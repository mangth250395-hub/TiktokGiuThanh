"""Staying up during a live of many hours (the user, 10/11/2026: "sao có lúc game tự tắt").

- One copy only: a Windows mutex decides at once. Asking the port was not enough: two copies opened a moment apart
  both started (the first did not answer yet), and Windows let the second take the same port; then the game page
  reported to the other copy and the watchdog reloaded a page that was fine (seen 10/11/2026 16:24-16:32).
- The browser inside the window (WebView2) can crash. The window stays, empty or frozen, and reloading the page does
  not help when the browser itself is gone. A crashed page is loaded again; a crashed browser, or a page that stays
  dead after a reload, restarts the whole app: points, players and rounds are on disk and the hub sends again what
  came in meanwhile, so the live goes on where it was.
- The game process itself can die (a crash, an antivirus ending it: the user, 10/11/2026, on another computer: "live
  được một lúc nó tự tắt app hoặc có thể là crash"). A dead process cannot restart itself, so the app runs as two
  processes: a small guard (no window) starts the game as its worker and starts it again when it ends without being
  closed by the user, writing the exit code in app.log (what killed it). Not while the game is being installed or
  removed.
- Never restart in a loop: at most MAX_RESTARTS within RESTART_WINDOW_S.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time

from . import config as C

MAX_RESTARTS = 3
RESTART_WINDOW_S = 600
_mutex = None

# how the worker (the game) ends: closed by the user / a message window (already open, missing files) / restart me
EXIT_CLOSED, EXIT_MESSAGE, EXIT_RESTART = 0, 2, 3
WORKER_ENV = "TIKTOKGIUTHANH_WORKER"        # set by the guard for its worker
GUARD_MUTEX = "TikTokGiuThanh_Guard"
SETUP_MUTEX = "TikTokGiuThanh_Setup"        # setup.iss SetupMutex: held while the installer runs
_guard = None


def supervised() -> bool:
    return os.environ.get(WORKER_ENV) == "1"


def single_instance(name: str) -> bool:
    """True when no other copy runs (the mutex stays held until this process ends)."""
    global _mutex
    if sys.platform != "win32":
        return True
    import ctypes
    k = ctypes.WinDLL("kernel32", use_last_error=True)
    k.CreateMutexW.restype = ctypes.c_void_p
    h = k.CreateMutexW(None, False, name)
    if not h:
        return True                                  # cannot tell: do not stop the app for it
    if ctypes.get_last_error() == 183:               # ERROR_ALREADY_EXISTS
        k.CloseHandle(ctypes.c_void_p(h))
        return False
    _mutex = h
    return True


def wait_for_exit(pid: int, timeout_s: float = 30) -> None:
    """A restart: wait until the old copy has ended (its mutex, port and files are free)."""
    if sys.platform != "win32" or not pid:
        return
    import ctypes
    k = ctypes.windll.kernel32
    h = k.OpenProcess(0x00100000, False, int(pid))   # SYNCHRONIZE
    if h:
        k.WaitForSingleObject(h, int(timeout_s * 1000))
        k.CloseHandle(h)


def may_restart(history: list[float], now: float) -> bool:
    """Not more than MAX_RESTARTS within RESTART_WINDOW_S (a fault that comes back at once must not loop)."""
    return sum(1 for t in history if now - t < RESTART_WINDOW_S) < MAX_RESTARTS


def _history_file():
    return C.DATA_DIR / "restarts.json"


def _read_history() -> list[float]:
    try:
        return [float(t) for t in json.loads(_history_file().read_text(encoding="utf-8"))][-20:]
    except (OSError, ValueError, TypeError):
        return []


def restart(reason: str, say, shutdown) -> bool:
    """Start a new copy of the app (it waits for this one to end) and end this one. False: too many restarts lately."""
    now = time.time()
    history = _read_history()
    if not may_restart(history, now):
        say(f"[APP] không tự khởi động lại ({reason}): đã khởi động lại {MAX_RESTARTS} lần trong {RESTART_WINDOW_S // 60} phút")
        return False
    try:
        _history_file().write_text(json.dumps([*history, now]), encoding="utf-8")
    except OSError:
        pass
    say(f"[APP] tự khởi động lại: {reason}")
    if supervised():                                  # the guard starts the game again when it ends with EXIT_RESTART
        threading.Thread(target=shutdown, args=(EXIT_RESTART,), name="restart", daemon=True).start()
        return True
    cmd = [sys.executable] if getattr(sys, "frozen", False) else [sys.executable, "-m", "giuthanh"]
    cmd += ["--wait-pid", str(os.getpid())]
    flags = 0x00000008 | 0x00000200 if sys.platform == "win32" else 0     # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    subprocess.Popen(cmd, close_fds=True, creationflags=flags, cwd=os.getcwd())
    threading.Thread(target=shutdown, name="restart", daemon=True).start()
    return True


def watch_browser(window, say, on_browser_gone) -> None:
    """When the WebView2 inside `window` (a pywebview window) is ready, react to its crashes: a page that crashed or
    hangs is loaded again; a browser that is gone calls on_browser_gone(reason)."""
    def attach():
        from System import Action  # noqa: PLC0415 - pythonnet, only with the Windows backend
        form = window.native
        done = threading.Event()

        def hook():
            core = form.webview.CoreWebView2
            if core is None:
                return
            core.ProcessFailed += on_failed
            done.set()

        def on_failed(sender, args):
            kind = str(args.ProcessFailedKind)
            say(f"[APP] trình duyệt trong cửa sổ game gặp lỗi: {kind} ({args.Reason})")
            if kind in ("BrowserProcessExited",):
                on_browser_gone(f"trình duyệt trong cửa sổ game đã tắt ({kind})")
            elif kind in ("RenderProcessExited", "RenderProcessUnresponsive", "FrameRenderProcessExited"):
                try:
                    sender.Reload()
                except Exception as e:  # noqa: BLE001 - the browser is gone after all
                    on_browser_gone(f"không tải lại được trang ({type(e).__name__})")
            # GPU and utility processes are started again by the browser itself: only written down

        for _ in range(60):                          # WebView2 is ready a little after the window shows
            try:
                form.Invoke(Action(hook))
            except Exception:  # noqa: BLE001 - the window is not there yet / closing
                pass
            if done.wait(1):
                return
        say("[APP] không theo dõi được trình duyệt trong cửa sổ game")
    threading.Thread(target=attach, name="watch-browser", daemon=True).start()


# ---------- the guard ----------
def _mutex_exists(name: str) -> bool:
    if sys.platform != "win32":
        return False
    import ctypes
    k = ctypes.windll.kernel32
    h = k.OpenMutexW(0x00100000, False, name)        # SYNCHRONIZE
    if h:
        k.CloseHandle(h)
        return True
    return False


def installing() -> bool:
    """The installer or the uninstaller of the game runs (the game must not be started again under it)."""
    if _mutex_exists(SETUP_MUTEX):
        return True
    try:
        out = subprocess.run(["tasklist", "/FO", "CSV", "/NH"], capture_output=True, text=True, timeout=10,
                             creationflags=0x08000000 if sys.platform == "win32" else 0).stdout.lower()   # CREATE_NO_WINDOW
    except (OSError, subprocess.SubprocessError):
        return False
    return "tiktokgiuthanh-setup" in out or '"unins0' in out


# ---------- what a crash leaves (the cause, written in app.log: the computer that crashes is not this one) ----------
def _children(pid: int) -> dict[int, list[int]]:
    """{parent pid: [child pids]} of the whole computer (one Toolhelp snapshot)."""
    import ctypes
    from ctypes import wintypes as W

    class PE(ctypes.Structure):
        _fields_ = [("dwSize", W.DWORD), ("cntUsage", W.DWORD), ("th32ProcessID", W.DWORD),
                    ("th32DefaultHeapID", ctypes.c_size_t), ("th32ModuleID", W.DWORD), ("cntThreads", W.DWORD),
                    ("th32ParentProcessID", W.DWORD), ("pcPriClassBase", ctypes.c_long), ("dwFlags", W.DWORD),
                    ("szExeFile", ctypes.c_wchar * 260)]
    k = ctypes.windll.kernel32
    k.CreateToolhelp32Snapshot.restype = ctypes.c_void_p
    snap = k.CreateToolhelp32Snapshot(2, 0)          # TH32CS_SNAPPROCESS
    tree: dict[int, list[int]] = {}
    e = PE()
    e.dwSize = ctypes.sizeof(PE)
    ok = k.Process32FirstW(ctypes.c_void_p(snap), ctypes.byref(e))
    while ok:
        tree.setdefault(e.th32ParentProcessID, []).append(e.th32ProcessID)
        ok = k.Process32NextW(ctypes.c_void_p(snap), ctypes.byref(e))
    k.CloseHandle(ctypes.c_void_p(snap))
    return tree


def _private_mb(pid: int) -> int:
    import ctypes
    from ctypes import wintypes as W

    class PMC(ctypes.Structure):
        _fields_ = [("cb", W.DWORD), ("PageFaultCount", W.DWORD)] + [(n, ctypes.c_size_t) for n in (
            "PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage", "QuotaPagedPoolUsage",
            "QuotaPeakNonPagedPoolUsage", "QuotaNonPagedPoolUsage", "PagefileUsage", "PeakPagefileUsage", "PrivateUsage")]
    k = ctypes.windll.kernel32
    k.OpenProcess.restype = ctypes.c_void_p
    h = k.OpenProcess(0x1000, False, pid)            # PROCESS_QUERY_LIMITED_INFORMATION
    if not h:
        return 0
    m = PMC()
    m.cb = ctypes.sizeof(PMC)
    ok = ctypes.windll.psapi.GetProcessMemoryInfo(ctypes.c_void_p(h), ctypes.byref(m), m.cb)
    k.CloseHandle(ctypes.c_void_p(h))
    return int(m.PrivateUsage // 2**20) if ok else 0


def _free_ram_mb() -> tuple[int, int]:
    """(free, total) physical memory of the computer, in MB."""
    import ctypes

    class MS(ctypes.Structure):
        _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong)] + [(n, ctypes.c_ulonglong) for n in (
            "ullTotalPhys", "ullAvailPhys", "ullTotalPageFile", "ullAvailPageFile", "ullTotalVirtual",
            "ullAvailVirtual", "ullAvailExtendedVirtual")]
    m = MS()
    m.dwLength = ctypes.sizeof(MS)
    ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))
    return int(m.ullAvailPhys // 2**20), int(m.ullTotalPhys // 2**20)


def health() -> str:
    """One line: the memory of the game, of the browser inside its window, and what the computer has left. Written
    every few minutes: memory that keeps growing until the game dies shows in app.log."""
    if sys.platform != "win32":
        return ""
    try:
        me = os.getpid()
        tree = _children(me)
        browser, todo = [], list(tree.get(me, []))
        while todo:                                  # WebView2 and its own processes, under this one
            p = todo.pop()
            browser.append(p)
            todo += tree.get(p, [])
        free, total = _free_ram_mb()
        return (f"game {_private_mb(me)} MB · trình duyệt {sum(_private_mb(p) for p in browser)} MB ({len(browser)} tiến trình)"
                f" · máy còn trống {free} / {total} MB")
    except Exception as e:  # noqa: BLE001 - only a note in the log
        return f"không đo được ({type(e).__name__})"


def watch_health(say, stop: threading.Event, every_s: float = 300, more=None) -> None:
    """every_s: one [SỨC KHỎE] line; more(): what else to add (how fast the voice is made)."""
    def run():
        while not stop.wait(every_s):
            extra = ""
            try:
                extra = f" · {more()}" if more else ""
            except Exception:  # noqa: BLE001 - only a note
                pass
            say(f"[SỨC KHỎE] {health()}{extra}")
    threading.Thread(target=run, name="health", daemon=True).start()


def crash_report(since_s: float = 180) -> list[str]:
    """What Windows wrote down about a program that crashed lately (Application Error 1000, a .NET error 1026, a hang
    1002) and a computer short of memory (2004): the faulting module and the exception code tell the cause."""
    if sys.platform != "win32":
        return []
    ms = int(since_s * 1000)
    out = []
    for log, ids in (("Application", "EventID=1000 or EventID=1002 or EventID=1026"), ("System", "EventID=2004")):
        q = f"*[System[({ids}) and TimeCreated[timediff(@SystemTime) <= {ms}]]]"
        try:
            text = subprocess.run(["wevtutil", "qe", log, f"/q:{q}", "/c:5", "/rd:true", "/f:text"], capture_output=True,
                                  text=True, timeout=15, errors="replace",
                                  creationflags=0x08000000).stdout                 # CREATE_NO_WINDOW
        except (OSError, subprocess.SubprocessError):
            continue
        for block in text.split("Event[")[1:]:
            lines = [l.strip() for l in block.splitlines() if l.strip()]
            desc = " ".join(lines[lines.index("Description:") + 1:] if "Description:" in lines else lines)
            if log == "Application" and not any(n in desc.lower() for n in ("tiktokgiuthanh", "msedgewebview2")):
                continue                             # another program's crash
            out.append(f"{log}: {desc[:600]}")
    return out


def guard_step(code: int, history: list[float], now: float, setup_running: bool) -> tuple[str, str]:
    """After the worker ended with `code`: ("stop" | "restart", why)."""
    if code == EXIT_CLOSED:
        return "stop", "người dùng đóng game"
    if code == EXIT_MESSAGE:
        return "stop", "ứng dụng chỉ hiện thông báo"
    if setup_running:
        return "stop", "đang cài hoặc gỡ game"
    why = "game xin khởi động lại" if code == EXIT_RESTART else f"game dừng bất thường, mã {code & 0xFFFFFFFF:#010x}"
    if code != EXIT_RESTART and not may_restart(history, now):     # the game limits its own restarts (restarts.json)
        return "stop", f"{why}; đã mở lại {MAX_RESTARTS} lần trong {RESTART_WINDOW_S // 60} phút, thôi"
    return "restart", why


def guard(argv: list[str], say) -> int:
    """Run the game as a worker process and start it again when it dies. Returns the worker's last exit code."""
    global _guard
    if sys.platform == "win32":
        import ctypes
        k = ctypes.WinDLL("kernel32", use_last_error=True)
        k.CreateMutexW.restype = ctypes.c_void_p
        h = k.CreateMutexW(None, False, GUARD_MUTEX)
        if h and ctypes.get_last_error() == 183:    # a guard runs already: the worker shows "already open"
            k.CloseHandle(ctypes.c_void_p(h))
            return -1
        _guard = h
    cmd = [sys.executable] if getattr(sys, "frozen", False) else [sys.executable, "-m", "giuthanh"]
    cmd += [*argv, "--worker"]
    env = {**os.environ, WORKER_ENV: "1"}
    history: list[float] = []
    while True:
        t0 = time.time()
        code = subprocess.Popen(cmd, env=env, close_fds=True).wait()
        now = time.time()
        step, why = guard_step(code, history, now, installing())
        say(f"[GUARD] game kết thúc sau {now - t0:.0f} giây: {why}" + (" · mở lại" if step == "restart" else ""))
        if code not in (EXIT_CLOSED, EXIT_MESSAGE, EXIT_RESTART):
            time.sleep(2)                              # Windows writes its report of the crash a moment later
            try:
                free, total = _free_ram_mb() if sys.platform == "win32" else (0, 0)
                say(f"[GUARD] máy còn trống {free} / {total} MB bộ nhớ")
            except Exception:  # noqa: BLE001 - only a note
                pass
            for line in crash_report(min(now - t0 + 60, 3600)) or ["Windows không ghi lỗi nào của game (có thể bị chương trình khác tắt)"]:
                say(f"[GUARD] {line}")
        if step == "stop":
            return code
        if code != EXIT_RESTART:
            history.append(now)
            time.sleep(3)                              # let the dead process free its port and files

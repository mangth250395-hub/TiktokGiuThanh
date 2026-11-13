"""The app window: the hub runs in a background thread, the window (WebView2, built into Windows) shows the hub's
own page. Closing the window stops the hub, after asking. Opening the app a second time while a hub already runs
only opens a window on it."""
from __future__ import annotations

import asyncio
import html
import os
import subprocess
import sys
import threading
from pathlib import Path

import httpx

from . import config as C
from .server import Hub, say

VI = {
    "global.quitConfirmation": "Thoát TikTok Live Hub? Các game đang nối sẽ mất kết nối TikTok.",
    "global.ok": "Thoát",
    "global.quit": "Thoát",
    "global.cancel": "Ở lại",
    "global.saveFile": "Lưu",
    "windows.fileFilter.allFiles": "Mọi file",
    "windows.fileFilter.otherFiles": "File khác",
}


def hub_answers(port: int) -> bool:
    try:
        r = httpx.get(f"http://127.0.0.1:{port}/api/status", timeout=1.5)
        return r.status_code == 200 and "epoch" in r.json()
    except (httpx.HTTPError, ValueError):
        return False


def set_clipboard(text: str) -> bool:
    if sys.platform != "win32":
        if sys.platform != "darwin":
            return False
        try:                                  # a Mac: its own command for the clipboard
            return subprocess.run(["pbcopy"], input=text.encode("utf-8"), timeout=5).returncode == 0
        except (OSError, subprocess.SubprocessError):
            return False
    import ctypes
    from ctypes import wintypes
    u32, k32 = ctypes.windll.user32, ctypes.windll.kernel32
    k32.GlobalAlloc.restype = wintypes.HGLOBAL
    k32.GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
    k32.GlobalLock.restype = wintypes.LPVOID
    k32.GlobalLock.argtypes = [wintypes.HGLOBAL]
    k32.GlobalUnlock.argtypes = [wintypes.HGLOBAL]
    u32.SetClipboardData.argtypes = [wintypes.UINT, wintypes.HANDLE]
    u32.SetClipboardData.restype = wintypes.HANDLE
    data = text.encode("utf-16-le") + b"\0\0"
    for _ in range(10):                      # another program may hold the clipboard for a moment
        if u32.OpenClipboard(None):
            break
        import time
        time.sleep(0.05)
    else:
        return False
    try:
        u32.EmptyClipboard()
        h = k32.GlobalAlloc(0x0002, len(data))          # GMEM_MOVEABLE
        ptr = k32.GlobalLock(h)
        ctypes.memmove(ptr, data, len(data))
        k32.GlobalUnlock(h)
        return bool(u32.SetClipboardData(13, h))        # CF_UNICODETEXT
    finally:
        u32.CloseClipboard()


class Api:
    """Called by the page through window.pywebview.api (only inside this window, never by a game)."""

    def __init__(self, cfg: dict, owner: bool = True):
        self._cfg = cfg
        self._owner = owner      # False: this window shows another app's hub, whose settings may have changed
        self._window = None

    def _current(self) -> dict:
        return self._cfg if self._owner else C.load()

    def pick_json_file(self):
        import webview
        got = self._window.create_file_dialog(webview.FileDialog.OPEN, file_types=("File cấu hình (*.json)", "Mọi file (*.*)"))
        return got[0] if got else None

    def token(self):
        return self._current().get("token", "")

    def copy(self, text: str) -> bool:
        """Put text on the Windows clipboard (the page's clipboard API is not always allowed in the window)."""
        return set_clipboard(str(text))

    def export_config(self):
        """Save proxies (keys in clear) and settings to a file chosen by the user, to set up another computer."""
        import json

        import webview
        got = self._window.create_file_dialog(webview.FileDialog.SAVE, save_filename="TikTokLiveHub-cauhinh.json",
                                              file_types=("File cấu hình (*.json)",))
        if not got:
            return None
        path = got if isinstance(got, str) else got[0]
        Path(path).write_text(json.dumps(C.export(self._current()), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return path

    def open_folder(self, which: str):
        path = C.LOG_DIR if which == "logs" else C.CONFIG_FILE.parent
        Path(path).mkdir(parents=True, exist_ok=True)
        if sys.platform == "win32":
            os.startfile(path)   # noqa: S606 - opens Explorer on our own folder
        else:
            subprocess.Popen(["open" if sys.platform == "darwin" else "xdg-open", str(path)])   # Finder


class HubThread:
    def __init__(self, cfg: dict):
        self.hub = Hub(cfg)
        self.loop: asyncio.AbstractEventLoop | None = None
        self.task: asyncio.Task | None = None
        self.ready = threading.Event()
        self.error: BaseException | None = None
        self.thread = threading.Thread(target=self._run, name="hub", daemon=True)

    def _run(self) -> None:
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)

        async def main():
            up = asyncio.Event()
            self.task = asyncio.create_task(self.hub.run(ready=up))
            waiter = asyncio.create_task(up.wait())
            await asyncio.wait({self.task, waiter}, return_when=asyncio.FIRST_COMPLETED)
            waiter.cancel()
            self.ready.set()
            await self.task
        try:
            self.loop.run_until_complete(main())
        except asyncio.CancelledError:
            pass
        except BaseException as e:  # noqa: BLE001 - shown in the window (port taken, ...)
            self.error = e
        finally:
            self.ready.set()

    def start(self) -> bool:
        self.thread.start()
        self.ready.wait(20)
        return self.error is None and self.task is not None and not self.task.done()

    def stop(self) -> None:
        if self.loop and self.task and not self.task.done():
            self.loop.call_soon_threadsafe(self.task.cancel)
        self.thread.join(timeout=10)


def error_page(msg: str) -> str:
    return f"""<!doctype html><meta charset="utf-8"><body style="font:15px 'Segoe UI',sans-serif;padding:40px;color:#1b1f24">
    <h2>TikTok Live Hub không chạy được</h2><p>{msg}</p></body>"""


def show_error(msg: str) -> int:
    """A window that says why the app cannot start (the exe has no console to print it)."""
    import webview
    webview.create_window("TikTok Live Hub", html=error_page(html.escape(msg)), width=640, height=320)
    webview.start(localization=VI)
    return 2


APP_MUTEX = "TikTokLiveHub_Running"   # the installer looks for it to ask "close the app first" (setup.iss AppMutex)


def run_app(cfg: dict) -> int:
    import webview
    try:
        import ctypes
        ctypes.windll.kernel32.CreateMutexW(None, False, APP_MUTEX)   # held until the process ends
    except (AttributeError, OSError):
        pass

    port = C.port_of(cfg)
    url = f"http://127.0.0.1:{port}/"
    attached = hub_answers(port)
    api = Api(cfg, owner=not attached)
    state = {"runner": None, "closed": threading.Event()}
    if attached:
        say(f"[APP] hub đã chạy ở cổng {port}: chỉ mở cửa sổ (nếu hub đó tắt, cửa sổ này tự chạy hub riêng)")
        window = webview.create_window("TikTok Live Hub", url, js_api=api, width=1060, height=720, min_size=(760, 520))
    else:
        runner = HubThread(cfg)
        if runner.start():
            state["runner"] = runner
            window = webview.create_window("TikTok Live Hub", url, js_api=api, width=1060, height=720, min_size=(760, 520),
                                           confirm_close=True)
        else:
            e = runner.error
            port_taken = isinstance(e, OSError) and (getattr(e, "winerror", None) == 10048 or e.errno in (98, 48, 10048))
            msg = (f"Cổng {port} đang bị chương trình khác dùng. Tắt chương trình đó, hoặc đổi cổng trong tab Cài đặt "
                   f"(hoặc <code>port</code> trong <code>{C.CONFIG_FILE}</code>)." if port_taken
                   else f"Lỗi: {html.escape(type(e).__name__)}: {html.escape(str(e))}")
            window = webview.create_window("TikTok Live Hub", html=error_page(msg), width=640, height=300)
    api._window = window

    def take_over():
        """This window shows another app's hub: when that one closes, run our own and reload, instead of
        leaving a window with nothing behind it (seen 09/11/2026: buttons that did nothing)."""
        while not state["closed"].wait(2):
            if hub_answers(port):
                continue
            say("[APP] hub kia đã tắt: chạy hub của cửa sổ này")
            runner = HubThread(C.load())
            if runner.start():
                state["runner"] = runner
                window.confirm_close = True
                api._cfg, api._owner = runner.hub.cfg, True
                window.load_url(url)
                return
            # the port is not free yet (the other app is still closing): try again shortly

    if attached:
        threading.Thread(target=take_over, name="take-over", daemon=True).start()
    webview.start(localization=VI, private_mode=True)
    state["closed"].set()
    if state["runner"]:
        state["runner"].stop()
    return 0

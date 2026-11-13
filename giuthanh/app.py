"""The app: two windows over the local server, and the TikTok Live Hub inside (hubrun.py).

  "Giữ thành"              the game, 9:16: this is the window captured for the live (TikTok LIVE Studio / OBS)
  "Điều khiển"             channel, rounds, voice, tests (closing it only minimizes it)

Closing the game window quits the app (after asking).
"""
from __future__ import annotations

import html
import os
import sys
import threading
import time

import httpx

from . import capture, lifecycle, tts
from . import config as C
from .hubrun import EmbeddedHub
from .server import Server, say

APP_MUTEX = "TikTokGiuThanh_Running"   # setup.iss AppMutex: the installer asks to close the app first
GAME_TITLE = C.TITLE

VI = {
    "global.quitConfirmation": "Thoát Giữ thành? Trận đang chơi đã được lưu, mở lại sẽ chơi tiếp.",
    "global.ok": "Thoát",
    "global.quit": "Thoát",
    "global.cancel": "Ở lại",
}


def already_running(port: int) -> bool:
    try:
        r = httpx.get(f"http://127.0.0.1:{port}/api/ping", timeout=1.5)
        return r.status_code == 200 and r.json().get("app") == C.APP
    except (httpx.HTTPError, ValueError):
        return False


def message(title: str, text: str) -> int:
    import webview
    webview.create_window(title, html=f"""<!doctype html><meta charset="utf-8"><body style="font:15px 'Segoe UI',sans-serif;
      padding:32px;color:#1b1f24"><h2>{html.escape(title)}</h2><p>{text}</p></body>""", width=600, height=300)
    webview.start(localization=VI)
    return 2


def run_app(port: int = C.PORT, wait_pid: int | None = None) -> int:
    import webview
    if wait_pid:
        lifecycle.wait_for_exit(wait_pid)            # a restart: the old copy ends first
    # the commentator talks without anyone clicking first: let the window play sound on its own
    # and keep it running at full speed when it is covered or minimized: the live capture must not freeze
    os.environ["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = (
        os.environ.get("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "") + " --autoplay-policy=no-user-gesture-required"
        " --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows"
        " --disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling").strip()   # one list: only the last counts

    # one copy only: the mutex answers at once (asking the port let two copies opened together both start)
    if not lifecycle.single_instance(APP_MUTEX) or already_running(port):
        return message("Giữ thành đang mở", "Ứng dụng đã mở rồi (xem trên thanh tác vụ). Mỗi máy chỉ chạy một bản, "
                       "để điểm không bị đếm hai lần.")
    if not C.web_dir().joinpath("index.html").exists():
        return message("Thiếu giao diện", f"Không thấy {html.escape(str(C.web_dir()))}. Chạy <code>npm run build</code> trong thư mục web.")
    try:
        server = Server(port).start()
        hub = EmbeddedHub(say)
        hub.start()                       # the hub, in this app (or the separate one already running)
        server.bus.hub = hub
    except OSError as e:
        return message("Không mở được cổng", f"Cổng {port} đang bị chương trình khác dùng ({html.escape(str(e))}).")
    url = f"http://127.0.0.1:{server.port}"
    say(f"[APP] mở bản {C.VERSION} (tiến trình {os.getpid()}{', sau khi tự khởi động lại' if wait_pid else ''}) · {url}")
    if C.load_settings().get("voice", "").startswith("vieneu:"):
        tts.start_vieneu()                # the voice model loads while the windows open (Edge speaks meanwhile)

    game = webview.create_window(GAME_TITLE, f"{url}/", width=540, height=1000, min_size=(270, 500),
                                 confirm_close=True, background_color="#17301c")
    # wide enough for the hub's own page, which is shown inside it (the tab "Kết nối")
    control = webview.create_window("Điều khiển · Giữ thành", f"{url}/control", width=760, height=900,
                                    min_size=(460, 500))

    def control_closing():
        control.minimize()
        return False          # keep it: there is no other way to reopen it

    def game_closed():
        say("[APP] cửa sổ game đã đóng")
        control.events.closing -= control_closing
        try:
            control.destroy()
        except Exception:  # noqa: BLE001 - already gone
            pass
        hub.close_window()

    def fit_game():
        try:
            got = capture.fit(game)
            say(f"[APP] cửa sổ game: {got[0]}x{got[1]} điểm ảnh (khung live 1080x1920)" if got else "[APP] không chỉnh được cỡ cửa sổ game")
            return got
        except Exception as e:  # noqa: BLE001 - the window stays as it is
            say(f"[APP] không chỉnh được cỡ cửa sổ game: {e}")
            return None

    restarting = threading.Event()

    def restart(reason: str) -> None:
        """The game cannot be brought back in this window: a fresh copy of the app (once at a time)."""
        if not restarting.is_set():
            say(f"[SỨC KHỎE] {lifecycle.health()}")
        if not restarting.is_set() and lifecycle.restart(reason, say, lambda code=0: _shutdown(hub, server, code)):
            restarting.set()

    def on_shown():
        fit_game()
        lifecycle.watch_browser(game, say, restart)

    server.bus.fit_game = fit_game
    control.events.closing += control_closing
    game.events.shown += on_shown
    game.events.closed += game_closed
    stop = threading.Event()
    threading.Thread(target=_watchdog, args=(server, game, url, stop, restart), name="watchdog", daemon=True).start()
    lifecycle.watch_health(say, stop, more=tts.voice_stats)   # every 5 minutes: memory, and how fast the voice is made
    webview.start(localization=VI, private_mode=True)
    stop.set()
    _shutdown(hub, server)
    return 0


def _shutdown(hub, server, code: int = 0) -> None:
    """The game window is closed: the app ends for good. The hub and the server get a few seconds to stop; whatever
    still runs after that (a stuck connection, a thread that never ends) is not waited for: no process is ever left
    running hidden (an old version stayed behind using a CPU core, 10/11/2026). The game is saved by the page itself."""
    def stop_all():
        try:
            hub.stop()
        finally:
            server.stop()
    t = threading.Thread(target=stop_all, name="shutdown", daemon=True)
    t.start()
    t.join(SHUTDOWN_S)
    say("[APP] đã tắt" if not t.is_alive() else f"[APP] tắt sau {SHUTDOWN_S} giây chờ (hub chưa dừng hẳn)")
    try:
        sys.stdout.flush()
    except Exception:  # noqa: BLE001 - nowhere to write
        pass
    os._exit(code)


SHUTDOWN_S = 5        # closing: what does not stop within this long is not waited for
WATCH_S = 30          # the game page reports every 2 s; this long without a word: it is stuck
RELOAD_GAP_S = 90
AFTER_RELOAD_S = 60   # still nothing heard this long after a reload: the window cannot bring it back, restart the app


def watch_step(heard: float, now: float, last_reload: float) -> str:
    """What the watchdog does now: "ok" (the page reports, or never did yet), "wait", "reload" or "restart"."""
    if not heard or now - heard < WATCH_S:
        return "ok"
    if last_reload and heard < last_reload and now - last_reload >= AFTER_RELOAD_S:
        return "restart"                       # reloaded, and not a word since
    return "wait" if now - last_reload < RELOAD_GAP_S else "reload"


def _watchdog(server, game, url: str, stop: threading.Event, restart=None) -> None:
    """The game page has hung (nothing heard for WATCH_S): load it again. Still nothing after the reload (the browser
    inside the window is gone; 10/11/2026: three reloads in a row did nothing): restart the whole app. Points, players
    and rounds are on disk and the hub sends again what came in meanwhile, so the live goes on where it was."""
    last = 0.0
    while not stop.wait(5):
        heard = server.bus.status_at
        now = time.time()
        step = watch_step(heard, now, last)
        if step == "restart" and restart:
            restart(f"trang game vẫn không phản hồi {int(now - last)} giây sau khi tải lại")
            return
        if step != "reload":
            continue
        last = now
        say(f"[WATCHDOG] trang game không phản hồi {int(now - heard)} giây: tải lại (điểm và người chơi vẫn giữ)")
        try:
            game.load_url(f"{url}/")
        except Exception as e:  # noqa: BLE001 - the window is closing
            say(f"[WATCHDOG] không tải lại được: {e}")


def run_dev(port: int = C.PORT, hub_port: int | None = None) -> int:
    """Only the server (for `npm run dev`, which serves the pages with hot reload on :5179). With `hub_port`, a hub
    too, on that port: the connection to TikTok can be worked on beside the installed app, which keeps 8765."""
    server = Server(port).start()
    say(f"[DEV] API on http://127.0.0.1:{server.port} · pages: cd web && npm run dev -> http://localhost:5179")
    hub = None
    if hub_port:
        hub = EmbeddedHub(say, port=hub_port, windows=False)
        hub.start()
        server.bus.hub = hub
        say(f"[DEV] hub: {hub.state} · http://127.0.0.1:{hub.port}/")
    try:
        server.thread.join()
    except KeyboardInterrupt:
        pass
    finally:
        if hub:
            hub.stop()
    return 0


def selftest() -> int:
    """The packaged app has what it needs: pages, pictures, voice, windows, and the hub inside (its own selftest)."""
    import traceback
    try:
        ok = C.web_dir().joinpath("index.html").exists() and C.web_dir().joinpath("ts", "blue", "castle.png").exists()
        import edge_tts  # noqa: F401
        import webview  # noqa: F401
        from . import tts  # noqa: F401
        import onnxruntime  # noqa: F401
        import sea_g2p  # noqa: F401
        import soundfile  # noqa: F401
        import vieneu  # noqa: F401
        from .hubrun import _hub
        _hub()
        from hub.__main__ import cmd_selftest as hub_selftest
        ok = ok and hub_selftest() == 0
        say("OK" if ok else f"MISSING {C.web_dir()}")
        return 0 if ok else 1
    except Exception:  # noqa: BLE001 - a window app: never a crash dialog in the middle of a build
        traceback.print_exc()
        return 1


def voicetest(out: str) -> int:
    """The voice works in this build: the VieNeu model opens and says a line (the settings' voice, else Adam bựa)."""
    import shutil
    voice = C.load_settings().get("voice", "")
    voice = voice if voice.startswith("vieneu:") else "vieneu:Adam bựa"
    t0 = time.time()
    tts.start_vieneu()
    while tts.vieneu_state()["state"] == "loading" and time.time() - t0 < 900:
        time.sleep(0.3)
    st = tts.vieneu_state()
    if st["state"] != "ready":
        say(f"VOICE FAILED {st}")
        return 1
    t1 = time.time()
    f = tts.speak("Xin chào cả nhà, Adam bựa đây! Chào mừng đến với trận giữ thành!", voice)
    shutil.copy(f, out)
    say(f"VOICE OK {voice}: model {t1 - t0:.1f}s, line {time.time() - t1:.1f}s, {f.suffix}")
    return 0


def main(argv=None) -> int:
    import argparse
    for stream in (sys.stdout, sys.stderr):      # a Windows console: Vietnamese messages must not crash the app
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    ap = argparse.ArgumentParser(prog="TikTokGiuThanh")
    ap.add_argument("--dev", action="store_true", help="only the local server (pages from npm run dev)")
    ap.add_argument("--port", type=int, default=C.PORT)
    ap.add_argument("--hub-port", type=int, metavar="PORT", help="with --dev: also run a hub, on this port (not 8765: the installed app's)")
    ap.add_argument("--selftest", action="store_true", help="check the packaged app has what it needs")
    ap.add_argument("--voicetest", metavar="FILE", help="say one line with the chosen VieNeu voice into FILE (no windows)")
    ap.add_argument("--wait-pid", type=int, help=argparse.SUPPRESS)   # a restart: the copy to wait for
    ap.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)   # the game itself, started by the guard
    ap.add_argument("--no-guard", action="store_true", help="run the game without the guard that restarts it")
    a = ap.parse_args(argv)
    try:
        import faulthandler
        faulthandler.enable(sys.stderr)          # a crash of Python itself is written in app.log (why the app ended)
    except (AttributeError, ValueError, OSError):
        pass
    if a.selftest:
        return selftest()
    if a.voicetest:
        return voicetest(a.voicetest)
    if a.dev:
        return run_dev(a.port, a.hub_port)
    if not (a.worker or a.no_guard or a.wait_pid):
        # the guard: starts the game and starts it again if it dies (a crash ends the game process, it cannot do it)
        extra = ["--port", str(a.port)] if a.port != C.PORT else []
        code = lifecycle.guard(extra, say)
        if code != -1:
            return code
        # a guard runs already: this copy only says the game is open (single instance, below)
    return run_app(a.port, a.wait_pid)


if __name__ == "__main__":
    sys.exit(main())

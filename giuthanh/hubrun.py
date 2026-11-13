"""TikTok Live Hub, inside this app: one program to open for a live.

The hub is the part that connects to TikTok LIVE (through proxies, or straight from this computer: the user's choice)
and hands the comments, likes and gifts to the game. Its code is a project of its own; this repository carries a copy
in hub_src/ (tools/sync_hub.py), and that copy is what runs: from the source it is imported from hub_src/, in the exe
it is packed in (build.bat). Nothing outside the repository is ever imported, unless TIKTOKGIUTHANH_HUB names another
folder that holds a hub/ (to work on the hub itself). It keeps its own settings in %APPDATA%\\TikTokLiveHub (proxies,
keys), the same as the separate hub app, so nothing has to be set up twice.

  - a hub already runs (the separate app, or another game): the game uses it, nothing more starts
  - no hub: this app runs one, and stops it when the app closes
  - the other hub closes while the game runs: this app takes over, so the game keeps its connection
"""
from __future__ import annotations

import os
import sys
import threading
from pathlib import Path

HUB_COPY = Path(__file__).resolve().parents[1] / "hub_src"           # the hub's code, in this repository


def hub_source() -> Path:
    """Where the hub's code is taken from when running from the source: the copy in this repository. (A folder that
    merely sits next to a clone is never imported: asked for by name only, with TIKTOKGIUTHANH_HUB.)"""
    asked = os.environ.get("TIKTOKGIUTHANH_HUB")
    if asked and (Path(asked) / "hub" / "server.py").exists():
        return Path(asked)
    return HUB_COPY


def _hub():
    if not getattr(sys, "frozen", False):
        src = str(hub_source())
        if src not in sys.path:
            sys.path.insert(0, src)
    from hub import app as HA
    from hub import config as HC
    return HC, HA


class EmbeddedHub:
    def __init__(self, say=print, port: int | None = None, windows: bool = True):
        self.say = say
        self.runner = None
        self.state = "chưa chạy"
        self.port = 8765
        self.want_port = port        # a port for this run only (a development run beside the real app), never saved
        self.windows = windows       # False: no window can be opened (a development run has none)
        self.api = None
        self.window = None
        self._closed = threading.Event()

    def _load(self, HC) -> dict:
        cfg = HC.load()
        if self.want_port:
            cfg["_port"] = self.want_port
        return cfg

    @property
    def mode(self) -> str:
        return "embedded" if self.runner else "external" if self.state.startswith("dùng hub") else "none"

    def start(self) -> None:
        try:
            HC, HA = _hub()
        except Exception as e:  # noqa: BLE001 - the exe was built without it, or the source is missing
            self.state = f"không nạp được hub ({type(e).__name__}: {e})"
            return
        try:
            cfg = self._load(HC)
        except Exception as e:  # noqa: BLE001 - a broken config.json: the separate hub app says the same
            self.state = f"cấu hình hub lỗi: {e}"
            return
        self.port = HC.port_of(cfg)
        if HA.hub_answers(self.port):
            self.state = "dùng hub đang mở riêng"
            self.api = HA.Api(cfg, owner=False)
            self.say(f"[HUB] dùng hub đang chạy ở cổng {self.port}")
            threading.Thread(target=self._take_over, name="hub-watch", daemon=True).start()
            return
        runner = HA.HubThread(cfg)
        if runner.start():
            self.runner = runner
            self.api = HA.Api(runner.hub.cfg, owner=True)
            self.state = "chạy bên trong ứng dụng"
            self.say(f"[HUB] chạy bên trong ứng dụng, cổng {self.port}"
                     + ("" if cfg.get("use_proxy", True) else " · nối thẳng tới TikTok, không dùng proxy"))
        else:
            self.state = f"không chạy được hub: {runner.error}"

    def _take_over(self) -> None:
        """The separate hub closed: run ours, so the game keeps its events."""
        HC, HA = _hub()
        while not self._closed.wait(3):
            if HA.hub_answers(self.port):
                continue
            try:
                runner = HA.HubThread(self._load(HC))
            except Exception as e:  # noqa: BLE001 - the config file is being written, or broken: look again shortly
                self.state = f"cấu hình hub lỗi: {e}"
                continue
            if runner.start():
                self.runner = runner
                self.api = HA.Api(runner.hub.cfg, owner=True)
                self.state = "chạy bên trong ứng dụng"
                self.say("[HUB] hub riêng đã tắt: chạy hub bên trong ứng dụng")
                return

    def open_window(self) -> None:
        """The hub's own page (proxies, channels, log) in a window of this app."""
        if not self.windows:
            return
        import webview
        if self.window is not None:
            try:
                self.window.restore()
                self.window.show()
                return
            except Exception:  # noqa: BLE001 - closed meanwhile
                self.window = None
        w = webview.create_window("TikTok Live Hub", f"http://127.0.0.1:{self.port}/", js_api=self.api,
                                  width=1060, height=720, min_size=(760, 520))
        if self.api is not None:
            self.api._window = w

        def closed():
            self.window = None
        w.events.closed += closed
        self.window = w

    def close_window(self) -> None:
        """The game window is closed: the hub's own window goes too (left open, it kept the whole app running with
        nothing to show for it: the server, the connection to TikTok, and "Giữ thành đang mở" at the next start)."""
        w, self.window = self.window, None
        if w is not None:
            try:
                w.destroy()
            except Exception:  # noqa: BLE001 - already gone
                pass

    def stop(self) -> None:
        self._closed.set()
        if self.runner:
            self.runner.stop()

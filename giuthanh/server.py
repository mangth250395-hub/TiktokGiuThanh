"""The app's local web server (127.0.0.1 only): the game page, the control page, and their small API.

  /                    the game (9:16), the window that goes on the live
  /control             the control window
  /api/settings        GET / POST          channel, round length, voice
  /api/state           GET / POST          the session (saved by the game page every few seconds)
  /api/tts?text=...    GET                 the audio of a line (VieNeu .ogg, or Edge .mp3; cached)
  /api/voice-state     GET                 the VieNeu voice: off / loading / ready / failed
  /api/cmd             POST                control -> game (buttons), sent on /api/stream
  /api/stream          GET (event-stream)  what the game page listens to
  /api/game-status     POST / GET          game -> control (what the control window shows)
  /api/hub             GET                 the hub inside this app: running, or the separate one used
  /api/open-hub        POST                open the hub's own page (proxies, channels) in a window
  /api/open-data       POST                open the app's data folder (app.log, settings, session) in Explorer
  /api/fit-game        POST                the game window back to 1080 x 1920 real pixels (a sharp live picture)
"""
from __future__ import annotations

import json
import mimetypes
import os
import queue
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from . import config as C
from . import tts

MAX_BODY = 32 * 1024 * 1024
LOG_PER_MIN = 60
# a page of this computer: the app's own windows (http://127.0.0.1:PORT), or the pages served by `npm run dev`
LOCAL_ORIGIN = re.compile(r"^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$", re.I)
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("font/woff2", ".woff2")


def say(msg: str) -> None:
    print(f"{time.strftime('%H:%M:%S')} {msg}", flush=True)


class Bus:
    """Commands of the control window, passed on to every open game page."""

    def __init__(self):
        self.clients: list[queue.Queue] = []
        self.lock = threading.Lock()
        self.status: dict = {}
        self.status_at = 0.0
        self.hub = None               # the hub run by this app (hubrun.EmbeddedHub), when there is one
        self._logged: list[float] = []   # when the page's last lines were written in app.log
        self.fit_game = None          # app.py: makes the game window 1080 x 1920 real pixels, gives its inside size

    def may_log(self) -> bool:
        """The page writes its errors in app.log: at most LOG_PER_MIN lines a minute (a page that throws on every
        frame must not fill the disk)."""
        now = time.time()
        with self.lock:
            self._logged = [t for t in self._logged if now - t < 60]
            if len(self._logged) >= LOG_PER_MIN:
                return False
            self._logged.append(now)
            return True

    def join(self) -> queue.Queue:
        q: queue.Queue = queue.Queue(maxsize=200)
        with self.lock:
            self.clients.append(q)
        return q

    def leave(self, q: queue.Queue) -> None:
        with self.lock:
            if q in self.clients:
                self.clients.remove(q)

    def send(self, msg: dict) -> int:
        with self.lock:
            for q in self.clients:
                try:
                    q.put_nowait(msg)
                except queue.Full:
                    pass
            return len(self.clients)


class Handler(BaseHTTPRequestHandler):
    server_version = "TikTokGiuThanh"
    bus: Bus
    web: Path
    port: int

    def log_message(self, fmt, *args):  # noqa: D401 - quiet: the app has no console
        pass

    # ---------- helpers ----------
    def _host_ok(self) -> bool:
        # only pages of this computer (a web site cannot reach the app through a DNS trick)
        host = (self.headers.get("Host") or "").lower()
        return host in {f"127.0.0.1:{self.port}", f"localhost:{self.port}"} or host.startswith(("127.0.0.1:", "localhost:"))

    def _own_page(self) -> bool:
        """Is the caller one of the app's own pages (or a program of this computer), and not a web site?
        The Host check alone lets any web page open in a browser of this computer POST here: it could make the
        commentator speak, wipe the session, change the channel. A browser always says where such a request comes
        from: Origin on every POST from another site, Sec-Fetch-Site on every request (Chromium, so WebView2 too)."""
        origin = (self.headers.get("Origin") or "").lower()
        if origin and origin != "null" and not LOCAL_ORIGIN.match(origin):
            return False
        if origin == "null":                       # a sandboxed frame, a file:// page: not ours
            return False
        site = (self.headers.get("Sec-Fetch-Site") or "").lower()
        if site in ("cross-site", "same-site") and not origin:
            return False                           # e.g. an <img> of another site asking /api/tts
        return True

    def _send(self, code: int, body: bytes, ctype: str, extra: dict | None = None) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            try:
                self.wfile.write(body)
            except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
                self.close_connection = True       # the page let go (a line cut while it loaded): nothing wrong

    def _json(self, data, code: int = 200) -> None:
        self._send(code, json.dumps(data, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8",
                   {"Cache-Control": "no-store"})

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n < 0 or n > MAX_BODY:        # (a negative length would read until the caller hangs up, without limit)
            raise ValueError("bad length")
        raw = self.rfile.read(n) if n else b""
        return json.loads(raw.decode("utf-8")) if raw else {}

    # ---------- GET ----------
    def do_GET(self):  # noqa: N802
        if not self._host_ok():
            return self._send(403, b"forbidden", "text/plain")
        u = urlparse(self.path)
        p = u.path
        if p.startswith("/api/") and not self._own_page():
            return self._send(403, b"forbidden", "text/plain")
        if p == "/api/ping":
            return self._json({"app": C.APP, "version": C.VERSION})
        if p == "/api/settings":
            return self._json(C.load_settings())
        if p == "/api/state":
            return self._json(C.load_state())
        if p == "/api/hub":
            h = self.bus.hub
            return self._json({"state": h.state if h else "không có", "mode": h.mode if h else "none",
                               "port": h.port if h else C.HUB_PORT})
        if p == "/api/game-status":
            fresh = time.time() - self.bus.status_at < 6
            return self._json(self.bus.status if fresh else {})
        if p == "/api/tts":
            q = parse_qs(u.query)
            try:
                f = tts.speak(
                    q.get("text", [""])[0],
                    q.get("voice", [""])[0],
                    int(q.get("rate", ["0"])[0] or 0),
                    ahead=q.get("ahead", [""])[0] == "1",
                )
            except TimeoutError:
                if q.get("ahead", [""])[0] == "1":
                    return self._send(204, b"", "text/plain")     # asked ahead, no time for it: nothing to say
                say("[TTS] không kịp làm giọng câu này: chỉ hiện chữ")
                return self._send(503, b"tts late", "text/plain")
            except Exception as e:  # noqa: BLE001 - no internet, service changed: the page shows subtitles only
                say(f"[TTS] {type(e).__name__}: {e}")
                return self._send(503, b"tts unavailable", "text/plain")
            kind = "audio/ogg" if f.suffix == ".ogg" else "audio/mpeg"
            return self._send(200, f.read_bytes(), kind, {"Cache-Control": "max-age=86400"})
        if p == "/api/voice-state":
            return self._json(tts.vieneu_state())
        if p == "/api/stream":
            return self._stream()
        return self._static(p)

    do_HEAD = do_GET

    def _stream(self):
        q = self.bus.join()
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(b": hello\n\n")
            self.wfile.flush()
            while True:
                try:
                    msg = q.get(timeout=15)
                    self.wfile.write(f"data: {json.dumps(msg, ensure_ascii=False)}\n\n".encode("utf-8"))
                except queue.Empty:
                    self.wfile.write(b": ping\n\n")
                self.wfile.flush()
        except (BrokenPipeError, ConnectionError, OSError):
            pass
        finally:
            self.bus.leave(q)

    def _static(self, p: str):
        if p in ("/", ""):
            p = "/index.html"
        elif p in ("/control", "/control/"):
            p = "/control.html"
        root = self.web.resolve()
        f = (root / p.lstrip("/")).resolve()
        if not f.is_relative_to(root) or not f.is_file():      # (a name that merely starts like the folder's is outside)
            return self._send(404, b"not found", "text/plain")
        ctype = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
        cache = "no-store" if f.suffix == ".html" else "max-age=3600"
        return self._send(200, f.read_bytes(), ctype, {"Cache-Control": cache})

    # ---------- POST ----------
    def do_POST(self):  # noqa: N802
        if not self._host_ok():
            return self._send(403, b"forbidden", "text/plain")
        if not self._own_page():
            return self._send(403, b"forbidden", "text/plain")
        p = urlparse(self.path).path
        try:
            body = self._body()
        except (ValueError, UnicodeDecodeError, RecursionError):
            return self._json({"error": "bad body"}, 400)
        if p == "/api/settings":
            return self._json(C.update_settings(body if isinstance(body, dict) else {}))
        if p == "/api/settings/reset":
            return self._json(C.reset_settings())
        if p == "/api/log":         # an error of the game page, written in app.log (to trace a freeze)
            text = str((body or {}).get("text", "") if isinstance(body, dict) else "")[:2000]
            if text and self.bus.may_log():
                say(f"[PAGE] {text}")
            return self._json({"ok": True})
        if p == "/api/state":
            try:
                C.save_state(body)
            except (ValueError, OSError) as e:
                return self._json({"error": str(e)}, 400)
            return self._json({"ok": True})
        if p == "/api/fit-game":
            got = self.bus.fit_game() if self.bus.fit_game else None
            if not got:
                return self._json({"error": "không chỉnh được cửa sổ game"}, 404)
            return self._json({"ok": True, "width": got[0], "height": got[1]})
        if p == "/api/open-data":
            # app.log is there: what to send when the game closed by itself (the user, 10/11/2026)
            try:
                C.DATA_DIR.mkdir(parents=True, exist_ok=True)
                os.startfile(str(C.DATA_DIR))  # noqa: S606 - Explorer on our own folder
            except (AttributeError, OSError) as e:
                return self._json({"error": str(e)}, 500)
            return self._json({"ok": True, "path": str(C.DATA_DIR)})
        if p == "/api/open-hub":
            if not self.bus.hub:
                return self._json({"error": "không có hub"}, 404)
            self.bus.hub.open_window()
            return self._json({"ok": True})
        if p == "/api/cmd":
            if not isinstance(body, dict) or not body.get("cmd"):
                return self._json({"error": "no cmd"}, 400)
            return self._json({"ok": True, "games": self.bus.send(body)})
        if p == "/api/game-status":
            self.bus.status = body if isinstance(body, dict) else {}
            self.bus.status_at = time.time()
            return self._json({"ok": True})
        return self._json({"error": "not found"}, 404)


class _Http(ThreadingHTTPServer):
    # Windows: "reuse address" lets a second program take a port already in use (two copies of the app shared 8766,
    # 10/11/2026). Without it the second copy cannot open the port.
    allow_reuse_address = sys.platform != "win32"


class Server:
    def __init__(self, port: int = C.PORT, web: Path | None = None):
        self.bus = Bus()
        handler = type("H", (Handler,), {"bus": self.bus, "web": web or C.web_dir(), "port": port})
        self.httpd = _Http(("127.0.0.1", port), handler)
        self.httpd.daemon_threads = True
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, name="http", daemon=True)

    def start(self) -> "Server":
        self.thread.start()
        return self

    def stop(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()

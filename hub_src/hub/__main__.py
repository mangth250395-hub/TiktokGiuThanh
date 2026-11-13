"""TikTok Live Hub.

    TikTokLiveHub.exe                         run, in its own window
    TikTokLiveHub.exe --headless [--browser]  run without a window (console), for advanced use
    TikTokLiveHub.exe --import PATH [--name N]   add a proxy from another app's config file
    TikTokLiveHub.exe --check                 check every proxy (a new IP when one is dead)
    TikTokLiveHub.exe --watch tenkenh         also watch this channel from the start
(from source: python -m hub ...)
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
import webbrowser
from pathlib import Path

from . import config as C
from .proxy import Proxy, ProxyFatal
from .server import Hub, say

for s in (sys.stdout, sys.stderr):
    try:
        s.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass

PROXYBROWSER = Path(os.environ.get("LOCALAPPDATA", "")) / "ProxyBrowser" / "config.json"


def cmd_import(path: str | None, name: str | None) -> int:
    src = Path(path) if path else PROXYBROWSER
    if not src.exists():
        say(f"Không thấy {src}")
        return 1
    cfg = C.load()
    got = C.read_external_proxy(src)
    entry = next((p for p in cfg["proxies"] if (name and p["name"] == name) or (got["key"] and p["key"] == got["key"])), None)
    if entry is None:
        entry = {**C.PROXY_DEFAULT, "name": name or f"proxy{len(cfg['proxies']) + 1}"}
        cfg["proxies"].append(entry)
        what = "thêm"
        if len(cfg["proxies"]) == 1:
            cfg["use_proxy"] = True      # the first proxy of a hub that went straight for want of one: it is meant to be used
    else:
        what = "cập nhật"
    if got["key"] != entry.get("key") or got["proxy"] != entry.get("proxy"):
        entry.update(proxy_at="", expires_at=0)
    entry.update(got)
    C.check(C.normalize(cfg))
    C.save(cfg)
    say(f"Đã {what} {entry['name']} từ {src}: {entry['type']} {entry['proxy'] or '(chưa có IP:cổng)'}"
        + (" · có key + link đổi IP" if got["key"] and got["rotate_url"] else " · KHÔNG có key + link đổi IP")
        + f" · tổng {len(cfg['proxies'])} proxy trong {C.CONFIG_FILE}")
    return 0


async def cmd_check() -> int:
    cfg = C.load()
    if not cfg["proxies"]:
        say(f"Chưa có proxy nào. Thêm bằng:  --import ĐƯỜNG_DẪN  (sửa trực tiếp {C.CONFIG_FILE} cũng được)")
        return 1
    bad = 0
    for p in cfg["proxies"]:
        px = Proxy(p, min_interval=cfg["rotate_min_interval_s"], persist=lambda: C.save(cfg), say=say)
        say(f"Kiểm tra {px.describe()}…")
        try:
            c = await px.ensure()
            i = await px.lookup_now()
            say(f"  OK: TikTok thấy IP {i.get('ip') or '?'}" + (f" ({i['where']})" if i.get("where") else "") + (f" · {i['org']}" if i.get("org") else "")
                + f" · {c.ms} ms{px.life()}")
        except ProxyFatal as e:
            bad += 1
            say(f"  [LỖI] {e}")
    return 1 if bad else 0


def cmd_selftest() -> int:
    """The packaged app has everything it needs: TikTokLive, its protobuf messages, the proxy wiring, the web files."""
    import httpx
    from TikTokLive import TikTokLiveClient
    from TikTokLive.events import GiftEvent
    from TikTokLive.proto import CommonMessageData, User
    from TikTokLiveProto.v3.webcast.model import Gift

    from .tracker import from_gift_event

    ev = GiftEvent().parse(bytes(GiftEvent(common=CommonMessageData(msg_id=1), repeat_count=2, repeat_end=1,
                                           user=User(id=1, nickname="a", display_id="a"),
                                           gift=Gift(id=5655, name="Rose", diamond_count=1, type=1))))
    g = from_gift_event(ev)
    assert (g.gift_name, g.repeat_count, g.streakable) == ("Rose", 2, True), g
    hp = httpx.Proxy("http://10.0.0.1:8080", auth=("u", "p"))
    client = TikTokLiveClient(unique_id="abc", web_proxy=hp, ws_proxy=hp)
    assert client.web.signer.sdk_client._async_client is None
    for f in ("status.html", "demo.html", "tiktok-live-hub.js"):
        assert (C.resource_dir() / "web" / f).exists(), f
    say(f"selftest OK · TikTok Live Hub {C.VERSION} · {C.resource_dir()}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(prog="TikTokLiveHub", description=f"TikTok Live Hub {C.VERSION}")
    ap.add_argument("--import", dest="import_", nargs="?", const="", metavar="PATH", help="thêm proxy từ file cấu hình khác")
    ap.add_argument("--name", help="tên proxy khi --import (mặc định proxy1, proxy2…)")
    ap.add_argument("--check", action="store_true", help="kiểm tra mọi proxy")
    ap.add_argument("--watch", action="append", metavar="KENH", help="theo dõi kênh này từ đầu (lưu vào config)")
    ap.add_argument("--port", type=int, help="cổng (mặc định 8765)")
    ap.add_argument("--headless", action="store_true", help="chạy không có cửa sổ (in ra console)")
    ap.add_argument("--browser", action="store_true", help="cùng --headless: mở trang trạng thái trong trình duyệt")
    ap.add_argument("--no-browser", dest="headless", action="store_true", help=argparse.SUPPRESS)
    ap.add_argument("--version", action="version", version=C.VERSION)
    ap.add_argument("--selftest", action="store_true", help="kiểm tra bản đóng gói có đủ thành phần")
    a = ap.parse_args()
    if a.selftest:
        return cmd_selftest()
    try:
        if a.import_ is not None:
            return cmd_import(a.import_ or None, a.name)
        if a.check:
            return asyncio.run(cmd_check())
        cfg = C.load()
    except C.ConfigError as e:
        say(f"[LỖI CẤU HÌNH] {e}")
        if not (a.headless or a.check or a.import_ is not None):
            from .app import show_error      # the window exe has no console: show it
            return show_error(f"Cấu hình lỗi: {e}. Sửa hoặc xóa file {C.CONFIG_FILE} rồi mở lại.")
        return 2
    changed = not C.CONFIG_FILE.exists()
    for w in a.watch or []:
        try:
            w = C.clean_channel(w)
        except ValueError as e:
            say(f"[LỖI] --watch: {e}")
            return 2
        if w not in cfg["channels"]:
            cfg["channels"].append(w)
            changed = True
    if changed:
        C.save(cfg)
    if a.port:
        cfg["_port"] = a.port          # this run only: the saved port (tab Cài đặt) stays as it is
    if not a.headless:
        from .app import run_app
        return run_app(cfg)
    say(f"TikTok Live Hub {C.VERSION} · cấu hình: {C.CONFIG_FILE} · {len(cfg['proxies'])} proxy · log: {C.LOG_DIR}")
    if not cfg["use_proxy"]:
        say("Nối thẳng tới TikTok, không dùng proxy (đổi ở tab Proxy).")
    elif not cfg["proxies"]:
        say("Đang bật dùng proxy mà chưa có proxy nào: hub chỉ chạy giả lập. Thêm proxy (--import ĐƯỜNG_DẪN), hoặc chọn Nối thẳng ở tab Proxy.")
    elif len(cfg["proxies"]) == 1:
        say("Đang có 1 proxy: mỗi lần IP chết sẽ hụt khoảng 10–15 giây. Thêm proxy thứ 2 (key khác) để gần như không hụt.")
    hub = Hub(cfg)

    async def run():
        ready = asyncio.Event()
        task = asyncio.create_task(hub.run(ready=ready))
        done, _ = await asyncio.wait({task, asyncio.create_task(ready.wait())}, return_when=asyncio.FIRST_COMPLETED)
        if ready.is_set() and a.browser:
            webbrowser.open(f"http://127.0.0.1:{C.port_of(cfg)}/")   # once the port is open
        await task

    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        pass
    except OSError as e:
        say(f"[LỖI] không mở được cổng {C.port_of(cfg)}: {e} (hub khác đang chạy? đổi bằng --port)")
        return 1
    say("[HUB] đã dừng")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""The hub: TikTok channels and proxies on one side, the games (browser pages on this computer) on the other.

One port serves everything:
  ws://127.0.0.1:PORT/ws                      the games (JSON messages, see README "Giao thức")
  http://127.0.0.1:PORT/                      status page (links, proxies, live events, simulator)
  http://127.0.0.1:PORT/tiktok-live-hub.js    the SDK for games
  http://127.0.0.1:PORT/demo                  a small demo game page
  http://127.0.0.1:PORT/api/status            status as JSON

Only pages of this computer may connect (localhost / 127.0.0.1 / file://). Actions that change something
(watch a channel, simulate) need the token from config.json, except from http://localhost or 127.0.0.1 pages.
"""
from __future__ import annotations

import asyncio
import json
import re
import secrets
from collections import deque
from datetime import datetime
from urllib.parse import parse_qs
from http import HTTPStatus
from typing import Callable, Optional

from websockets.asyncio.server import ServerConnection, serve
from websockets.datastructures import Headers
from websockets.exceptions import ConnectionClosed
from websockets.http11 import Request, Response

from . import config as C
from .avatars import AvatarCache
from .channel import Channel
from .proxy import DIRECT_NAME, IP_PORT, KEY_SLOT, Direct, Proxy

LOCAL_ORIGIN = re.compile(r"^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$", re.I)
CLIENT_QUEUE_MAX = 5000
LOGBOOK_MAX = 500
FILES = {"/": ("status.html", "text/html"), "/status": ("status.html", "text/html"),
         "/demo": ("demo.html", "text/html"), "/tiktok-live-hub.js": ("tiktok-live-hub.js", "text/javascript"),
         "/favicon.ico": ("icon.ico", "image/x-icon")}


def say(msg: str) -> None:
    print(f"{datetime.now():%H:%M:%S} {msg}", flush=True)


class Client:
    def __init__(self, conn: ServerConnection, origin: Optional[str], trusted: bool, admin: bool = False):
        self.conn = conn
        self.origin = origin
        self.trusted = trusted        # may watch / simulate without the token
        self.admin = admin            # the hub's own window: proxies, keys, settings
        self.subs: set[str] = set()
        self.name = ""
        self.queue: asyncio.Queue = asyncio.Queue()
        self.dropped = False
        self.replayed = 0             # events queued as a replay: allowed on top of CLIENT_QUEUE_MAX

    def push(self, msg: dict, replay: bool = False) -> None:
        if self.dropped:
            return
        if replay:
            self.replayed += 1
        elif self.queue.qsize() > CLIENT_QUEUE_MAX + self.replayed:
            # a game that does not read: close it; it reconnects with "since" and gets what it missed
            self.dropped = True
            asyncio.create_task(self.conn.close(code=1013, reason="too slow"))
            return
        self.queue.put_nowait(json.dumps(msg, ensure_ascii=False))

    async def writer(self) -> None:
        while True:
            await self.conn.send(await self.queue.get())


class Hub:
    def __init__(self, cfg: dict, *, persist: Optional[Callable[[], None]] = None, log_dir=None, say_fn=say):
        self.cfg = cfg
        self._say_fn = say_fn
        self.logbook: deque = deque(maxlen=LOGBOOK_MAX)   # what the console used to show, for the app window
        self._log_id = 0
        save = persist or (lambda: C.save(self.cfg))

        def persist_safe():
            # a config.json held for a moment (antivirus, backup tool): say it, never kill whoever was saving
            try:
                save()
            except OSError as e:
                self.say(f"[LỖI] không lưu được cấu hình ({e}); thử lại ở lần lưu sau")
        self.persist = persist_safe
        self.log_dir = log_dir or C.LOG_DIR
        self.epoch = secrets.token_hex(4)          # a new number every start: "since" from another run is unusable
        self.proxies: dict[str, Proxy] = {}
        self._proxy_tasks: dict[str, asyncio.Task] = {}
        for p in cfg["proxies"]:
            self.proxies[p["name"]] = self._make_proxy(p)
        self.direct = Direct(say=self.say)         # the way to TikTok when proxies are turned off (cfg["use_proxy"])
        self.channels: dict[str, Channel] = {}
        self.clients: set[Client] = set()
        self.started = datetime.now()
        self.running = False
        self._sync_lock = asyncio.Lock()
        self.avatars = AvatarCache(self._image_proxy, direct=lambda: not self.cfg["use_proxy"])

    def say(self, msg: str) -> None:
        self._log_id += 1
        self.logbook.append({"id": self._log_id, "t": datetime.now().strftime("%H:%M:%S"), "msg": msg})
        self._say_fn(msg)

    def _make_proxy(self, entry: dict) -> Proxy:
        return Proxy(entry, min_interval=self.cfg["rotate_min_interval_s"], rotate_at_expiry=self.cfg["rotate_at_expiry"],
                     persist=self.persist, say=self.say)

    # ---------- channels ----------
    def channel(self, name: str, connect: bool = True) -> Channel:
        name = C.clean_channel(name)
        ch = self.channels.get(name)
        if ch is None:
            ch = Channel(self, name, connect=connect, proxies=[self.way(n) for n in self.wanted(name)] if connect else [])
            self.channels[name] = ch
            ch.start()
            if ch.links and not self.cfg["use_proxy"]:
                self.say(f"[KÊNH] theo dõi @{name}, nối thẳng (không dùng proxy)")
            elif ch.links:
                self.say(f"[KÊNH] theo dõi @{name} qua {len(ch.links)} proxy: {', '.join(l.name for l in ch.links)}")
            elif connect:
                self.say(f"[KÊNH] @{name}: chờ proxy (chưa có proxy nào: thêm ở tab Proxy)")
            else:
                self.say(f"[KÊNH] @{name}: chỉ giả lập")
        elif connect and not ch.real:
            # was simulation only: start the real connections now
            ch.real = True
            for n in self.wanted(name):
                ch.add_link(self.way(n))
            self.say(f"[KÊNH] @{name}: bắt đầu kết nối thật " + (f"qua {len(ch.links)} proxy" if self.cfg["use_proxy"]
                                                                 else "(nối thẳng, không dùng proxy)"))
        return ch

    def way(self, name: str):
        """A way to TikTok by its name: one of the proxies, or the straight one."""
        return self.direct if name == DIRECT_NAME else self.proxies[name]

    # ---------- which proxies each channel goes through ----------
    def wanted(self, name: str) -> list[str]:
        """The proxies of a channel: chosen by hand (channel_proxies), or by the hub: `proxies_per_channel` of
        them, the least used ones, keeping those it already has (moving a link costs a reconnection).
        With proxies turned off: the one straight way, whatever was chosen (the choice is kept for later)."""
        if not self.cfg["use_proxy"]:
            return [DIRECT_NAME]
        manual = [n for n in self.cfg["channel_proxies"].get(name) or [] if n in self.proxies]
        if manual:
            return manual
        k = min(self.cfg["proxies_per_channel"], len(self.proxies))
        ch = self.channels.get(name)
        current = [x.name for x in ch.links if x.name in self.proxies] if ch else []
        keep = current[:k]
        order = list(self.proxies)
        load = {n: sum(1 for c in self.channels.values() if c is not ch and c.real and any(x.name == n for x in c.links))
                for n in order}
        others = sorted((n for n in order if n not in keep), key=lambda n: (load[n], order.index(n)))
        return keep + others[:k - len(keep)]

    async def sync_links(self) -> None:
        """Make every channel's links match `wanted` (new ones first, then the extra ones go: no gap)."""
        async with self._sync_lock:
            for ch in list(self.channels.values()):
                if not ch.real:
                    continue
                want = self.wanted(ch.name)
                have = [x.name for x in ch.links]
                for n in want:
                    if n not in have:
                        ch.add_link(self.way(n))
                for n in have:
                    if n not in want:
                        await ch.remove_link(n)

    def stagger(self, link) -> float:
        """Several channels on one proxy reconnect after a new IP: not all in the same second (the sign server
        counts requests per IP)."""
        users = sorted(c.name for c in self.channels.values() if any(x.proxy is link.proxy for x in c.links))
        return min(2.0, 0.4 * users.index(link.channel.name)) if link.channel.name in users else 0.0

    async def set_channel_proxies(self, name: str, proxies: Optional[list]) -> None:
        if proxies:
            unknown = [n for n in proxies if n not in self.proxies]
            if unknown:
                raise ValueError(f"không có proxy {', '.join(unknown)}")
            self.cfg["channel_proxies"][name] = list(proxies)
        else:
            self.cfg["channel_proxies"].pop(name, None)
        self.persist()
        await self.sync_links()
        ch = self.channels.get(name)
        self.say(f"[KÊNH] @{name}: đi qua {', '.join(x.name for x in ch.links) if ch else '?'}"
                 + (" (chọn tay)" if proxies else " (hub tự chia)"))

    # ---------- proxies, changed while running ----------
    def public_proxy(self, name: str) -> dict:
        """What the window may show of a proxy: never the key or the password themselves."""
        p = self.proxies[name].p
        link = p["rotate_url"].replace(p["key"], "{key}") if p["key"] else p["rotate_url"]
        return {"name": name, "type": p["type"], "proxy": p["proxy"], "user": p["user"], "rotate_url": link,
                "has_key": bool(p["key"]), "has_password": bool(p["password"])}

    def _prepare_proxy(self, data: dict, original: Optional[str], entries: list) -> tuple[Optional[dict], dict]:
        """The proxy entry `data` would give, checked against `entries`, without changing anything."""
        names = [e["name"] for e in entries]
        i = len(names) + 1
        while f"proxy{i}" in names:
            i += 1
        name = str(data.get("name") or original or "").strip() or f"proxy{i}"
        if original and original not in names:
            raise ValueError(f"không có proxy {original} (có thể vừa bị xóa)")
        if name in names and name != original:
            # adding (or renaming to) a name already used would silently replace that other proxy
            raise ValueError(f"đã có proxy tên {name}: đặt tên khác, hoặc bấm Sửa trên proxy đó")
        old = next((e for e in entries if e["name"] == original), None) if original else None
        new = {**(old or C.PROXY_DEFAULT)}
        for k in ("type", "proxy", "user", "rotate_url"):
            if k in data:
                new[k] = str(data[k] or "").strip()
        for k in ("key", "password"):
            if data.get(k):
                new[k] = str(data[k]).strip() if k == "key" else str(data[k])
        new["name"] = name
        self._validate_proxy(new)
        if old and (new["key"] != old["key"] or new["proxy"] != old["proxy"]):
            new.update(proxy_at="", expires_at=0)
        trial = [e for e in entries if e is not old] + [new]
        C.check(C.normalize({**self.cfg, "proxies": trial}))      # refuses two proxies on one key
        return old, C.normalize({"proxies": [new]})["proxies"][0]

    def save_proxy(self, data: dict, original: Optional[str] = None) -> str:
        """Add a proxy, or change one (empty key / password = keep the current one). Applied at once."""
        entries = self.cfg["proxies"]
        old, new = self._prepare_proxy(data, original, entries)
        name = new["name"]
        if old is None:
            first = not entries
            entries.append(new)
            px = self._make_proxy(new)
            self.proxies[name] = px
            if self.running:
                self._proxy_tasks[name] = asyncio.create_task(px.expiry_loop())
            self.say(f"[PROXY] thêm {name}: {new['type']} {new['proxy'] or '(chưa có IP:cổng)'}")
            if first and not self.cfg["use_proxy"]:
                # the first proxy of a hub that went straight because it had none: whoever adds one wants it used.
                # (With proxies already there and turned off by hand, one more changes nothing.)
                self.cfg["use_proxy"] = True
                self.say("[PROXY] đã có proxy đầu tiên: từ giờ kết nối đi qua proxy (tắt được ở tab Proxy)")
            asyncio.create_task(self.sync_links())       # channels short of links get this one
        else:
            px = self.proxies[old["name"]]
            if old["name"] != name:
                self.proxies = {(name if k == old["name"] else k): v for k, v in self.proxies.items()}
            changed = (new["key"], new["proxy"], new["type"], new["user"], new["password"]) != \
                      (old["key"], old["proxy"], old["type"], old["user"], old["password"])
            old.clear()
            old.update(new)                 # the Proxy object keeps the same dict
            if original and original != name:
                if original in self._proxy_tasks:
                    self._proxy_tasks[name] = self._proxy_tasks.pop(original)
                for lst in self.cfg["channel_proxies"].values():      # channels that chose it by hand
                    lst[:] = [name if n == original else n for n in lst]
            if changed:
                px.last_check = None
                px._bump()                  # its links reconnect with the new settings
            self.say(f"[PROXY] sửa {name}" + (": kết nối lại" if changed else ""))
        self.persist()
        return name

    def _free_name(self) -> str:
        i = len(self.proxies) + 1
        while f"proxy{i}" in self.proxies:
            i += 1
        return f"proxy{i}"

    @staticmethod
    def _validate_proxy(p: dict) -> None:
        if not re.fullmatch(r"[\w.\-]{1,40}", p["name"]):
            raise ValueError("tên proxy chỉ gồm chữ, số, dấu chấm, gạch (tối đa 40 ký tự), ví dụ proxy1")
        if p["proxy"] and not IP_PORT.match(p["proxy"]):
            raise ValueError(f"IP:cổng \"{p['proxy']}\" không đúng dạng, ví dụ 203.0.113.10:8080")
        if p["rotate_url"] and not re.match(r"^https?://", p["rotate_url"], re.I):
            raise ValueError("link đổi IP phải bắt đầu bằng http:// hoặc https://")
        if p["rotate_url"] and KEY_SLOT.search(p["rotate_url"]) and not p["key"]:
            raise ValueError("link đổi IP có chỗ [keyxoay] / {key} nhưng chưa nhập key")
        if p["key"] and not p["rotate_url"]:
            raise ValueError("có key thì cần cả link đổi IP (link nhà cung cấp cho để lấy IP mới)")
        if not p["proxy"] and not (p["key"] and p["rotate_url"]):
            raise ValueError("cần IP:cổng, hoặc key + link đổi IP (để hub tự lấy IP)")

    async def remove_proxy(self, name: str) -> None:
        if name not in self.proxies:
            raise ValueError(f"không có proxy {name}")
        self.proxies.pop(name)
        for ch in self.channels.values():
            await ch.remove_link(name)
        t = self._proxy_tasks.pop(name, None)
        if t:
            t.cancel()
        self.cfg["proxies"] = [e for e in self.cfg["proxies"] if e["name"] != name]
        for k in list(self.cfg["channel_proxies"]):
            self.cfg["channel_proxies"][k] = [n for n in self.cfg["channel_proxies"][k] if n != name]
            if not self.cfg["channel_proxies"][k]:
                del self.cfg["channel_proxies"][k]
        self.persist()
        self.say(f"[PROXY] xóa {name}")
        await self.sync_links()                          # channels that lost it get another one

    async def check_proxy(self, name: str) -> dict:
        px = self.proxies[name]
        if await px.alive():
            c = px.last_check
        elif px.can_rotate:
            c = await px.ensure(max_tries=1)   # dead and it can rotate: one new IP (60 s rule applies), then answer
        else:
            # a fixed proxy that does not answer: say so now (ensure() would wait for it forever)
            raise ValueError(f"{name} không chạy: {px.last_check.error if px.last_check else 'không trả lời'}"
                             " (proxy cố định, không có key + link để tự đổi IP)")
        info = await px.lookup_now()
        return {"ip": info.get("ip", ""), "where": info.get("where", ""), "org": info.get("org", ""), "ms": c.ms, "life": px.life()}

    async def unwatch(self, name: str) -> None:
        ch = self.channels.pop(name, None)
        if ch:
            await ch.stop()
            self.say(f"[KÊNH] thôi theo dõi @{name}")

    @property
    def port(self) -> int:
        """The port this hub serves on (a --port given for this run, else the saved one)."""
        return C.port_of(self.cfg)

    def avatar_url(self, uid: str) -> str:
        return f"http://127.0.0.1:{self.port}/avatar/{uid}"

    def _image_proxy(self):
        """A proxy for the pictures: one that answered last time, else any with an address. None: no picture
        (never the home network while proxies are on; with proxies off the pictures come straight, see AvatarCache)."""
        ok = [p for p in self.proxies.values() if p.last_check and p.last_check.ok and p.httpx_proxy()]
        any_ = [p for p in self.proxies.values() if p.httpx_proxy()]
        pick = (ok or any_ or [None])[0]
        return pick.httpx_proxy() if pick else None

    def broadcast(self, ch: str, ev: dict) -> None:
        for c in list(self.clients):
            if ch in c.subs:
                c.push(ev)

    # ---------- settings, other computers ----------
    async def save_settings(self, msg: dict) -> str:
        said = []
        if msg.get("clear_sign_key"):
            self.cfg["sign_api_key"] = ""
            said.append("đã xóa sign key")
        elif msg.get("sign_api_key"):
            self.cfg["sign_api_key"] = str(msg["sign_api_key"]).strip()
            said.append("đã lưu sign key (dùng từ lần nối tới)")
        if "use_proxy" in msg and bool(msg["use_proxy"]) != self.cfg["use_proxy"]:
            self.cfg["use_proxy"] = bool(msg["use_proxy"])
            said.append("kết nối đi qua proxy" if self.cfg["use_proxy"] else "nối thẳng, không dùng proxy")
        if msg.get("proxies_per_channel"):
            n = max(1, int(msg["proxies_per_channel"]))
            if n != self.cfg["proxies_per_channel"]:
                self.cfg["proxies_per_channel"] = n
                said.append(f"mỗi kênh {n} proxy")
        if msg.get("port"):
            port = int(msg["port"])
            if not 1024 <= port <= 65535:
                raise ValueError("cổng phải từ 1024 đến 65535")
            if port != self.cfg["port"]:
                self.cfg["port"] = port
                said.append(f"cổng {port} (có tác dụng khi mở lại ứng dụng; game phải nối vào cổng mới)")
        self.persist()
        await self.sync_links()
        msg_ = "Đã lưu: " + ", ".join(said) if said else "Không có gì thay đổi"
        self.say(f"[CÀI ĐẶT] {msg_}")
        return msg_

    async def import_config(self, path: str) -> str:
        """A hub export (proxies, settings, channels) or one proxy from another app. A proxy whose key is
        already here is updated, not added twice."""
        data = C.read_import_file(path)
        # all or nothing: every proxy of the file is checked on a copy first, so a bad one leaves nothing half done
        sim = [dict(e) for e in self.cfg["proxies"]]
        plan = []
        for p in data["proxies"]:
            original = next((e["name"] for e in sim if p["key"] and e["key"] == p["key"]), None)
            name = p.get("name") or original or ""
            if name in [e["name"] for e in sim] and name != original:
                name = original or ""           # a name already used by another proxy: keep its own / a new one
            try:
                old, new = self._prepare_proxy({**p, "name": name}, original, sim)
            except (ValueError, C.ConfigError) as e:
                raise ValueError(f"proxy {p.get('name') or p.get('proxy') or '?'} trong file không dùng được: {e}. "
                                 "Chưa nhập gì.") from e
            if old is None:
                sim.append(new)
            else:
                sim[sim.index(old)] = new
            plan.append(({**p, "name": new["name"]}, original, p.get("name") or ""))
        names, renamed = [], {}
        for d, o, file_name in plan:
            names.append(self.save_proxy(d, original=o))
            if file_name:
                renamed[file_name] = names[-1]
        s = data["settings"]
        if s.get("sign_api_key"):
            self.cfg["sign_api_key"] = s["sign_api_key"]
        if s.get("proxies_per_channel"):
            self.cfg["proxies_per_channel"] = max(1, int(s["proxies_per_channel"]))
        if isinstance(s.get("allowed_origins"), list):
            self.cfg["allowed_origins"] = sorted(set(self.cfg["allowed_origins"]) | {str(o) for o in s["allowed_origins"]})
        if s.get("rotate_min_interval_s"):
            self.cfg["rotate_min_interval_s"] = max(10, int(s["rotate_min_interval_s"]))
        if "rotate_at_expiry" in s:
            self.cfg["rotate_at_expiry"] = bool(s["rotate_at_expiry"])
        if isinstance(s.get("use_proxy"), bool):
            self.cfg["use_proxy"] = s["use_proxy"]
        for ch, lst in (s.get("channel_proxies") or {}).items():
            try:
                ch = C.clean_channel(ch)
            except ValueError:
                continue
            mapped = [renamed.get(n, n) for n in lst if renamed.get(n, n) in self.proxies]
            if mapped:
                self.cfg["channel_proxies"][ch] = mapped
        for ch in C._clean_list(s.get("channels")):
            self.channel(ch)
            if ch not in self.cfg["channels"]:
                self.cfg["channels"].append(ch)
        self.persist()
        await self.sync_links()
        msg = f"Đã nhập {len(names)} proxy ({', '.join(names)}) từ {path}"
        if s.get("channels"):
            msg += f" · kênh: {', '.join(s['channels'])}"
        self.say(f"[CÀI ĐẶT] {msg}")
        return msg

    def status(self) -> dict:
        return {"hub": C.VERSION, "epoch": self.epoch, "port": self.port, "started": self.started.isoformat(timespec="seconds"),
                "config": str(C.CONFIG_FILE), "portable": C.PORTABLE, "logs": str(self.log_dir), "watched": list(self.cfg["channels"]),
                "settings": {"sign_api_key_set": bool(self.cfg["sign_api_key"]), "proxies_per_channel": self.cfg["proxies_per_channel"],
                             "port": self.cfg["port"], "use_proxy": self.cfg["use_proxy"]},
                "direct": self.direct.status(),
                "proxies": [{**p.status(), **self.public_proxy(n)} for n, p in self.proxies.items()],
                "channels": [c.status() for c in self.channels.values()],
                "clients": [{"name": c.name, "origin": c.origin, "subs": sorted(c.subs)} for c in self.clients]}

    # ---------- games ----------
    def allowed_origin(self, origin: Optional[str]) -> bool:
        return origin is None or origin == "null" or bool(LOCAL_ORIGIN.match(origin)) or origin in self.cfg["allowed_origins"]

    def trusted_origin(self, origin: Optional[str]) -> bool:
        # "null" (file:// pages) is also what a sandboxed frame of any website sends: it needs the token
        return origin is None or bool(LOCAL_ORIGIN.match(origin)) or origin in self.cfg["allowed_origins"]

    async def on_message(self, c: Client, msg: dict) -> None:
        op = msg.get("op")
        may_change = c.trusted or (msg.get("token") and secrets.compare_digest(str(msg["token"]), self.cfg["token"]))
        if op == "subscribe":
            c.name = str(msg.get("client") or c.name)
            since = msg.get("since") or {}
            same_run = msg.get("epoch") == self.epoch
            for name in msg.get("channels") or []:
                try:
                    name = C.clean_channel(name)
                except ValueError as e:
                    c.push({"type": "error", "op": op, "message": str(e)})
                    continue
                if name not in self.channels:
                    if not may_change:
                        c.push({"type": "error", "op": op, "ch": name, "message": "cần token để mở kênh mới"})
                        continue
                    self.channel(name, connect=not msg.get("sim_only"))
                ch = self.channels[name]
                c.subs.add(name)
                missed, dropped = ([], False)
                if same_run and name in since:
                    missed, dropped = ch.since(int(since[name]))
                c.push({"type": "subscribed", "ch": name, "head": ch.seq, "epoch": self.epoch, "live": ch.live,
                        "replay": len(missed), "missing_before_buffer": dropped})
                for ev in missed:
                    c.push(ev, replay=True)
        elif op == "unsubscribe":
            for name in msg.get("channels") or []:
                c.subs.discard(str(name).lstrip("@"))
        elif op in ("watch", "unwatch", "simulate"):
            if not may_change:
                c.push({"type": "error", "op": op, "message": "cần token (xem config.json) cho thao tác này"})
                return
            try:
                name = C.clean_channel(msg.get("ch"))
            except ValueError as e:
                c.push({"type": "error", "op": op, "message": str(e)})
                return
            if op == "watch":
                self.channel(name)
                if name not in self.cfg["channels"]:
                    self.cfg["channels"].append(name)
                    self.persist()
            elif op == "unwatch":
                await self.unwatch(name)
                if name in self.cfg["channels"]:
                    self.cfg["channels"].remove(name)
                    self.persist()
            else:
                ch = self.channels.get(name) or self.channel(name, connect=False)

                async def run():
                    try:
                        await ch.simulate(msg)
                    except Exception as e:  # noqa: BLE001
                        c.push({"type": "error", "op": op, "message": str(e)})
                asyncio.create_task(run())
            c.push({"type": "ok", "op": op, "ch": name})
        elif op in ("proxy_save", "proxy_remove", "proxy_import", "config_import", "proxy_check", "channel_proxies",
                    "settings_save"):
            # proxies hold keys: only the hub's own window / pages of this computer, never with the token alone
            if not c.admin:
                c.push({"type": "error", "op": op, "message": "chỉ cửa sổ của hub mới đổi được cài đặt và proxy"})
                return
            try:
                if op == "proxy_save":
                    name = self.save_proxy(msg.get("proxy") or {}, original=msg.get("original"))
                    c.push({"type": "ok", "op": op, "name": name})
                elif op in ("proxy_import", "config_import"):
                    path = str(msg.get("source") or msg.get("path") or "").strip()
                    if not path:
                        raise ValueError("chưa chọn file cấu hình")
                    c.push({"type": "ok", "op": "config_import", "message": await self.import_config(path)})
                elif op == "channel_proxies":
                    await self.set_channel_proxies(C.clean_channel(msg.get("ch")), msg.get("proxies") or None)
                    c.push({"type": "ok", "op": op})
                elif op == "settings_save":
                    c.push({"type": "ok", "op": op, "message": await self.save_settings(msg)})
                elif op == "proxy_remove":
                    await self.remove_proxy(str(msg.get("name")))
                    c.push({"type": "ok", "op": op})
                else:
                    name = str(msg.get("name"))

                    async def run():
                        try:
                            r = await self.check_proxy(name)
                            c.push({"type": "ok", "op": op, "name": name, **r})
                        except Exception as e:  # noqa: BLE001
                            c.push({"type": "error", "op": op, "name": name, "message": str(e)})
                    asyncio.create_task(run())
            except (C.ConfigError, ValueError, OSError, KeyError) as e:
                c.push({"type": "error", "op": op, "message": str(e)})
        elif op == "status":
            c.push({"type": "status", **self.status()})
        elif op == "ping":
            c.push({"type": "pong", "t": msg.get("t")})
        else:
            c.push({"type": "error", "op": op, "message": "không biết thao tác này"})

    async def handler(self, conn: ServerConnection) -> None:
        origin = conn.request.headers.get("Origin") if conn.request else None
        own = {f"http://127.0.0.1:{self.port}", f"http://localhost:{self.port}"}
        c = Client(conn, origin, self.trusted_origin(origin), admin=origin is None or origin in own)
        self.clients.add(c)
        writer = asyncio.create_task(c.writer())
        c.push({"type": "hello", "hub": C.VERSION, "epoch": self.epoch, "trusted": c.trusted,
                "channels": {n: {"seq": ch.seq, "live": ch.live} for n, ch in self.channels.items()}})
        try:
            async for raw in conn:
                try:
                    msg = json.loads(raw)
                    if not isinstance(msg, dict):
                        raise ValueError("cần một object JSON")
                except ValueError as e:
                    c.push({"type": "error", "message": f"tin không đọc được: {e}"})
                    continue
                try:
                    await self.on_message(c, msg)
                except Exception as e:  # noqa: BLE001
                    self.say(f"[LỖI] thao tác {msg.get('op')}: {type(e).__name__}: {e}")
                    c.push({"type": "error", "op": msg.get("op"), "message": f"{type(e).__name__}: {e}"})
        except ConnectionClosed:
            pass
        finally:
            self.clients.discard(c)
            writer.cancel()

    # ---------- HTTP ----------
    async def process_request(self, conn: ServerConnection, req: Request) -> Optional[Response]:
        path = req.path.split("?", 1)[0]
        origin = req.headers.get("Origin")
        host = (req.headers.get("Host") or "").lower()
        if host not in {f"127.0.0.1:{self.port}", f"localhost:{self.port}", f"[::1]:{self.port}"}:
            return self._resp(HTTPStatus.FORBIDDEN, b"host not allowed", "text/plain")
        if path == "/ws":
            if not self.allowed_origin(origin):
                return self._resp(HTTPStatus.FORBIDDEN, b"origin not allowed", "text/plain")
            return None
        if path.startswith("/avatar/"):
            uid = path[len("/avatar/"):]
            if not uid.isdigit():
                return self._resp(HTTPStatus.NOT_FOUND, b"not found", "text/plain")
            status, body, ctype = await self.avatars.get(uid)
            # any page may draw it (canvas / WebGL texture); kept by the browser for a day
            return self._resp(HTTPStatus(status), body, ctype, cache="public, max-age=86400" if status == 200 else "no-store",
                              extra=[("Access-Control-Allow-Origin", "*"), ("Cross-Origin-Resource-Policy", "cross-origin")])
        if path == "/api/status":
            return self._resp(HTTPStatus.OK, json.dumps(self.status(), ensure_ascii=False).encode(), "application/json")
        if path == "/api/log":
            after = int((parse_qs(req.path.partition("?")[2]).get("after") or ["0"])[0] or 0)
            lines = [x for x in self.logbook if x["id"] > after]
            return self._resp(HTTPStatus.OK, json.dumps(lines, ensure_ascii=False).encode(), "application/json")
        if path in FILES:
            fname, ctype = FILES[path]
            try:
                return self._resp(HTTPStatus.OK, (C.resource_dir() / "web" / fname).read_bytes(), ctype)
            except OSError:
                pass
        return self._resp(HTTPStatus.NOT_FOUND, b"not found", "text/plain")

    @staticmethod
    def _resp(status: HTTPStatus, body: bytes, ctype: str, cache: str = "no-store", extra: Optional[list] = None) -> Response:
        ctype = ctype if ctype.startswith("image/") else f"{ctype}; charset=utf-8"
        return Response(status.value, status.phrase, Headers([("Content-Type", ctype), ("Cache-Control", cache),
                                                              ("Content-Length", str(len(body))), *(extra or [])]), body)

    # ---------- run ----------
    async def run(self, host: str = "127.0.0.1", ready: Optional[asyncio.Event] = None) -> None:
        async with serve(self.handler, host, self.port, process_request=self.process_request,
                         max_size=2 ** 20) as server:
            self.running = True
            for name, p in self.proxies.items():
                self._proxy_tasks[name] = asyncio.create_task(p.expiry_loop())
            for name in self.cfg["channels"]:
                self.channel(name)
            self.say(f"[HUB] chạy ở http://{host}:{self.port}/  (game nối vào ws://{host}:{self.port}/ws)")
            for w in C.LOAD_WARNINGS:
                self.say(f"[CẢNH BÁO] {w}")
            if ready:
                ready.set()
            try:
                await asyncio.Future()
            finally:
                self.running = False
                server.close()
                for t in self._proxy_tasks.values():
                    t.cancel()
                for name in list(self.channels):
                    await self.channels[name].stop()

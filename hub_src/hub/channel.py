"""One TikTok LIVE channel: one link per proxy, merged into one stream of numbered events for the games.

Every message reaches the channel once per link (and again on each reconnect): it is passed on the first time
only (msg_id). Each event gets `seq`, a number that only goes up; the last `buffer_events` are kept, so a game
that reconnects with "since: N" gets everything it missed. When no link is up, a `gap` event says how long.
"""
from __future__ import annotations

import asyncio
import json
import random
import time
import zlib
from collections import deque
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from .link import Link
from .tracker import GiftIn, GiftTracker, Out, SeenIds, from_gift_event, msg_id_of, user_fields

if TYPE_CHECKING:
    from .server import Hub


def now_ms() -> int:
    return int(time.time() * 1000)


class ChannelLog:
    def __init__(self, folder, name: str):
        folder.mkdir(parents=True, exist_ok=True)
        self.path = folder / f"{datetime.now():%Y%m%d-%H%M%S}-{name}.jsonl"
        self.f = self.path.open("a", encoding="utf-8")

    def write(self, kind: str, /, **data) -> None:
        self.f.write(json.dumps({"t": time.time(), **data, "kind": kind}, ensure_ascii=False, default=str) + "\n")
        self.f.flush()

    def close(self) -> None:
        self.f.close()


class Channel:
    def __init__(self, hub: "Hub", name: str, *, connect: bool = True, proxies: Optional[list] = None):
        self.hub = hub
        self.name = name
        self.seen = SeenIds()
        self.tracker = GiftTracker()
        self.seq = 0
        self.buffer: deque = deque(maxlen=int(hub.cfg.get("buffer_events") or 20000))
        self.room_id: Optional[int] = None      # used to reconnect fast; forgotten when it stops working
        self.last_room: Optional[int] = None    # the room of the live going on (live_start once per room)
        self.live = False
        self.real = connect             # watched for real (not simulation only): every proxy gets a link
        self.links: list[Link] = [Link(self, p) for p in (proxies or [])] if connect else []
        # a gap = the live goes on and no link is up. Only counted once a link has been up (the first
        # connection is not a gap) and while the channel is live (offline is not a gap either)
        self.gap_from: Optional[int] = None
        self.had_link_up = False
        self.viewers: Optional[int] = None
        self.stats = {"comments": 0, "gifts": 0, "coins": 0, "duplicates": 0, "gaps": 0, "gap_ms": 0, "errors": 0}
        self.log = ChannelLog(hub.log_dir, name)
        self._reported: set = set()
        self._tick: Optional[asyncio.Task] = None

    # ---------- life ----------
    def start(self) -> None:
        for link in self.links:
            link.start()
        self._tick = asyncio.create_task(self._ticker())

    async def stop(self) -> None:
        for link in self.links:
            await link.stop()
        if self._tick:
            self._tick.cancel()
        self._emit_outs(self.tracker.flush("stop"))
        self.log.write("summary", **self.stats, duplicates_skipped=self.seen.duplicates, late=self.tracker.late,
                       timeouts=self.tracker.timeouts)
        self.log.close()

    async def _ticker(self) -> None:
        while True:
            await asyncio.sleep(1)
            self._emit_outs(self.tracker.tick())

    # ---------- events out ----------
    def emit(self, type_: str, **data) -> dict:
        u = data.get("user")
        if isinstance(u, dict):
            # the picture through the hub (proxy, cache, CORS): see hub/avatars.py
            u["avatar_hub"] = self.hub.avatar_url(u.get("id", "")) if self.hub.avatars.remember(u.get("id", ""), u.get("avatar", "")) else ""
        self.seq += 1
        ev = {"seq": self.seq, "ch": self.name, "type": type_, "ts": now_ms(), **data}
        self.buffer.append(ev)
        self.log.write("event", **ev)
        self.hub.broadcast(self.name, ev)
        return ev

    def note(self, kind: str, msg: str, **data) -> None:
        """Hub console + channel log (not sent to games)."""
        self.hub.say(msg)
        self.log.write(kind, msg=msg, **data)

    def handler_error(self, where: str, e: Exception) -> None:
        self.stats["errors"] += 1
        sig = (where, type(e).__name__, str(e))
        self.log.write("handler_error", where=where, error=f"{type(e).__name__}: {e}")
        if sig not in self._reported:
            self._reported.add(sig)
            self.hub.say(f"[LỖI CODE] {self.name} {where}: {type(e).__name__}: {e} (lần sau chỉ ghi vào log)")

    def since(self, seq: int) -> tuple[list, bool]:
        """Events after `seq`, and whether some were already dropped from the buffer."""
        if not self.buffer:
            return [], seq < self.seq
        first = self.buffer[0]["seq"]
        return [e for e in self.buffer if e["seq"] > seq], seq + 1 < first

    # ---------- links ----------
    def peer_last(self, link: Link) -> float:
        """Last frame time of the other links that are up (0 when none)."""
        return max((x.last_msg for x in self.links if x is not link and x.up), default=0.0)

    def add_link(self, proxy) -> Link:
        """A proxy added while running: one more connection to this live."""
        link = Link(self, proxy)
        self.links.append(link)
        link.start()
        return link

    async def remove_link(self, proxy_name: str) -> None:
        for link in [x for x in self.links if x.name == proxy_name]:
            await link.stop()
            self.links.remove(link)
            if link.up:
                link.up = False
                self.link_changed(link, "proxy bị xóa")

    def links_up(self) -> int:
        return sum(1 for x in self.links if x.up)

    def link_changed(self, link: Link, reason: str) -> None:
        p = link.proxy
        self.emit("link", proxy=link.name, up=link.up, reason=reason, links_up=self.links_up(), links=len(self.links),
                  ip=p.ip_info.get("ip", ""), life_left_s=p.life_left_s())
        up = self.links_up()
        if up:
            if self.gap_from is not None:
                gap_ms = now_ms() - self.gap_from
                self.stats["gaps"] += 1
                self.stats["gap_ms"] += gap_ms
                self.emit("gap", **{"from": self.gap_from, "to": now_ms(), "ms": gap_ms})
                self.note("gap", f"[{self.name}] mất hết kết nối {gap_ms / 1000:.1f} giây (tin trong khoảng này có thể thiếu)", ms=gap_ms)
                self.gap_from = None
            self.had_link_up = True
        elif self.gap_from is None and self.live and self.had_link_up:
            self.gap_from = now_ms()

    def on_connect(self, link: Link, room_id: int) -> None:
        p = link.proxy
        how = "nối thẳng, không qua proxy" if getattr(p, "direct", False) else \
            f"qua {p.p.get('proxy')} · TikTok thấy IP {p.ip_info.get('ip') or '?'}{p.life()}"
        self.note("connect", f"[{self.name}/{link.name}] vào live (room {room_id}) {how}", room_id=room_id, proxy=link.name)
        new_live = not self.live or room_id != self.last_room
        self.room_id, self.last_room, self.live = room_id, room_id, True
        if new_live:
            self.emit("live_start", room_id=str(room_id))

    def on_live_end(self, link: Link) -> None:
        if self.live:
            self.live = False
            self.room_id = self.last_room = None
            self.gap_from = None
            self._emit_outs(self.tracker.flush("stop"))
            self.emit("live_end")
            self.note("live_end", f"[{self.name}] kênh đã tắt live")

    def on_offline(self, link: Link) -> None:
        if self.live:
            self.on_live_end(link)

    def forget_room(self, link: Link) -> None:
        if self.room_id is not None:
            self.note("room_forget", f"[{self.name}] room {self.room_id} không còn tin: tìm lại room của live")
            self.room_id = None

    # ---------- events in (from TikTokLive, once per link) ----------
    def _first(self, ev) -> bool:
        if self.seen.seen(msg_id_of(ev)):
            self.stats["duplicates"] += 1
            return False
        return True

    def ingest_comment(self, ev) -> None:
        if self._first(ev):
            self.stats["comments"] += 1
            self.emit("comment", user=user_fields(ev.user), text=ev.content, msg_id=str(msg_id_of(ev)))

    def ingest_gift(self, ev) -> None:
        if not self._first(ev):
            return
        g = from_gift_event(ev)
        if g is None:
            return
        self.log.write("gift_raw", **g.__dict__, group_count=getattr(ev, "group_count", None),
                       combo_count=getattr(ev, "combo_count", None),
                       create_time=ev.common.create_time if ev.common else None)
        self.ingest_giftin(g)

    def ingest_giftin(self, g: GiftIn, sim: bool = False) -> None:
        self.stats["gifts"] += 1
        self._emit_outs(self.tracker.feed(g), sim=sim)

    def _emit_outs(self, outs: list[Out], sim: bool = False) -> None:
        for o in outs:
            g = o.g
            user = {"id": str(g.user_id or ""), "unique_id": g.unique_id, "nickname": g.nickname, "avatar": g.avatar}
            gift = {"id": g.gift_id, "name": g.gift_name, "diamonds": g.diamonds, "image": g.image, "streakable": g.streakable}
            extra = {"sim": True} if sim else {}
            if o.kind == "add":
                self.stats["coins"] += o.coins
                self.emit("gift", user=user, gift=gift, count=o.count, coins=o.coins, combo_total=o.total_count, **extra)
            else:
                self.emit("gift_done", user=user, gift=gift, count=o.count, coins=o.coins, reason=o.reason, **extra)

    def _simple(self, type_: str, ev, **data) -> None:
        if self._first(ev):
            self.emit(type_, user=user_fields(getattr(ev, "user", None)), **data)

    def ingest_join(self, ev) -> None:
        self._simple("join", ev)

    def ingest_like(self, ev) -> None:
        self._simple("like", ev, count=int(getattr(ev, "count", 0) or 0), total=int(getattr(ev, "total", 0) or 0))

    def ingest_follow(self, ev) -> None:
        self._simple("follow", ev)

    def ingest_share(self, ev) -> None:
        self._simple("share", ev)

    def ingest_viewers(self, ev) -> None:
        n = int(getattr(ev, "total", 0) or 0)
        if n and n != self.viewers:
            self.viewers = n
            self.emit("viewers", count=n)

    # ---------- simulation (games are made without opening a live) ----------
    async def simulate(self, req: dict) -> None:
        kind = req.get("kind", "comment")
        name = str(req.get("user") or "tester")
        uid = zlib.crc32(name.encode("utf-8"))   # stable between runs (hash() of a str is not)
        user = {"id": str(uid), "unique_id": name, "nickname": str(req.get("nickname") or name), "avatar": ""}
        if kind == "comment":
            self.emit("comment", user=user, text=str(req.get("text", "")), msg_id="", sim=True)
        elif kind in ("join", "follow", "share"):
            self.emit(kind, user=user, sim=True)
        elif kind == "like":
            self.emit("like", user=user, count=int(req.get("count", 1)), total=0, sim=True)
        elif kind == "gift":
            count = max(1, int(req.get("count", 1)))
            diamonds = max(0, int(req.get("diamonds", 1)))
            streak = bool(req.get("combo", diamonds < 100))
            group = random.getrandbits(40)

            def g(n, end):
                return GiftIn(msg_id=0, user_id=uid, unique_id=name, nickname=user["nickname"],
                              gift_id=int(req.get("gift_id", 1)), gift_name=str(req.get("gift", "Rose")),
                              diamonds=diamonds, streakable=streak, repeat_count=n, repeat_end=end, group_id=group)
            if not streak:
                self.ingest_giftin(g(count, True), sim=True)
                return
            step = max(0.05, float(req.get("interval_ms", 250)) / 1000)
            for n in range(1, count + 1):
                self.ingest_giftin(g(n, False), sim=True)
                await asyncio.sleep(step)
            await asyncio.sleep(min(3.0, step * 4))
            self.ingest_giftin(g(count, True), sim=True)
        else:
            raise ValueError(f"không biết loại giả lập '{kind}'")

    # ---------- status page ----------
    def status(self) -> dict:
        return {"name": self.name, "real": self.real, "auto": self.name not in self.hub.cfg["channel_proxies"],
                "live": self.live, "room_id": str(self.room_id) if self.room_id else None, "seq": self.seq,
                "viewers": self.viewers, "links_up": self.links_up(), "links": [x.status() for x in self.links],
                "gap_open_s": round((now_ms() - self.gap_from) / 1000, 1) if self.gap_from and self.had_link_up else None,
                "stats": {**self.stats, "duplicates_skipped": self.seen.duplicates, "late": self.tracker.late,
                          "combo_timeouts": self.tracker.timeouts}, "log": str(self.log.path)}

"""Counting gifts without losing combo (streak) gifts, and skipping messages seen twice.

TikTok sends a streakable gift (gift.type == 1) many times while the combo runs, each time with the running
repeat_count, and a last time with repeat_end = 1. That last event can go missing, so:
  - coins are added on every event, by the increase of repeat_count since the last one seen (never waits for the end)
  - a combo is closed by repeat_end, or by itself after `combo_timeout_s` without a new event
  - the same message twice (same msg_id) is counted once; a late or repeated event never counts twice
  - with two connections, an older count of a combo can arrive after a newer one: same group_id = late, skipped
Gifts that cannot streak are counted at once.
"""
from __future__ import annotations

import time
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Callable, Optional

COMBO_TIMEOUT_S = 4.0
CLOSED_KEEP_S = 120.0
MSG_ID_KEEP = 50000


class SeenIds:
    """msg_ids already handled. TikTok sends a batch of recent messages again on every (re)connect (seen in the
    live 09/11/2026: the same comments twice, 0.9 s apart, same msg_id), and with two connections every message
    comes twice. Kept across reconnects: what was already handled is skipped, what was missed still comes in."""

    def __init__(self, keep: int = MSG_ID_KEEP):
        self.keep = keep
        self.ids: "OrderedDict[int, None]" = OrderedDict()
        self.duplicates = 0

    def seen(self, msg_id: int) -> bool:
        if not msg_id:
            return False
        if msg_id in self.ids:
            self.duplicates += 1
            return True
        self.ids[msg_id] = None
        if len(self.ids) > self.keep:
            self.ids.popitem(last=False)
        return False


@dataclass
class GiftIn:
    msg_id: int
    user_id: int
    unique_id: str
    nickname: str
    gift_id: int
    gift_name: str
    diamonds: int          # coins of one gift
    streakable: bool       # gift.type == 1
    repeat_count: int
    repeat_end: bool
    group_id: int = 0
    avatar: str = ""
    image: str = ""


@dataclass
class Combo:
    key: tuple
    g: GiftIn
    count: int = 0          # highest repeat_count seen
    last_seen: float = 0.0

    @property
    def coins(self) -> int:
        return self.count * self.g.diamonds


@dataclass
class Out:
    """'add' = coins to add now (a combo comes in parts) · 'done' = a gift or combo is over, with its totals."""
    kind: str
    g: GiftIn
    count: int              # add: gifts added now · done: gifts in the whole combo
    coins: int              # add: coins added now · done: coins of the whole combo
    total_count: int = 0    # running count of the combo
    reason: str = ""        # done: "end" | "timeout" | "single" | "stop" | "restart"


@dataclass
class GiftTracker:
    clock: Callable[[], float] = time.monotonic
    combo_timeout_s: float = COMBO_TIMEOUT_S
    active: dict = field(default_factory=dict)
    closed: dict = field(default_factory=dict)          # key -> (count, closed_at)
    total_coins: int = 0
    late: int = 0
    timeouts: int = 0

    @staticmethod
    def key_of(g: GiftIn) -> tuple:
        return (g.user_id, g.gift_id, g.group_id)

    def _add(self, c: Combo, n: int) -> Out:
        self.total_coins += n * c.g.diamonds
        return Out("add", c.g, n, n * c.g.diamonds, total_count=c.count)

    def _done(self, c: Combo, reason: str) -> Out:
        self.active.pop(c.key, None)
        self.closed[c.key] = (c.count, self.clock())
        return Out("done", c.g, c.count, c.coins, total_count=c.count, reason=reason)

    def feed(self, g: GiftIn) -> list[Out]:
        """One gift event (already de-duplicated by msg_id)."""
        now = self.clock()
        n = max(1, g.repeat_count)
        if not g.streakable:
            self.total_coins += n * g.diamonds
            return [Out("add", g, n, n * g.diamonds, total_count=n),
                    Out("done", g, n, n * g.diamonds, total_count=n, reason="single")]

        out: list[Out] = []
        key = self.key_of(g)
        c = self.active.get(key)
        if c is None:
            before = 0
            old = self.closed.get(key)
            if old is not None:
                if n > old[0]:
                    before = old[0]     # the combo went on after it was closed by timeout: only what is new
                elif g.group_id or (n == old[0] and g.repeat_end):
                    self.late += 1      # the end of a combo already closed, or a late copy: nothing new
                    return []
                # else: no combo id, and a lower count (or the same, still running): the next combo of this gift
                del self.closed[key]
            c = Combo(key, g, count=before, last_seen=now)
            self.active[key] = c
        elif n < c.count:
            if g.group_id:
                self.late += 1          # same combo, an older count arriving late (the other connection)
                return []
            out.append(self._done(c, "restart"))   # no group_id: a lower count can only be a new combo
            self.closed.pop(key, None)
            c = Combo(key, g, count=0, last_seen=now)
            self.active[key] = c

        c.last_seen = now
        c.g = g if g.nickname else c.g
        if n > c.count:
            delta, c.count = n - c.count, n
            out.append(self._add(c, delta))
        if g.repeat_end:
            out.append(self._done(c, "end"))
        return out

    def tick(self) -> list[Out]:
        """Close combos with no news for `combo_timeout_s`; forget closed ones after a while (about once a second)."""
        now = self.clock()
        out = []
        for c in list(self.active.values()):
            if now - c.last_seen >= self.combo_timeout_s:
                self.timeouts += 1
                out.append(self._done(c, "timeout"))
        for k, (_, at) in list(self.closed.items()):
            if now - at > CLOSED_KEEP_S:
                del self.closed[k]
        return out

    def flush(self, reason: str = "stop") -> list[Out]:
        return [self._done(c, reason) for c in list(self.active.values())]


# ---------- TikTokLive objects -> plain values ----------
def image_url(img) -> str:
    urls = getattr(img, "url_list", None) or []
    return urls[0] if urls else ""


def user_fields(user) -> dict:
    """{id, unique_id, nickname, avatar} of a TikTokLive user. Comments carry a plain proto `User` (the @name is
    `display_id`); gifts carry an `ExtendedUser` (which adds `unique_id`). Works for both, and for None."""
    if user is None:
        return {"id": "", "unique_id": "", "nickname": "", "avatar": ""}
    uid = getattr(user, "unique_id", None) or getattr(user, "display_id", "") or ""
    # id as a string: about 7e18, more than a browser keeps exactly as a number (2^53)
    return {"id": str(int(getattr(user, "id", 0) or 0) or ""), "unique_id": str(uid),
            "nickname": str(getattr(user, "nickname", "") or ""), "avatar": image_url(getattr(user, "avatar_thumb", None))}


def msg_id_of(ev) -> int:
    return int(getattr(getattr(ev, "common", None), "msg_id", 0) or 0)


def from_gift_event(ev) -> Optional[GiftIn]:
    gift = getattr(ev, "gift", None)
    if gift is None:
        return None
    u = user_fields(getattr(ev, "user", None))
    return GiftIn(
        msg_id=msg_id_of(ev), user_id=int(u["id"] or 0), unique_id=u["unique_id"], nickname=u["nickname"], avatar=u["avatar"],
        gift_id=int(getattr(gift, "id", 0) or getattr(ev, "gift_id", 0) or 0), gift_name=getattr(gift, "name", "") or "",
        diamonds=int(getattr(gift, "diamond_count", 0) or 0), streakable=getattr(gift, "type", 0) == 1,
        repeat_count=int(getattr(ev, "repeat_count", 0) or 0), repeat_end=bool(getattr(ev, "repeat_end", 0)),
        group_id=int(getattr(ev, "group_id", 0) or 0), image=image_url(getattr(gift, "image", None)),
    )

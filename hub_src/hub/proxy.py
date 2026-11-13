"""One rotating proxy (one key), shared by every connection that goes through it.

Rules (set by the user, 09/11/2026):
  - everything to TikTok and to the sign server goes through a proxy; never the home network
  - an IP lives 15 to 30 minutes; a new one only when it fails, or at the moment the provider said it dies
  - at least 60 seconds between two requests for a new IP (per key)

Several connections (channels) share one proxy: when the IP dies they all notice, but only one new IP is asked
for. `generation` goes up on every new IP; a connection compares it with the one it connected on.

Since 13/11/2026 the user may also turn proxies off ("cho phép sử dụng proxy hoặc không", setting `use_proxy`): the
connections then go straight from this computer's network, through `Direct` below, which stands where a Proxy
would. Nothing ever changes from one to the other by itself: with proxies on, a dead proxy still never falls back
to the home network.
"""
from __future__ import annotations

import asyncio
import json
import re
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Awaitable, Callable, Optional
from urllib.parse import quote

import httpx

IP_PORT = re.compile(r"^[^\s:/@]+:\d{2,5}$")
PROXY_IN_TEXT = re.compile(r"(\d{1,3}(?:\.\d{1,3}){3}:\d{2,5})(?::([^:\s\"',]*):([^:\s\"',]*))?")
KEY_SLOT = re.compile(r"\{key\}|\[key[a-z]*\]", re.I)
WRONG_KEY = re.compile(r"key", re.I)
WRONG_KEY_WORDS = re.compile(r"ton tai|không tồn tại|khong ton tai|invalid|sai", re.I)
LIFETIME = re.compile(r"die\s*(?:sau|after)?\s*(\d+)\s*(?:s\b|giây|giay|sec)", re.I)

CHECK_TIMEOUT_S = 8
IP_TIMEOUT_S = 5
EXPIRY_GRACE_S = 1.0     # rotate this long after the announced death (asking earlier may be refused)
TIKTOK_PROBE = "https://www.tiktok.com/robots.txt"
IP_PROBE = "https://ipinfo.io/json"


class ProxyFatal(RuntimeError):
    """Nothing more can be done without the user (no proxy, wrong key)."""


class ProxyGaveUp(RuntimeError):
    """ensure(max_tries=...) did not get a working IP in time (only for callers that wait for an answer)."""


def proxy_url(p: dict, with_auth: bool = True) -> str:
    if not IP_PORT.match(p.get("proxy") or ""):
        return ""
    scheme = "socks5" if p.get("type") == "SOCKS5" else "http"
    auth = f"{quote(p['user'], safe='')}:{quote(p.get('password') or '', safe='')}@" if with_auth and p.get("user") else ""
    return f"{scheme}://{auth}{p['proxy']}"


def httpx_proxy(p: dict) -> Optional[httpx.Proxy]:
    url = proxy_url(p, with_auth=False)
    if not url:
        return None
    return httpx.Proxy(url, auth=(p["user"], p.get("password") or "") if p.get("user") else None)


def rotate_link(p: dict) -> str:
    return KEY_SLOT.sub(lambda _: quote(p.get("key") or "", safe=""), str(p.get("rotate_url") or ""))


def parse_rotate(text: str, type_: str = "HTTP") -> dict:
    """Read any provider's answer: {proxy, user, password, message} (proxy '' when none was found)."""
    data, message, candidates = None, "", []
    try:
        data = json.loads(text)
    except ValueError:
        pass
    if isinstance(data, dict):
        for k in ("message", "msg", "error", "mess", "thongbao"):
            if isinstance(data.get(k), str):
                message = data[k]
                break
        want = "socks" if type_ == "SOCKS5" else "http"
        vals = [(k, v) for k, v in data.items() if isinstance(v, str)]
        candidates = [v for k, v in vals if want in k.lower()] + [v for _, v in vals]
    candidates.append(str(text))
    for v in candidates:
        m = PROXY_IN_TEXT.search(v)
        if m:
            return {"proxy": m.group(1), "user": m.group(2) or "", "password": m.group(3) or "", "message": message}
    return {"proxy": "", "user": "", "password": "", "message": message or str(text).strip()[:300]}


def parse_lifetime(message: str) -> Optional[int]:
    m = LIFETIME.search(message or "")
    return int(m.group(1)) if m else None


@dataclass
class Check:
    ok: bool
    ip: str = ""
    where: str = ""
    org: str = ""
    ms: int = 0
    error: str = ""


async def check_proxy(p: dict) -> Check:
    """Through the proxy only: does TikTok answer. That alone decides; where the IP is comes later (lookup_ip),
    so a reconnection never waits for it."""
    hp = httpx_proxy(p)
    if hp is None:
        return Check(ok=False, error="chưa có proxy (IP:cổng)")
    return await _reach_tiktok(hp)


async def check_direct(_p: Optional[dict] = None) -> Check:
    """With no proxy (the setting `use_proxy` is off): does TikTok answer from this computer's network."""
    return await _reach_tiktok(None)


async def _reach_tiktok(hp: Optional[httpx.Proxy]) -> Check:
    t0 = time.monotonic()
    try:
        async with httpx.AsyncClient(proxy=hp, timeout=CHECK_TIMEOUT_S, follow_redirects=True) as c:
            t = await c.get(TIKTOK_PROBE, headers={"User-Agent": "Mozilla/5.0"})
    except httpx.HTTPError as e:
        return Check(ok=False, error=f"{type(e).__name__} {e}".strip(), ms=int((time.monotonic() - t0) * 1000))
    ms = int((time.monotonic() - t0) * 1000)
    if t.status_code >= 500:
        return Check(ok=False, ms=ms, error=f"TikTok trả lỗi {t.status_code}")
    return Check(ok=True, ms=ms)


async def lookup_ip(p: dict) -> dict:
    """The IP TikTok sees through this proxy, and where it is (for the window only)."""
    hp = httpx_proxy(p)
    if hp is None:
        return {}
    try:
        async with httpx.AsyncClient(proxy=hp, timeout=IP_TIMEOUT_S, follow_redirects=True) as c:
            return (await c.get(IP_PROBE, headers={"User-Agent": "Mozilla/5.0"})).json()
    except (httpx.HTTPError, ValueError):
        return {}


async def _fetch_direct(url: str) -> str:
    # the provider's link is called directly: the current proxy is dead, and the link only hands out an IP
    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as c:
        return (await c.get(url, headers={"User-Agent": "Mozilla/5.0"})).text


DIRECT_NAME = "trực tiếp"      # a proxy's name has no space in it (Hub._validate_proxy): no proxy can take this one


class Direct:
    """No proxy: straight from this computer's network. It stands where a Proxy does for a Link (the same
    methods), with nothing to rotate: when TikTok does not answer, it waits and looks again.
    Where the IP is is never looked up here: that would tell a third site the address of the user's home."""

    direct = True
    name = DIRECT_NAME
    can_rotate = False
    RETRY_S = 15

    def __init__(self, *, say: Callable[[str], None] = print, sleep: Callable[[float], Awaitable] = asyncio.sleep,
                 check: Callable[[dict], Awaitable[Check]] = None):
        self.p = {"name": DIRECT_NAME, "type": "", "proxy": ""}
        self.say, self.sleep = say, sleep
        self.check = check or check_direct
        self.generation = 0          # never changes: there is no IP of ours to replace
        self.last_check: Optional[Check] = None
        self.ip_info: dict = {}
        self.state = "chưa kiểm tra"

    def httpx_proxy(self) -> Optional[httpx.Proxy]:
        return None

    def ip_age_s(self) -> Optional[float]:
        return None

    def life_left_s(self) -> Optional[float]:
        return None

    def life(self) -> str:
        return ""

    def describe(self) -> str:
        return "nối thẳng (không proxy)"

    def status(self) -> dict:
        c = self.last_check
        return {"name": self.name, "state": self.state, "ms": c.ms if c else None,
                "error": c.error if c and not c.ok else ""}

    async def alive(self) -> bool:
        self.last_check = await self.check(self.p)
        self.state = "chạy" if self.last_check.ok else f"mạng của máy chưa vào được TikTok: {self.last_check.error}"
        return self.last_check.ok

    async def lookup_now(self) -> dict:
        return self.ip_info

    async def ensure(self, seen_generation: Optional[int] = None, force_new: bool = False,
                     trust_new: bool = False, max_tries: Optional[int] = None) -> Check:
        """TikTok answers from this network, now. Waits for it (the cable is out, the router restarts...); `max_tries`:
        give up after that many looks, for a caller that waits for an answer."""
        tries = 0
        while not await self.alive():
            tries += 1
            if max_tries is not None and tries >= max_tries:
                raise ProxyGaveUp(f"nối thẳng: chưa vào được TikTok ({self.last_check.error})")
            self.say(f"[MẠNG] nối thẳng: chưa vào được TikTok ({self.last_check.error}), thử lại sau {self.RETRY_S} giây")
            await self.sleep(self.RETRY_S)
        return self.last_check  # type: ignore[return-value]

    async def wait_changed(self, seen_generation: int) -> None:
        await asyncio.Future()       # there is never a new IP to wait for


class Proxy:
    """One proxy entry of config.json (the dict is updated in place; `persist` saves the whole config)."""

    direct = False

    def __init__(self, entry: dict, *, min_interval: float = 60, rotate_at_expiry: bool = True,
                 persist: Callable[[], None] = lambda: None, say: Callable[[str], None] = print,
                 clock: Callable[[], float] = time.time, sleep: Callable[[float], Awaitable] = asyncio.sleep,
                 fetch: Callable[[str], Awaitable[str]] = _fetch_direct, check: Callable[[dict], Awaitable[Check]] = None,
                 lookup: Optional[Callable[[dict], Awaitable[dict]]] = None):
        self.p = entry
        self.min_interval = float(min_interval or 60)
        self.rotate_at_expiry = rotate_at_expiry
        self.persist, self.say, self.clock, self.sleep, self.fetch = persist, say, clock, sleep, fetch
        self.check = check or check_proxy
        # where the IP is: real lookups only with the real check (tests that fake the check do not go online)
        self.lookup = lookup or (lookup_ip if check is None else None)
        self.generation = 0          # +1 on every new IP
        self.last_check: Optional[Check] = None
        self.ip_info: dict = {}      # {"ip", "where", "org"} of the current generation
        self._ip_gen = -1
        self._bg: set = set()
        self.state = "chưa kiểm tra"
        self._lock = asyncio.Lock()
        self._changed = asyncio.Event()   # set on every new IP (connections waiting for it wake up)

    # ---------- what the status page shows ----------
    @property
    def name(self) -> str:
        return self.p["name"]

    @property
    def can_rotate(self) -> bool:
        return bool(self.p.get("rotate_url") and self.p.get("key"))

    def httpx_proxy(self) -> Optional[httpx.Proxy]:
        return httpx_proxy(self.p)

    def ip_age_s(self) -> Optional[float]:
        try:
            return (datetime.now() - datetime.fromisoformat(self.p["proxy_at"])).total_seconds()
        except (KeyError, ValueError, TypeError):
            return None

    def life_left_s(self) -> Optional[float]:
        at = float(self.p.get("expires_at") or 0)
        return max(0.0, at - self.clock()) if at else None

    def life(self) -> str:
        age, left = self.ip_age_s(), self.life_left_s()
        parts = ([f"IP đã dùng {age / 60:.0f} phút"] if age is not None else []) + \
                ([f"còn khoảng {left / 60:.0f} phút"] if left is not None else [])
        return (" · " + ", ".join(parts)) if parts else ""

    def describe(self) -> str:
        return f"{self.name} ({self.p.get('type')} {self.p.get('proxy') or 'chưa có IP:cổng'})"

    def status(self) -> dict:
        c = self.last_check
        return {"name": self.name, "type": self.p.get("type"), "proxy": self.p.get("proxy"), "state": self.state,
                "ip": self.ip_info.get("ip", ""), "where": self.ip_info.get("where", ""), "ms": c.ms if c else None,
                "error": c.error if c and not c.ok else "", "can_rotate": self.can_rotate,
                "age_s": self.ip_age_s(), "life_left_s": self.life_left_s(), "generation": self.generation}

    # ---------- rotating ----------
    async def _rotate_once(self) -> dict:
        if not self.can_rotate:
            raise ProxyFatal(f"{self.name}: chưa có key + link đổi IP, không tự đổi được")
        wait = self.min_interval - (self.clock() - float(self.p.get("rotated_at") or 0))
        if wait > 0:
            self.state = f"chờ {int(wait + 0.999)} giây để đổi IP"
            self.say(f"[PROXY] {self.name}: chờ {int(wait + 0.999)} giây nữa mới được đổi IP (tối thiểu {int(self.min_interval)} giây/lần)")
            await self.sleep(wait)
        self.p["rotated_at"] = self.clock()
        self.persist()
        self.state = "đang đổi IP"
        try:
            text = await self.fetch(rotate_link(self.p))
        except Exception as e:  # noqa: BLE001 - any network failure means "try again later"
            return {"ok": False, "message": f"không gọi được link đổi IP: {e}"}
        got = parse_rotate(text, self.p.get("type", "HTTP"))
        if not got["proxy"]:
            msg = got["message"] or "chưa lấy được proxy (chưa đến lúc đổi IP, hoặc key sai)"
            if WRONG_KEY.search(msg) and WRONG_KEY_WORDS.search(msg):
                self.state = "key sai hoặc hết hạn"
                raise ProxyFatal(f"{self.name}: nhà cung cấp báo key sai hoặc hết hạn ({msg})")
            return {"ok": False, "message": msg}
        self.p["proxy"] = got["proxy"]
        if got["user"] or got["password"]:
            self.p["user"], self.p["password"] = got["user"], got["password"]
        # a new IP even when IP:port stays the same (this provider keeps the port, changes the IP behind it)
        self.p["proxy_at"] = datetime.now().isoformat(timespec="seconds")
        lifetime = parse_lifetime(got["message"])
        self.p["expires_at"] = self.clock() + lifetime if lifetime else 0
        self.persist()
        return {"ok": True, "proxy": got["proxy"], "message": got["message"]}

    async def alive(self) -> bool:
        self.last_check = await self.check(self.p)
        if self.last_check.ok:
            self.state = "chạy"
            if self._ip_gen != self.generation:
                self._background(self.lookup_now())
        return self.last_check.ok

    async def lookup_now(self) -> dict:
        """Fill ip_info for the current IP (the window shows it; nothing waits for it)."""
        gen = self.generation
        if self.lookup is None:
            return self.ip_info
        info = await self.lookup(self.p)
        if info.get("ip") and gen == self.generation:
            self.ip_info = {"ip": info["ip"], "where": ", ".join(x for x in (info.get("city"), info.get("country")) if x),
                            "org": info.get("org", "")}
            self._ip_gen = gen
        return self.ip_info

    def _background(self, coro) -> None:
        t = asyncio.ensure_future(coro)
        self._bg.add(t)
        t.add_done_callback(self._bg.discard)

    def _bump(self) -> None:
        self.generation += 1
        self.ip_info = {}
        self._changed.set()
        self._changed = asyncio.Event()

    async def ensure(self, seen_generation: Optional[int] = None, force_new: bool = False,
                     trust_new: bool = False, max_tries: Optional[int] = None) -> Check:
        """A working proxy right now. `seen_generation`: the generation the caller connected on; if the IP
        changed since, the caller just uses the new one (someone else already rotated). Keeps the current IP
        while it works (unless force_new); otherwise asks for new ones, `min_interval` apart, until one works.
        Never returns without a proxy, never falls back to the home network. `max_tries`: give up after that
        many requests for a new IP (a button waiting for an answer); None = never (the connections)."""
        tries = 0
        async with self._lock:
            if seen_generation is not None and seen_generation != self.generation:
                return self.last_check or Check(ok=True)
            if not force_new and proxy_url(self.p) and await self.alive():
                return self.last_check  # type: ignore[return-value]
            if proxy_url(self.p) and self.last_check and not force_new:
                self.say(f"[PROXY] {self.describe()} không chạy: {self.last_check.error}{self.life()}")
            if not self.can_rotate:
                if not proxy_url(self.p):
                    raise ProxyFatal(f"{self.name}: chưa có proxy")
                if force_new and await self.alive():
                    # cannot rotate: this IP is all there is and it works. No bump: a bump would disconnect
                    # every channel on this proxy for nothing.
                    return self.last_check  # type: ignore[return-value]
                while True:
                    self.state = "chết, chờ proxy cố định sống lại"
                    self.say(f"[PROXY] {self.name}: không có key + link đổi IP, thử lại sau 30 giây")
                    await self.sleep(30)
                    if await self.alive():
                        self._bump()
                        return self.last_check  # type: ignore[return-value]
            while True:
                if max_tries is not None and tries >= max_tries:
                    raise ProxyGaveUp(f"{self.name}: chưa lấy được IP chạy được sau {tries} lần đổi"
                                      + (f" ({self.last_check.error})" if self.last_check and self.last_check.error else ""))
                tries += 1
                r = await self._rotate_once()
                if not r["ok"]:
                    self.say(f"[PROXY] {self.name}: chưa đổi được IP: {r['message']}")
                    if max_tries is not None and tries >= max_tries:
                        raise ProxyGaveUp(f"{self.name}: chưa đổi được IP: {r['message']}")
                    continue
                self.say(f"[PROXY] {self.name}: IP mới {r['proxy']}" + (f" · {r['message']}" if r.get("message") else ""))
                if trust_new:
                    # at the announced death: the old IP is gone anyway; the links connect at once instead of
                    # waiting for a check (a bad new IP is caught by their own failure path)
                    self.state = "chạy"
                    self.last_check = Check(ok=True)
                    self._bump()
                    self._background(self.alive())
                    return self.last_check
                if await self.alive():
                    self._bump()
                    return self.last_check  # type: ignore[return-value]
                self.say(f"[PROXY] {self.name}: IP mới chưa vào được TikTok: {self.last_check.error if self.last_check else ''}")

    async def wait_changed(self, seen_generation: int) -> None:
        """Returns as soon as the IP is no longer the one of `seen_generation`."""
        while self.generation == seen_generation:
            await self._changed.wait()

    async def expiry_loop(self) -> None:
        """The provider said when the IP dies: take the new one right then, instead of waiting for the
        connections to go silent (that costs 10 to 30 s of missed messages each time)."""
        # runs for the whole life of the proxy: a key or link added later, or a failed rotation, never stops it
        while True:
            try:
                left = self.life_left_s()
                if not (self.rotate_at_expiry and self.can_rotate) or left is None:
                    await self.sleep(5)      # nothing to do yet (no key, or no death announced): look again later
                    continue
                if left > 0:
                    await self.sleep(min(left + EXPIRY_GRACE_S, 30))
                    continue
                gen = self.generation
                self.say(f"[PROXY] {self.name}: đến giờ IP hết hạn (nhà cung cấp đã báo), lấy IP mới")
                self.p["expires_at"] = 0     # handled: do not loop on it if the rotation fails
                await self.ensure(seen_generation=gen, force_new=True, trust_new=True)
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001 - wrong key, provider down, config file locked...
                self.state = f"lỗi: {e}"
                self.say(f"[PROXY] {self.name}: đổi IP lúc hết hạn không được: {type(e).__name__}: {e}")
                await self.sleep(30)

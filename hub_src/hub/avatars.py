"""Avatars for the games, through the hub: http://127.0.0.1:PORT/avatar/<user id>

Why not the TikTok link (user.avatar) itself:
  - TikTok's image servers send no CORS header: a browser game cannot draw them on a canvas / use them as a
    WebGL (Three.js) texture
  - the game would load them from the home network (with proxies on, the hub only goes through proxies)
  - the links are signed and expire (about 2 days, seen 09/11/2026)
So the hub keeps the latest link of each viewer, downloads the picture once through a proxy, keeps it in memory,
and serves it with CORS. Only links the hub got from TikTok, only from image hosts listed below: nobody can make
the hub fetch an address of their choosing.
"""
from __future__ import annotations

import asyncio
from collections import OrderedDict
from typing import Awaitable, Callable, Optional
from urllib.parse import urlparse

import httpx

IMAGE_HOSTS = (".tiktokcdn.com", ".tiktokcdn-eu.com", ".tiktokcdn-us.com", ".ibyteimg.com", ".byteimg.com",
               ".muscdn.com", ".fbsbx.com")      # fbsbx: viewers who signed up with Facebook (seen in a live)
MAX_URLS = 20000           # viewers remembered (only their link: a few hundred bytes each)
MAX_IMAGES = 3000          # pictures kept (72x72 webp: a few KB each)
MAX_IMAGE_BYTES = 2_000_000
FETCH_TIMEOUT_S = 8


def allowed(url: str) -> bool:
    try:
        u = urlparse(url or "")
    except ValueError:
        return False
    host = (u.hostname or "").lower()
    return u.scheme == "https" and any(host == h[1:] or host.endswith(h) for h in IMAGE_HOSTS)


async def fetch_through(url: str, proxy: Optional[httpx.Proxy]) -> tuple[bytes, str]:
    async with httpx.AsyncClient(proxy=proxy, timeout=FETCH_TIMEOUT_S, follow_redirects=True) as c:
        r = await c.get(url, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://www.tiktok.com/"})
    if r.status_code != 200:
        raise ValueError(f"máy chủ ảnh trả {r.status_code}" + (" (link đã hết hạn?)" if r.status_code in (403, 410) else ""))
    return r.content, r.headers.get("content-type", "")


class AvatarCache:
    def __init__(self, pick_proxy: Callable[[], Optional[httpx.Proxy]],
                 fetch: Callable[[str, Optional[httpx.Proxy]], Awaitable[tuple[bytes, str]]] = fetch_through,
                 direct: Callable[[], bool] = lambda: False):
        self.pick_proxy = pick_proxy
        self.fetch = fetch
        self.direct = direct         # True: proxies are turned off, the pictures come straight too
        self.urls: "OrderedDict[str, str]" = OrderedDict()                     # user id -> latest link
        self.images: "OrderedDict[str, tuple[str, bytes, str]]" = OrderedDict()  # user id -> (link, bytes, type)
        self._inflight: dict[str, asyncio.Future] = {}
        self.fetched = 0

    def remember(self, uid: str, url: str) -> bool:
        """The latest link of a viewer (a new one replaces an expired one). False when not usable."""
        if not uid or not allowed(url):
            return False
        self.urls[uid] = url
        self.urls.move_to_end(uid)
        while len(self.urls) > MAX_URLS:
            self.urls.popitem(last=False)
        return True

    async def get(self, uid: str) -> tuple[int, bytes, str]:
        """(HTTP status, body, content type)."""
        url = self.urls.get(uid)
        if not url:
            return 404, b"unknown viewer", "text/plain"
        hit = self.images.get(uid)
        if hit and hit[0] == url:
            self.images.move_to_end(uid)
            return 200, hit[1], hit[2]
        if uid in self._inflight:                     # many requests for one picture: downloaded once
            return await asyncio.shield(self._inflight[uid])
        fut = asyncio.get_running_loop().create_future()
        self._inflight[uid] = fut
        try:
            result = await self._download(uid, url)
        except Exception as e:  # noqa: BLE001
            result = (502, f"không tải được ảnh: {e}".encode("utf-8"), "text/plain")
        finally:
            self._inflight.pop(uid, None)
        fut.set_result(result)
        return result

    async def _download(self, uid: str, url: str) -> tuple[int, bytes, str]:
        proxy = None if self.direct() else self.pick_proxy()
        if proxy is None and not self.direct():       # proxies are on: never from the home network
            return 503, "chưa có proxy chạy được để tải ảnh".encode("utf-8"), "text/plain"
        body, ctype = await self.fetch(url, proxy)
        ctype = (ctype or "").split(";")[0].strip().lower()
        if not ctype.startswith("image/") or len(body) > MAX_IMAGE_BYTES:
            return 502, f"không phải ảnh ({ctype or '?'}, {len(body)} byte)".encode("utf-8"), "text/plain"
        self.fetched += 1
        self.images[uid] = (url, body, ctype)
        self.images.move_to_end(uid)
        while len(self.images) > MAX_IMAGES:
            self.images.popitem(last=False)
        return 200, body, ctype

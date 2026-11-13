"""One connection to a TikTok LIVE, through one proxy (or straight from this computer when proxies are turned off:
proxy.Direct stands for the proxy then). A channel opens one link per proxy and merges them.

A link whose proxy IP died gives no error: TikTokLive turns off the WebSocket ping (TikTok does not answer it),
so the connection just goes quiet (seen in the live 09/11/2026 19:20). A link is replaced when:
  - its proxy got a new IP (expiry or another link asked for it)        -> at once
  - another link of the channel received messages and this one did not  -> after CROSS_STALE_S
  - nothing at all came for the silence limit                           -> 30 s (10 s near the announced death)
Reconnecting reuses the room id already known (no live page to load, no "is live" check): a few seconds saved.
"""
from __future__ import annotations

import asyncio
import time
from typing import TYPE_CHECKING, Optional

import httpx

from .proxy import Proxy, ProxyFatal

if TYPE_CHECKING:
    from .channel import Channel

SILENCE_S = 30
SILENCE_NEAR_END_S = 10
SILENCE_MAX_S = 120
NEAR_END_S = 60
CROSS_STALE_S = 5
STOP_TIMEOUT_S = 5
START_TIMEOUT_S = 45
WATCH_EVERY_S = 1
SAME_IP_FAILS = 3
OFFLINE_RETRY_S = 30
CACHED_ROOM_FAILS = 2     # this many silent connects in a row with the cached room id: look the room up again
DIRECT_RETRY_MAX_S = 30   # with no proxy: the longest wait between two tries that did not connect


async def with_timeout(coro, timeout: float):
    """asyncio.wait_for without its Python 3.10 bug (it can swallow a cancellation arriving just as the inner
    call finishes, and the app then never stops)."""
    task = asyncio.ensure_future(coro)
    try:
        done, _ = await asyncio.wait({task}, timeout=timeout)
    except asyncio.CancelledError:
        task.cancel()
        raise
    if not done:
        task.cancel()
        raise asyncio.TimeoutError()
    return task.result()


def hook_raw_frames(client, on_frame) -> bool:
    """Call on_frame() for every frame the WebSocket receives, the server heartbeats ("hb") included: TikTokLive
    drops those before they become events, so a quiet live (nobody comments) would look dead and be reconnected
    for nothing. Wraps recv() of this connection only. False when TikTokLive's insides changed: the link then
    goes by messages only, as before."""
    gen = getattr(getattr(client, "_ws", None), "_connection_generator", None)
    proto = getattr(gen, "ws", None)
    recv = getattr(proto, "recv", None)
    if recv is None or getattr(proto, "_hub_hooked", False):
        return False

    async def counted(*a, **k):
        data = await recv(*a, **k)
        on_frame()
        return data
    proto.recv = counted
    proto._hub_hooked = True
    return True


async def close_client(client) -> None:
    """Close everything, never hanging."""
    t = getattr(client, "_event_loop_task", None)
    if t is not None and t.done():
        client._event_loop_task = None   # cancelled: disconnect() would re-raise the cancellation
    sign = client.web.signer.sdk_client
    for step in (client.disconnect, client.web.close, lambda: sign.get_async_httpx_client().aclose()):
        try:
            await with_timeout(step(), STOP_TIMEOUT_S)
        except Exception:  # noqa: BLE001 - timeout or already closed
            pass


class Link:
    def __init__(self, channel: "Channel", proxy: Proxy):
        self.channel = channel
        self.proxy = proxy
        self.state = "chờ"
        self.up = False                 # connected and not stale
        self.last_msg = 0.0             # monotonic time of the last frame (heartbeats included when readable)
        self.msgs = 0
        self.raw_frames = 0
        self.heartbeat = False          # True when the server heartbeats are seen (see hook_raw_frames)
        self.connects = 0
        self.reconnects = 0
        self.last_reason = ""
        self.silence_limit = SILENCE_S
        self._task: Optional[asyncio.Task] = None

    @property
    def name(self) -> str:
        return self.proxy.name

    def status(self) -> dict:
        return {"proxy": self.name, "state": self.state, "up": self.up, "connects": self.connects,
                "reconnects": self.reconnects, "last_reason": self.last_reason, "messages": self.msgs,
                "raw_frames": self.raw_frames, "heartbeat": self.heartbeat,
                "quiet_s": round(time.monotonic() - self.last_msg, 1) if self.last_msg else None}

    def start(self) -> None:
        self._task = asyncio.create_task(self.run())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass

    def _set_up(self, up: bool, reason: str = "") -> None:
        if up != self.up:
            self.up = up
            self.channel.link_changed(self, reason)

    def _silence_limit(self) -> float:
        left = self.proxy.life_left_s()
        return SILENCE_NEAR_END_S if left is not None and left <= NEAR_END_S else self.silence_limit

    async def run(self) -> None:
        """Keeps the link alive whatever happens: an unexpected error (TikTokLive changed, config file locked
        by an antivirus...) restarts it after a pause instead of leaving a dead task behind."""
        while True:
            try:
                await self._run()
                return                                    # stopped on purpose (channel not found...)
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001
                self.state = f"lỗi bất ngờ, chạy lại sau 5 giây: {type(e).__name__}: {e}"
                self._set_up(False, f"lỗi {type(e).__name__}")
                self.channel.handler_error(f"link {self.name}", e)
                await asyncio.sleep(5)

    async def _run(self) -> None:
        from TikTokLive import TikTokLiveClient
        from TikTokLive.client.errors import (AgeRestrictedError, SignatureRateLimitError, UserNotFoundError,
                                              UserOfflineError)
        from TikTokLive.client.web.web_settings import WebDefaults
        from TikTokLive.events import (CommentEvent, ConnectEvent, FollowEvent, GiftEvent, JoinEvent, LikeEvent,
                                       LiveEndEvent, RoomUserSeqEvent, ShareEvent)
        from TikTokLive.events.custom_events import WebsocketResponseEvent

        ch = self.channel
        same_ip_fails = 0
        cached_room_fails = 0
        need_check = True       # false when the bottom of the loop already made sure the proxy works
        while True:
            if need_check:
                try:
                    self.state = "kiểm tra mạng" if self.proxy.direct else "kiểm tra proxy"
                    await self.proxy.ensure()
                except ProxyFatal as e:
                    self.state = f"proxy hỏng: {e}"
                    ch.note("link_fatal", f"[{ch.name}/{self.name}] {e}", proxy=self.name)
                    await asyncio.sleep(60)
                    continue
            need_check = True
            gen = self.proxy.generation
            WebDefaults.tiktok_sign_api_key = ch.hub.cfg.get("sign_api_key") or None   # changed in Settings: from now on
            hp = self.proxy.httpx_proxy()
            client = TikTokLiveClient(unique_id=ch.name, web_proxy=hp, ws_proxy=hp)
            sign = client.web.signer.sdk_client
            if getattr(sign, "_async_client", None) is not None:
                raise RuntimeError("TikTokLive đã tạo kết nối ký trước khi gắn proxy: kiểm tra lại khi nâng phiên bản")
            sign._httpx_args["proxy"] = hp      # the sign server request too goes the way of the link (never the home
            #                                     network while proxies are on; hp is None only for proxy.Direct)
            st = {"stale": False, "why": "", "msgs": 0, "connected": False, "ended": False}
            self.last_msg = time.monotonic()

            def h(cls, fn):
                client.on(cls)(self._safe(fn))

            def raw_frame():
                self.last_msg = time.monotonic()
                self.raw_frames += 1

            async def on_connect(ev):
                st["connected"] = True
                self.connects += 1
                self.heartbeat = hook_raw_frames(client, raw_frame)
                self.state = "đang nhận" + ("" if self.heartbeat else " (không đọc được heartbeat)")
                self._set_up(True, "kết nối")
                ch.on_connect(self, ev.room_id)

            async def on_frame(_ev):
                self.last_msg = time.monotonic()
                st["msgs"] += 1
                self.msgs += 1
                if not self.up and st["connected"] and not st["stale"]:
                    self._set_up(True, "có tin trở lại")

            async def on_end(_ev):
                st["ended"] = True
                ch.on_live_end(self)

            h(ConnectEvent, on_connect)
            h(WebsocketResponseEvent, on_frame)
            h(CommentEvent, ch.ingest_comment)
            h(GiftEvent, ch.ingest_gift)
            h(JoinEvent, ch.ingest_join)
            h(LikeEvent, ch.ingest_like)
            h(FollowEvent, ch.ingest_follow)
            h(ShareEvent, ch.ingest_share)
            h(RoomUserSeqEvent, ch.ingest_viewers)
            h(LiveEndEvent, on_end)

            failure, offline = "", False
            room = ch.room_id
            self.state = "đang vào live" + (" (room đã biết)" if room else "")
            try:
                task = await with_timeout(client.start(fetch_live_check=room is None, room_id=room), START_TIMEOUT_S)

                async def watchdog():
                    while not task.done():
                        await asyncio.sleep(WATCH_EVERY_S)
                        now = time.monotonic()
                        quiet = now - self.last_msg
                        why = ""
                        if self.proxy.generation != gen:
                            why = "proxy vừa đổi IP"
                        elif st["connected"] and (ch.peer_last(self) - self.last_msg) > CROSS_STALE_S and quiet > CROSS_STALE_S:
                            why = f"link khác vẫn nhận tin, link này im {quiet:.0f} giây"
                        elif quiet > self._silence_limit():
                            why = f"{quiet:.0f} giây không có tin"
                        if why:
                            st["stale"], st["why"] = True, why
                            self._set_up(False, why)
                            try:
                                await with_timeout(client.disconnect(), STOP_TIMEOUT_S)
                            except Exception:  # noqa: BLE001
                                pass
                            if not task.done():
                                task.cancel()
                            return

                dog = asyncio.create_task(watchdog())
                try:
                    await task
                except asyncio.CancelledError:
                    if not st["stale"]:
                        raise
                finally:
                    dog.cancel()
                failure = st["why"] or "mất kết nối"
            except UserOfflineError:
                offline = True
                failure = "kênh chưa live"
            except (UserNotFoundError, AgeRestrictedError) as e:
                failure = f"{type(e).__name__}: {e}"
                self.state = f"dừng: {failure}"
                ch.note("link_fatal", f"[{ch.name}/{self.name}] {failure}", proxy=self.name)
                await close_client(client)
                self._set_up(False, failure)
                return
            except SignatureRateLimitError as e:
                wait = max(30, int(getattr(e, "retry_after", 60) or 60))
                failure = f"server ký báo quá giới hạn, chờ {wait} giây"
                self.state = failure
                ch.note("sign_rate_limit", f"[{ch.name}/{self.name}] {failure} (thêm sign_api_key để có hạn mức riêng)", wait=wait)
                await close_client(client)
                self._set_up(False, failure)
                await asyncio.sleep(wait)
                continue
            except (httpx.HTTPError, OSError, asyncio.TimeoutError) as e:
                failure = f"{type(e).__name__}: {e}"
            except asyncio.CancelledError:
                await close_client(client)
                self._set_up(False, "dừng")
                raise
            except Exception as e:  # noqa: BLE001 - TikTok changes often: log and try again
                failure = f"{type(e).__name__}: {e}"
            await close_client(client)
            self._set_up(False, failure)
            self.last_reason = failure

            if offline:
                ch.on_offline(self)
                self.state = f"kênh chưa live, thử lại sau {OFFLINE_RETRY_S} giây"
                await asyncio.sleep(OFFLINE_RETRY_S)
                continue
            if st["ended"]:
                self.state = f"kênh vừa tắt live, chờ {OFFLINE_RETRY_S} giây"
                await asyncio.sleep(OFFLINE_RETRY_S)
                continue

            self.reconnects += 1
            # a cached room that brings nothing: maybe the live ended unseen and a new room started
            if room and st["msgs"] <= 1:
                cached_room_fails += 1
                if cached_room_fails >= CACHED_ROOM_FAILS:
                    ch.forget_room(self)
                    cached_room_fails = 0
            elif st["msgs"] > 1:
                cached_room_fails = 0
            # a quiet live: a connection that brought nothing makes the next wait longer (fewer sign requests)
            self.silence_limit = min(SILENCE_MAX_S, self.silence_limit * 2) if st["stale"] and st["msgs"] <= 1 else SILENCE_S
            ch.note("reconnect", f"[{ch.name}/{self.name}] {failure} · nối lại", proxy=self.name, reason=failure)

            if self.proxy.generation != gen:
                need_check = False                         # the IP already changed (and was checked): use it
                delay = ch.hub.stagger(self)               # several channels on this proxy: not all at once
                if delay:
                    await asyncio.sleep(delay)
                continue
            same_ip_fails = 0 if st["connected"] else same_ip_fails + 1
            self.state = "kiểm tra mạng" if self.proxy.direct else "kiểm tra proxy"
            try:
                if not await self.proxy.alive():
                    await self.proxy.ensure(seen_generation=gen)
                    same_ip_fails = 0
                elif same_ip_fails >= SAME_IP_FAILS and not self.proxy.direct:
                    ch.note("rotate_forced", f"[{ch.name}/{self.name}] {SAME_IP_FAILS} lần liền không vào được live qua IP này: đổi IP")
                    await self.proxy.ensure(seen_generation=gen, force_new=True)
                    same_ip_fails = 0
                elif self.proxy.direct and not st["connected"]:
                    # no proxy: there is no other IP to try. Each failure in a row waits longer (3 s, 6 s ... 30 s),
                    # so a refusal by TikTok or by the sign server is not answered with a stream of new requests
                    await asyncio.sleep(min(DIRECT_RETRY_MAX_S, 3 * max(1, same_ip_fails)))
                else:
                    await asyncio.sleep(0.5 if st["connected"] else 3)
                need_check = False
            except ProxyFatal:
                pass                                       # need_check stays true: reported at the top

    def _safe(self, fn):
        ch = self.channel

        async def run(ev):
            try:
                r = fn(ev)
                if asyncio.iscoroutine(r):
                    await r
            except Exception as e:  # noqa: BLE001 - one bad handler must not stop the others
                ch.handler_error(getattr(fn, "__name__", "handler"), e)
        return run

/*!
 * TikTok Live Hub SDK for browser games.
 *
 *   <script src="http://127.0.0.1:8765/tiktok-live-hub.js"></script>
 *   <script>
 *     const hub = new TikTokLiveHub({ channels: ["tenkenh"], client: "ten-game" });
 *     hub.on("comment",   e => console.log(e.user.nickname, e.text));
 *     hub.on("gift",      e => console.log(e.coins));            // coins to add NOW (a combo comes in parts)
 *     hub.on("gift_done", e => console.log(e.count, e.coins));   // the gift / combo is over, with its totals
 *
 * The hub only carries what happens on the live; what to do with it is up to each game.
 * e.user = { id (a string: TikTok ids are too big for JS numbers), unique_id, nickname, avatar, avatar_hub }
 *   avatar_hub: the picture through the hub (proxy, cache, CORS): fine for <img>, canvas and WebGL textures.
 *     hub.connect();
 *   </script>
 *
 * Events (e.type): comment, gift, gift_done, join, like, follow, share, viewers, live_start, live_end,
 *   gap (no connection to TikTok for e.ms milliseconds: messages in it may be missing), link (a proxy link up/down).
 * Every event: { seq, ch, type, ts, ... }. "*" receives them all.
 * Connection events: open, close, hello, subscribed, reset (the hub restarted), error.
 *
 * Reconnects by itself and asks for what it missed (resume). A game that reloads its page starts fresh, unless
 * { resume: "storage" } (then it gets again what happened while it was closed, up to the hub's buffer).
 */
(function (root) {
  "use strict";

  // messages that answer the game (not live events): they carry no seq of their own
  const CONTROL = new Set(["hello", "subscribed", "ok", "error", "pong", "status", "unwatched"]);

  class TikTokLiveHub {
    constructor(opts = {}) {
      this.url = opts.url || "ws://127.0.0.1:8765/ws";
      this.channels = (opts.channels || []).map((c) => String(c).replace(/^@/, "").trim()).filter(Boolean);
      this.token = opts.token || "";
      this.client = opts.client || (typeof document !== "undefined" && document.title) || "game";
      this.resume = opts.resume === undefined ? "memory" : opts.resume; // "memory" | "storage" | false
      this.simOnly = !!opts.simOnly;   // channels used only for simulation: no connection to TikTok
      this.storageKey = opts.storageKey || "tiktok-live-hub:" + this.client;
      this.handlers = {};
      this.ws = null;
      this.closed = false;
      this.retry = 0;
      this.connected = false;
      this.pos = this._load();   // { epoch, seq: { ch: lastSeq } }
      this._pending = [];
    }

    on(type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn); return this; }
    off(type, fn) { this.handlers[type] = (this.handlers[type] || []).filter((f) => f !== fn); return this; }

    connect() {
      this.closed = false;
      this._open();
      return this;
    }

    close() {
      this.closed = true;
      if (this.ws) this.ws.close();
    }

    /** Add channels after connect(). */
    subscribe(channels) {
      const list = [].concat(channels).map((c) => String(c).replace(/^@/, "").trim()).filter(Boolean);
      for (const c of list) if (!this.channels.includes(c)) this.channels.push(c);
      this.send(this._subscribeMsg(list));
    }

    /** Fake events through the hub, as if they came from TikTok (marked sim: true).
     *  simulate("kenh", { kind: "comment", user: "an", text: "Hà Nội" })
     *  simulate("kenh", { kind: "gift", user: "an", gift: "Rose", diamonds: 1, count: 10 })   // a 10-combo
     *  kind: comment | gift | join | like | follow | share */
    simulate(ch, payload) { this.send({ op: "simulate", ch: String(ch).replace(/^@/, ""), ...payload }); }
    comment(ch, user, text) { this.simulate(ch, { kind: "comment", user, text }); }
    gift(ch, user, gift = "Rose", diamonds = 1, count = 1) { this.simulate(ch, { kind: "gift", user, gift, diamonds, count }); }
    watch(ch) { this.send({ op: "watch", ch }); }
    /** Stop watching a channel (for everyone) and stop asking for it after a reconnect. */
    unwatch(ch) { this.unsubscribe(ch); this.send({ op: "unwatch", ch }); }
    /** Stop receiving a channel (this game only). */
    unsubscribe(channels) {
      const list = [].concat(channels).map((c) => String(c).replace(/^@/, "").trim());
      this.channels = this.channels.filter((c) => !list.includes(c));
      this.send({ op: "unsubscribe", channels: list });
    }
    status() { this.send({ op: "status" }); }

    send(msg) {
      if (this.token && msg.token === undefined) msg.token = this.token;
      if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
      else this._pending.push(msg);
    }

    // ---------- inside ----------
    _subscribeMsg(list) {
      const since = {};
      if (this.resume && this.pos.epoch) for (const c of list) if (this.pos.seq[c]) since[c] = this.pos.seq[c];
      return { op: "subscribe", client: this.client, channels: list, since, epoch: this.pos.epoch, sim_only: this.simOnly };
    }

    _open() {
      let ws;
      try { ws = new WebSocket(this.url); } catch (e) { this._later(); return; }
      this.ws = ws;
      ws.onopen = () => {
        this.retry = 0;
        this.connected = true;
        this._fire("open", {});
      };
      ws.onmessage = (m) => {
        let e;
        try { e = JSON.parse(m.data); } catch (_) { return; }
        this._handle(e);
      };
      ws.onclose = (ev) => {
        const was = this.connected;
        this.connected = false;
        if (was) this._fire("close", { code: ev.code, reason: ev.reason });
        this._later();
      };
      ws.onerror = () => {};
    }

    _later() {
      if (this.closed) return;
      const wait = Math.min(5000, 500 * Math.pow(2, this.retry++));
      setTimeout(() => !this.closed && this._open(), wait);
    }

    _handle(e) {
      if (e.type === "hello") {
        if (this.pos.epoch && this.pos.epoch !== e.epoch) {
          this.pos = { epoch: e.epoch, seq: {} };   // the hub restarted: numbers start again
          this._fire("reset", e);
        }
        this.pos.epoch = e.epoch;
        this._fire("hello", e);
        // always sent, even with no channel yet: it also tells the hub this game's name (status page)
        this.ws.send(JSON.stringify(this._tok(this._subscribeMsg(this.channels))));
        for (const msg of this._pending.splice(0)) this.ws.send(JSON.stringify(msg));
        return;
      }
      if (CONTROL.has(e.type)) {                  // answers of the hub, not events: never move the position
        // ...but a channel that was closed and opened again counts from 0: a position ahead of its head is of the
        // old one, and would throw away every event up to that number
        if (e.type === "subscribed" && e.ch && typeof e.head === "number" && (this.pos.seq[e.ch] || 0) > e.head) {
          this.pos.seq[e.ch] = e.head;
          this._save();
        }
        this._fire(e.type, e);
        return;
      }
      if (e.seq !== undefined && e.ch) {
        const last = this.pos.seq[e.ch] || 0;
        if (e.seq <= last) return;                // already had it (a replay overlapping what we saw)
        this.pos.seq[e.ch] = e.seq;
        this._save();
      }
      this._fire(e.type, e);
      if (e.seq !== undefined) this._fire("*", e);
    }

    _tok(msg) { if (this.token) msg.token = this.token; return msg; }

    _fire(type, e) {
      for (const fn of this.handlers[type] || []) {
        try { fn(e); } catch (err) { console.error("[TikTokLiveHub] handler " + type, err); }
      }
    }

    _load() {
      if (this.resume !== "storage") return { epoch: null, seq: {} };
      try { return JSON.parse(localStorage.getItem(this.storageKey)) || { epoch: null, seq: {} }; }
      catch (_) { return { epoch: null, seq: {} }; }
    }

    _save() {
      if (this.resume !== "storage" || this._saving) return;
      this._saving = true;
      setTimeout(() => {
        this._saving = false;
        try { localStorage.setItem(this.storageKey, JSON.stringify(this.pos)); } catch (_) {}
      }, 500);
    }
  }

  root.TikTokLiveHub = TikTokLiveHub;
  if (typeof module === "object" && module.exports) module.exports = TikTokLiveHub;
})(typeof window !== "undefined" ? window : globalThis);

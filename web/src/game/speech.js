// The voice: one line at a time, the most urgent first, old lines dropped (a thank-you a minute late sounds wrong).
// The app's backend turns text into speech (/api/tts); when it fails, the line is still shown as a subtitle for
// as long as it would take to say, so the game goes on the same way.

const MS_PER_CHAR = 62;   // about how long the voice takes per character (used when there is no audio)

export class Speech {
  /**
   * @param {object} o
   * @param {(item) => void} o.onStart  a line starts (subtitle, camera)
   * @param {(item) => void} o.onEnd
   * @param {() => object} o.settings   { enabled, voice, rate, volume }
   */
  constructor({ onStart = () => {}, onEnd = () => {}, settings = () => ({ enabled: true }), cut = null } = {}) {
    this.queue = [];
    this.onStart = onStart;
    this.onEnd = onEnd;
    this.settings = settings;
    this.current = null;
    this.audio = new Audio();
    this.script = null;          // the end of a round: its lines go before everything else, in order
    this.lastEnd = Date.now();
    // which new line stops the line being said: (item, current) => bool, or { from, below } (a line of priority `from` or
    // more stops a line under `below`). A thank-you does not wait for a story; a big gift does not wait for anything
    // clearly smaller (the user, 10/11/2026)
    this.cut = cut;
  }

  busy() { return !!this.current || !!this.script || this.queue.length > 0; }
  idleFor(now = Date.now()) { return this.current || this.script ? 0 : now - this.lastEnd; }

  push(item) {
    if (!item?.text) return;
    // the same line twice in the queue (two quick countdowns, two asks) is said once
    if (this.queue.some((q) => q.text === item.text)) return;
    this.queue.push({ ttl: 15000, at: Date.now(), pri: 0, ...item });
    // something is being said: this one is made meanwhile, so it starts the moment its turn comes (it was only made
    // then: a second or more of silence before each line, and the commentary ran late)
    if (this.current && this.queue.length <= 3) this.warm([item.text]);
    if (this.queue.length > 30) {
      this.queue.sort((a, b) => b.pri - a.pri);
      this.queue.length = 30;
    }
    const c = this.current;
    const cuts = this.cut && c && !this.script && !c.cutting
      && (typeof this.cut === "function" ? this.cut(item, c) : item.pri >= this.cut.from && c.pri < this.cut.below);
    if (cuts) this._fadeOut(c);
    this._next();
  }

  /** The line being said fades out quickly and ends (what waits goes on as usual). */
  _fadeOut(c) {
    c.cutting = true;
    const a = this.audio, v0 = a.volume, t0 = Date.now(), MS = 220;
    const step = () => {
      if (this.current !== c) return;
      const k = Math.min(1, (Date.now() - t0) / MS);
      a.volume = v0 * (1 - k);
      if (k < 1) return setTimeout(step, 30);
      a.pause();
      this._cut?.();
    };
    step();
  }

  /** Say these lines now, in order, after the line being said; resolves when the last is over. */
  playScript(lines) {
    return new Promise((resolve) => {
      this.script = { lines: lines.map((l) => ({ pri: 100, ...l })), resolve };
      this._next();
    });
  }

  /** The script is over (said, or given up after too long): what is left of it is dropped, its promise resolved. */
  endScript() {
    if (!this.script) return;
    const s = this.script;
    this.script = null;
    s.resolve();
  }

  /** Throw away what waits (not the script). */
  clear(belowPri = Infinity) { this.queue = this.queue.filter((q) => q.pri >= belowPri); }

  /** Silence now: the line being said ends at once (its end is still reported), what waits is dropped. */
  stop() {
    this.queue = [];
    if (this.current) this.current.stopped = true;     // its voice may still be loading: it must not be waited for
    this.audio.pause();
    this._cut?.();
  }

  _pick(now) {
    if (this.script) {
      const l = this.script.lines.shift();
      if (!this.script.lines.length) { const s = this.script; this.script = null; l.done = s.resolve; }
      return l;
    }
    this.queue = this.queue.filter((q) => now - q.at <= q.ttl);
    if (!this.queue.length) return null;
    let best = 0;
    for (let i = 1; i < this.queue.length; i++) if (this.queue[i].pri > this.queue[best].pri) best = i;
    return this.queue.splice(best, 1)[0];
  }

  /** These lines will be said soon: their voice is made now (a few at most). */
  warm(texts) {
    const s = this.settings();
    if (!s.enabled) return;
    for (const text of texts.slice(0, 3)) if (text) fetch(ttsUrl(text, s, true)).catch(() => {});
  }

  /** Warm the voice of what comes next, so it starts without a pause. */
  _prefetch() {
    const s = this.settings();
    const next = this.script?.lines[0] || [...this.queue].sort((a, b) => b.pri - a.pri)[0];
    if (next && s.enabled) fetch(ttsUrl(next.text, s, true)).catch(() => {});
  }

  async _next() {
    if (this.current) return;
    const item = this._pick(Date.now());
    if (!item) return;
    this.current = item;
    const s = this.settings();
    try { this.onStart(item); } catch (e) { console.error(e); }
    this._prefetch();
    // waits until the line is over, or stop() cuts it
    const wait = (ms, audio) => new Promise((res) => {
      const done = () => {
        clearTimeout(t);
        if (audio) this.audio.onended = this.audio.onerror = null;
        this._cut = null;
        res();
      };
      const t = setTimeout(done, ms);
      this._cut = done;
      if (audio) { this.audio.onended = done; this.audio.onerror = done; }
    });
    let played = false;
    if (s.enabled) {
      try {
        this.audio.src = ttsUrl(item.text, s);
        this.audio.volume = Math.max(0, Math.min(1, s.volume ?? 1));
        // VieNeu has no speed setting: its lines are played faster or slower here (pitch kept); Edge's are made at speed
        const speed = String(s.voice || "").startsWith("vieneu:") ? Math.max(0.6, Math.min(1.6, 1 + (Number(s.rate) || 0) / 100)) : 1;
        this.audio.defaultPlaybackRate = this.audio.playbackRate = speed;
        await this.audio.play();
        await wait(30000, true);
        played = true;
      } catch (e) {
        if (!item.stopped && !item.cutting) console.warn("[speech]", e?.message || e);
      }
    }
    // no voice for this line: its words stay on screen for the time it takes to read them. Not when it was cut or
    // stopped while its voice was still loading (the line that cut it then waited up to 9 s in silence)
    if (!played && !item.stopped && !item.cutting) await wait(Math.min(9000, 900 + item.text.length * MS_PER_CHAR), false);
    await new Promise((res) => setTimeout(res, 120));   // a breath between two lines
    this.current = null;
    this.lastEnd = Date.now();
    try { this.onEnd(item); } catch (e) { console.error(e); }
    if (item.done) item.done();
    this._next();
  }
}

/** ahead: a line asked for before its turn (made after the lines said now, given up when the voice has no time). */
export function ttsUrl(text, s = {}, ahead = false) {
  const q = new URLSearchParams({ text, voice: s.voice || "", rate: String(s.rate ?? 0) });
  if (ahead) q.set("ahead", "1");
  return `/api/tts?${q}`;
}

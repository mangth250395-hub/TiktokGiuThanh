// Sound effects, made on the spot with Web Audio (no sound files, nothing to license), ASMR-like:
// a soft "bloop" when an avatar lands, a bell for a gift, a harp run for a new tier, a singing bowl at the end of
// a round, a wooden tick in the last seconds. No background music: the streamer plays their own.
// The effects go quieter while the commentator speaks.

// ngũ cung (C D F G A), as frequencies around middle C
const NOTE = (semi) => 261.63 * Math.pow(2, semi / 12);
const SCALE = [0, 2, 5, 7, 9, 12, 14, 17, 19, 21, 24];

export class Sound {
  constructor() {
    this.ctx = null;
    this.on = true;
    this.sfxLevel = 0.6;
    this.ducked = false;
    this.last = {};
  }

  /** Start (the first call creates the audio; a browser may need a click first, the app window does not). */
  start() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    // a little room for everything: a short soft echo
    this.verb = ctx.createConvolver();
    this.verb.buffer = this._impulse(2.8);
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    this.verb.connect(wet).connect(this.master);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.sfx.connect(this.verb);
    this._levels();
    document.addEventListener("pointerdown", () => ctx.state === "suspended" && ctx.resume());
  }

  set({ on = this.on, sfx = this.sfxLevel } = {}) {
    this.on = on; this.sfxLevel = sfx;
    this._levels();
  }

  /** The commentator speaks: everything steps back. */
  duck(on) {
    this.ducked = on;
    this._levels(0.6);
  }

  _levels(time = 0.3) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const sfx = this.on ? this.sfxLevel * (this.ducked ? 0.6 : 1) * 0.8 : 0;
    this.sfx.gain.setTargetAtTime(sfx, t, time / 3);
  }

  _impulse(seconds) {
    const n = Math.floor(this.ctx.sampleRate * seconds);
    const b = this.ctx.createBuffer(2, n, this.ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
    }
    return b;
  }

  // ---------- building blocks ----------
  _bell(freq, gain, decay, dest = this.sfx, when = 0) {
    if (!Number.isFinite(freq)) return;   // a wrong note is skipped, never an error (it stopped the hearts once)
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(gain, t + 0.008);
    out.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    out.connect(dest);
    for (const [ratio, amp] of [[1, 1], [2.76, 0.35], [5.4, 0.12]]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = freq * ratio;
      g.gain.value = amp;
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + decay + 0.1);
    }
  }

  _ok(kind, gapMs) {
    if (!this.ctx || !this.on || this.ctx.state !== "running") return false;
    const now = performance.now();
    if (now - (this.last[kind] || 0) < gapMs) return false;
    this.last[kind] = now;
    return true;
  }

  // ---------- effects ----------
  /** An avatar lands in a province: a soft round "bloop". */
  drop() {
    if (!this._ok("drop", 140)) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    const f0 = 520 + Math.random() * 180;
    o.frequency.setValueAtTime(f0 * 1.9, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.7, t + 0.13);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.22, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.25);
  }

  /** A golden outline rises off a province: a soft shimmer sweeping up, and a high bell. */
  halo() {
    if (!this._ok("halo", 300)) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const [f0, f1, a] of [[440, 1320, 0.03], [660, 1980, 0.018]]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + 0.9);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(a, t + 0.15);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
      o.connect(g).connect(this.sfx);
      o.start(t);
      o.stop(t + 1.2);
    }
    this._hiss("bandpass", 2500, 0.018, 0.9, 0, 7000);
    this._bell(NOTE(SCALE[9] + 12), 0.035, 1.6, this.sfx, 0.35);
  }

  /** "+N" rises over a province: a bright coin "ting-ting", higher and longer for more points. */
  plus(points = 5) {
    if (!this._ok("plus", 90)) return;
    const n = points >= 500 ? 4 : points >= 50 ? 3 : 2;
    const top = Math.min(SCALE.length - 1, 6 + Math.floor(Math.log10(Math.max(1, points))));
    for (let i = 0; i < n; i++) {
      const f = NOTE(SCALE[Math.max(0, top - n + 1 + i)] + 12);
      const t = this.ctx.currentTime + i * 0.075;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = "triangle";
      o.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.09, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.connect(g).connect(this.sfx);
      o.start(t);
      o.stop(t + 0.55);
    }
  }

  /** A gift: a bell; bigger gifts ring a few notes. */
  gift(points = 1) {
    if (!this._ok("gift", 160)) return;
    const notes = points >= 99 ? 5 : points >= 20 ? 3 : 1;
    const base = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < notes; i++) this._bell(NOTE(SCALE[Math.min(SCALE.length - 1, base + i)]), 0.11, 2.2, this.sfx, i * 0.11);
  }

  /** A province reaches a new tier: a harp run up the scale. */
  tier() {
    if (!this._ok("tier", 600)) return;
    const ctx = this.ctx;
    SCALE.slice(2, 9).forEach((s, i) => {
      const t = ctx.currentTime + i * 0.07;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "triangle";
      o.frequency.value = NOTE(s);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.12, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
      o.connect(g).connect(this.sfx);
      o.start(t);
      o.stop(t + 1.2);
    });
  }

  /** The end of a round: a singing bowl, long and soft. */
  bowl() {
    if (!this._ok("bowl", 3000)) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(0.25, t + 0.05);
    out.gain.exponentialRampToValueAtTime(0.0001, t + 7);
    out.connect(this.sfx);
    for (const [r, a, beat] of [[1, 1, 0.8], [2.71, 0.45, 1.3], [5.15, 0.18, 2.1]]) {
      for (const d of [0, beat]) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = 196 * r + d;
        g.gain.value = a / 2;
        o.connect(g).connect(out);
        o.start(t);
        o.stop(t + 7.2);
      }
    }
  }

  _noise(seconds) {
    if (this._noiseBuf?.duration >= seconds) return this._noiseBuf;
    const n = Math.floor(this.ctx.sampleRate * seconds);
    const b = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return (this._noiseBuf = b);
  }

  /** A burst of filtered noise: type/frequency of the filter, how loud, how long. */
  _hiss(type, freq, gain, decay, when = 0, freqEnd = 0) {
    const ctx = this.ctx, t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this._noise(4);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + Math.min(0.02, decay / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t, Math.random() * Math.max(0, 3.9 - decay));
    src.stop(t + decay + 0.05);
  }

  /** Hearts (5): soft little pops going up, and a warm chime. */
  hearts() {
    if (!this._ok("hearts", 400)) return;
    const ctx = this.ctx;
    for (let i = 0; i < 6; i++) {
      const t = ctx.currentTime + i * 0.07 + Math.random() * 0.03;
      const o = ctx.createOscillator(), g = ctx.createGain();
      const f0 = 600 + i * 90 + Math.random() * 60;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f0 * 1.8, t + 0.08);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.13, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g).connect(this.sfx);
      o.start(t);
      o.stop(t + 0.2);
    }
    [7, 9, 10].forEach((s, i) => this._bell(NOTE(SCALE[s]), 0.07, 1.8, this.sfx, 0.25 + i * 0.09));
  }

  /** A rocket going up (10): a thin whistle rising. */
  rocket() {
    if (!this._ok("rocket", 150)) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(700 + Math.random() * 200, t);
    o.frequency.exponentialRampToValueAtTime(2200 + Math.random() * 400, t + 0.7);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.035, t + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.8);
    this._hiss("bandpass", 3000, 0.04, 0.7);
  }

  /** A firework bursts (10): a soft boom, then a crackle. */
  burst() {
    if (!this._ok("burst", 120)) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.5);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.32, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.65);
    this._hiss("lowpass", 900, 0.3, 0.5);
    for (let i = 0; i < 14; i++) this._hiss("highpass", 4000 + Math.random() * 3000, 0.07, 0.04, 0.15 + Math.random() * 0.9);
  }

  /** The dragon (30): a deep gong, a long whoosh of wind, a harp run up the scale. */
  dragon() {
    if (!this._ok("dragon", 1500)) return;
    this._bell(NOTE(SCALE[0]) / 2, 0.3, 4.5);
    this._bell(NOTE(SCALE[3]) / 2, 0.12, 3.5, this.sfx, 0.02);
    this._hiss("bandpass", 300, 0.16, 2.6, 0.2, 1400);
    this._hiss("bandpass", 1200, 0.1, 2.4, 2.6, 350);
    const ctx = this.ctx;
    SCALE.forEach((s, i) => {
      const t = ctx.currentTime + 0.4 + i * 0.06;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "triangle";
      o.frequency.value = NOTE(s);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.1, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
      o.connect(g).connect(this.sfx);
      o.start(t);
      o.stop(t + 1.5);
    });
    [0, 4, 7].forEach((s, i) => this._bell(NOTE(SCALE[s] + 12), 0.08, 3, this.sfx, 1.2 + i * 0.15));
  }

  /** The last seconds of a round: a small wooden tick. */
  tick() {
    if (!this._ok("tick", 300)) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "square";
    o.frequency.value = 1400;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 1800;
    g.gain.setValueAtTime(0.09, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    o.connect(f).connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.08);
  }
}

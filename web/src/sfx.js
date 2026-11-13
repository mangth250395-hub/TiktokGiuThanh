// The sounds of the fight, made on the spot with Web Audio like the rest (audio.js: no sound files, nothing to
// license). Two families (the user, 10/11/2026: "dễ nghe, gay cấn, ASMR, nhạc khoảnh khắc"):
//   - small soft sounds, pleasant to hear all through a long live: steel on steel, a mallet on wood, an arrow in
//     the air, a healer's chime, a gate that opens. Each kind has a minimum gap, so a crowd of fighters is a steady
//     murmur and never a wall of noise
//   - short pieces of music for the moments: a leader comes on the field, a gate goes down, the castle falls, the
//     citadel holds, the last seconds. They are a few notes of brass, drums and bells, 2 to 4 seconds, never a loop
//     (no background music: the streamer plays their own)
import { Sound } from "./audio.js";

const N = (semi) => 261.63 * Math.pow(2, semi / 12);      // semitones from middle C

export class BattleSound extends Sound {
  // ---------- building blocks ----------
  _tone(type, f0, f1, gain, dur, when = 0, attack = 0.012) {
    const ctx = this.ctx, t = ctx.currentTime + when;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  /** A note of brass: two saws a little apart, opened and closed by a filter. */
  _brass(freq, when, dur, gain = 0.07) {
    const ctx = this.ctx, t = ctx.currentTime + when;
    const f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = "lowpass"; f.Q.value = 1.2;
    f.frequency.setValueAtTime(300, t);
    f.frequency.linearRampToValueAtTime(Math.min(4200, freq * 6), t + 0.07);
    f.frequency.exponentialRampToValueAtTime(Math.max(500, freq * 2.2), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.04);
    g.gain.setValueAtTime(gain * 0.85, t + Math.max(0.05, dur - 0.12));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
    f.connect(g).connect(this.sfx);
    for (const cents of [-7, 6]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth"; o.frequency.value = freq; o.detune.value = cents;
      o.connect(f); o.start(t); o.stop(t + dur + 0.15);
    }
  }
  /** A big drum: a low note that falls, and the skin. */
  _timp(when = 0, f = 92, gain = 0.34) {
    this._tone("sine", f * 1.5, f * 0.55, gain, 0.5, when, 0.006);
    this._hiss("lowpass", 420, gain * 0.35, 0.16, when);
  }
  /** A soft held chord under a moment (voices far away). */
  _pad(freqs, when, dur, gain = 0.03) {
    const ctx = this.ctx, t = ctx.currentTime + when;
    for (const fr of freqs) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "triangle"; o.frequency.value = fr;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + Math.min(0.5, dur * 0.3));
      g.gain.setValueAtTime(gain, t + dur * 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.sfx); o.start(t); o.stop(t + dur + 0.1);
    }
  }
  /** A cymbal that swells, or a long breath of air. */
  _swell(when, dur, gain = 0.06, freq = 5200) {
    const ctx = this.ctx, t = ctx.currentTime + when;
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = this._noise(dur + 0.2);
    f.type = "highpass"; f.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.85);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.15);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t); src.stop(t + dur + 0.2);
  }
  _music(kind, gapMs) { return this._ok(kind, gapMs); }

  // ---------- small sounds of the fight (soft, each with its gap) ----------
  /** Steel on steel: a small bright ring. */
  clink() {
    if (!this._ok("clink", 150)) return;
    const f = 1700 + Math.random() * 900;
    this._bell(f, 0.018, 0.22);
    this._tone("triangle", f * 1.5, f * 1.48, 0.008, 0.05);
  }
  /** A blow on a gate or on the castle: a dull knock (heavy: a ram, a leader). */
  thud(heavy = false) {
    if (!this._ok(heavy ? "thudH" : "thud", heavy ? 260 : 170)) return;
    this._tone("sine", heavy ? 120 : 190 + Math.random() * 40, heavy ? 48 : 90, heavy ? 0.24 : 0.07, heavy ? 0.32 : 0.12);
    this._hiss("lowpass", heavy ? 700 : 1400, heavy ? 0.12 : 0.03, heavy ? 0.22 : 0.07);
  }
  /** An arrow leaves: air, then the string. */
  arrows() {
    if (!this._ok("arrows", 240)) return;
    this._hiss("bandpass", 2600, 0.028, 0.16, 0, 5600);
    this._tone("triangle", 420 + Math.random() * 60, 300, 0.012, 0.06);
  }
  /** Mending: a mallet on wood, a round dry click. */
  knock() {
    if (!this._ok("knock", 230)) return;
    const f = 560 + Math.random() * 160;
    this._tone("triangle", f, f * 0.62, 0.05, 0.07, 0, 0.004);
    this._tone("sine", f * 2.4, 0, 0.014, 0.04, 0, 0.003);
  }
  /** A healer at work: two soft bells a fifth apart. */
  heal() {
    if (!this._ok("heal", 420)) return;
    const base = N([12, 14, 17, 19][Math.floor(Math.random() * 4)]);
    this._bell(base, 0.035, 0.9);
    this._bell(base * 1.5, 0.022, 1.1, this.sfx, 0.09);
  }
  /** Someone falls: a soft puff and a small note going down. */
  fall(big = false) {
    if (!this._ok(big ? "fallB" : "fall", big ? 900 : 200)) return;
    this._hiss("lowpass", 900, big ? 0.12 : 0.04, big ? 0.4 : 0.16);
    this._tone("sine", big ? 330 : 520, big ? 110 : 260, big ? 0.1 : 0.035, big ? 0.5 : 0.18);
  }
  /** A stone lands, something blows up: a short boom. */
  boom(big = false) {
    if (!this._ok("boom", 180)) return;
    this._tone("sine", big ? 150 : 120, 38, big ? 0.34 : 0.24, big ? 0.6 : 0.42);
    this._hiss("lowpass", 800, big ? 0.28 : 0.18, big ? 0.5 : 0.35);
    if (big) for (let i = 0; i < 6; i++) this._hiss("highpass", 3500 + Math.random() * 2500, 0.04, 0.04, 0.1 + Math.random() * 0.5);
  }
  /** Something heavy comes down in a long rumble (a gate, a leader). */
  crash() {
    if (!this._ok("crash", 1200)) return;
    this._tone("sine", 110, 30, 0.38, 1.2);
    this._hiss("lowpass", 600, 0.36, 1.4, 0, 180);
    for (let i = 0; i < 12; i++) this._hiss("bandpass", 900 + Math.random() * 1800, 0.07, 0.08, 0.1 + Math.random() * 1.1);
  }
  /** A gate stands again: a short bright rise. */
  rise() {
    if (!this._ok("rise", 800)) return;
    [N(7), N(12), N(16)].forEach((f, i) => this._tone("triangle", f, 0, 0.1, 0.5, i * 0.09));
    this._bell(N(24), 0.05, 1.4, this.sfx, 0.3);
  }
  /** A streak of fallen foes: quick notes going up, more of them for a longer streak. */
  streak(n = 3) {
    if (!this._ok("streak", 900)) return;
    const steps = [0, 4, 7, 12, 16, 19];
    for (let i = 0; i < Math.min(steps.length, 2 + Math.floor(n / 2)); i++) this._bell(N(12 + steps[i]), 0.05, 0.5, this.sfx, i * 0.07);
  }
  /** A character earns a rank with a right answer or likes: a harp going up. */
  rankUp() {
    if (!this._ok("rankUp", 260)) return;
    [0, 4, 7, 12].forEach((s, i) => this._bell(N(12 + s), 0.05, 0.9, this.sfx, i * 0.06));
  }
  /** Someone joins and stands in the queue: a round soft drop. */
  join() { this.drop(); }

  // ---------- the gates, the clock ----------
  /** The 4 gates open: wood that creaks, a short horn, the voices of those who run out. */
  gate() {
    if (!this._ok("gate", 4000)) return;
    this._tone("sawtooth", 82, 128, 0.035, 0.7, 0, 0.2);                    // the hinges
    this._hiss("bandpass", 500, 0.05, 0.7, 0, 1200);
    this._brass(N(-5), 0.15, 0.5, 0.05); this._brass(N(2), 0.6, 0.9, 0.06);   // the horn: a fifth up
    this._swell(0.5, 1.1, 0.03, 1800);                                      // the rush
    this._timp(0.6, 80, 0.22);
  }
  /** The start of a match: a horn, two long low notes, and a roll of drums. */
  horn() {
    if (!this._ok("horn", 2500)) return;
    this._brass(N(-10), 0, 0.9, 0.07); this._brass(N(-5), 0.75, 1.5, 0.08);
    this._pad([N(-22), N(-10)], 0, 2.2, 0.03);
    for (let i = 0; i < 6; i++) this._timp(1.2 + i * 0.13, 78, 0.1 + i * 0.03);
  }
  /** The last seconds: a heart that beats (called once a second; faster and louder at the very end). */
  heartbeat(left = 10) {
    if (!this._ok("heart", 400)) return;
    const g = 0.2 + (10 - Math.min(10, left)) * 0.018;
    this._tone("sine", 62, 40, g, 0.22, 0, 0.008);
    this._tone("sine", 56, 38, g * 0.75, 0.24, 0.19, 0.008);
    if (left <= 5) this._tone("triangle", N(24), 0, 0.03, 0.12, 0, 0.004);
    if (left <= 3) this._tone("triangle", N(24), 0, 0.03, 0.12, 0.5, 0.004);
  }
  /** "One minute", "thirty seconds": a low string that rises, so everyone feels the time. */
  tension() {
    if (!this._ok("tension", 5000)) return;
    this._pad([N(-22), N(-15)], 0, 2.6, 0.04);
    for (let i = 0; i < 4; i++) this._tone("sawtooth", N(-22), 0, 0.03, 0.18, i * 0.5, 0.02);
    this._swell(1.2, 1.4, 0.02, 3000);
  }

  // ---------- music for the moments ----------
  /** A leader comes on the field (rank 5: Đội trưởng, 6: Tướng): a call of brass over drums, bells on top. */
  hero(rank = 5) {
    if (!this._music("hero", 2500)) return;
    const big = rank >= 6;
    this._swell(0, 0.45, 0.05);
    this._timp(0.42, 82, 0.4); this._timp(0.62, 82, 0.26);
    const call = big ? [[7, 0.45, 0.16], [7, 0.62, 0.16], [12, 0.8, 0.22], [16, 1.04, 0.22], [19, 1.28, 1.5]] : [[7, 0.45, 0.16], [12, 0.62, 0.2], [16, 0.84, 1.0]];
    for (const [s, when, dur] of call) { this._brass(N(s), when, dur, 0.075); this._brass(N(s - 12), when, dur, 0.05); }
    if (big) {
      this._timp(1.28, 65, 0.46);
      this._brass(N(12), 1.28, 1.5, 0.05); this._brass(N(16), 1.28, 1.5, 0.045);   // the chord under the last note
      this._pad([N(0), N(7), N(12), N(16)], 1.28, 2.2, 0.03);
      this._swell(1.0, 0.3, 0.06);
      [24, 28, 31, 36].forEach((s, i) => this._bell(N(s), 0.045, 1.6, this.sfx, 1.34 + i * 0.07));
    } else [19, 24].forEach((s, i) => this._bell(N(s), 0.04, 1.2, this.sfx, 0.9 + i * 0.08));
  }
  /** A gate goes down: the blow, then brass that warns (a low dissonant stab) and a drum. */
  breach() {
    if (!this._music("breach", 1500)) return;
    this.last.crash = 0; this.crash();
    this._timp(0, 60, 0.46);
    for (const s of [-12, -6, -1]) this._brass(N(s), 0.12, 0.7, 0.06);        // a tritone: danger
    this._brass(N(-13), 0.85, 0.9, 0.06);
    this._timp(0.85, 55, 0.34);
  }
  /** The castle is at half, at a quarter: an alarm bell, twice. */
  danger() {
    if (!this._music("danger", 2500)) return;
    for (const when of [0, 0.42]) { this._bell(N(7), 0.09, 1.2, this.sfx, when); this._bell(N(13), 0.05, 1.0, this.sfx, when); }
    this._timp(0, 70, 0.3);
  }
  /** The castle falls: a long blast, stones that keep coming down, brass that sinks, a last low drum. */
  castleFall() {
    if (!this._music("castleFall", 4000)) return;
    this._tone("sine", 140, 26, 0.46, 2.0);
    this._hiss("lowpass", 700, 0.42, 2.2, 0, 140);
    for (let i = 0; i < 22; i++) this._hiss("bandpass", 700 + Math.random() * 2200, 0.07, 0.09, 0.1 + Math.random() * 2.2);
    for (const [s, when, dur] of [[0, 0.5, 0.5], [-2, 1.0, 0.5], [-4, 1.5, 0.5], [-5, 2.0, 1.8]]) { this._brass(N(s - 12), when, dur, 0.07); this._brass(N(s - 9), when, dur, 0.045); }
    this._timp(0.5, 70, 0.34); this._timp(2.0, 52, 0.46);
    this._pad([N(-29), N(-17)], 2.0, 2.4, 0.04);
  }
  /** The citadel held to the end of the time: a bright fanfare going up, drums, bells that ring on. */
  victory() {
    if (!this._music("victory", 4000)) return;
    this._timp(0, 82, 0.4); this._timp(0.2, 82, 0.28);
    const tune = [[0, 0, 0.18], [4, 0.2, 0.18], [7, 0.4, 0.18], [12, 0.6, 0.5], [7, 1.15, 0.16], [12, 1.32, 0.16], [16, 1.5, 1.6]];
    for (const [s, when, dur] of tune) { this._brass(N(s), when, dur, 0.075); this._brass(N(s - 12), when, dur, 0.045); }
    this._brass(N(7), 1.5, 1.6, 0.05); this._brass(N(12), 1.5, 1.6, 0.05);
    this._timp(0.6, 82, 0.36); this._timp(1.5, 65, 0.46);
    this._pad([N(0), N(7), N(12), N(16)], 1.5, 2.6, 0.03);
    this._swell(1.2, 0.3, 0.06);
    [24, 28, 31, 36, 40].forEach((s, i) => this._bell(N(s), 0.045, 2.0, this.sfx, 1.55 + i * 0.08));
  }
  /** The end of a series: the fanfare, then a bowl that rings long. */
  seriesEnd() { this.last.victory = 0; this.victory(); this._bell(N(-12), 0.1, 4, this.sfx, 2.2); }

  // ---------- the quiz ----------
  /** A new question: two wooden notes, like a small xylophone. */
  quizOpen() {
    if (!this._ok("quizOpen", 3000)) return;
    this._bell(N(12), 0.04, 0.5); this._bell(N(19), 0.04, 0.7, this.sfx, 0.12);
  }
  /** A right answer: a small clear ding. */
  ding() {
    if (!this._ok("ding", 160)) return;
    this._bell(N(24 + [0, 4, 7][Math.floor(Math.random() * 3)]), 0.045, 0.7);
  }
  /** The answer is shown: three notes that settle. */
  reveal() {
    if (!this._ok("reveal", 3000)) return;
    [19, 16, 12].forEach((s, i) => this._bell(N(s), 0.04, 0.9, this.sfx, i * 0.1));
  }

  /** Kept for the callers of the first version. */
  drum(n = 4) {
    if (!this._ok("drum", 1500)) return;
    for (let i = 0; i < n; i++) this._timp(i * 0.22, 86, 0.3);
  }
  fanfare() { this.victory(); }
}

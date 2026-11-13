// The fight around the square citadel, with no screen: 4 gates (north, east, south, west), a castle in the middle.
//
//   - every WAVE seconds the gates open: everyone who is waiting (new viewers, the fallen) comes on the field at once,
//     the defenders (D) out of the castle, the attackers (A) out of their 4 camps, with a few soldiers of the place
//     so no side of the citadel is ever empty
//   - a character is one of 7 kinds (rules.js TIERS): a villager, a swordsman, a lancer, an archer, a healer, a
//     captain, a general. It has life points; at zero it falls and waits for the next wave
//   - the attackers break a gate, go in, and bring the castle down; the defenders fight in front of their gate,
//     shoot from the wall, heal, and mend the gate. The castle down: A wins. Still up at the end of the time: D wins
//   - only the DIFFERENCE between the teams counts: blows on gates and on the castle are divided by the size of the
//     live, the smaller team hits harder, and each match has a little luck
//
// update(dt) moves everything; take() gives what happened since the last call (for the picture, the sound, the voice).

export const H = 110;            // half the side of the citadel
export const WALL_T = 12;
export const HALL_R = 30;        // how far from the centre the castle is hit from
export const CAMP_D = 96;        // from a gate out to the attackers' camp
export const FACES = ["N", "E", "S", "W"];
export const FACE_NAMES = { N: "bắc", E: "đông", S: "nam", W: "tây" };
const DIR = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

/** A point by a gate: `o` along the wall (-1..1 of its half-length), `d` outwards from the wall (negative: inside). */
export function facePos(f, o = 0, d = 0) {
  const [dx, dy] = DIR[f];
  return [dx * (H + d) - dy * o * H, dy * (H + d) + dx * o * H];
}

export const KINDS = ["pawn", "warrior", "lancer", "archer", "monk", "captain", "general"];

export const TUNE = {
  wave: 20, firstWave: 1.5,          // seconds between two waves (30 at first: the user, 11/11/2026, "hơi lâu, tầm 20 giây thôi")
  gateMax: 80, hallMax: 580, stand: 0.3,           // a broken gate stands again when mended to 30%
  ref: 8,                                            // blows on gates and castle count as if the team had `ref` fighters
  // soldiers of the place, so that no side of the citadel is ever empty: per team per wave, and at most alive.
  // With nobody playing at all the field is only a quiet skirmish (npcQuiet / npcQuietCap): the user, 11/11/2026:
  // "không có người xem và người chơi nhưng lại quá nhiều lính đánh nhau" (they were 6 a wave, up to 14 a team)
  npcWave: 4, npcCap: 8, npcQuiet: 2, npcQuietCap: 4, fieldCap: 150,
  sizePow: 1.0, sizeMax: 3, luck: 0.1, home: 1.03, homeFade: 0.025, homeAt: 20, homeMin: 0.96,
  hallHit: 1.0, mend: 2.2, underFire: 1.6, mendUnderFire: 0.25, press: 0.4, pressD: 50, restAfter: 4, rest: 0.015,   // a gate under blows is hard to mend
  kind: {
    pawn:    { hp: 36, siege: 3.5,  dmg: 2.2, every: 1.0, range: 10, speed: 34, sight: 34 },
    warrior: { hp: 78, siege: 5,  dmg: 5.2, every: 0.9, range: 11, speed: 36, sight: 46 },
    lancer:  { hp: 144, siege: 4.5,  dmg: 4.6, every: 1.1, range: 16, speed: 31, sight: 46, taunt: 0.55 },
    archer:  { hp: 48, siege: 2.5,  dmg: 4.2, every: 1.4, range: 80, speed: 34, sight: 84 },
    monk:    { hp: 66, siege: 0,  dmg: 0,   every: 1.2, range: 56, speed: 34, sight: 0, heal: 7 },
    captain: { hp: 188, siege: 5, dmg: 7.5, every: 0.9, range: 12, speed: 35, sight: 50, aura: 0.2 },
    general: { hp: 322, siege: 6, dmg: 10.5, every: 1.0, range: 17, speed: 31, sight: 54, aura: 0.25, cleave: 1 },
  },
  streaks: [3, 5, 8, 12],
  // the match of fury ("trận nộ", rules.js): one giant per team, face to face before the south gate. They trade
  // blows for the whole match, harder and harder (`ramp`: at the end of the time a blow is 1 + ramp times the first
  // ones), so without help both would fall before the end. Nobody storms the walls: every fighter of the two teams
  // comes to the giants, fights the other team's fighters and strikes the other team's giant (`unit`: how much of a
  // fighter's blow a giant takes, `reach`: from how far). What moves the duel: the likes, shares and follows of each
  // team (feed), the blows of the fighters, and every fighter who falls (`fall`, by rank, off their own giant).
  // Measured 11/11/2026 with `node tools/rage-sweep.mjs` (40 matches a case): equal teams of 8 to 120, nobody
  // helping: the attackers win 53-60% (a very small live: 35%), a giant falls around 3:05 of 4:00; 5 viewers sending
  // likes against 3: 3 in 4 for the 5; a general on one side only: 9 in 10 for that side
  giant: { hp: 1000, dps: 2.4, ramp: 5, every: 1.4, fall: [1, 2, 3, 2, 3, 6, 10], hall: 0.006, drainA: 1, drainD: 1, unit: 0.02, reach: 16 },
};

let UID = 0;

export class Battle {
  constructor({ rand = Math.random, tune = TUNE } = {}) {
    this.rand = rand;
    this.T = tune;
    this.events = [];
    this.reset([]);
  }

  // ---------- a new match ----------
  /** viewers: [{ key, team, tier, name, avatar, lives }] (everyone in a team who is here). boost: { D, A }.
   *  rage: the match of fury, with the two giants; len: how long the match lasts (seconds), for their growing blows. */
  reset(viewers = [], { boost = { D: 1, A: 1 }, rage = false, len = 240 } = {}) {
    const T = this.T;
    this.rage = !!rage;
    this.rageLen = Math.max(60, Number(len) || 240);
    this.giants = this.rage ? { D: this._giant("D"), A: this._giant("A") } : null;
    this.gfeed = 1; this.gdrain = 1; this.gLead = null; this.gLeadAt = 0;
    this.t = 0;
    this.over = false;
    this.winner = null;
    this.units = [];
    this.byUk = new Map();           // character key -> the character on the field
    this.queue = new Map();          // character key -> the character waiting for the next wave
    this.squad = new Map();          // viewer key -> Set of their characters on the field
    this.byKey = new Map();          // viewer key -> the one of theirs shown for them on the field (lead)
    this.leads = new Map();          // viewer key -> their lead: on the field, or waiting
    this.seen = new Map();           // character key -> team: everyone who was in this match
    this.incoming = [];              // [{ at, v }] walking out of the gate, one after the other
    this.gates = Object.fromEntries(FACES.map((f) => [f, { hp: T.gateMax, max: T.gateMax, broken: false, half: false, hitAt: -9 }]));
    this.hall = { hp: T.hallMax, max: T.hallMax, marks: [] };
    this.waveN = 0;
    this.nextWave = T.firstWave;
    this.stats = new Map();          // viewer key -> { kills, gate, heal, mend, falls }
    this.lane = new Map();           // viewer key -> their side of the citadel, for the whole match
    this.laneTeam = new Map();
    this.boost = { D: boost.D || 1, A: boost.A || 1 };
    this.luck = { D: 1 + (this.rand() - 0.5) * 2 * T.luck, A: 1 + (this.rand() - 0.5) * 2 * T.luck };
    this.mul = { D: 1, A: 1 };
    this.gnorm = { D: 1, A: 1 };
    this.aura = { D: { N: 0, E: 0, S: 0, W: 0 }, A: { N: 0, E: 0, S: 0, W: 0 } };
    this.pow = { D: { N: 0, E: 0, S: 0, W: 0 }, A: { N: 0, E: 0, S: 0, W: 0 } };
    this.normAt = -9;
    this.firstBlood = false;
    this.events.length = 0;
    for (const v of viewers) this.enqueue(v);
    this._norms();
  }

  snapshot() {
    return { kind: "gates", t: this.t, waveN: this.waveN, nextWave: this.nextWave, luck: this.luck, boost: this.boost,
      giants: this.giants ? { D: this.giants.D.hp, A: this.giants.A.hp } : null,
      gates: Object.fromEntries(FACES.map((f) => [f, { hp: this.gates[f].hp, broken: this.gates[f].broken, half: this.gates[f].half }])),
      hall: { hp: this.hall.hp, marks: this.hall.marks } };
  }
  /** After a restart of the app: the gates and the castle as they were; the characters come back with the next wave. */
  restore(s) {
    if (!s || s.kind !== "gates") return false;
    this.t = Number(s.t) || 0;
    this.waveN = Number(s.waveN) || 0;
    this.nextWave = this.t + 1.5;
    if (s.luck) this.luck = s.luck;
    if (s.boost) this.boost = s.boost;
    for (const f of FACES) if (s.gates?.[f]) Object.assign(this.gates[f], { hp: Math.max(0, Math.min(this.gates[f].max, Number(s.gates[f].hp) || 0)), broken: !!s.gates[f].broken, half: !!s.gates[f].half });
    if (s.hall) { this.hall.hp = Math.max(1, Math.min(this.hall.max, Number(s.hall.hp) || this.hall.max)); this.hall.marks = s.hall.marks || []; }
    if (s.giants && this.giants) for (const tm of ["D", "A"]) this.giants[tm].hp = Math.max(1, Math.min(this.giants[tm].max, Number(s.giants[tm]) || this.giants[tm].max));
    return true;
  }

  // ---------- the two giants of the match of fury ----------
  _giant(team) {
    const G = this.T.giant, [x, y] = facePos("S", (team === "D" ? 46 : -46) / H, 46);     // face to face before the south gate, the defenders' on the left
    return { team, hp: G.hp, max: G.hp, x, y, o: team === "D" ? 46 : -46, d: 46, flip: team === "D" ? 1 : -1, cd: team === "D" ? 0.8 : 1.5, act: "idle", actAt: -9, hitAt: -9, n: 0, marks: [], fed: 0, pend: 0 };
  }
  giantRatio(team) { const g = this.giants?.[team]; return g ? g.hp / g.max : 0; }
  /** The team whose giant stands better (when the time is up). A draw: the defenders, as in any match. */
  giantLead() { return this.giants && this.giants.A.hp > this.giants.D.hp ? "A" : "D"; }
  /** Likes, shares and follows of a team: strength back for its giant (worth less in a big live, so that what counts
   *  is how the two teams compare). Returns what it took. */
  feed(team, hp) {
    const g = this.giants?.[team];
    if (!g || this.over || !(hp > 0)) return 0;
    const amt = Math.min(g.max - g.hp, hp * this.gfeed);
    if (amt <= 0) return 0;
    g.hp += amt; g.fed += amt; g.pend += amt;
    if (g.pend >= 6) { this.emit({ type: "giant_fed", team, amt: g.pend, x: g.x, y: g.y }); g.pend = 0; }
    return amt;
  }
  _hurtGiant(team, dmg) {
    const g = this.giants?.[team];
    if (!g || this.over || !(dmg > 0)) return;
    const before = g.hp / g.max;
    g.hp = Math.max(0, g.hp - dmg);
    const r = g.hp / g.max;
    for (const m of [0.5, 0.25]) if (before > m && r <= m && !g.marks.includes(m)) { g.marks.push(m); this.emit({ type: "giant_mark", team, mark: m }); }
    if (g.hp <= 0) { this.over = true; this.winner = team === "D" ? "A" : "D"; this.emit({ type: "giant_fell", team, winner: this.winner, x: g.x, y: g.y }); }
  }
  /** Who is ahead changed hands (by a clear margin, so it does not flicker): told once each time. */
  _leadCheck() {
    const d = this.giants.D.hp - this.giants.A.hp, lead = d > 30 ? "D" : d < -30 ? "A" : this.gLead;
    if (lead && lead !== this.gLead) { if (this.gLead) this.emit({ type: "giant_lead", team: lead }); this.gLead = lead; }
  }
  _duel(dt) {
    const G = this.T.giant, f = Math.min(1, this.t / this.rageLen);
    if (this.t - (this.gLeadAt || 0) > 1) { this.gLeadAt = this.t; this._leadCheck(); }
    for (const tm of ["D", "A"]) {
      const g = this.giants[tm], foe = this.giants[tm === "D" ? "A" : "D"];
      g.cd -= dt;
      if (g.cd > 0 || this.over) continue;
      g.cd = G.every;
      const dmg = G.dps * G.every * (1 + G.ramp * f * f) * this.luck[tm] * (0.8 + this.rand() * 0.4);      // no help for the team that lost here: the fighters have it
      g.act = "attack"; g.actAt = this.t; g.n++;
      foe.hitAt = this.t;
      this.emit({ type: "giant_hit", team: tm, dmg, x: foe.x, y: foe.y, heavy: f > 0.6 });
      this._hurtGiant(foe.team, dmg);
    }
  }

  // ---------- reading ----------
  take() { const e = this.events; this.events = []; return e; }
  emit(e) { if (this.events.length < 4000) this.events.push(e); }
  /** A viewer has a character in the match (on the field or waiting) / on the field. */
  has(key) { return this.leads.has(key); }
  alive(key) { return this.byKey.has(key); }
  /** This very character is on the field or waiting. */
  hasUnit(uk) { return this.byUk.has(uk) || this.queue.has(uk); }
  gateRatio(f) { return this.gates[f].hp / this.gates[f].max; }
  hallRatio() { return this.hall.hp / this.hall.max; }
  waveLeft() { return Math.max(0, this.nextWave - this.t); }
  waiting(team) { let n = 0; for (const v of this.queue.values()) if (v.team === team) n++; return n; }
  count(team, viewersOnly = false) { let n = 0; for (const u of this.units) if (u.team === team && (!viewersOnly || u.key)) n++; return n; }
  /** The gate under the hardest attack (for the camera when nothing else calls it). */
  get front() {
    let best = "S", w = -1;
    for (const f of FACES) {
      const g = this.gates[f];
      let n = 0; for (const u of this.units) if (u.lane === f) n++;
      const s = (g.broken ? 1000 : 0) + (1 - g.hp / g.max) * 100 + n;
      if (s > w) { w = s; best = f; }
    }
    return best;
  }
  stat(key) { let s = this.stats.get(key); if (!s) this.stats.set(key, (s = { kills: 0, gate: 0, heal: 0, mend: 0, falls: 0 })); return s; }
  /** The best of the match among the viewers: { killer, breaker, healer, mender }, each { key, value } (or absent). */
  awards() {
    const out = {};
    for (const [name, field] of [["killer", "kills"], ["breaker", "gate"], ["healer", "heal"], ["mender", "mend"]]) {
      let best = null;
      for (const [key, s] of this.stats) if (s[field] >= 1 && (!best || s[field] > best.value)) best = { key, value: Math.round(s[field]) };
      if (best) out[name] = best;
    }
    return out;
  }

  // ---------- viewers and their characters ----------
  // A viewer (key) may own several characters: the one of their comment, and one more for each item. Each has its
  // own key `uk`; all of them share the viewer's name and picture, and fight on the same side of the citadel.
  // lead(key): the one shown for the viewer (the highest rank on the field, else the highest that waits).
  _laneFor(v) {
    if (this.rage) return "S";         // the match of fury: everyone goes to the two giants, before the south gate
    let f = this.lane.get(v.key);
    if (f && this.laneTeam.get(v.key) === v.team) return f;
    const n = { N: 0, E: 0, S: 0, W: 0 };
    for (const u of this.units) if (u.team === v.team && u.key) n[u.lane]++;
    for (const q of this.queue.values()) if (q.team === v.team && q.lane) n[q.lane]++;
    f = FACES[Math.floor(this.rand() * 4)];
    for (const g of FACES) if (n[g] < n[f]) f = g;
    this.lane.set(v.key, f);
    this.laneTeam.set(v.key, v.team);
    return f;
  }
  /** A character waits for the next wave (new, or fallen). v: { key, uk?, n?, team, tier, name, avatar } (with no
   *  `uk` the viewer has this one character). Already on the field or waiting: only brought up to date. */
  enqueue(v) {
    if (!v?.key || !v.team) return null;
    const uk = v.uk || v.key;
    const u = this.byUk.get(uk);
    if (u) {
      if (u.team !== v.team) this._remove(u);
      else { u.name = v.name ?? u.name; u.avatar = v.avatar ?? u.avatar; if (v.tier !== undefined && v.tier !== u.tier) this.promote(uk, v.tier); return u; }
    }
    const old = this.queue.get(uk);
    if (old && old.team === v.team) { Object.assign(old, { tier: v.tier || 0, kind: KINDS[v.tier || 0], name: v.name || old.name, avatar: v.avatar || old.avatar, item: !!v.item, hpr: v.hp }); this._relead(v.key); return old; }
    const q = { key: v.key, uk, n: v.n || 0, team: v.team, tier: v.tier || 0, name: v.name || "", avatar: v.avatar || "", item: !!v.item, hpr: v.hp };
    q.lane = this._laneFor(q);
    // they wait in sight: the attackers in rows at their camp, the defenders in the yard by the castle
    let i = 0;
    for (const w of this.queue.values()) if (w.team === q.team && w.lane === q.lane) i++;
    Object.assign(q, this.waitSpot(q.team, q.lane, i), { id: ++UID, kind: KINDS[q.tier], hp: 1, max: 1, act: "idle", actAt: 0, born: 0, hurry: 0, waiting: true, npc: false, since: this.t });
    q.flip = q.team === "A" ? (q.x > 2 ? -1 : 1) : (q.x < -2 ? -1 : 1);
    this.queue.set(uk, q);
    this.seen.set(uk, q.team);
    this._relead(v.key);
    return q;
  }
  /** Where the i-th of a team waits on a side: { o, d, x, y }. */
  waitSpot(team, lane, i) {
    const col = i % 6, row = Math.min(5, Math.floor(i / 6)) + (i >= 36 ? ((i * 7) % 5) * 0.2 : 0);
    const o = (col - 2.5) * 9 + (row % 2 ? 2.5 : 0);
    const d = team === "A" ? CAMP_D - 12 - row * 8 : -(H - 62) + row * 7;
    const [x, y] = facePos(lane, o / H, d);
    return { o, d, x, y };
  }
  /** Which of a viewer's characters stands for them (its name plate, the camera): the highest rank on the field. */
  _relead(key) {
    if (!key) return;
    const sq = this.squad.get(key);
    let best = null;
    if (sq) for (const u of sq) if (!best || u.tier > best.tier) best = u;
    if (sq) for (const u of sq) u.lead = u === best;
    if (best) this.byKey.set(key, best); else this.byKey.delete(key);
    let wait = null;
    for (const q of this.queue.values()) if (q.key === key) { q.lead = false; if (!wait || q.tier > wait.tier) wait = q; }
    if (!best && wait) wait.lead = true;
    if (best || wait) this.leads.set(key, best || wait); else this.leads.delete(key);
  }
  lead(key) { return this.leads.get(key) || null; }
  /** Every character of a viewer out of the game (moved to the other team, or the series is over). */
  removeViewer(key) {
    for (const [uk, q] of [...this.queue]) if (q.key === key) this.queue.delete(uk);
    const sq = this.squad.get(key);
    if (sq) for (const u of [...sq]) this._remove(u);
    this._relead(key);
  }
  /** An item for a character that is already that rank or higher: full life, a rush of speed, on the field at once. */
  refresh(uk, s = 12) {
    let u = this.byUk.get(uk);
    if (!u) { const q = this.queue.get(uk); if (!q) return null; this.queue.delete(uk); u = this._spawn(q, 0); }
    u.hp = u.max; u.hurry = this.t + s;
    this.emit({ type: "boost", id: u.id, key: u.key, uk, team: u.team, x: u.x, y: u.y });
    return u;
  }
  /** A little life back (likes, a share, a follow; `part`: a share of its whole life, for a right answer at the top
   *  rank) for ONE character of the viewer: the one that is hurt most (the user, 10/11/2026: "hồi máu từng con").
   *  Nothing when none of theirs is on the field. */
  heal(key, hp = 0, part = 0) {
    const sq = this.squad.get(key);
    if (!sq) return 0;
    let u = null, worst = 1;
    for (const x of sq) { const r = x.hp / x.max; if (r < worst) { worst = r; u = x; } }
    if (!u) return 0;
    const amt = Math.min(u.max - u.hp, hp + u.max * part);
    if (amt <= 0) return 0;
    u.hp += amt;
    if (amt >= 6 || part > 0) this.emit({ type: "heal", id: u.id, target: u.id, amt, x: u.x, y: u.y, self: true });
    return amt;
  }
  /** What each viewer's character has left of its strength (0..1), by character key: it goes with it into the next match. */
  strengths() {
    const m = new Map();
    for (const [uk, u] of this.byUk) m.set(uk, Math.max(0.01, u.hp / u.max));
    for (const [uk, q] of this.queue) if (q.hpr > 0) m.set(uk, q.hpr);       // carried over and not out yet
    return m;
  }
  /** What each viewer did this match, as one number (for the ranking): Map key -> { score, kills, gate, heal, mend }. */
  scores() {
    const out = new Map();
    for (const [key, s] of this.stats) out.set(key, { score: Math.round(s.kills * 10 + s.gate + s.heal * 0.5 + s.mend * 0.5), kills: s.kills, gate: Math.round(s.gate), heal: Math.round(s.heal), mend: Math.round(s.mend) });
    return out;
  }
  /** A like: their characters hurry for a few seconds. */
  hurry(key, s = 4) { const sq = this.squad.get(key); if (sq) for (const u of sq) u.hurry = this.t + s; }
  /**
   * A character becomes another rank (a right answer; an item past the viewer's limit). On the field: changed where
   * it stands, full life. Waiting or fallen: with `now`, it comes on the field at once (an item never waits).
   */
  promote(uk, tier, _unused, { now = false } = {}) {
    const u = this.byUk.get(uk);
    if (u) {
      const from = u.tier;
      u.tier = tier; u.kind = KINDS[tier];
      u.max = this._hp(u); u.hp = u.max; u.cd = 0;
      this._relead(u.key);
      this.emit({ type: "promote", id: u.id, key: u.key, uk, team: u.team, tier, from, x: u.x, y: u.y });
      return u;
    }
    const q = this.queue.get(uk);
    if (!q) return null;
    q.tier = tier; q.kind = KINDS[tier];
    if (now) { this.queue.delete(uk); const nu = this._spawn(q, 0); this.emit({ type: "promote", id: nu.id, key: nu.key, uk, team: nu.team, tier, from: -1, x: nu.x, y: nu.y }); return nu; }
    this._relead(q.key);
    return null;
  }

  // ---------- strength ----------
  _norms() {
    const T = this.T, n = { D: 0, A: 0 }, v = { D: 0, A: 0 };
    for (const u of this.units) { n[u.team]++; if (u.key) v[u.team]++; }
    for (const q of this.queue.values()) v[q.team]++;
    // everyone of the team this match (on the field, waiting, or fallen): blows on gates are divided by this
    const all = { D: 0, A: 0 };
    for (const tm of this.seen.values()) all[tm]++;
    // the smaller team (by viewers; a team with nobody counts its soldiers of the place) hits harder
    const size = { D: Math.max(3, all.D, v.D), A: Math.max(3, all.A, v.A) };
    for (const t of ["D", "A"]) {
      const o = t === "D" ? "A" : "D";
      const bonus = size[t] < size[o] ? Math.min(T.sizeMax, Math.pow(size[o] / size[t], T.sizePow)) : 1;
      // the defenders are at home: a little stronger (the user, 11/11/2026: "ưu tiên Thành Xanh một chút", most
      // viewers pick the red team). Less so as the live grows: a big live already favours the walls
      const home = t === "D" ? Math.max(T.homeMin, T.home - T.homeFade * Math.log(Math.max(1, ((size.D + size.A) / 2) / T.homeAt))) : 1;
      this.mul[t] = bonus * this.boost[t] * this.luck[t] * home;
      this.gnorm[t] = (T.ref / Math.max(T.ref, Math.max(all[t], v[t]) + T.npcWave)) * this.boost[t] * this.luck[t] * home;
    }
    // how strong each team stands on each side (for the defenders, who go where they are needed)
    for (const t of ["D", "A"]) for (const f of FACES) this.pow[t][f] = 0;
    for (const u of this.units) this.pow[u.team][u.goLane || u.lane] += T.kind[u.kind].hp;
    for (const t of ["D", "A"]) for (const f of FACES) this.aura[t][f] = 0;
    for (const u of this.units) { const a = T.kind[u.kind].aura; if (a && a > this.aura[u.team][u.lane]) this.aura[u.team][u.lane] = a; }
    this._pawnPlan();
    // where the attackers' strongest leader is: the defenders' leaders go and face them
    this.heroLane = null;
    let top = 0;
    for (const u of this.units) if (u.team === "A" && u.tier >= 5 && u.tier * 1000 + u.hp > top) { top = u.tier * 1000 + u.hp; this.heroLane = u.lane; }
    // the giants: what the viewers send and what the fighters do weigh by the size of the live, not by one team's
    const vs = (Math.max(all.D, v.D) + Math.max(all.A, v.A)) / 2;
    this.gfeed = T.ref / Math.max(T.ref, vs);
    this.gdrain = T.ref / Math.max(T.ref, vs + T.npcWave);
    this.normAt = this.t;
  }
  /**
   * Where the defenders' villagers are needed (the user, 11/11/2026: "dân cần phân ra các cổng hợp lý hoặc dồn hợp
   * lý"; before, a villager never left a gate that had a single enemy before it, so three gates could lie broken
   * while four villagers stood by a whole one). Each gate weighs by how hurt it is, whether it is down, and how many
   * attackers stand before it; the villagers are shared out in that proportion: spread when all is quiet, massed
   * where a gate is going.
   */
  _pawnPlan() {
    const at = { N: 0, E: 0, S: 0, W: 0 }, want = { N: 0, E: 0, S: 0, W: 0 };
    let n = 0, sum = 0;
    for (const u of this.units) if (u.team === "D" && u.kind === "pawn") { at[u.goLane || u.lane]++; n++; }
    for (const f of FACES) {
      const g = this.gates[f];
      want[f] = 0.25 + (1 - g.hp / g.max) * 2.5 + (g.broken ? 0.8 : 0) + Math.min(1.5, this.pow.A[f] / 150);
      sum += want[f];
    }
    for (const f of FACES) want[f] = (n * want[f]) / sum;
    this.pawnAt = at; this.pawnWant = want;
  }
  /** A villager at `lane`: the gate to go to, or null when this one needs them (or no other is short of a whole one). */
  _pawnMove(lane) {
    const at = this.pawnAt, want = this.pawnWant;
    if (!at || at[lane] - 1 < want[lane] - 0.5) return null;
    let best = null, lack = 0.75;
    for (const f of FACES) { if (f === lane) continue; const l = want[f] - at[f]; if (l > lack) { lack = l; best = f; } }
    return best;
  }
  _hp(u) { return this.T.kind[KINDS[u.tier]].hp * Math.sqrt(this.mul[u.team] || 1); }
  _dmg(u) { return this.mul[u.team] * (1 + this.aura[u.team][u.lane]); }

  // ---------- the waves ----------
  _spawn(v, delay = 0) {
    const T = this.T, kind = KINDS[v.tier] || "pawn", lane = v.lane || this._laneFor(v);
    const side = (this.rand() - 0.5) * 2;
    const u = { id: ++UID, key: v.key || null, uk: v.uk || v.key || null, n: v.n || 0, item: !!v.item, team: v.team, tier: v.tier || 0, kind, lane, name: v.name || "", avatar: v.avatar || "",
      o: 0, d: 0, x: 0, y: 0, hp: 1, max: 1, cd: this.rand() * 0.5, think: 0, target: null, act: "run", actAt: this.t, flip: 1,
      slot: side, born: this.t + delay, hurry: 0, kills: 0, npc: !v.key };
    if (v.waiting) { u.o = v.o; u.d = v.d; u.id = v.id; }          // from where they stood waiting
    else if (v.team === "A") { u.o = side * 16; u.d = CAMP_D - 8 + this.rand() * 6; }
    else { u.o = side * 10; u.d = -(H - HALL_R - 4) + this.rand() * 6; }
    u.max = this._hp(u);
    u.hp = u.max * (v.hpr > 0 ? Math.min(1, v.hpr) : 1);      // what it had left at the end of the last match
    this._place(u);
    this.units.push(u);
    if (u.key) {
      this.byUk.set(u.uk, u);
      let sq = this.squad.get(u.key);
      if (!sq) this.squad.set(u.key, (sq = new Set()));
      sq.add(u);
      this.seen.set(u.uk, u.team);
      this._relead(u.key);
    }
    this.emit({ type: "spawn", id: u.id, key: u.key, uk: u.uk, team: u.team, lane, x: u.x, y: u.y, delay });
    return u;
  }
  _openWave() {
    const T = this.T;
    this.waveN++;
    this.nextWave = this.t + T.wave;
    const n = { D: 0, A: 0 }, per = { D: {}, A: {} };
    let i = 0;
    // a very big live: at most fieldCap viewers of a team on the field at once; the others keep their place in the queue
    const on = { D: 0, A: 0 };
    for (const u of this.units) if (u.key) on[u.team]++;
    for (const [uk, v] of [...this.queue]) {
      if (on[v.team] >= T.fieldCap) continue;
      on[v.team]++;
      this.queue.delete(uk);
      this._spawn(v, (i++ % 12) * 0.07); n[v.team]++;
    }
    // soldiers of the place: spread over the 4 sides, so every gate has its fight
    for (const t of ["D", "A"]) {
      let aliveNpc = 0; for (const u of this.units) if (u.team === t && u.npc) aliveNpc++;
      const quiet = this.seen.size === 0;        // not one viewer in this match yet
      const add = Math.max(0, Math.min(quiet ? T.npcQuiet : T.npcWave, (quiet ? T.npcQuietCap : T.npcCap) - aliveNpc));
      for (let k = 0; k < add; k++) {
        const lane = this.rage ? "S" : FACES[(k + this.waveN) % 4];
        per[t][lane] = (per[t][lane] || 0) + 1;
        this._spawn({ team: t, tier: k % 3 === 2 ? 1 : 0, lane }, k * 0.1);
      }
    }
    this._norms();
    this.emit({ type: "wave", n: this.waveN, came: n });
  }

  // ---------- blows ----------
  hitGate(f, dmg, by = null, kind = "blow") {
    const g = this.gates[f];
    if (this.over || !(dmg > 0)) return;
    if (g.broken) return this.hitHall(dmg, by, kind);
    const real = Math.min(g.hp, dmg);
    g.hp -= real; g.hitAt = this.t;
    if (by?.key) this.stat(by.key).gate += real;
    this.emit({ type: "hit", face: f, dmg: real, kind, id: by?.id });
    if (!g.half && g.hp <= g.max * 0.5) { g.half = true; this.emit({ type: "gate_half", face: f }); }
    if (g.hp <= 0) { g.hp = 0; g.broken = true; this.emit({ type: "breach", face: f, key: by?.key || null, name: by?.name || "" }); }
  }
  mend(f, amt, by = null) {
    const g = this.gates[f];
    if (this.over || !(amt > 0) || g.hp >= g.max) return;
    const real = Math.min(g.max - g.hp, amt);
    g.hp += real;
    if (by?.key) this.stat(by.key).mend += real;
    this.emit({ type: "mend", face: f, amt: real, id: by?.id });
    if (g.broken && g.hp >= g.max * this.T.stand) { g.broken = false; this.emit({ type: "rebuilt", face: f, key: by?.key || null, name: by?.name || "" }); }
    if (g.half && g.hp > g.max * 0.6) g.half = false;
  }
  hitHall(dmg, by = null, kind = "blow") {
    if (this.over || !(dmg > 0)) return;
    if (this.rage) {                 // the match of fury: the castle stands, the blow goes to the defenders' giant
      if (by?.key) this.stat(by.key).gate += dmg;
      this.emit({ type: "hall_hit", dmg, kind, id: by?.id });
      this._hurtGiant("D", dmg * this.T.giant.hall * (this.T.giant.hp / this.T.hallMax));
      return;
    }
    const h = this.hall, before = h.hp / h.max;
    h.hp = Math.max(0, h.hp - dmg);
    if (by?.key) this.stat(by.key).gate += dmg;
    this.emit({ type: "hall_hit", dmg, kind, id: by?.id });
    const r = h.hp / h.max;
    for (const m of [0.5, 0.25]) if (before > m && r <= m && !h.marks.includes(m)) { h.marks.push(m); this.emit({ type: "hall_mark", mark: m }); }
    if (h.hp <= 0) { this.over = true; this.winner = "A"; this.emit({ type: "hall_fell", key: by?.key || null, name: by?.name || "" }); }
  }
  _hurt(v, dmg, by) {
    if (v.hp <= 0) return;
    v.hp -= dmg;
    v.hitAt = this.t;
    if (v.hp > 0) return;
    v.hp = 0;
    this._remove(v);
    if (v.key) this.stat(v.key).falls++;
    this.emit({ type: "died", id: v.id, key: v.key, uk: v.uk, n: v.n, team: v.team, tier: v.tier, kind: v.kind, name: v.name, lane: v.lane, x: v.x, y: v.y, by: by?.id, byKey: by?.key || null, byName: by?.name || "", byTier: by?.tier ?? 0 });
    if (this.rage) {                 // every fighter who falls takes a little strength from their own giant
      const G = this.T.giant;
      this._hurtGiant(v.team, (G.fall[v.tier] || 1) * (v.npc ? 0.5 : 1) * this.gdrain * (v.team === "A" ? G.drainA : G.drainD));
    }
    if (!by) return;
    by.kills++;
    if (by.key) {
      this.stat(by.key).kills++;
      if (!this.firstBlood && v.key) { this.firstBlood = true; this.emit({ type: "first_blood", key: by.key, name: by.name, team: by.team, victim: v.name, id: by.id }); }
      if (this.T.streaks.includes(by.kills)) this.emit({ type: "streak", key: by.key, name: by.name, team: by.team, n: by.kills, id: by.id });
    }
  }
  _remove(u) {
    const i = this.units.indexOf(u);
    if (i >= 0) this.units.splice(i, 1);
    u.gone = true;
    if (u.key) {
      if (this.byUk.get(u.uk) === u) this.byUk.delete(u.uk);
      const sq = this.squad.get(u.key);
      if (sq) { sq.delete(u); if (!sq.size) this.squad.delete(u.key); }
      this._relead(u.key);
    }
  }

  _place(u) { const [x, y] = facePos(u.lane, u.o / H, u.d); u.x = x; u.y = y; }

  // ---------- every step ----------
  update(dt) {
    if (this.over || !(dt > 0)) return;
    dt = Math.min(dt, 0.25);
    this.t += dt;
    const T = this.T, t = this.t;
    if (t >= this.nextWave) this._openWave();
    if (t - this.normAt > 0.5) this._norms();
    if (this.rage) this._duel(dt);
    // the fighters of each side of the citadel, by team
    const lanes = { D: { N: [], E: [], S: [], W: [] }, A: { N: [], E: [], S: [], W: [] } };
    for (const u of this.units) if (u.born <= t) lanes[u.team][u.lane].push(u);
    const units = this.units.slice();
    const turn = (u, dir) => { if (dir !== u.flip && t - (u.flipAt || -9) > 0.3) { u.flip = dir; u.flipAt = t; } };
    for (const u of units) {
      if (u.gone || u.born > t) continue;
      const K = T.kind[u.kind], g = this.gates[u.lane], foes = lanes[u.team === "D" ? "A" : "D"][u.lane], mates = lanes[u.team][u.lane];
      const fast = u.hurry > t ? 1.3 : 1;
      u.cd -= dt * fast;
      if (u.hp < u.max && t - (u.hitAt || -9) > T.restAfter) u.hp = Math.min(u.max, u.hp + u.max * T.rest * dt);   // out of the fight: they get their breath back
      // who to deal with: looked at again a few times a second
      if (t >= u.think) {
        u.think = t + 0.22 + this.rand() * 0.1;
        // the one they are on stays theirs unless another is clearly better: a fighter who goes from one to the other
        // and back twitches on the spot (measured with tools/jitter.mjs)
        const prev = u.target && !u.target.gone && u.target.lane === u.lane ? u.target : null;
        u.target = null;
        if (K.heal) {                      // a healer: the most hurt friend of this side
          let best = null, w = 0.02;
          for (const m of mates) { if (m === u || m.gone) continue; const miss = 1 - m.hp / m.max; if (miss > w) { w = miss; best = m; } }
          if (prev && prev.team === u.team && prev !== best) { const miss = 1 - prev.hp / prev.max; if (miss > 0.05 && w < miss + 0.25) best = prev; }
          u.target = best;
        } else {
          // how far an enemy is for this fighter (a lancer draws them: it counts as nearer); Infinity behind a wall
          const far = (e) => {
            if (!g.broken && K.range < 40 && (u.d < 0) !== (e.d < 0) && !(Math.abs(u.d) < 14 && Math.abs(e.d) < 14)) return Infinity;   // only arrows fly over a wall
            const dist = Math.hypot(e.o - u.o, e.d - u.d);
            return T.kind[e.kind].taunt ? dist * T.kind[e.kind].taunt : dist;
          };
          let best = null, bd = K.sight;
          for (const e of foes) {
            if (e.gone) continue;
            const dist = far(e);
            if (dist < bd) { bd = dist; best = e; }
          }
          if (prev && prev.team !== u.team && prev !== best) { const pd = far(prev); if (pd < K.sight * 1.15 && (!best || bd > pd * 0.7)) best = prev; }
          u.target = best;
        }
      }
      let to = null, td = 0, stop = 2, acted = false;
      let tg = u.target && !u.target.gone ? u.target : null;
      if (u.team === "D" && u.tier >= 5 && this.heroLane && this.heroLane !== u.lane && !u.goLane && !(tg && tg.tier >= 5) && t - (u.movedAt || -99) > 8) { u.goLane = this.heroLane; u.movedAt = t; }
      if (u.goLane && tg && Math.hypot(tg.o - u.o, tg.d - u.d) > K.range) tg = null;      // on their way: only those in reach
      if (tg && K.heal) {
        const dist = Math.hypot(tg.o - u.o, tg.d - u.d);
        if (dist <= K.range) {
          acted = true;
          if (u.cd <= 0) {
            u.cd = K.every;
            const amt = Math.min(tg.max - tg.hp, K.heal * this._dmg(u));
            tg.hp += amt;
            if (u.key) this.stat(u.key).heal += amt;
            u.act = "heal"; u.actAt = t;
            this.emit({ type: "heal", id: u.id, target: tg.id, amt, x: tg.x, y: tg.y });
          }
        } else { to = tg.o; td = tg.d; stop = K.range * 0.8; }
      } else if (tg) {
        const dist = Math.hypot(tg.o - u.o, tg.d - u.d);
        if (Math.abs(tg.x - u.x) > 1.2) turn(u, tg.x > u.x ? 1 : -1);
        if (dist <= K.range) {
          acted = true;
          if (u.cd <= 0) {
            u.cd = K.every;
            const dmg = K.dmg * this._dmg(u);
            u.act = "attack"; u.actAt = t;
            if (K.range >= 40) this.emit({ type: "shot", id: u.id, x1: u.x, y1: u.y, x2: tg.x, y2: tg.y, team: u.team });
            else this.emit({ type: "swing", id: u.id, x: tg.x, y: tg.y, team: u.team, big: u.tier >= 5 });
            this._hurt(tg, dmg, u);
            // a fight at the foot of a gate (or of the castle) wears it down too: the attackers never fight for nothing
            if (u.team === "A" && T.press > 0 && !this.rage) {
              const sg = K.siege * T.press * (1 + this.aura.A[u.lane]) * this.gnorm.A;
              if (!g.broken) { if (u.d < T.pressD && u.d > -14) this.hitGate(u.lane, sg, u, "press"); }
              else if (u.d < -(H - HALL_R - 64)) this.hitHall(sg * T.hallHit, u, "press");
            }
            if (K.cleave) { let n = 0; for (const e of foes) { if (n >= K.cleave) break; if (e !== tg && !e.gone && Math.hypot(e.o - tg.o, e.d - tg.d) < 16) { this._hurt(e, dmg * 0.6, u); n++; } } }
          }
        } else { to = tg.o; td = tg.d; stop = K.range * 0.85; }
      }
      if (!acted && to === null && this.rage) {
        // the match of fury (the user, 11/11/2026: "lính dồn hết về 2 phía người khổng lồ, đánh nhau và đánh người
        // khổng lồ"): nobody storms the walls. With no enemy fighter in sight they go for the other team's giant and
        // strike it; the healers stay by their own
        const G = T.giant, foe = this.giants[u.team === "D" ? "A" : "D"], own = this.giants[u.team], side = u.team === "D" ? 1 : -1;
        if (u.d < -2) { to = u.slot * 5; td = 4; stop = 1; }                       // out through the south gate first
        else if (K.heal) { to = own.o + side * (16 + Math.abs(u.slot) * 12); td = own.d + u.slot * 24; stop = 4; }
        else {
          const dist = Math.hypot(foe.o - u.o, foe.d - u.d);
          if (dist <= K.range + G.reach) {
            acted = true;
            turn(u, foe.x - u.x >= 0 ? 1 : -1);
            if (u.cd <= 0) {
              u.cd = K.every;
              u.act = "attack"; u.actAt = t;
              if (K.range >= 40) this.emit({ type: "shot", id: u.id, x1: u.x, y1: u.y, x2: foe.x + (this.rand() - 0.5) * 14, y2: foe.y - 16 - this.rand() * 30, team: u.team });
              else this.emit({ type: "swing", id: u.id, x: foe.x - side * -10, y: foe.y - 8, team: u.team, big: u.tier >= 5 });
              const dmg = K.dmg * this._dmg(u) * G.unit * this.gdrain;
              if (u.key) this.stat(u.key).gate += dmg * 4;           // counts for the ranking as blows on a gate do
              this._hurtGiant(foe.team, dmg);
            }
          } else {
            // a place of their own on the side of the giant that faces them, always within reach of it
            const R = Math.min(K.range, 60) + G.reach - 4, a = u.slot * 1.25;
            to = foe.o + side * Math.cos(a) * R; td = foe.d + Math.sin(a) * R; stop = 2;
          }
        }
      } else if (!acted && to === null) {
        // nobody to deal with: the work of their side
        if (u.team === "A") {
          if (!g.broken) {
            const post = K.range >= 40 ? 42 : K.heal ? 26 : 7;
            const po = u.slot * (K.range >= 40 ? 46 : 20);
            if (Math.abs(u.d - post) < 4 && Math.abs(u.o - po) < 6 && !K.heal) {
              acted = true;
              if (u.cd <= 0) {
                u.cd = K.every;
                const base = K.siege;
                u.act = "attack"; u.actAt = t; turn(u, facePos(u.lane, 0, 0)[0] - u.x >= 0 ? 1 : -1);
                if (K.range >= 40) { const [gx, gy] = facePos(u.lane, u.slot * 0.2, 0); this.emit({ type: "shot", id: u.id, x1: u.x, y1: u.y, x2: gx, y2: gy, team: "A" }); }
                else this.emit({ type: "swing", id: u.id, x: u.x, y: u.y, team: "A", gate: true });
                this.hitGate(u.lane, base * (1 + this.aura.A[u.lane]) * this.gnorm.A, u, K.range >= 40 ? "arrow" : "blow");
              }
            } else { to = po; td = post; }
          } else {
            // the gate is down: in, to the castle
            const post = -(H - HALL_R - (K.range >= 40 ? 44 : K.heal ? 30 : 6)), po = u.slot * 18;
            if (Math.abs(u.d - post) < 5 && !K.heal) {
              acted = true;
              if (u.cd <= 0) {
                u.cd = K.every;
                u.act = "attack"; u.actAt = t;
                if (K.range >= 40) this.emit({ type: "shot", id: u.id, x1: u.x, y1: u.y, x2: (this.rand() - 0.5) * 30, y2: (this.rand() - 0.5) * 16, team: "A" });
                else this.emit({ type: "swing", id: u.id, x: u.x, y: u.y, team: "A", hall: true });
                this.hitHall(K.siege * T.hallHit * (1 + this.aura.A[u.lane]) * this.gnorm.A, u, K.range >= 40 ? "arrow" : "blow");
              }
            } else { to = Math.abs(u.d) > 30 && u.d > 0 ? 0 : po; td = post; }
          }
        } else if (u.goLane) {
          // on their way to another gate, through the yard
          if (u.d > -20 || Math.abs(u.o) > 30) { to = 0; td = -26; stop = 3; }
          if (to === null || Math.hypot(to - u.o, td - u.d) <= 4) {
            const [dx, dy] = DIR[u.goLane];
            u.lane = u.goLane; u.goLane = null;
            u.d = u.x * dx + u.y * dy - H; u.o = -u.x * dy + u.y * dx;
            to = null;
          }
        } else {
          // defenders: fighters in front of the gate, archers on the wall, healers behind, villagers mend the gate
          if (t >= (u.review || 0)) {
            u.review = t + 2 + this.rand() * 1.5;
            // nobody to fight here: go where the attackers are (the user: an idle guard must help the other gates);
            // while there is a fight here: leave only for a side in much greater need
            const P = this.pow;
            if (u.kind === "pawn") {
              // a villager: to the gate that is short of menders (see _pawnPlan), never back and forth
              const best = t - (u.movedAt || -99) > 6 ? this._pawnMove(u.lane) : null;
              if (best) { this.pawnAt[u.lane]--; this.pawnAt[best]++; P.D[u.lane] -= K.hp; P.D[best] += K.hp; u.goLane = best; u.movedAt = t; }
            } else {
              const idle = P.A[u.lane] < 1;
              const mine = P.A[u.lane] * (g.broken ? 1.6 : 1) - (P.D[u.lane] - K.hp);
              let best = null, need = idle ? -1e9 : 12;
              for (const f of FACES) {
                if (f === u.lane || P.A[f] < 1) continue;
                const og = this.gates[f];
                const n = P.A[f] * (og.broken ? 1.6 : 1) - P.D[f] * (idle ? 0.5 : 1);
                if (n > need) { need = n; best = f; }
              }
              if (best && (idle || mine < need - K.hp * 0.5) && t - (u.movedAt || -99) > 8) {
                P.D[u.lane] -= K.hp; P.D[best] += K.hp; u.goLane = best; u.movedAt = t;
              }
            }
          }
          let post, po;
          if (u.kind === "pawn") { post = -9; po = u.slot * 14; }
          else if (K.range >= 40) { post = -5; po = (u.slot >= 0 ? 1 : -1) * (26 + Math.abs(u.slot) * 46); }
          else if (K.heal) { post = g.broken ? -52 : 10; po = u.slot * 18; }
          else { post = g.broken ? -40 : 22; po = u.slot * 26; }
          // out through the gate first (the middle of the wall), then to their place
          const through = !g.broken && u.d < -2 && post > 0;
          if (Math.abs(u.d - post) < 3 && Math.abs(u.o - po) < 5) {
            if (u.kind === "pawn" && g.hp < g.max) {
              acted = true;
              if (u.cd <= 0) { u.cd = K.every; u.act = "work"; u.actAt = t; this.mend(u.lane, T.mend * (t - g.hitAt < T.underFire ? T.mendUnderFire : 1) * (1 + this.aura.D[u.lane]) * this.gnorm.D, u); }
            }
          } else { to = through ? u.slot * 5 : po; td = through ? 0 : post; }
        }
      }
      if (to !== null) {
        const vo = to - u.o, vd = td - u.d, dist = Math.hypot(vo, vd);
        // already walking: on to the place. Standing: only when a little out of place (a nudge from a neighbour
        // does not send them walking again: that was the twitching). The margin is small on purpose: a wider one
        // left fighters standing just out of reach of their enemy, or beside their post, doing nothing (measured
        // with tools/jitter.mjs: 36 of 111 frozen for more than 3 seconds)
        if (dist > (u.act === "run" ? stop : stop + 0.6)) {
          const step = Math.min(dist - stop * 0.5, K.speed * fast * dt);
          const px = u.x;
          u.o += (vo / dist) * step; u.d += (vd / dist) * step;
          this._place(u);
          if (Math.abs(u.x - px) > 0.04) turn(u, u.x > px ? 1 : -1);
          u.stopAt = 0;
          if (u.act !== "attack" || t - u.actAt > 0.45) { if (u.act !== "run") { u.act = "run"; u.actAt = t; } }
          continue;
        }
      }
      // no step this time: a walker stands once it has not moved for a moment
      let still = true;
      if (u.act === "run") { if (!u.stopAt) u.stopAt = t; still = t - u.stopAt > 0.12; }
      if (!acted && still && (u.act === "run" || t - u.actAt > 0.6) && u.act !== "idle") { u.act = "idle"; u.actAt = t; u.stopAt = 0; }
      else if (acted && still && u.act === "run") { u.act = "idle"; u.actAt = t; u.stopAt = 0; }
    }
    // in a fight, people of the same team do not stand inside each other: a light push apart
    for (const tm of ["D", "A"]) for (const f of FACES) {
      const Ls = lanes[tm][f], n = Math.min(Ls.length, 40);
      for (let i = 0; i < n; i++) {
        const a = Ls[i];
        if (a.gone || !a.target) continue;
        for (let j = i + 1; j < n; j++) {
          const c = Ls[j];
          if (c.gone || !c.target) continue;
          const dx = a.o - c.o;
          if (Math.abs(dx) < 5 && Math.abs(a.d - c.d) < 3) { const push = (dx >= 0 ? 1 : -1) * 5 * dt * (1 - Math.abs(dx) / 5); a.o += push; c.o -= push; this._place(a); this._place(c); }
        }
      }
    }
  }
}

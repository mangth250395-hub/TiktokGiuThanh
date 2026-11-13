// The rules of the game, with no screen and no sound: events in, effects out. Everything it knows is in `state`
// (plain JSON), saved to disk by the app, so a restart continues the same session.
//
//   - two teams around a square citadel: D "Thành Xanh" (thủ: holds the castle) and A "Quân Đỏ" (đánh: brings it down)
//   - a viewer's FIRST comment gives them a character, for the whole series of matches: "thủ" / "đánh" chooses the
//     team, anything else (a quiz answer, a hello) puts them in the team with fewer people. "đổi": the other team
//     from the next wave. When the series (5 matches) is over everything starts again: they comment again to play
//   - a character is one of 7 ranks (TIERS). The one from the comment starts as "Dân"; a right quiz answer moves it
//     up to FREE_MAX (Lính kiếm: the user, 11/11/2026, "trả lời câu hỏi lên bậc lính kiếm thôi, còn lại hồi sức");
//     at that rank a right answer gives strength back instead
//   - EVERY GIFT ITEM ADDS ONE MORE CHARACTER of the rank of its value (1, 5, 10, 20, 30, 99) for the giver (the user,
//     10/11/2026: "tặng quà thì được thêm 1 con khác"): a viewer can own up to MAX_UNITS (30); past that, an item
//     gives life back instead. A character that came from an item is GONE when it falls
//   - likes, shares and follows are cheap and can be spammed: they give a little life back to ONE of the viewer's
//     characters (the most hurt), never a rank
//   - the character of the comment, when it falls, comes back as a Dân at the next wave, whatever its rank
//   - a match: the defenders win when the castle still stands at the end of the time, the attackers when it falls
//   - the series (the user, 11/11/2026): as soon as one team has won so many matches that the other cannot catch up
//     (3 of 5), the next match is THE MATCH OF FURY ("trận nộ"): two giants, one per team, fight; likes, shares and
//     follows give strength to the giant of the viewer's team instead of their own character. The team that is
//     ahead wins it: the series is over at once. The team behind wins it: the score is LEVEL and the game goes on
//     with an ordinary match (the user: "lại đánh bình thường"); level as they are, whoever wins that one has won
//     the series
import { fold } from "./quiz.js";

export const MATCH_MS = 240_000;
export const SERIES_MATCHES = 5;
/** Points for the ranking of the match: per coin of a gift, a right quiz answer; `likes`: likes for 1 point; a share,
 *  a follow, joining. Only a right answer moves a rank (STEP points = one rank). */
export const POINTS = { comment: 0, likes: 20, coin: 5, share: 1, follow: 2, quiz: 10 };
export const STEP = 10;          // quiz points for one rank up: a right answer = one rank
export const FREE_MAX = 1;       // the highest rank reached without an item (Lính kiếm)
// What a right answer gives, in this order (the user, 11/11/2026): their Dân becomes a Lính kiếm; then ONE MORE Dân
// (FREE_UNITS characters without an item at most); then that one becomes a Lính kiếm; with all of them soldiers, a
// right answer gives strength back
export const FREE_UNITS = 2;
/** Strength given back to the viewer's character (a villager has 36, a general 322): `like` for every `likes`
 *  hearts, for a share, for a follow; a right answer at the top rank gives `quiz` of the character's whole strength.
 *  Hearts are COUNTED for each viewer and give only when the count is reached, what is left over waits for their
 *  next ones (it was half a point a heart, so the screen showed +6, +7, +1,5 beside a label that says "10 tim +5";
 *  the user, 11/11/2026: "sao không phải đúng số tim mới cho cộng?"). One batch of hearts gives once at most, and no
 *  more than `likeBank` hearts wait: a flood from one finger is not worth more. */
// The user, 11/11/2026: "10 tim 5 sức, chia sẻ 3 sức, theo dõi 10 sức", then "chỉnh lại share 2 sức thôi".
export const HEAL = { likes: 10, like: 5, likeBank: 20, share: 2, follow: 10, quiz: 0.6 };
export const MAX_UNITS = 30;     // characters one viewer can own (1 from their comment + items); the user, 10/11/2026
export const GIFT_TIERS = [1, 5, 10, 20, 30, 99];    // the value of one item (coins)
/** The match of fury, what a viewer gives the giant of their team (the user, 11/11/2026: first "5 tim mỗi 5 giây, chia sẻ
 *  được 2 sức, follow 10 sức", then "share 1 sức thôi, 10 tim là 2 sức", then "follow +5 sức khổng lồ thôi"): `likes` likes are worth `perViewer`, and no more than `perViewer` every `windowMs`
 *  from likes (pressing faster brings nothing more: a giant is carried by how many people help, not by one finger);
 *  a share, a follow. */
export const GIANT = { likes: 10, perViewer: 2, windowMs: 5000, share: 1, follow: 5 };
export const REST_GRACE_MS = 30_000;                 // who spoke this close to the end of a match need not speak again
export const COUNTDOWN_S = [60, 30, 10];
export const AWAY_MS = 10 * 60_000;                  // not seen for this long: taken as gone (their character rests)

export const TEAMS = {
  D: { id: "D", name: "Thành Xanh", side: "thủ", verb: "giữ thành", color: "#3fa7ff" },
  A: { id: "A", name: "Quân Đỏ", side: "đánh", verb: "công thành", color: "#ff5a4d" },
};
export const other = (t) => (t === "D" ? "A" : "D");

/** The ranks of character. gift: the value of the item that gives it; does: what it is good at. */
export const TIERS = [
  { id: "pawn", name: "Dân", gift: 0, does: "vá cổng" },
  { id: "warrior", name: "Lính kiếm", gift: 1, does: "đánh gần" },
  { id: "lancer", name: "Lính giáo", gift: 5, does: "trâu, chặn" },
  { id: "archer", name: "Cung thủ", gift: 10, does: "bắn xa" },
  { id: "monk", name: "Thầy thuốc", gift: 20, does: "hồi sức" },
  { id: "captain", name: "Đội trưởng", gift: 30, does: "tăng sức quân" },
  { id: "general", name: "Tướng", gift: 99, does: "mạnh nhất" },
];
export const AWARDS = { killer: "Hạ nhiều địch nhất", breaker: "Phá thành số một", healer: "Cứu người nhiều nhất", mender: "Vá cổng giỏi nhất" };

/** The rank of a gift item (the highest of GIFT_TIERS it reaches) and how much more than that it is worth. */
export function giftTier(each) {
  let rank = 0;
  for (let i = 1; i < TIERS.length; i++) if (each >= TIERS[i].gift) rank = i;
  return rank ? { rank, tier: TIERS[rank].gift, mult: Math.min(20, each / TIERS[rank].gift) } : null;
}

/**
 * How the value of ONE item is dealt into characters when it is not one of the six values (the user, 10/11/2026:
 * "tặng không đúng xu nhưng vẫn phải phân chia hợp lý"): the biggest ranks first, until nothing is left, so no coin
 * is lost. 50 = Đội trưởng (30) + Thầy thuốc (20); 199 = 2 Tướng + 1 Lính kiếm; 7 = Lính giáo + 2 Lính kiếm.
 * Returns the ranks, the highest first (never more than `max`).
 */
export function giftSplit(each, max = MAX_UNITS) {
  const out = [];
  let left = Math.max(1, Math.floor(Number(each) || 0));
  for (let r = TIERS.length - 1; r >= 1; r--)
    while (left >= TIERS[r].gift && out.length < max) { out.push(r); left -= TIERS[r].gift; }
  return out;
}

// ---------- reading a comment ----------
const KEYS = { D: ["thủ", "giữ", "xanh"], A: ["đánh", "đỏ"], SW: ["đổi"] };
const PHRASES = [["giữ thành", "D"], ["thành xanh", "D"], ["phòng thủ", "D"], ["tấn công", "A"], ["công thành", "A"], ["phá thành", "A"], ["quân đỏ", "A"]];
// small words that may stand around a team word ("vào thủ nha", "em theo đánh", "đội thủ")
const FILLER = new Set(["vao", "vo", "theo", "em", "minh", "toi", "tui", "cho", "nha", "nhe", "di", "thoi", "luon", "a", "nao",
  "phe", "doi", "ben", "chon", "team", "nhom", "xin", "con", "anh", "chi", "ne", "nay", "sang", "qua"]);

/**
 * What a comment asks: { kind: "join", team } | { kind: "switch", team: "D" | "A" | null } | null. Only short comments
 * count (at most 4 words: a team word and small words around it), so a sentence that merely holds "đánh" chooses nothing.
 * Typed with accents, the accents must be the right ones ("thư", "thú", "thử" are not "thủ"); typed with none at all:
 * "thu", "giu", "xanh", "danh", "do", "doi".
 */
export function readCommand(text) {
  const raw = String(text || "").normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  if (!raw) return null;
  if (raw.split(" ").length > 4) return null;
  const ascii = raw === fold(raw);             // typed without any accent
  const same = (word, key) => (ascii ? word === fold(key) : word === key);
  let team = null, clash = false, sw = false;
  const setTeam = (t) => { if (team && team !== t) clash = true; team = t; };
  let s = ` ${raw} `;
  for (const [p, t] of PHRASES) {
    const q = ` ${ascii ? fold(p) : p} `;
    if (s.includes(q)) { setTeam(t); s = s.replace(q, " "); }
  }
  for (const w of s.trim().split(" ").filter(Boolean)) {
    if (KEYS.SW.some((k) => same(w, k))) sw = true;
    else if (KEYS.D.some((k) => same(w, k))) setTeam("D");
    else if (KEYS.A.some((k) => same(w, k))) setTeam("A");
    else if (!FILLER.has(fold(w))) return null;
  }
  if (clash) return null;
  if (sw) return { kind: "switch", team };
  return team ? { kind: "join", team } : null;
}

// ---------- the state ----------
/** kind: null (a match like any other) or "rage" (the match of fury). */
function newMatch(n, kind = null) {
  return { n, kind, elapsed: 0, said: [], people: {} };      // people: viewer key -> points brought in this match
}
function newSeries(n = 1) {
  return { n, wins: { D: 0, A: 0 }, people: {}, rage: null, lead: null };     // rage: "done" once the match of fury was played; lead: who was ahead
}
const team0 = () => ({ members: 0 });

/** The key of a viewer in the session: TikTok's id, or their @id when the event carries no id. The @id is the
 *  viewer's own choice, and the keys index plain objects: "__proto__" wrote the viewer's name and team onto every
 *  object of the page, "constructor" or "toString" made their comment throw. Such a name gets "@" in front. */
export function userKey(u, none = "?") {
  const key = String(u?.id || u?.unique_id || "");
  if (!key) return none;
  return key in Object.prototype ? `@${key}` : key;
}

export function newState(matchMs = MATCH_MS) {
  return {
    v: 1,
    game: "giuthanh",
    rules: 3,
    session: { id: Math.random().toString(36).slice(2, 10), started: Date.now() },
    matchMs,
    paused: false,
    match: newMatch(1),
    series: newSeries(1),
    teams: { D: team0(), A: team0() },
    boost: { D: 1, A: 1 },     // the team that lost the last match(es) starts a little stronger
    history: [],               // [{ n, winner, reason }]
    users: {},                 // key -> { name, uid, avatar, team, army: [{ n, tier }], next, fp, pts, gifts, nextTeam, ... }
    followers: {},
    hub: { epoch: null, seq: {} },
    battle: null,              // the field as last saved (gates, castle): battle.js
  };
}

const unitKey = (key, n) => `${key}#${n}`;
/** A character that did not come from an item: the one of the comment (0), and the one a right answer added. When it
 *  falls it comes back as a Dân; a Dân rests after each match until its owner comments again. */
const isFree = (b) => b.n === 0 || !!b.free;

export class Game {
  constructor(state = newState(), points = POINTS, { rand = Math.random } = {}) {
    this.s = state;
    this.rand = rand;
    this.lastTick = null;
    this.seriesMatches = SERIES_MATCHES;
    this.setPoints(points);
    this.s.teams ||= { D: team0(), A: team0() };
    this.s.boost ||= { D: 1, A: 1 };
    this.s.series ||= newSeries(1);
    if (this.s.rules !== 3) {            // a session saved by earlier rules: the people stay, each with one Dân
      this.s.rules = 3;
      this.s.battle = null;
      for (const u of Object.values(this.s.users || {})) {
        u.army = u.team ? [{ n: 0, tier: 0 }] : []; u.next = 1; u.fp = 0;
        delete u.job; delete u.lvl; delete u.pendingPowers; delete u.tier; delete u.lives;
      }
    }
    this._count();
  }

  setPoints(p = {}) {
    const n = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
    this.pts = { comment: n(p.comment, POINTS.comment), likes: Math.max(1, n(p.likes, POINTS.likes)), coin: n(p.coin, POINTS.coin),
      share: n(p.share, POINTS.share), follow: n(p.follow, POINTS.follow), quiz: n(p.quiz, POINTS.quiz) };
  }
  setSeries(n) { this.seriesMatches = Math.max(1, Math.min(50, Number(n) || SERIES_MATCHES)); }
  /** In a team and with a character in play (a Dân that rests after a match is not counted until its owner speaks). */
  _active(u) { return !!u.team && (u.army || []).some((b) => !(u.rest && isFree(b) && b.tier === 0)); }
  _count() { const t = this.s.teams; t.D.members = 0; t.A.members = 0; for (const u of Object.values(this.s.users)) if (this._active(u)) t[u.team].members++; }

  // ---------- reading ----------
  timeLeftMs() { return Math.max(0, this.s.matchMs - this.s.match.elapsed); }
  members(team) { return this.s.teams[team].members; }
  /** The highest rank among a viewer's characters (the frame around their picture in the panels). */
  top(u) { let t = 0; for (const b of u.army || []) if (b.tier > t) t = b.tier; return t; }
  view(key, u = this.s.users[key]) { return { key, name: u.name, uid: u.uid, avatar: u.avatar, team: u.team, tier: this.top(u), units: u.army?.length || 0, gifts: u.gifts || 0 }; }
  /** The characters of a viewer, as the field wants them: { key (the viewer), uk (this character), n, team, tier, name, avatar }. */
  bodies(key, u = this.s.users[key]) {
    if (!u?.team) return [];
    // item: it came from an item (it is gone when it falls, and shown before the others). hp: what it had left of
    // its strength at the end of the last match (0..1), absent when whole
    return (u.army || []).filter((b) => !(u.rest && isFree(b) && b.tier === 0))       // a Dân that rests after a match: not in play
      .map((b) => ({ key, uk: unitKey(key, b.n), n: b.n, team: u.team, tier: b.tier, name: u.name, avatar: u.avatar, item: !isFree(b), hp: b.hp }));
  }
  /** Every character in play. A character with a rank, or one that came from an item, stays for the whole series;
   *  a Dân rests after each match until its owner comments again (_restDan). */
  roster() {
    const out = [];
    for (const [key, u] of Object.entries(this.s.users)) if (u.team) out.push(...this.bodies(key, u));
    return out;
  }
  /** The first n by points. extra: Map key -> { score } added to the points (what they did on the field so far). */
  topPeople(n = 5, src = this.s.match.people, extra = null) {
    let list = Object.entries(src || {});
    if (extra) {
      const sum = new Map(list);
      for (const [key, sc] of extra) if (sc.score > 0) sum.set(key, (sum.get(key) || 0) + sc.score);
      list = [...sum];
    }
    return list.filter(([key, p]) => p > 0 && this.s.users[key]?.team)
      .sort((a, b) => b[1] - a[1]).slice(0, n)
      .map(([key, points]) => ({ ...this.view(key), points }));
  }
  /** The team a newcomer who names none goes to: the one with fewer people (a draw: the one that lost last). */
  smaller() {
    const t = this.s.teams;
    if (t.D.members !== t.A.members) return t.D.members < t.A.members ? "D" : "A";
    const last = this.s.history[this.s.history.length - 1];
    return last ? other(last.winner) : this.rand() < 0.5 ? "D" : "A";
  }

  // ---------- events ----------
  _user(u) {
    const key = userKey(u);
    let x = this.s.users[key];
    if (!x) x = this.s.users[key] = { name: "", uid: "", avatar: "", team: null, army: [], next: 0, fp: 0, pts: 0, gifts: 0 };
    x.name = u?.nickname || x.name || u?.unique_id || "";
    x.uid = u?.unique_id || x.uid;
    x.avatar = u?.avatar_hub || x.avatar || "";
    x.seen = Date.now();
    return [key, x];
  }
  /** Someone who has a character already (a like, a share or a follow never makes a new entry: a long live would
   *  fill up with people who only pressed the heart). */
  _known(u) {
    const key = userKey(u), x = this.s.users[key];
    if (!x) return null;
    x.seen = Date.now();
    return [key, x];
  }
  /**
   * The viewer said something (a comment, a right answer, an item). If their Dân was resting since the end of the
   * last match, it is back in play ("back"). Also notes when they last spoke, for the grace at the end of a match.
   */
  _spoke(key, u, out) {
    u.saidIn = this._matchId(); u.saidAt = this.s.match.elapsed;
    if (!u.rest) return;
    const was = this._active(u);
    u.rest = false;
    if (!u.team) return;
    if (!was) this.s.teams[u.team].members++;
    out.push({ type: "back", ...this._who(key, u) });
  }
  /**
   * The end of a match (the user, 10/11/2026: "bình luận lại sau mỗi trận là dân"): a character of a comment that
   * is still a Dân rests until its owner comments again. One that earned a rank with right answers comes out by
   * itself in the next match, and so do the characters that came from items. Who spoke in the last REST_GRACE_MS of
   * the match is plainly here: they need not speak again. Returns how many rest.
   */
  _restDan() {
    const id = this._matchId(), now = this.s.match.elapsed;
    let n = 0;
    for (const u of Object.values(this.s.users)) {
      if (!u.team || u.rest) continue;
      if (!(u.army || []).some((x) => isFree(x) && x.tier === 0)) continue;
      if (u.saidIn === id && now - (u.saidAt || 0) < REST_GRACE_MS) continue;
      u.rest = true; n++;
    }
    if (n) this._count();
    return n;
  }
  _who(key, u) { return { key, team: u.team, name: u.name, uid: u.uid, avatar: u.avatar, tier: this.top(u), units: u.army?.length || 0 }; }

  /** Points for the ranking of the match and of the series. */
  _rank(key, pts) {
    if (!(pts > 0)) return;
    const m = this.s.match, se = this.s.series;
    m.people[key] = (m.people[key] || 0) + pts;
    se.people[key] = (se.people[key] || 0) + pts;
  }
  /** Points for the ranking; with `rank` (a right quiz answer) they also move the viewer's first character up, one
   *  rank every STEP points, as far as FREE_MAX. At that rank, the answer gives life back instead. */
  _add(key, u, pts, why, out, rank = false) {
    if (!(pts > 0)) return;
    u.pts = (u.pts || 0) + pts;
    if (u.team) this._rank(key, pts);
    out.push({ type: "points", ...this._who(key, u), delta: pts, why });
    if (!rank) return;
    u.fp = (u.fp || 0) + pts;
    this._earn(key, u, out, why);
  }
  _earn(key, u, out, why = null) {
    if (!u.team) return;                 // no character yet: the answer counts when they have one
    while ((u.fp || 0) >= STEP) {
      u.fp -= STEP;
      const free = u.army.filter(isFree), b = free.find((x) => x.tier < FREE_MAX);
      if (b) {
        const from = b.tier;
        b.tier = from + 1; delete b.hp;
        out.push({ type: "promote", ...this._who(key, u), unit: b.n, tier: b.tier, from, free: true, why });
      } else if (free.length < FREE_UNITS && u.army.length < MAX_UNITS) {
        const nb = { n: u.next++, tier: 0, free: true };       // one more Dân, out with the next wave
        u.army.push(nb);
        out.push({ type: "recruit", ...this._who(key, u), unit: nb.n, why });
      } else out.push({ type: "heal", ...this._who(key, u), why, part: HEAL.quiz });
    }
  }

  _enter(key, u, team, out, auto = false) {
    const from = u.team, T = this.s.teams;
    u.team = team;
    u.nextTeam = null;
    if (from && T[from]) T[from].members = Math.max(0, T[from].members - 1);
    T[team].members++;
    if (!u.army?.length) { u.army = [{ n: 0, tier: 0 }]; u.next = 1; }      // the character of their comment
    out.push({ type: from ? "switched" : "join", ...this._who(key, u), from, auto });
    if (!u.counted) { u.counted = true; this._add(key, u, this.pts.comment, "comment", out); }
    this._earn(key, u, out, "quiz");             // a right answer given before they had a character counts now
  }

  /** A comment event of the hub. A viewer's first comment gives them a character for the whole series. */
  comment(ev) {
    const out = [];
    const [key, u] = this._user(ev.user);
    if (String(ev.text || "").trim()) this._spoke(key, u, out);
    const c = readCommand(ev.text);
    const back = () => { if (u.team) out.push({ type: "cheer", ...this._who(key, u) }); };
    if (!c) {
      if (!u.team && String(ev.text || "").trim()) this._enter(key, u, this.smaller(), out, true);
      else back();
      return out;
    }
    if (c.kind === "join") {
      if (!u.team) this._enter(key, u, c.team, out);
      else if (u.team === c.team) { if (u.nextTeam) { u.nextTeam = null; out.push({ type: "stay", ...this._who(key, u) }); } back(); }
      else { out.push({ type: "locked", ...this._who(key, u), wanted: c.team }); back(); }
      return out;
    }
    // "đổi": to the other team (or the named one) at the next wave; with no team yet, "đổi thủ" simply joins
    if (!u.team) { this._enter(key, u, c.team || this.smaller(), out, !c.team); return out; }
    const to = c.team || other(u.nextTeam || u.team);
    if (to === u.team) { u.nextTeam = null; out.push({ type: "stay", ...this._who(key, u) }); }
    else if (u.movedIn === this._matchId()) { out.push({ type: "locked", ...this._who(key, u), wanted: to, once: true }); }
    else if (u.nextTeam !== to) { u.nextTeam = to; out.push({ type: "switch_planned", ...this._who(key, u), to }); }
    back();
    return out;
  }
  _matchId() { return `${this.s.series.n}:${this.s.match.n}`; }

  /** A wave of fighters leaves: the planned moves ("đổi") are made (once per match for each viewer). */
  wave() {
    const out = [];
    for (const [key, u] of Object.entries(this.s.users)) {
      if (!u.team || !u.nextTeam || u.nextTeam === u.team) { u.nextTeam = null; continue; }
      const from = u.team;
      u.team = u.nextTeam; u.nextTeam = null; u.movedIn = this._matchId();
      out.push({ type: "switched", ...this._who(key, u), from, auto: false });
    }
    if (out.length) this._count();
    return out;
  }

  /**
   * A gift event of the hub: coins to add now (a combo comes in several parts). Each item adds ONE MORE CHARACTER of
   * its rank for the giver, on the field at once ("spawn"); an item whose value is not one of the six is dealt into
   * several (giftSplit). A viewer who already owns MAX_UNITS: the item gives one of theirs its whole life back
   * instead ("heal").
   */
  gift(ev) {
    const out = [];
    const [key, u] = this._user(ev.user);
    const coins = Math.max(0, Number(ev.coins) || 0);
    if (!coins) return out;
    const count = Math.max(1, Number(ev.count) || 1);
    const each = Number(ev.gift?.diamonds) || Math.round(coins / count) || 1;
    this._spoke(key, u, out);
    if (!u.team) this._enter(key, u, this.smaller(), out, true);    // an item is a comment too: they are in
    u.gifts = (u.gifts || 0) + coins;
    this._rank(key, coins * this.pts.coin);
    const n = Math.max(1, Math.min(MAX_UNITS, Math.round(coins / each))), parts = giftSplit(each);
    const made = [], units = [];        // units: [[rank, how many]] added now, the highest rank first
    let healed = false;
    for (let i = 0; i < n; i++) for (const rank of parts) {
      if (u.army.length < MAX_UNITS) {
        const b = { n: u.next++, tier: rank };
        u.army.push(b);
        made.push({ type: "spawn", unit: b.n, tier: rank, coins: each });
        const x = units.find((p) => p[0] === rank);
        if (x) x[1]++; else units.push([rank, 1]);
      } else if (!healed) { healed = true; made.push({ type: "heal", why: "gift", part: 1 }); }
    }
    units.sort((a, b) => b[0] - a[0]);
    const who = this._who(key, u), added = made.length - (healed ? 1 : 0), rank = units[0]?.[0] || giftTier(each)?.rank || 1;
    // what the whole gift (a combo comes in parts) added, for the thanks: how many, the highest rank and how many of it
    const c = u.combo || (u.combo = { added: 0, rank: 0, same: 0 });
    c.added += added;
    if (units.length) { if (units[0][0] > c.rank) { c.rank = units[0][0]; c.same = units[0][1]; } else if (units[0][0] === c.rank) c.same += units[0][1]; }
    out.push({ type: "giving", ...who, gift: ev.gift?.name || "", count: n, coins, each, points: coins * this.pts.coin, rank, added, units });
    for (const e of made) out.push({ ...who, ...e });
    return out;
  }

  /** A gift_done event: the gift or combo is over (the giver is thanked once). */
  giftDone(ev) {
    const [key, u] = this._user(ev.user);
    const count = Math.max(1, Number(ev.count) || 1), coins = Number(ev.coins) || 0;
    const each = Number(ev.gift?.diamonds) || Math.round(coins / count) || 0;
    const c = u.combo || { added: 0, rank: 0, same: 0 };      // none added: they are at the limit (life back instead)
    delete u.combo;
    return [{ type: "thanks", ...this._who(key, u), gift: ev.gift?.name || "", count, coins, each, rank: c.rank || giftTier(each)?.rank || 0, added: c.added, same: c.same }];
  }

  /** One character of a viewer fell (n: which one). The one of their comment (0) comes back as a Dân at the next wave;
   *  one that came from an item is gone (the user, 10/11/2026). */
  died(key, n = 0) {
    const u = this.s.users[key];
    const i = u?.team ? (u.army || []).findIndex((x) => x.n === n) : -1;
    if (i < 0) return [];
    const b = u.army[i], from = b.tier;
    if (!isFree(b)) { u.army.splice(i, 1); if (u.rest) this._count(); return [{ type: "lost", ...this._who(key, u), unit: n, from }]; }
    delete b.hp;                         // it comes back whole
    if (!(from > 0)) return [{ type: "fell", ...this._who(key, u), unit: n }];
    b.tier = 0;
    if (u.rest) this._count();           // a resting viewer: their Dân stay out, so they may have nobody in play now
    return [{ type: "demoted", ...this._who(key, u), unit: n, from }];
  }

  /**
   * In the match of fury, what would give strength back to the viewer's own character goes to the giant of their
   * team instead ("feed"). From likes: GIANT.perViewer for every GIANT.likes hearts of a viewer, once every GIANT.windowMs.
   * Returns false when this is not the match of fury (the caller does what it always does).
   */
  _feed(key, u, hp, why, out, capped = false) {
    if (this.s.match.kind !== "rage" || !u.team) return false;
    let give = hp;
    if (capped) {
      const w = Math.floor(Date.now() / GIANT.windowMs);
      if (u.gWin !== w) { u.gWin = w; u.gSum = 0; }
      give = Math.max(0, Math.min(hp, GIANT.perViewer - u.gSum));
      u.gSum += give;
    }
    if (give > 0) out.push({ type: "feed", ...this._who(key, u), why, hp: give });
    return true;
  }
  /** A test button: the match that is on becomes the match of fury (lead: the team that is ahead in the series). */
  startRage(lead = "A") {
    const se = this.s.series, need = Math.floor(this.seriesMatches / 2) + 1;
    se.lead = lead === "D" ? "D" : "A";
    se.rage = null;
    se.wins[se.lead] = Math.max(se.wins[se.lead], need);
    se.wins[other(se.lead)] = Math.min(se.wins[other(se.lead)], need - 1);
    this.s.match = newMatch(this.s.match.n, "rage");
    this.lastTick = null;
  }

  /** A like event (likes come in batches): a little life back for one of the viewer's characters, and they hurry. */
  like(ev) {
    const out = [], k = this._known(ev.user);
    if (!k) return out;
    const [key, u] = k;
    const n = Math.max(0, Number(ev.count) || 0);
    u.likes = (u.likes || 0) + n;
    // counted as they come, at the rate of now (worked out from all their likes since the start, a change of
    // "N tim = 1 điểm" in the control window gave every viewer a lump of points at their next like, or none for long)
    u.likeRest = (u.likeRest || 0) + n;
    const earned = Math.floor(u.likeRest / this.pts.likes);
    if (earned > 0) { u.likeRest -= earned * this.pts.likes; u.likePts = (u.likePts || 0) + earned; this._add(key, u, earned, "like", out); }
    if (u.team) {
      out.push({ type: "hurry", key, team: u.team });
      // their hearts are counted; when the count is reached, it gives (once for a batch), the rest waits
      u.likeBank = Math.min(HEAL.likeBank, (u.likeBank || 0) + n);
      if (this.s.match.kind === "rage") {
        if (u.likeBank >= GIANT.likes) {
          const before = out.length;
          this._feed(key, u, GIANT.perViewer, "like", out, true);
          if (out.length > before) u.likeBank -= GIANT.likes;     // given: those hearts are spent (not while this viewer's five seconds are full)
        }
      } else if (u.likeBank >= HEAL.likes) { u.likeBank -= HEAL.likes; out.push({ type: "heal", ...this._who(key, u), why: "like", hp: HEAL.like }); }
    }
    return out;
  }

  share(ev) {
    const out = [], k = this._known(ev.user);
    if (!k) return out;
    const [key, u] = k;
    // counted at most once a minute per viewer (a share button pressed again and again is not a way to win)
    const now = Date.now();
    if (!u.sharedAt || now - u.sharedAt >= 60_000) {
      u.sharedAt = now;
      this._add(key, u, this.pts.share, "share", out);
      if (u.team && !this._feed(key, u, GIANT.share, "share", out)) out.push({ type: "heal", ...this._who(key, u), why: "share", hp: HEAL.share });
    }
    out.push({ type: "shared", ...this._who(key, u) });
    return out;
  }

  /** A follow: once per viewer, ever (the list of followers outlives "Phiên mới"). */
  follow(ev) {
    const out = [], followers = (this.s.followers ||= {}), k = this._known(ev.user);
    if (!k) {                          // someone with no character: remembered as a follower, thanked, nothing kept
      const id = userKey(ev.user, "");
      if (!id || followers[id]) return out;
      followers[id] = 1;
      return [{ type: "followed", key: id, team: null, name: ev.user?.nickname || "", uid: ev.user?.unique_id || "", tier: 0 }];
    }
    const [key, u] = k;
    if (u.followed || followers[key]) return out;
    u.followed = true;
    followers[key] = 1;
    this._add(key, u, this.pts.follow, "follow", out);
    if (u.team && !this._feed(key, u, GIANT.follow, "follow", out)) out.push({ type: "heal", ...this._who(key, u), why: "follow", hp: HEAL.follow });
    out.push({ type: "followed", ...this._who(key, u) });
    return out;
  }

  /** A viewer comes in the room: nothing to do (characters stay for the series whether their viewer is here or not). */
  seen(ev) { this._known(ev.user); return []; }

  quizRight(ev) {
    const out = [];
    const [key, u] = this._user(ev.user);
    this._spoke(key, u, out);
    this._add(key, u, this.pts.quiz, "quiz", out, true);
    out.push({ type: "quiz_right", ...this._who(key, u) });
    return out;
  }

  // ---------- time ----------
  /** Call often. Says the countdown marks; when the time is up: { type: "time_up" } (the page ends the match). */
  tick(now = Date.now()) {
    const out = [];
    if (this.lastTick === null || this.s.paused) { this.lastTick = now; return out; }
    const m = this.s.match;
    const leftBefore = this.timeLeftMs();
    m.elapsed += Math.max(0, Math.min(5000, now - this.lastTick));   // a frozen page does not burn a match
    this.lastTick = now;
    const left = this.timeLeftMs();
    for (const s of COUNTDOWN_S) if (leftBefore > s * 1000 && left <= s * 1000 && !m.said.includes(s)) {
      m.said.push(s);
      out.push({ type: "countdown", seconds: s, n: m.n });
    }
    if (left <= 0 && !m.over) { m.over = true; out.push({ type: "time_up", n: m.n }); }
    return out;
  }

  /**
   * The match is over: "D" held until the end of the time, or "A" brought the castle down. `awards`: the best of the
   * match on the field; `scores`: what each viewer did there (battle.scores()). The result carries the ranking of the
   * two teams. After a match every Dân rests until its owner comments again (_restDan); the soldiers keep what
   * they had left of their strength (`hp`). After the last match of a
   * series EVERYONE IS FORGOTTEN: a new series starts with whoever comments again.
   */
  endMatch(winner, reason = "time", awards = {}, hallLeft = 0, scores = null, hp = null) {
    const m = this.s.match, se = this.s.series;
    // what each viewer did on the field joins what they brought (items, right answers)
    if (scores) for (const [key, sc] of scores) if (sc.score > 0 && this.s.users[key]?.team) this._rank(key, sc.score);
    const board = { D: [], A: [] }, size = { D: this.members("D"), A: this.members("A") };
    for (const p of this.topPeople(600, m.people)) if (board[p.team] && board[p.team].length < 5) board[p.team].push({ ...p, kills: scores?.get(p.key)?.kills || 0 });
    se.wins[winner] = (se.wins[winner] || 0) + 1;
    const loser = other(winner);
    this.s.boost[loser] = Math.min(1.09, Math.round(((this.s.boost[loser] || 1) + 0.03) * 100) / 100);   // a little help to the team that lost
    this.s.boost[winner] = 1;
    this.s.history.push({ n: m.n, winner, reason });
    if (this.s.history.length > 200) this.s.history.shift();
    const people = this.topPeople(5, m.people);
    const best = {};
    for (const [kind, a] of Object.entries(awards || {})) {
      const u = a && this.s.users[a.key];
      if (u && AWARDS[kind]) best[kind] = { ...this.view(a.key, u), value: a.value, kind };
    }
    // how the series goes on
    const need = Math.floor(this.seriesMatches / 2) + 1;
    let final = false, nextKind = null, levelled = false;
    if (m.kind === "rage") {
      se.rage = "done";
      if (winner === se.lead) final = true;                      // the team ahead won the match of fury: over at once
      else { se.wins[winner] = se.wins[se.lead]; levelled = true; }     // level again: on with an ordinary match
    } else if (se.rage === "done") final = true;                     // the match after the level: its winner is ahead for good
    else if (this.seriesMatches >= 3 && !se.rage && Math.max(se.wins.D, se.wins.A) >= need) {
      se.lead = se.wins.D > se.wins.A ? "D" : "A";               // the other team cannot catch up any more: its last chance
      nextKind = "rage";
    } else if (m.n >= this.seriesMatches) final = true;
    const out = { type: "match_end", n: m.n, kind: m.kind || null, winner, reason, hallLeft, people, board, size, awards: best, wins: { ...se.wins }, final, series: null,
      nextKind, levelled, lead: se.lead || null };
    if (final) {
      const w = se.wins.D === se.wins.A ? null : se.wins.D > se.wins.A ? "D" : "A";
      out.series = { n: se.n, matches: m.n, wins: { ...se.wins }, winner: w, top: this.topPeople(3, se.people) };
      this._newSeries(se.n + 1);
    }
    // the strength each character has left goes with it into the next match (the user, 11/11/2026: "sau mỗi trận
    // reset dân nhưng máu của mọi lính giữ nguyên"). hp: Map of character key -> what is left (0..1), from the field
    for (const [key, u] of Object.entries(this.s.users)) for (const b of u.army || []) {
      const r = hp?.get(unitKey(key, b.n));
      if (r > 0 && r < 0.995) b.hp = Math.round(r * 1000) / 1000; else delete b.hp;
    }
    if (!final) out.resting = this._restDan();
    this.s.match = newMatch(final ? 1 : m.n + 1, final ? null : nextKind);
    out.next = this.s.match.n;
    out.moved = this.wave();
    return out;
  }
  /** A new series: nobody is in it yet. Everyone comments again to get a character (so a long live stays light: the
   *  game only ever holds the people of one series). The followers are remembered apart. */
  _newSeries(n) {
    this.s.series = newSeries(n);
    this.s.boost = { D: 1, A: 1 };
    this.s.users = {};
    this._count();
    const f = Object.keys(this.s.followers || {});
    if (f.length > 60_000) for (const k of f.slice(0, f.length - 50_000)) delete this.s.followers[k];
  }

  // ---------- buttons ----------
  /** "Loạt mới": a new series from match 1, as after a last match: everyone comments again. */
  resetSeries() {
    this._newSeries((this.s.series?.n || 0) + 1);
    this.s.match = newMatch(1);
    this.s.history = [];
    this.s.battle = null;
    this.lastTick = null;
  }

  /** "Phiên mới": everything back to zero (the hub position and the followers are kept). */
  newSession() {
    const { hub, matchMs, followers = {} } = this.s;
    this.s = Object.assign(newState(matchMs), { hub, followers });
    this.lastTick = null;
  }
}

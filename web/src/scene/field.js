// The picture of the field (canvas 2D): the square citadel with its 4 gates, the castle in the middle, the 4 camps
// of the attackers around. Characters, buildings, trees and effects come from the pack "Tiny Swords" (assets.js);
// the ground, the walls and the gates are drawn here in the same colours.
// It only shows what battle.js knows; what happens there comes in as events (onEvents) and becomes arrows, dust,
// flying pieces and shakes. The camera has 6 places only (the whole field, the 4 gates, the castle), plus following
// one character: it glides from one to the other, so the eye is never thrown around.
import { H, WALL_T, CAMP_D, FACES, facePos } from "../game/battle.js";
import { TIERS } from "../game/rules.js";
import { K, SHEETS, LOOK, FX, GIANT, img, color, assetsReady } from "./assets.js";

export const VIEW_W = 420;        // field units across the screen at the widest
const ANCHOR_Y = 0.47;            // where the camera's centre sits on the screen (the panels take the top and the bottom)
const MAX_DRAWN = 170;
const DIR = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const GATE_W = 17;                // half the width of a gate
export const TEAM_COL = { D: { main: "#3fa7ff", dark: "#1c4f8f", light: "#a9d8ff" }, A: { main: "#ff5a4d", dark: "#8f2118", light: "#ffc0b8" } };
/** The colour of a rank: the one ring around the picture in the name plate of a character that came from an item
 *  (and the light of its arrival). Light colours, so each reads on the blue plate and on the red one: Dân, Lính kiếm
 *  (peach), Lính giáo (lime), Cung thủ (aqua), Thầy thuốc (lavender), Đội trưởng and Tướng (gold; the general also
 *  wears a small crown). */
export const RANK_COL = ["#dfe7ee", "#ffc48a", "#c8f57a", "#7df0e4", "#dcc8ff", "#ffd54a", "#ffd54a"];
/** The name plates are filled with the colour of the team, deep enough for white letters: in a crowd one sees at
 *  once who is on which side (the user, 11/11/2026: with plates edged in the colour of the rank, "rất khó biết là bên
 *  nào với bên nào khi đông"). */
const PLATE = { D: "#2467c9", A: "#cf3b2c" };
const STONE = { top: "#8fc0bd", light: "#77a9ab", mid: "#5c8f96", dark: "#3d6674", line: "#243447" };
const WOOD = ["#8a5a2b", "#6b4423", "#c79a5e"];
// what stands in the yard of the citadel, in its four corners (the roads to the gates stay free): [picture, x, y, ax, ay, scale]
const YARD = [
  ["blue/house1", -66, -52, 64, 172, 0.8], ["old/house_blue", -84, -30, 64, 176, 0.72], ["blue/archery", 70, -46, 96, 244, 0.72],
  ["blue/monastery", -72, 86, 96, 306, 0.62], ["blue/house2", 62, 84, 64, 172, 0.8], ["blue/house3", 86, 62, 64, 172, 0.74], ["old/deco18", 84, -22, 96, 150, 0.5],
];
// the 4 camps of the attackers are not the same: [picture, dx, dy, ax, ay, scale]
const CAMPS = {
  N: [["red/house1", 26, 14, 64, 172, 0.85], ["red/barracks", -8, 10, 96, 244, 0.85]],
  E: [["old/tent", 24, 14, 64, 176, 0.8], ["red/archery", -8, 10, 96, 244, 0.82]],
  S: [["red/tower", 30, 12, 64, 232, 0.7], ["red/barracks", -8, 10, 96, 244, 0.85], ["old/tent", -40, 16, 64, 176, 0.7]],
  W: [["red/house2", 26, 14, 64, 172, 0.85], ["red/monastery", -8, 12, 96, 306, 0.7]],
};

export class Field {
  constructor(canvas, battle) {
    this.cv = canvas;
    this.ctx = canvas.getContext("2d");
    this.b = battle;
    this.cam = { x: 0, y: 0, z: 1 };
    this.to = { x: 0, y: 0, z: 1 };
    this.follow = null;            // a viewer key the camera follows
    this.focused = null;           // "N" | "E" | "S" | "W" | "C" | "u:key" | null (the whole field)
    this.time = 0;
    this.shots = [];
    this.puffs = [];
    this.texts = [];
    this.rings = [];
    this.parts = [];               // pieces that fly: chunks of wall, sparks, little stars
    this.flashes = [];             // the white of a blast
    this.pillars = [];             // the light on someone who just became another kind
    this.anims = [];               // effects of the pack: { fx, x, y, t0, scale }
    this.ghosts = [];              // the fallen, fading
    this.flash = { N: -9, E: -9, S: -9, W: -9, C: -9 };
    this.shakeAt = -9; this.shakeAmp = 0;
    this.screen = { t0: -9, a: 0 };
    this.waveAt = -9;
    this.imgs = new Map();
    this.tokens = new Map();       // viewer key -> a drawn picture for those who have none
    this.fits = new Map();         // a name -> the same, cut to the width of a plate
    this.acting = new Map();       // viewer key -> { id, until }: the one of theirs the camera follows for now (act())
    this.spots = new Map();        // viewer key -> until when their name shows on the whole field
    this.ended = null;             // { winner, at }
    this.ground = null;
    this.deco = this._deco();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  resize() {
    const r = this.cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const w = Math.max(2, Math.round(r.width * dpr)), h = Math.max(2, Math.round(r.height * dpr));
    if (this.cv.width !== w || this.cv.height !== h) { this.cv.width = w; this.cv.height = h; }
    this.W = w; this.Hpx = h;
  }

  // ---------- the camera (driven by director.js) ----------
  /** id: a gate ("N", "E", "S", "W"), the castle ("C") or a character ("u:<viewer key>"); shot: "close" | "medium". */
  focus(id, shot = "medium") {
    this.focused = id;
    this.follow = null;
    if (id === "C") { this.to = { x: 0, y: -6, z: shot === "close" ? 2.4 : 1.8 }; return; }
    if (id === "G") { this.to = { x: 0, y: H + 6, z: shot === "close" ? 1.9 : 1.5 }; return; }       // the two giants, before the south gate
    if (String(id).startsWith("u:")) { this.follow = id.slice(2); this.to.z = shot === "close" ? 2.5 : 2; return; }
    if (!DIR[id]) return this.overview();
    const [x, y] = facePos(id, 0, shot === "close" ? 14 : 22);
    const dy = id === "N" ? 10 : id === "S" ? (shot === "close" ? -6 : -20) : 0;
    this.to = { x, y: y + dy, z: shot === "close" ? 2.2 : 1.7 };
  }
  /** The whole field. In the match of fury everything happens before the south gate: the picture sits a little
   *  lower on the field, so the two giants stand clear of the panels at the bottom. */
  overview() { this.focused = null; this.follow = null; this.to = { x: 0, y: this.b.rage ? 36 : 0, z: 1 }; }
  /** A viewer's character: on the field, or waiting for the gate. The one that just did something (act()) for as
   *  long as that lasts, else the one that stands for them (their highest rank). */
  who(key) {
    const a = this.acting.get(key);
    if (a) {
      if (a.until > this.time) { const u = this.b.units.find((x) => x.id === a.id); if (u) return u; }
      this.acting.delete(key);
    }
    return this.b.lead(key);
  }
  /** One of a viewer's characters just did something worth showing (a run of enemies brought down): for `ms` the
   *  camera that follows this viewer follows THAT one. A viewer can have thirty characters; the camera went to their
   *  highest rank, which was often standing somewhere else, and "HẠ 3!" was written over someone who was fighting
   *  nobody (the user, 11/11/2026: "có đánh ai đâu mà hiện hạ"). */
  act(key, id, ms = 6000) { if (key && id) this.acting.set(key, { id, until: this.time + ms / 1000 }); }
  /** Where a point of the field is on the screen: [across, down, zoom], the first two as parts of the stage (0..1). */
  screenOf(x, y) {
    const s = (this.W / VIEW_W) * this.cam.z;
    return [0.5 + (x - this.cam.x) * s / this.W, ANCHOR_Y + (y - this.cam.y) * s / this.Hpx, this.cam.z];
  }
  /** The back of each giant (the side away from the other one, at the height of its shoulders), on the screen: what
   *  the viewers of a team do in the match of fury floats up from there. null when there are no giants. */
  giantBacks() {
    const g = this.b.giants;
    if (!g) return null;
    const out = {};
    for (const tm of ["D", "A"]) {
      const me = g[tm], side = me.x <= g[tm === "D" ? "A" : "D"].x ? -1 : 1;
      const [x, y, z] = this.screenOf(me.x + side * 24, me.y - 22);
      out[tm] = { x, y, z, side, up: me.hp > 0 };
    }
    return out;
  }
  whereIs(key) { return this.who(key) ? `u:${key}` : null; }
  /** Their name shows for a while even on the whole field (they just gave, or just became another kind). */
  spot(key, ms = 6000) { this.spots.set(key, this.time + ms / 1000); }
  shake(amp = 3) { this.shakeAmp = Math.max(amp, this.time - this.shakeAt < 0.3 ? this.shakeAmp : 0); this.shakeAt = this.time; }
  /** The whole screen goes white for a blink (a gate down, the castle down, a leader on the field). */
  flashScreen(a = 0.4) { this.screen = { t0: this.time, a }; }
  finish(winner) { this.ended = winner ? { winner, at: this.time } : null; if (!winner) { this.ghosts = []; this.anims = []; this.acting.clear(); } }

  // ---------- what happened on the field ----------
  onEvents(list) {
    const t = this.time, b = this.b;
    for (const e of list) {
      switch (e.type) {
        case "spawn": this.anim("dust2", e.x, e.y + 2, 1, e.delay || 0); break;
        case "wave":
          this.waveAt = t;
          for (const f of FACES) { const [x, y] = facePos(f, 0, CAMP_D); this.rings.push({ x, y, t0: t, dur: 0.9, r: 44, col: TEAM_COL.A.light }); }
          this.rings.push({ x: 0, y: 10, t0: t, dur: 0.9, r: 60, col: TEAM_COL.D.light });
          break;
        case "shot": if (this.shots.length < 260) this.shots.push({ ...e, t0: t, dur: 0.22 + Math.hypot(e.x2 - e.x1, e.y2 - e.y1) / 300 }); break;
        case "swing":
          if (e.big) { this.slash(e.x, e.y - 6, TEAM_COL[e.team].light); if (Math.random() < 0.4) this.shake(1.2); }
          else if (!e.gate && !e.hall && Math.random() < 0.35) this.sparks(e.x + (Math.random() - 0.5) * 6, e.y - 7, 2);
          break;
        case "hit": {
          this.flash[e.face] = t;
          const [x, y] = facePos(e.face, (Math.random() - 0.5) * 0.24, 2);
          if (e.kind === "press") { if (Math.random() < 0.12) this.puff(x, y, 2.4, "#e9dcc0", 0.35); break; }
          if (Math.random() < 0.5) this.puff(x, y, 2.6, "#e9dcc0", 0.35);
          if (Math.random() < 0.3) this.debris(x, y, 2, WOOD, 0.5);
          break;
        }
        case "mend": if (Math.random() < 0.5) { const [x, y] = facePos(e.face, (Math.random() - 0.5) * 0.24, -2); this.stars(x, y - 3, 1, "#b8ffcf"); } break;
        case "gate_half": { const [x, y] = facePos(e.face, 0, 0); this.debris(x, y, 10, WOOD, 1); this.anim("dust2", x, y + 4, 2.2); this.shake(2.4); break; }
        case "breach": {
          const [x, y] = facePos(e.face, 0, 0);
          this.anim("explosion2", x, y + 8, 1.5); this.anim("explosion", x - 10, y + 4, 1, 0.12); this.anim("explosion", x + 12, y + 6, 1, 0.22);
          this.debris(x, y, 36, [...WOOD, STONE.mid], 1.6);
          this.flashes.push({ x, y, r: 50, t0: t, dur: 0.3, col: "255,244,214" });
          this.rings.push({ x, y, t0: t, dur: 0.7, r: 74, col: "#fff1c9" });
          this.flashScreen(0.35); this.shake(7);
          break;
        }
        case "rebuilt": {
          const [x, y] = facePos(e.face, 0, 0);
          this.rings.push({ x, y, t0: t, dur: 0.9, r: 46, col: "#8dffb0" }, { x, y, t0: t + 0.18, dur: 0.9, r: 62, col: "#8dffb0" });
          this.stars(x, y - 4, 14, "#b8ffcf");
          break;
        }
        case "hall_hit":
          this.flash.C = t;
          if (e.kind !== "press" && Math.random() < 0.3) this.debris((Math.random() - 0.5) * 50, -6, 2, [STONE.mid, STONE.light, "#c79a5e"], 0.7);
          if (Math.random() < 0.05) this.anim("explosion", (Math.random() - 0.5) * 50, 8 - Math.random() * 30, 0.7);
          break;
        case "hall_mark": this.anim("explosion2", -16, 6, 1.2); this.anim("explosion2", 20, -4, 1.1, 0.2); this.debris(0, -10, 22, [STONE.mid, STONE.light, "#c79a5e", STONE.dark], 1.3); this.shake(5); break;
        case "hall_fell":
          for (let i = 0; i < 9; i++) this.anim(i % 2 ? "explosion" : "explosion2", (Math.random() - 0.5) * 80, 10 - Math.random() * 50, 1.1 + Math.random() * 0.6, i * 0.16);
          this.debris(0, -14, 50, [STONE.mid, STONE.light, "#c79a5e", STONE.dark, "#2f7fd0"], 1.9);
          this.flashes.push({ x: 0, y: -10, r: 80, t0: t, dur: 0.45, col: "255,230,190" });
          this.flashScreen(0.6); this.shake(10);
          break;
        case "heal": this.anim("heal", e.x, e.y + 2, 0.9); if (e.amt >= 5) this.text(e.x, e.y - 24, `+${Math.round(e.amt)}`, "#aef5c2", 0.9); break;
        case "died":
          this.ghosts.push({ x: e.x, y: e.y, kind: e.kind, team: e.team, t0: t, dur: 0.45 });
          this.anim("dead", e.x, e.y + 3, e.tier >= 5 ? 1.6 : 1);
          if (e.tier >= 5) this.anim("dust2", e.x, e.y + 2, 2.4);
          if (e.tier >= 5) {
            this.anim("explosion", e.x, e.y + 4, 1.1); this.rings.push({ x: e.x, y: e.y, t0: t, dur: 0.8, r: 50, col: TEAM_COL[e.team].light });
            this.shake(4); this.text(e.x, e.y - 34, `${TIERS[e.tier].name.toUpperCase()} NGÃ!`, "#ffb4a8", 1.4);
          } else if (e.key) this.text(e.x, e.y - 26, "ngã!", "#ffd0c8", 0.85);
          break;
        case "promote": this.promoteFx(e); break;
        // ---- the two giants of the match of fury ----
        case "giant_hit": {
          const hy = e.y - 34 - Math.random() * 22, col = TEAM_COL[e.team].light;
          this.slash(e.x + (Math.random() - 0.5) * 14, hy, col); this.sparks(e.x, hy, e.heavy ? 8 : 4);
          this.rings.push({ x: e.x, y: hy, t0: t, dur: 0.35, r: e.heavy ? 34 : 22, col });
          this.shake(e.heavy ? 3.2 : 1.6);
          break;
        }
        case "giant_fed":
          this.anim("heal", e.x, e.y + 2, 2.8); this.stars(e.x, e.y - 40, 8, "#b8ffcf");
          this.text(e.x, e.y - 66, `+${Math.round(e.amt)}`, "#aef5c2", 1.4);
          break;
        case "giant_mark": {
          const g = b.giants?.[e.team];
          if (!g) break;
          this.anim("explosion2", g.x, g.y - 30, 1.6); this.anim("dust2", g.x, g.y + 4, 4);
          this.debris(g.x, g.y - 40, 16, [TEAM_COL[e.team].main, TEAM_COL[e.team].dark, "#d8d8d8"], 1.4);
          this.text(g.x, g.y - 100, e.mark <= 0.25 ? "SẮP GỤC!" : "CÒN MỘT NỬA!", "#ffb4a8", 1.7);
          this.shake(6);
          break;
        }
        case "giant_fell":
          for (let i = 0; i < 9; i++) this.anim(i % 2 ? "explosion" : "explosion2", e.x + (Math.random() - 0.5) * 60, e.y - Math.random() * 80, 1.2 + Math.random() * 0.8, i * 0.14);
          this.anim("dead", e.x, e.y + 4, 4.5); this.anim("dust2", e.x, e.y + 6, 6);
          this.debris(e.x, e.y - 40, 46, [TEAM_COL[e.team].main, TEAM_COL[e.team].dark, "#d8d8d8", "#8a8a8a"], 2);
          this.flashes.push({ x: e.x, y: e.y - 40, r: 90, t0: t, dur: 0.45, col: "255,236,200" });
          this.text(e.x, e.y - 120, "GỤC RỒI!", "#ffe27a", 2.2);
          this.flashScreen(0.6); this.shake(11);
          break;
        case "boost": this.anim("heal", e.x, e.y + 2, 1.3); this.rings.push({ x: e.x, y: e.y, t0: t, dur: 0.7, r: 30, col: "#8dffb0" }); this.stars(e.x, e.y - 12, 8, "#b8ffcf"); this.text(e.x, e.y - 34, "TIẾP SỨC!", "#aef5c2", 1.2); break;
        // over the one that brought them down (it was written over the viewer's highest rank, wherever that stood)
        case "streak": { const u = b.units.find((x) => x.id === e.id); if (u) { this.text(u.x, (u._bar ?? u.y - 28) - 8, `HẠ ${e.n}!`, "#ffe27a", e.n >= 5 ? 1.5 : 1.15); this.stars(u.x, u.y - 14, 6, "#ffe27a"); } break; }
        default:
      }
    }
  }

  /** Someone became another kind: a column of light on them, rings, stars, the name of the kind in big. */
  promoteFx(e) {
    const col = RANK_COL[e.tier] || "#ffd54a", t = this.time, big = e.tier >= 5;
    this.pillars.push({ uk: e.uk, x: e.x, y: e.y, t0: t, dur: big ? 2.2 : 1.4, col, w: big ? 16 : 9 });
    this.rings.push({ x: e.x, y: e.y, t0: t, dur: 0.7, r: big ? 46 : 26, col }, { x: e.x, y: e.y, t0: t + 0.2, dur: 0.8, r: big ? 70 : 36, col });
    this.stars(e.x, e.y - 14, big ? 22 : 9, col);
    this.text(e.x, e.y - 36, `${TIERS[e.tier].name.toUpperCase()}!`, col, big ? 1.8 : 1.25);
    if (big) { this.anim("dust2", e.x, e.y + 4, 3); this.flashScreen(e.tier >= 6 ? 0.4 : 0.25); this.shake(e.tier >= 6 ? 6 : 3); }
  }
  /** Someone just joined: dust where they stand waiting, and a word so they know where they are. */
  arrive(key) {
    const u = this.who(key);
    if (!u) return;
    this.anim("dust2", u.x, u.y + 2, 1.4);
    this.rings.push({ x: u.x, y: u.y, t0: this.time, dur: 0.7, r: 22, col: TEAM_COL[u.team].light });
    if (u.waiting && this.time - (this.waitTextAt || -9) > 1.2) { this.waitTextAt = this.time; this.text(u.x, u.y - 32, "CHỜ RA TRẬN", "#fff3b0", 0.95); }
  }

  anim(fx, x, y, scale = 1, delay = 0) { if (this.anims.length < 160) this.anims.push({ fx, x, y, scale, t0: this.time + delay }); }
  puff(x, y, r, col, dur = 0.6, delay = 0) { if (this.puffs.length < 260) this.puffs.push({ x, y, r, col, t0: this.time + delay, dur }); }
  part(p) { if (this.parts.length < 520) this.parts.push({ t0: this.time, g: 120, vr: 0, rot: 0, size: 1.6, dur: 0.8, shape: "chunk", ...p }); }
  debris(x, y, n, cols, power = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = (18 + Math.random() * 46) * power;
      this.part({ x: x + (Math.random() - 0.5) * 8, y: y + (Math.random() - 0.5) * 5, vx: Math.cos(a) * sp, vy: -Math.abs(Math.sin(a)) * sp - 18 * power,
        col: cols[i % cols.length], size: 1 + Math.random() * 2, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 16, dur: 0.55 + Math.random() * 0.6 });
    }
  }
  sparks(x, y, n, col = "#fff3c4") {
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, sp = 26 + Math.random() * 40; this.part({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 10, g: 70, col, size: 0.5, dur: 0.2 + Math.random() * 0.22, shape: "spark" }); }
  }
  stars(x, y, n, col) {
    for (let i = 0; i < n; i++) this.part({ x: x + (Math.random() - 0.5) * 14, y: y + (Math.random() - 0.5) * 6, vx: (Math.random() - 0.5) * 16, vy: -14 - Math.random() * 24, g: 8, col, size: 1 + Math.random() * 1.1, rot: Math.random() * 3, vr: (Math.random() - 0.5) * 5, dur: 0.7 + Math.random() * 0.6, shape: "star" });
  }
  slash(x, y, col) { this.part({ x, y, vx: 0, vy: 0, g: 0, rot: Math.random() * 6, size: 9, col, dur: 0.22, shape: "slash" }); }
  text(x, y, s, col, size = 1) { if (s && this.texts.length < 60) this.texts.push({ x: x + (Math.random() - 0.5) * 8, y, s, col, size, t0: this.time, dur: 1.35 }); }

  /** A viewer's picture; while it loads, or when they have none, a round in a colour of their own with their initial. */
  _img(u) {
    if (u.avatar) {
      let m = this.imgs.get(u.avatar);
      if (!m) {
        // past 400 pictures, the hundred not drawn for the longest go (all of them went at once before: every face
        // on the field blinked back to its initial and was asked from the hub again, at each new viewer)
        if (this.imgs.size > 400) {
          const old = [...this.imgs].sort((a, b) => a[1].used - b[1].used).slice(0, 100);
          for (const [k] of old) this.imgs.delete(k);
        }
        m = { img: new Image(), ok: false, used: 0 };
        m.img.onload = () => { m.ok = true; };
        m.img.src = u.avatar;
        this.imgs.set(u.avatar, m);
      }
      m.used = this.time;
      if (m.ok) return m.img;
    }
    let c = this.tokens.get(u.key);
    if (!c) {
      if (this.tokens.size > 600) this.tokens.clear();
      c = document.createElement("canvas"); c.width = c.height = 72;
      const g = c.getContext("2d"), name = String(u.name || "?").trim();
      let h = 0; for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
      const gr = g.createLinearGradient(0, 0, 72, 72);
      gr.addColorStop(0, `hsl(${h % 360} 62% 58%)`); gr.addColorStop(1, `hsl(${(h + 40) % 360} 58% 36%)`);
      g.fillStyle = gr; g.fillRect(0, 0, 72, 72);
      g.fillStyle = "#fff"; g.font = '800 40px "Be Vietnam Pro", "Segoe UI", sans-serif'; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText((name[0] || "?").toUpperCase(), 36, 40);
      this.tokens.set(u.key, c);
    }
    return c;
  }

  // ---------- every frame ----------
  update(dt) {
    this.time += dt;
    const t = this.time;
    if (this.follow) {
      const u = this.who(this.follow);
      if (u) { this.to.x = u.x; this.to.y = u.y - 6; } else { this.follow = null; this.overview(); }
    }
    const k = 1 - Math.exp(-dt * 3.4);
    this.cam.x += (this.to.x - this.cam.x) * k;
    this.cam.y += (this.to.y - this.cam.y) * k;
    this.cam.z += (this.to.z - this.cam.z) * (1 - Math.exp(-dt * 2.6));
    const live = (p) => t - p.t0 < p.dur;
    this.shots = this.shots.filter(live); this.puffs = this.puffs.filter(live); this.texts = this.texts.filter(live);
    this.rings = this.rings.filter(live); this.flashes = this.flashes.filter(live); this.pillars = this.pillars.filter(live);
    this.ghosts = this.ghosts.filter(live);
    // a very big fight: never more of these at once than the eye can take (and the frame can draw)
    for (const [list, max] of [[this.rings, 80], [this.flashes, 40], [this.ghosts, 80], [this.pillars, 30]]) if (list.length > max) list.splice(0, list.length - max);
    for (const p of this.parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.g * dt; p.rot += p.vr * dt; }
    this.parts = this.parts.filter(live);
    this.anims = this.anims.filter((a) => t - a.t0 < FX[a.fx].n / 12);
    for (const [key, until] of this.spots) if (until < t) this.spots.delete(key);
  }

  draw() {
    const ctx = this.ctx, t = this.time, b = this.b, W = this.W, Hp = this.Hpx;
    const s = (W / VIEW_W) * this.cam.z;                     // pixels per field unit
    let sx = 0, sy = 0;
    const sh = t - this.shakeAt;
    if (sh < 0.45) { const a = this.shakeAmp * (1 - sh / 0.45); sx = Math.sin(t * 71) * a; sy = Math.cos(t * 83) * a; }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#9db14a";
    ctx.fillRect(0, 0, W, Hp);
    ctx.setTransform(s, 0, 0, s, W / 2 - (this.cam.x + sx) * s, Hp * ANCHOR_Y - (this.cam.y + sy) * s);
    this.s = s;
    ctx.imageSmoothingEnabled = K * s < 1;                   // shrunk: smooth; enlarged: the sharp pixels of the pack
    ctx.imageSmoothingQuality = "high";
    this._ground(ctx);
    this._wall(ctx, "N", t); this._wall(ctx, "W", t); this._wall(ctx, "E", t);

    // everything that stands on the field, the farthest first
    const list = [];
    const units = b.units.length <= MAX_DRAWN ? b.units : this._pick(b.units);
    for (const u of units) if (u.born <= b.t) list.push({ y: u.y, u });
    const waiting = [];
    for (const q of b.queue.values()) { if (waiting.length < 120) { waiting.push(q); list.push({ y: q.y, u: q }); } }
    for (const d of YARD) list.push({ y: d[2], yard: d });
    for (const g of this.ghosts) list.push({ y: g.y, ghost: g });
    for (const d of this.deco) list.push({ y: d.y, deco: d });
    list.push({ y: 22, hall: true });
    for (const [cx, cy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) list.push({ y: cy * H + 8, tower: [cx * H, cy * H + 8] });
    for (const f of FACES) { const [x, y] = facePos(f, 0, CAMP_D + 16); list.push({ y: y + 10, camp: f, x }); }
    list.push({ y: H + WALL_T / 2 + 0.5, wallS: true });
    if (b.giants) for (const tm of ["D", "A"]) if (b.giants[tm].hp > 0) list.push({ y: b.giants[tm].y, giant: b.giants[tm] });
    list.sort((a, c) => a.y - c.y);
    const zoomed = this.cam.z > 1.35;
    const all = waiting.length ? [...units, ...waiting] : units;
    // the size of what is written over the heads follows the SCREEN, not the field: the same when the camera is close
    this.base = Math.max(4.6, 15 / s * (W / 1080) * 1.5);
    this.plates = this._plates(all, zoomed);
    this.plated = new Set(this.plates.map((p) => p.u));
    for (const d of list) {
      if (d.u) this._unit(ctx, d.u, t, zoomed);
      else if (d.ghost) this._ghost(ctx, d.ghost, t);
      else if (d.deco) this._decoDraw(ctx, d.deco, t);
      else if (d.yard) this._sprite(ctx, d.yard[0], d.yard[1], d.yard[2], d.yard[3], d.yard[4], d.yard[5] || 1);
      else if (d.hall) this._hall(ctx, t);
      else if (d.tower) this._sprite(ctx, "blue/tower", d.tower[0], d.tower[1], 64, 232);
      else if (d.camp) this._camp(ctx, d.camp, t);
      else if (d.wallS) this._wall(ctx, "S", t);
      else if (d.giant) this._giant(ctx, d.giant, t);
    }
    this._bars(ctx, t);
    this._fx(ctx, t);
    this._labels(ctx, t);
    // over everything: the blink of a great blow
    const fl = t - this.screen.t0;
    if (fl < 0.35) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = `rgba(255,248,230,${this.screen.a * (1 - fl / 0.35)})`; ctx.fillRect(0, 0, W, Hp); }
  }

  /** Too many people to draw them all: viewers before the soldiers of the place, the highest ranks first. */
  _pick(units) {
    const score = (u) => (u.key ? 1000 : 0) + u.tier * 100 + (this.follow && u.key === this.follow ? 1e5 : 0) + (this.spots.has(u.key) ? 5000 : 0);
    return [...units].sort((a, c) => score(c) - score(a)).slice(0, MAX_DRAWN);
  }

  /** One picture of the pack, its foot at (x, y). */
  _sprite(ctx, name, x, y, ax, ay, scale = 1, frame = 0, fw = 0, flip = 1) {
    const im = img(name);
    if (!im) return false;
    const w = fw || im.width, k = K * scale;
    if (flip < 0) { ctx.save(); ctx.translate(x, y); ctx.scale(-1, 1); ctx.drawImage(im, frame * w, 0, w, im.height, -ax * k, -ay * k, w * k, im.height * k); ctx.restore(); }
    else ctx.drawImage(im, frame * w, 0, w, im.height, x - ax * k, y - ay * k, w * k, im.height * k);
    return true;
  }

  _unit(ctx, u, t, zoomed) {
    const L = LOOK[u.kind], name = (u.npc && L.npc ? L.npc[u.team] : null) || L[u.team], S = SHEETS[name], b = this.b;
    const scale = L.scale * (u.npc ? 0.9 : 1), tc = TEAM_COL[u.team];
    const lit = !!u.key && u.lead && (this.spots.has(u.key) || u.key === this.follow);
    // under the feet: a leader stands on the colour of their team, someone in the light has a turning ring
    if (L.gold) {
      const rx = u.tier >= 6 ? 15 : 12;
      ctx.globalAlpha = 0.5 + Math.sin(t * 4 + u.id) * 0.12; ctx.fillStyle = tc.main; ctx.beginPath(); ctx.ellipse(u.x, u.y + 0.5, rx, rx * 0.4, 0, 0, 7); ctx.fill();
      ctx.globalAlpha = 1; ctx.strokeStyle = "#ffd54a"; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.ellipse(u.x, u.y + 0.5, rx, rx * 0.4, 0, 0, 7); ctx.stroke();
    }
    if (lit) { ctx.save(); ctx.setLineDash([2.6, 2]); ctx.lineDashOffset = -t * 8; ctx.beginPath(); ctx.ellipse(u.x, u.y + 0.5, 10, 4, 0, 0, 7); ctx.strokeStyle = "#fff3b0"; ctx.lineWidth = 1; ctx.stroke(); ctx.restore(); }
    // the picture: standing, running, or striking (the strike is played once, then they stand)
    let anim = u.act === "run" ? "run" : "idle", frame;
    if (u.act === "attack" || u.act === "heal" || u.act === "work") {
      const fps = u.kind === "monk" ? 14 : 12, since = b.t - u.actAt;
      if (since < S.attack / fps) { anim = "attack"; frame = Math.min(S.attack - 1, Math.floor(since * fps)); }
    }
    if (frame === undefined) frame = Math.floor((t + u.id * 0.37) * 10) % S[anim];
    const hurt = b.t - (u.hitAt ?? -9) < 0.12;
    const src = `${L.gold ? "yellow" : color(u.team)}/${name}_${anim === "attack" && name === "warrior" && u.id % 2 ? "attack2" : anim}`;
    if (hurt) ctx.filter = "brightness(1.9)";
    if (L.gold) { ctx.shadowColor = tc.main; ctx.shadowBlur = 6 * this.s; }
    if (u.waiting) ctx.globalAlpha = 0.92;
    if (!this._sprite(ctx, src, u.x, u.y, S.ax, S.ay, scale, frame, S.fw, u.flip)) {     // the pack is still loading: a dot in the colour of the team
      ctx.fillStyle = TEAM_COL[u.team].main; ctx.beginPath(); ctx.arc(u.x, u.y - 6, 4, 0, 7); ctx.fill();
    }
    if (hurt) ctx.filter = "none";
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    // the top of the head (measured on the sheet), and from there upwards: the strength, the pennant of a leader, then
    // the picture or the name plate
    const top = u.y - S.tall * K * scale - 1;
    const plated = this.plated?.has(u);
    // strength: only when hurt (or a leader). A character with a name plate has it in the plate: not twice
    const bar = !plated && !u.waiting && (u.hp < u.max - 0.5 || u.tier >= 5);
    if (bar) this._life(ctx, u, top);
    // (the leaders had a pennant here: taken away, the plate in the colour of the team says whose they are)
    const above = top - (bar ? 4.2 : 0.6);
    u._bar = top;
    u._top = above - 0.4;
    // a viewer: their picture in a ring over the head (the name plate, when shown, has it instead)
    if (u.key && !this.plated?.has(u)) { const r = this._badgeR(u); this._badge(ctx, u, u.x, u._top - r * 1.17 - 0.6, r); }
    if (u.hurry > b.t) { ctx.fillStyle = "#ff6b8b"; this._heart(ctx, u.x + 7, top + 2 - Math.sin(t * 8) * 1.5, 2.2); }
  }
  /** The strength of a character, as a small bar just over the head. */
  _life(ctx, u, top) {
    const w = u.tier >= 5 ? 16 : 10, r = Math.max(0, u.hp / u.max);
    ctx.fillStyle = "rgba(10,16,24,.8)"; ctx.fillRect(u.x - w / 2 - 0.5, top - 3.6, w + 1, 2.6);
    ctx.fillStyle = r > 0.5 ? "#6fe38d" : r > 0.25 ? "#ffd54a" : "#ff5a4d"; ctx.fillRect(u.x - w / 2, top - 3.1, w * r, 1.6);
  }
  /** A name made to fit a plate no wider than `max` times the size of the plate's letters: written small, and smaller
   *  still when it is long, so that a long name is read whole (the user, 11/11/2026: a long name made the plate too
   *  long; then: "tên hiện bé thôi thì hiện được dài"); only a very long one is cut, with an ellipsis.
   *  Returns [the name, the size of its letters as a part of fs]. ctx.font must be set at fs. Kept for each name. */
  _fit(ctx, name, fs, max) {
    const key = `${max}|${name}`;
    let out = this.fits.get(key);
    if (out !== undefined) return out;
    const BIG = 0.8, SMALL = 0.56;
    const em = (txt) => ctx.measureText(txt).width / fs;
    const w = em(name);
    if (w * BIG <= max) out = [name, BIG];
    else if (w * SMALL <= max) out = [name, max / w];
    else {
      const ch = Array.from(name);
      while (ch.length > 1 && em(ch.join("").trimEnd() + "\u2026") * SMALL > max) ch.pop();
      out = [ch.join("").trimEnd() + "\u2026", SMALL];
    }
    if (this.fits.size > 600) this.fits.clear();
    this.fits.set(key, out);
    return out;
  }
  /** A giant of the match of fury: the hooded goblin with its torch, in the team's colour, several times the size of
   *  a general, with the team's light under the feet and its strength as a bar over the head. */
  _giant(ctx, g, t) {
    const S = GIANT, tc = TEAM_COL[g.team], b = this.b, scale = S.scale;
    const breathe = 1 + Math.sin(t * 2.2 + (g.team === "D" ? 0 : 1.7)) * 0.012;
    ctx.globalAlpha = 0.4; ctx.fillStyle = "#0b1016"; ctx.beginPath(); ctx.ellipse(g.x, g.y + 1.5, 26, 8, 0, 0, 7); ctx.fill();
    ctx.globalAlpha = 0.5 + Math.sin(t * 4) * 0.12; ctx.fillStyle = tc.main; ctx.beginPath(); ctx.ellipse(g.x, g.y + 1, 30, 10, 0, 0, 7); ctx.fill();
    ctx.globalAlpha = 1; ctx.strokeStyle = "#ffd54a"; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.ellipse(g.x, g.y + 1, 30, 10, 0, 0, 7); ctx.stroke();
    let anim = "idle", frame;
    const since = b.t - g.actAt;
    if (g.act === "attack" && since >= 0 && since < S.attack / 10) { anim = "attack"; frame = Math.min(S.attack - 1, Math.floor(since * 10)); }      // the swing to the side: towards the other one
    if (frame === undefined) frame = Math.floor(t * 8 + (g.team === "D" ? 0 : 3)) % S.idle;
    const hurt = b.t - g.hitAt < 0.14;
    if (hurt) ctx.filter = "brightness(1.8)";
    ctx.shadowColor = tc.main; ctx.shadowBlur = 9 * this.s;
    if (!this._sprite(ctx, `old/giant_${color(g.team)}_${anim}`, g.x, g.y, S.ax, S.ay, scale * breathe, frame, S.fw, g.flip)) {
      ctx.fillStyle = tc.main; ctx.beginPath(); ctx.arc(g.x, g.y - 30, 22, 0, 7); ctx.fill();
    }
    if (hurt) ctx.filter = "none";
    ctx.shadowBlur = 0;
    // its strength, over the head
    const top = g.y - S.tall * scale - 12, w = 48, r = Math.max(0, g.hp / g.max);
    ctx.fillStyle = "rgba(10,16,24,.85)"; ctx.fillRect(g.x - w / 2 - 1, top - 1, w + 2, 6.4);
    ctx.fillStyle = r > 0.25 ? tc.main : "#ffd54a"; ctx.fillRect(g.x - w / 2, top, w * r, 4.4);
    ctx.fillStyle = "rgba(255,255,255,.35)"; ctx.fillRect(g.x - w / 2, top, w * r, 1.3);
    // no name over it: the two bars at the top of the screen say whose it is
  }
  /** The picture alone over a head (a Dân, or a character whose plate has no room): small, a little smaller than the
   *  picture inside a plate, and like the plates the same size on the screen whatever the camera does (they were tied
   *  to the field and grew big when the camera came close: the user, 11/11/2026). */
  // the radius of the picture itself (its one ring goes around it). Not from an item (a Dân too): smaller
  _badgeR(u) { return (this.base || 8) * (u.item ? 0.58 + u.tier * 0.025 : 0.55); }
  /** A viewer's picture in a round, with ONE ring around it and nothing else: no second ring, no dark edge, no shadow
   *  (the user, 11/11/2026: "avatar bị gắn 2 border liền", "đừng dùng shadow vì khi ở chất lượng kém nhìn nó rất
   *  nhoè"). ring: its colour; without one, the colour of the team (a picture alone over a head). Never thinner than
   *  two pixels of the screen: a thinner line is only a blur. */
  _badge(ctx, u, x, y, r, ring) {
    const im = this._img(u), smooth = ctx.imageSmoothingEnabled, px = 1 / (this.s || 1);
    ctx.imageSmoothingEnabled = true;
    ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.clip(); ctx.drawImage(im, x - r, y - r, r * 2, r * 2); ctx.restore();
    const lw = Math.max(2 * px, r * (u.item ? 0.17 : 0.15));
    ctx.beginPath(); ctx.arc(x, y, r + lw / 2 - 0.2 * px, 0, 7); ctx.strokeStyle = ring || TEAM_COL[u.team].main; ctx.lineWidth = lw; ctx.stroke();
    ctx.imageSmoothingEnabled = smooth;
  }
  _ghost(ctx, g, t) {
    const L = LOOK[g.kind], name = L[g.team], S = SHEETS[name], k = (t - g.t0) / g.dur;
    ctx.globalAlpha = Math.max(0, 1 - k);
    ctx.filter = "grayscale(1) brightness(1.4)";
    this._sprite(ctx, `${color(g.team)}/${name}_idle`, g.x, g.y - k * 8, S.ax, S.ay, L.scale, 0, S.fw, 1);
    ctx.filter = "none"; ctx.globalAlpha = 1;
  }
  _heart(ctx, x, y, r) {
    ctx.beginPath();
    ctx.moveTo(x, y + r);
    ctx.bezierCurveTo(x - r * 1.6, y - r * 0.2, x - r * 0.8, y - r * 1.5, x, y - r * 0.5);
    ctx.bezierCurveTo(x + r * 0.8, y - r * 1.5, x + r * 1.6, y - r * 0.2, x, y + r);
    ctx.fill();
  }

  // ---------- trees, rocks, sheep: around the field, never where the fight is ----------
  _deco() {
    const out = [];
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const free = (x, y) => {
      if (Math.abs(x) < H + 30 && Math.abs(y) < H + 30) return false;                       // the citadel
      if (Math.abs(x) < 46 && Math.abs(y) < H + CAMP_D + 70) return false;                  // the roads north and south
      if (Math.abs(y) < 46 && Math.abs(x) < H + CAMP_D + 70) return false;                  // the roads east and west
      return true;
    };
    for (let i = 0; i < 600 && out.length < 72; i++) {
      const x = (rnd() - 0.5) * 520, y = -420 + rnd() * 900;
      if (!free(x, y) || out.some((d) => Math.hypot(d.x - x, d.y - y) < 26)) continue;
      const r = rnd();
      out.push(r < 0.5 ? { kind: "tree", n: 1 + Math.floor(rnd() * 4), x, y, ph: rnd() * 8 }
        : r < 0.75 ? { kind: "bush", n: 1 + Math.floor(rnd() * 4), x, y, ph: rnd() * 8 }
          : r < 0.84 ? { kind: "rock", n: 1 + Math.floor(rnd() * 4), x, y }
            : r < 0.93 ? { kind: "old", n: [1, 2, 3, 3, 12, 13, 13, 10, 11, 17][Math.floor(rnd() * 10)], x, y }
              : { kind: "sheep", x, y, ph: rnd() * 6, flip: rnd() < 0.5 ? -1 : 1 });
    }
    return out;
  }
  _decoDraw(ctx, d, t) {
    if (d.kind === "tree") this._sprite(ctx, `deco/tree${d.n}`, d.x, d.y, 96, d.n <= 2 ? 240 : 178, 1, Math.floor(t * 8 + d.ph) % 8, 192);
    else if (d.kind === "bush") this._sprite(ctx, `deco/bush${d.n}`, d.x, d.y, 64, 80, 1, Math.floor(t * 8 + d.ph) % 8, 128);
    else if (d.kind === "rock") this._sprite(ctx, `deco/rock${d.n}`, d.x, d.y, 32, 50);
    else if (d.kind === "old") this._sprite(ctx, `old/deco${String(d.n).padStart(2, "0")}`, d.x, d.y, 32, d.n === 17 ? 112 : 48, 1.1);
    else this._sprite(ctx, "deco/sheep", d.x, d.y, 64, 84, 1, Math.floor(t * 7 + d.ph) % 6, 128, d.flip);
  }

  // ---------- the ground: drawn once on a hidden canvas (again when the pack has loaded) ----------
  _ground(ctx) {
    const X = 300, Y0 = -440, Y1 = 500, R = 2;
    if (!this.ground || this.ground.ready !== assetsReady()) {
      const g = document.createElement("canvas");
      g.width = X * 2 * R; g.height = (Y1 - Y0) * R;
      const c = g.getContext("2d");
      c.scale(R, R); c.translate(X, -Y0);
      c.fillStyle = "#a3b34b"; c.fillRect(-X, Y0, X * 2, Y1 - Y0);
      const tiles = img("deco/tiles");
      if (tiles) {                                        // the grass of the pack (the middle tile of its first block)
        const ts = 64 * K;
        c.imageSmoothingEnabled = false;
        for (let y = Y0; y < Y1; y += ts) for (let x = -X; x < X; x += ts) c.drawImage(tiles, 64, 64, 64, 64, x, y, ts + 0.5, ts + 0.5);
      }
      const road = (x, y, w, h, r) => {
        c.fillStyle = "#b08f58"; c.beginPath(); c.roundRect(x - 1.5, y - 1.5, w + 3, h + 3, r + 1.5); c.fill();
        c.fillStyle = "#d8bf85"; c.beginPath(); c.roundRect(x, y, w, h, r); c.fill();
      };
      // the roads from the camps to the gates, the ground around the walls, the yard inside
      road(-20, -H - CAMP_D - 30, 40, CAMP_D + 40, 10); road(-20, H - 10, 40, CAMP_D + 40, 10);
      road(-H - CAMP_D - 30, -20, CAMP_D + 40, 40, 10); road(H - 10, -20, CAMP_D + 40, 40, 10);
      for (const f of FACES) { const [x, y] = facePos(f, 0, CAMP_D + 14); road(x - 42, y - 30, 84, 60, 26); }
      road(-H - 16, -H - 16, (H + 16) * 2, (H + 16) * 2, 18);
      c.fillStyle = "#e3d2a2"; c.fillRect(-H + 4, -H + 4, (H - 4) * 2, (H - 4) * 2);
      // paving stones in the yard
      let seed = 5;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      c.fillStyle = "rgba(160,130,80,.16)";
      for (let i = 0; i < 260; i++) { const x = -H + 8 + rnd() * (H * 2 - 22), y = -H + 8 + rnd() * (H * 2 - 22); c.fillRect(Math.round(x), Math.round(y), 5 + Math.floor(rnd() * 5), 3); }
      c.fillStyle = "rgba(255,255,255,.14)";
      for (let i = 0; i < 120; i++) { const x = -H + 8 + rnd() * (H * 2 - 22), y = -H + 8 + rnd() * (H * 2 - 22); c.fillRect(Math.round(x), Math.round(y), 4, 2); }
      this.ground = { g, X, Y0, w: X * 2, h: Y1 - Y0, ready: assetsReady() };
    }
    const G = this.ground, smooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(G.g, -G.X, G.Y0, G.w, G.h);
    ctx.imageSmoothingEnabled = smooth;
  }

  // ---------- the walls and their gates (stone in the colours of the pack's cliffs) ----------
  _wall(ctx, f, t) {
    const b = this.b, g = b.gates[f], r = g.hp / g.max, horiz = f === "N" || f === "S";
    const hit = Math.max(0, 1 - (t - this.flash[f]) / 0.18);
    const L = H + WALL_T / 2, T = WALL_T;
    const block = (x, y, w, h) => {                              // a run of wall: top, front face, battlements
      ctx.fillStyle = STONE.line; ctx.fillRect(x - 0.8, y - 0.8, w + 1.6, h + 1.6);
      if (horiz) {
        ctx.fillStyle = STONE.top; ctx.fillRect(x, y, w, h * 0.45);
        ctx.fillStyle = STONE.mid; ctx.fillRect(x, y + h * 0.45, w, h * 0.55);
        ctx.fillStyle = STONE.dark;
        for (let i = 0, bx = x + 3; bx < x + w - 2; bx += 9, i++) ctx.fillRect(bx, y + h * 0.45 + (i % 2 ? 1.2 : 3.4), 0.9, 2.4);
        ctx.fillRect(x, y + h * 0.45, w, 0.8);
        for (let bx = x + 1.5; bx < x + w - 4; bx += 8) { ctx.fillStyle = STONE.line; ctx.fillRect(bx - 0.6, y - 3, 5.6, 3.2); ctx.fillStyle = STONE.light; ctx.fillRect(bx, y - 2.4, 4.4, 3); }
      } else {
        ctx.fillStyle = STONE.top; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = STONE.mid; ctx.fillRect(x + (f === "W" ? w - 2.6 : 0), y, 2.6, h);
        ctx.fillStyle = STONE.dark;
        for (let by = y + 4; by < y + h - 3; by += 9) ctx.fillRect(x + 1.5, by, w - 3, 0.8);
      }
    };
    const span = (a0, a1) => { if (horiz) block(a0, (f === "N" ? -H : H) - T / 2, a1 - a0, T); else block((f === "W" ? -H : H) - T / 2, a0, T, a1 - a0); };
    span(-L, -GATE_W); span(GATE_W, L);
    // the gate: two posts and wooden doors; cracked as it weakens; in pieces when broken
    const [gx, gy] = facePos(f, 0, 0);
    ctx.save(); ctx.translate(gx, gy);
    if (!horiz) ctx.rotate(Math.PI / 2);
    const gw = GATE_W, gh = T + 2;
    if (!g.broken) {
      ctx.fillStyle = STONE.line; ctx.fillRect(-gw - 0.8, -gh / 2 - 0.8, gw * 2 + 1.6, gh + 1.6);
      ctx.fillStyle = "#8a5a2b"; ctx.fillRect(-gw, -gh / 2, gw * 2, gh);
      ctx.fillStyle = "#a9713a"; ctx.fillRect(-gw, -gh / 2, gw * 2, gh * 0.4);
      ctx.fillStyle = "#5c3a1a";
      for (let x = -gw + 4; x < gw; x += 5) ctx.fillRect(x, -gh / 2, 0.8, gh);
      ctx.fillRect(-0.6, -gh / 2, 1.2, gh);
      ctx.fillStyle = "#c9cfd6"; ctx.fillRect(-gw, -gh / 2 + 2.2, gw * 2, 1.2); ctx.fillRect(-gw, gh / 2 - 3.4, gw * 2, 1.2);   // iron bands
      ctx.fillStyle = `rgba(30,12,4,${(1 - r) * 0.5})`; ctx.fillRect(-gw, -gh / 2, gw * 2, gh);
      ctx.strokeStyle = "rgba(20,10,4,.85)"; ctx.lineWidth = 0.9;
      const n = Math.floor((1 - r) * 7);
      for (let i = 0; i < n; i++) { const x = -gw + 3 + ((i * 11) % (gw * 2 - 6)); ctx.beginPath(); ctx.moveTo(x, -gh / 2 + 1); ctx.lineTo(x + 2, -1); ctx.lineTo(x - 1.4, 2); ctx.lineTo(x + 1, gh / 2 - 1); ctx.stroke(); }
      if (hit > 0) { ctx.fillStyle = `rgba(255,255,255,${hit * 0.5})`; ctx.fillRect(-gw, -gh / 2, gw * 2, gh); }
    } else {
      for (let i = 0; i < 16; i++) {
        const x = -gw + ((i * 37) % (gw * 2)), y = -gh / 2 + ((i * 53) % (gh + 8)) - 3;
        ctx.fillStyle = i % 3 === 0 ? STONE.mid : i % 2 ? "#6b4423" : "#a9713a"; ctx.save(); ctx.translate(x, y); ctx.rotate(i); ctx.fillRect(-2.6, -1.2, 5.2, 2.4); ctx.restore();
      }
    }
    for (const sx of [-1, 1]) {                                  // the gate posts
      ctx.fillStyle = STONE.line; ctx.fillRect(sx * (gw + 2.4) - 3.4, -gh / 2 - 2.6, 6.8, gh + 5.2);
      ctx.fillStyle = STONE.light; ctx.fillRect(sx * (gw + 2.4) - 2.6, -gh / 2 - 1.8, 5.2, gh + 3.6);
      ctx.fillStyle = STONE.top; ctx.fillRect(sx * (gw + 2.4) - 2.6, -gh / 2 - 1.8, 5.2, 3);
    }
    ctx.restore();
    if (!g.broken && r < 0.35) { this._fire(ctx, gx - 7, gy, t, 0.9); this._fire(ctx, gx + 8, gy + 1, t + 0.4, 0.8); }   // nearly down: it burns
  }
  _fire(ctx, x, y, t, scale = 1) { const f = FX.fire; this._sprite(ctx, f.src, x, y, 32, 62, scale * 1.6, Math.floor(t * 12) % f.n, f.fw); }

  // ---------- the castle ----------
  _hall(ctx, t) {
    const b = this.b, r = b.hall.hp / b.hall.max;
    const hit = Math.max(0, 1 - (t - this.flash.C) / 0.2);
    const down = this.ended?.winner === "A" || r <= 0;
    if (down && this._sprite(ctx, "old/castle_destroyed", 0, 22, 160, 232)) { /* a heap of stones */ }
    else {
      if (down) ctx.filter = "grayscale(.9) brightness(.45)";
      else if (hit > 0) ctx.filter = `brightness(${1 + hit * 0.8})`;
      if (!this._sprite(ctx, "blue/castle", 0, 22, 160, 248)) { ctx.fillStyle = TEAM_COL.D.main; ctx.fillRect(-40, -30, 80, 50); }
      ctx.filter = "none";
    }
    if (down) { for (const [x, y, s2, ph] of [[-26, 10, 1.3, 0], [8, 14, 1.5, 0.3], [30, 6, 1.1, 0.6], [-6, -14, 1.2, 0.2]]) this._fire(ctx, x, y, t + ph, s2); return; }
    if (r < 0.6) this._fire(ctx, -28, 4, t, 0.9);
    if (r < 0.4) this._fire(ctx, 26, 8, t + 0.3, 1);
    if (r < 0.2) { this._fire(ctx, 0, -12, t + 0.6, 1.2); this._fire(ctx, -10, 16, t + 0.15, 0.9); }
    if (this.ended?.winner === "D") {                         // the citadel held: flags over the castle
      for (const fx of [-34, 34]) {
        const w = Math.sin(t * 6 + fx) * 1.6;
        ctx.strokeStyle = "#5a3a1c"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(fx, -38); ctx.lineTo(fx, -62); ctx.stroke();
        ctx.fillStyle = TEAM_COL.D.main; ctx.beginPath(); ctx.moveTo(fx, -62); ctx.lineTo(fx + 13, -58 + w); ctx.lineTo(fx, -53); ctx.fill();
      }
    }
  }

  // ---------- an attackers' camp: a barracks and a house ----------
  _camp(ctx, f, t) {
    const [x, y] = facePos(f, 0, CAMP_D + 16);
    const glow = Math.max(0, 1 - (t - this.waveAt) / 0.8);
    if (glow > 0) ctx.filter = `brightness(${1 + glow * 0.7})`;
    for (const [name, dx, dy, ax, ay, sc] of CAMPS[f]) this._sprite(ctx, name, x + dx, y + dy, ax, ay, sc);
    // a wooden watchtower by the road (the old pack: its flag moves)
    this._sprite(ctx, "old/woodtower_red", x - 44, y + 4, 128, 150, 0.7, Math.floor(t * 8) % 4, 256);
    ctx.filter = "none";
  }

  /** The life of the gates and of the castle, and the seconds to the next wave over each camp and over the castle. */
  _bars(ctx) {
    const b = this.b;
    for (const f of FACES) {
      const g = b.gates[f], r = g.hp / g.max, [dx] = DIR[f];
      if (r < 0.995) {
        const [x, y] = facePos(f, 0, 0);
        const bw = 40, bh = 4, bx = x - bw / 2, by = dx ? y - 30 : f === "N" ? y - 17 : y + 13;
        ctx.fillStyle = "rgba(10,16,24,.85)"; ctx.beginPath(); ctx.roundRect(bx - 1, by - 1, bw + 2, bh + 2, 2.2); ctx.fill();
        const show = g.broken ? Math.min(1, g.hp / (g.max * b.T.stand)) : r;
        ctx.fillStyle = g.broken ? "#ff5a4d" : r > 0.5 ? "#6fe38d" : r > 0.25 ? "#ffd54a" : "#ff8a4d";
        ctx.beginPath(); ctx.roundRect(bx, by, Math.max(1.5, bw * show), bh, 1.6); ctx.fill();
      }
      if (b.rage && f !== "S") continue;         // the match of fury: everyone comes out on the south side
      const [cx, cy] = facePos(f, 0, CAMP_D + 16);
      this._clock(ctx, cx + 4, cy - 58, 8, TEAM_COL.A);
    }
    if (!b.rage) this._clock(ctx, 0, -70, 9, TEAM_COL.D);
    const r = b.hall.hp / b.hall.max;
    if (r < 0.995 && r > 0) {
      const bw = 60, bx = -bw / 2, by = -52;
      ctx.fillStyle = "rgba(10,16,24,.85)"; ctx.beginPath(); ctx.roundRect(bx - 1.2, by - 1.2, bw + 2.4, 7.4, 3.4); ctx.fill();
      ctx.fillStyle = r > 0.5 ? "#6fe38d" : r > 0.25 ? "#ffd54a" : "#ff5a4d";
      ctx.beginPath(); ctx.roundRect(bx, by, Math.max(2, bw * r), 5, 2.4); ctx.fill();
    }
  }
  /** The seconds until the gates open again, in a ring. */
  _clock(ctx, x, y, r, col) {
    const b = this.b;
    if (b.over || this.ended) return;
    const left = b.waveLeft(), k = Math.max(0, Math.min(1, left / b.T.wave)), hot = left <= 5;
    const pop = hot ? 1 + Math.abs(Math.sin(this.time * 6)) * 0.14 : 1;
    ctx.save(); ctx.translate(x, y); ctx.scale(pop, pop);
    ctx.fillStyle = "rgba(8,14,22,.88)"; ctx.beginPath(); ctx.arc(0, 0, r + 1.4, 0, 7); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.18)"; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(0, 0, r - 1, 0, 7); ctx.stroke();
    ctx.strokeStyle = hot ? "#ffd54a" : col.main; ctx.lineWidth = 1.8; ctx.lineCap = "round";
    ctx.beginPath(); ctx.arc(0, 0, r - 1, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - k)); ctx.stroke();
    ctx.fillStyle = hot ? "#ffd54a" : "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = `800 ${r * 0.95}px "Be Vietnam Pro", "Segoe UI", sans-serif`;
    ctx.fillText(String(Math.ceil(left)), 0, r * 0.08);
    ctx.restore();
  }

  // ---------- arrows, dust, pieces, numbers ----------
  _fx(ctx, t) {
    for (const s of this.shots) {
      const p = (t - s.t0) / s.dur;
      if (p < 0) continue;
      const arc = 10 + Math.hypot(s.x2 - s.x1, s.y2 - s.y1) * 0.12;
      const at = (q) => [s.x1 + (s.x2 - s.x1) * q, s.y1 - 10 + (s.y2 - s.y1) * q - Math.sin(q * Math.PI) * arc];
      const [x, y] = at(p), [x0, y0] = at(Math.max(0, p - 0.06));
      const im = img(`${color(s.team || "D")}/arrow`);
      if (im) { ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan2(y - y0, x - x0)); ctx.drawImage(im, -32 * K, -32 * K, 64 * K, 64 * K); ctx.restore(); }
      else { ctx.strokeStyle = "#f4efe0"; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x, y); ctx.stroke(); }
    }
    for (const a of this.anims) {
      const f = FX[a.fx], k = t - a.t0;
      if (k < 0) continue;
      const fr = Math.min(f.n - 1, Math.floor(k * 12));
      if (f.cols) {                                          // a sheet of several rows
        const im = img(f.src);
        if (im) { const w = f.fw * K * a.scale; ctx.drawImage(im, (fr % f.cols) * f.fw, Math.floor(fr / f.cols) * f.fw, f.fw, f.fw, a.x - w / 2, a.y - w * 0.72, w, w); }
      } else this._sprite(ctx, f.src, a.x, a.y, f.fw / 2, f.fw === 64 ? 46 : 120, a.scale * (f.fw === 64 ? 1.5 : 1), fr, f.fw);
    }
    for (const p of this.puffs) {
      const k = (t - p.t0) / p.dur;
      if (k < 0) continue;
      ctx.globalAlpha = (1 - k) * 0.75; ctx.fillStyle = p.col;
      ctx.beginPath(); ctx.arc(p.x, p.y - k * 5, p.r * (0.5 + k * 0.9), 0, 7); ctx.fill();
    }
    for (const r of this.rings) {
      const k = (t - r.t0) / r.dur;
      if (k < 0) continue;
      ctx.globalAlpha = (1 - k) * 0.8; ctx.strokeStyle = r.col; ctx.lineWidth = 2.4 * (1 - k) + 0.6;
      ctx.beginPath(); ctx.ellipse(r.x, r.y, r.r * k, r.r * k * 0.55, 0, 0, 7); ctx.stroke();
    }
    for (const f of this.flashes) {
      const k = (t - f.t0) / f.dur;
      if (k < 0) continue;
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r * (0.5 + k * 0.7));
      g.addColorStop(0, `rgba(${f.col},${0.95 * (1 - k)})`); g.addColorStop(0.5, `rgba(${f.col},${0.5 * (1 - k)})`); g.addColorStop(1, `rgba(${f.col},0)`);
      ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (0.5 + k * 0.7), 0, 7); ctx.fill();
    }
    for (const pl of this.pillars) {                           // the light on those who just became another kind
      const u = this.b.byUk.get(pl.uk), x = u ? u.x : pl.x, y = u ? u.y : pl.y;
      const k = (t - pl.t0) / pl.dur, a = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85, w = pl.w + Math.sin(t * 20) * 0.8;
      const g = ctx.createLinearGradient(0, y - 130, 0, y);
      g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(1, pl.col);
      ctx.globalAlpha = a * 0.55; ctx.fillStyle = g; ctx.fillRect(x - w, y - 130, w * 2, 130);
      ctx.globalAlpha = a * 0.5; ctx.fillStyle = "#fff"; ctx.fillRect(x - w * 0.3, y - 130, w * 0.6, 130);
    }
    for (const p of this.parts) {
      const k = (t - p.t0) / p.dur;
      ctx.globalAlpha = k > 0.6 ? (1 - k) / 0.4 : 1;
      if (p.shape === "spark") { ctx.strokeStyle = p.col; ctx.lineWidth = p.size * 1.4; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.045, p.y - p.vy * 0.045); ctx.stroke(); continue; }
      if (p.shape === "slash") { ctx.strokeStyle = p.col; ctx.lineWidth = 1.8 * (1 - k); ctx.lineCap = "round"; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.7 + k * 0.6), p.rot, p.rot + 2.2); ctx.stroke(); continue; }
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.col;
      if (p.shape === "star") {
        const r = p.size * (1 - k * 0.4);
        ctx.beginPath(); ctx.moveTo(0, -r * 1.7); ctx.quadraticCurveTo(0, 0, r * 1.7, 0); ctx.quadraticCurveTo(0, 0, 0, r * 1.7); ctx.quadraticCurveTo(0, 0, -r * 1.7, 0); ctx.quadraticCurveTo(0, 0, 0, -r * 1.7); ctx.fill();
      } else ctx.fillRect(-p.size, -p.size * 0.7, p.size * 2, p.size * 1.4);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const p of this.texts) {
      const k = (t - p.t0) / p.dur, pop = k < 0.12 ? 0.6 + (k / 0.12) * 0.55 : 1.15 - Math.min(0.15, (k - 0.12) * 0.6);
      ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
      ctx.font = `800 ${8.6 * p.size * pop}px "Be Vietnam Pro", "Segoe UI", sans-serif`;
      ctx.lineWidth = 2.4; ctx.strokeStyle = "rgba(14,18,28,.9)"; ctx.lineJoin = "round";
      ctx.strokeText(p.s, p.x, p.y - k * 16); ctx.fillStyle = p.col; ctx.fillText(p.s, p.x, p.y - k * 16);
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Names. A plate: the viewer's picture in a ring of the rank, the name, the character's strength as a bar, an edge in
   * the colour of the team. The user, 11/11/2026:
   *   - a character that came from an item: a plate, its size growing gently with the rank, shown before the others
   *   - the character of a comment that has earned a rank (Lính kiếm, Lính giáo, Cung thủ): the same plate, small,
   *     shown after those of the items
   *   - a Dân: no plate, only the viewer's picture over its head
   * Returns the characters that get a plate this frame, the most important first (there is room for so many).
   */
  _plates(units, zoomed) {
    const list = [];
    for (const u of units) {
      if (!u.key || !u.name || u.born > this.b.t) continue;
      const item = !!u.item;                                    // it came from an item
      if (this.b.rage && !item) continue;                       // the match of fury: everyone is in one place, only these have room
      if (!item && !(u.tier > 0)) continue;                     // a Dân: only the picture
      const lit = this.spots.has(u.key) || u.key === this.follow;
      const acts = this.acting.get(u.key)?.id === u.id;         // the one of theirs the camera is on
      list.push({ u, lit, item, w: (item ? 5000 + u.tier * 300 : u.tier * 40) + (lit ? 1000 : 0) + (u.key === this.follow ? 600 : 0) + (u.waiting ? -50 : 0) + (u.lead ? 100 : 0) + (acts ? 3000 : 0) });
    }
    list.sort((a, c) => c.w - a.w);
    // one plate for each viewer, on the best of theirs (the others show the picture): someone with five characters
    // had their name five times over one gate while four other names had no room
    const seen = new Set(), out = [], max = this.b.rage ? 8 : zoomed ? 18 : 22;
    for (const p of list) {
      if (seen.has(p.u.key)) continue;
      seen.add(p.u.key); out.push(p);
      if (out.length >= max) break;
    }
    return out;
  }
  _labels(ctx, t) {
    const s = this.s;
    ctx.textBaseline = "middle";
    const base = this.base;
    const placed = [], draws = [];
    for (const { u, lit, item } of this.plates || []) {         // those of the items come first in the list
      // from an item: a little bigger with each rank; a rank earned with right answers: a smaller plate
      const fs = base * (item ? 0.84 * (1 + u.tier * 0.055) : 0.68) * (lit ? 1.08 : 1);
      const note = u.waiting ? "chờ" : "";
      const top = u._top ?? u.y - 30;
      ctx.font = `800 ${fs}px "Be Vietnam Pro", "Segoe UI", sans-serif`;
      const [name, nk] = this._fit(ctx, u.name, fs, item ? 5 : 4.6);      // the words of a plate are never wider than that
      const nf = fs * nk;
      ctx.font = `800 ${nf}px "Be Vietnam Pro", "Segoe UI", sans-serif`;
      const tw = Math.max(ctx.measureText(name).width, fs * 1.6), nw = note ? ctx.measureText(note).width * 0.85 + fs * 0.3 : 0;
      const life = !u.waiting;                                  // their strength, under the name
      // the picture is a little taller than the plate and stands out of it at the left: a bigger face, the same words
      // the picture sits inside the plate, at its left end (not from an item: exactly the size of a Dân's, the user)
      const hgt = fs * (life ? 1.86 : 1.6), av = hgt / 2, w = tw + nw + hgt + fs * 0.7;
      const x = u.x, y0 = top - 2.5 - hgt / 2 - (lit ? Math.abs(Math.sin(t * 3 + u.id)) * 1.2 : 0);
      let y = y0;
      const hit = (q, m = 0) => Math.abs(q.x - x) < (q.w + w) / 2 + m && Math.abs(q.y - y) < (q.h + hgt) / 2 + m * 0.6;
      let alpha = 1;
      if (item) {
        // no room over its head (a crowd at a gate): the plate goes one row up, up to three rows, before it is given
        // up for the picture alone. With sixty viewers and thirty characters from items, the whole field showed four
        // names: everyone who gave wants to read theirs
        const step = hgt + fs * 0.2;
        let row = 0;
        while (row < 3 && placed.some((q) => hit(q))) { row++; y = y0 - row * step; }
        if (placed.some((q) => hit(q))) { u._lift = undefined; this._bare(ctx, u, top); continue; }
      } else {
        // not from an item: never in the way. On another small plate: only the picture. Beside (or under) the plate
        // of a character that came from an item: it fades (the user, 11/11/2026)
        if (placed.some((q) => !q.item && hit(q))) { this._bare(ctx, u, top); continue; }
        if (placed.some((q) => q.item && hit(q, 14))) alpha = 0.38;
      }
      placed.push({ x, y, w, h: hgt, item });
      // a plate that changes row glides there (it does not jump from one frame to the next)
      const lift = y0 - y;
      u._lift = u._lift === undefined ? lift : u._lift + (lift - u._lift) * 0.2;
      draws.push({ u, lit, item, fs, nf, name, note, tw, nw, life, hgt, w, x, y: y0 - u._lift, alpha, av, arrow: u._lift < 1 });
    }
    // the small ones first: the plates of the items lie over them
    draws.sort((a, c) => (a.item ? 1 : 0) - (c.item ? 1 : 0));
    for (const d of draws) this._plate(ctx, d);
    ctx.globalAlpha = 1;
  }
  /** A character whose plate has no room: only the picture, and its strength over the head like anyone without a plate. */
  _bare(ctx, u, top) {
    const r = this._badgeR(u);
    let y = top;
    if (!u.waiting && u._bar !== undefined && (u.hp < u.max - 0.5 || u.tier >= 5)) { this._life(ctx, u, u._bar); y = top - 3.6; }
    this._badge(ctx, u, u.x, y - r * 1.17 - 0.6, r);
  }
  /** The name plate: a flat pill in the colour of the team, the picture at its left end with one ring (the colour of
   *  the rank for a character that came from an item), the name, the strength as a thin line. No edge around the
   *  plate, no shadow under it, nothing drawn twice (the user, 11/11/2026: "gọn đẹp hơn, đừng lạm dụng border", "đừng
   *  dùng shadow"). In the light (lit): one white line around it. */
  _plate(ctx, { u, lit, fs, nf, name, note, tw, nw, life, hgt, w, x, y, alpha, arrow = true }) {
    const br = hgt / 2, item = !!u.item, gold = item && u.tier >= 5, x0 = x - w / 2, px = 1 / (this.s || 1);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = PLATE[u.team];
    ctx.beginPath(); ctx.roundRect(x0, y - br, w, hgt, br); ctx.fill();
    if (arrow) { ctx.beginPath(); ctx.moveTo(x - fs * 0.3, y + br - 0.1); ctx.lineTo(x, y + br + fs * 0.36); ctx.lineTo(x + fs * 0.3, y + br - 0.1); ctx.fill(); }      // only right over its character
    if (lit) { ctx.beginPath(); ctx.roundRect(x0, y - br, w, hgt, br); ctx.strokeStyle = "#fff"; ctx.lineWidth = Math.max(1.5 * px, fs * 0.07); ctx.stroke(); }
    // the picture: from an item, as big as the plate allows; else exactly a Dân's
    const ar = item ? br * 0.82 : Math.min(br * 0.84, this._badgeR(u)), ax = x0 + br;
    this._badge(ctx, u, ax, y, ar, item ? RANK_COL[u.tier] : "#eaf2ff");
    if (item && u.tier >= 6) {     // the general: a small crown on the picture
      const cw = ar * 0.62, cy = y - ar * 0.94, ch = ar * 0.62;
      ctx.fillStyle = "#ffd54a"; ctx.beginPath();
      ctx.moveTo(ax - cw, cy); ctx.lineTo(ax - cw, cy - ch); ctx.lineTo(ax - cw * 0.45, cy - ch * 0.45); ctx.lineTo(ax, cy - ch * 1.1);
      ctx.lineTo(ax + cw * 0.45, cy - ch * 0.45); ctx.lineTo(ax + cw, cy - ch); ctx.lineTo(ax + cw, cy); ctx.closePath(); ctx.fill();
    }
    const tx = x0 + hgt + fs * 0.12, ty = y + fs * 0.06 - (life ? fs * 0.24 : 0);
    ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillStyle = gold ? "#ffe27a" : "#fff";
    ctx.font = `800 ${nf}px "Be Vietnam Pro", "Segoe UI", sans-serif`;
    ctx.fillText(name, tx, ty);
    if (note) { ctx.fillStyle = "#ffe9a8"; ctx.font = `800 ${nf * 0.85}px "Be Vietnam Pro", "Segoe UI", sans-serif`; ctx.fillText(note, tx + tw + fs * 0.3, ty); }
    if (life) {     // white on the colour of the team (green would be lost on the red plate); yellow when nearly gone
      const r = Math.max(0, Math.min(1, u.hp / u.max)), bw = tw + nw, bh = fs * 0.28, by = y + br - bh - fs * 0.27;
      ctx.fillStyle = "rgba(0,0,0,.3)"; ctx.beginPath(); ctx.roundRect(tx, by, bw, bh, bh / 2); ctx.fill();
      ctx.fillStyle = r > 0.25 ? "#fff" : "#ffe27a"; ctx.beginPath(); ctx.roundRect(tx, by, Math.max(bh, bw * r), bh, bh / 2); ctx.fill();
    }
  }
}

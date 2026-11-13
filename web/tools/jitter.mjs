// Looks for fighters that twitch or stand frozen: `node tools/jitter.mjs`. Plays matches with no picture and counts,
// for every fighter, how often it turns round, how often it starts and stops walking, and how long it stands doing
// nothing while enemies (or, in the match of fury, the other giant) are there to deal with.
import { Battle } from "../src/game/battle.js";

function rng(seed) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }
const mix = (i) => [0, 0, 0, 1, 0, 0, 2, 0, 1, 0, 0, 3, 0, 0, 1, 0, 0, 4, 0, 0][i % 20];

export function measure({ n = 10, rage = false, seconds = 150, seed = 5 } = {}) {
  const b = new Battle({ rand: rng(seed) });
  const viewers = [];
  for (let i = 0; i < n; i++) viewers.push({ key: `d${i}`, team: "D", tier: mix(i), name: `D${i}` }, { key: `a${i}`, team: "A", tier: mix(i + 3), name: `A${i}` });
  b.reset(viewers, { rage, len: 240 });
  const st = new Map();       // unit id -> { flips, toggles, idle, life, kind, team }
  let wave = 0, pawnLanes = [];
  for (let t = 0; t < seconds && !b.over; t += 1 / 60) {
    b.update(1 / 60);
    b.take();
    if (b.waveLeft() < 0.15 || b.waveN !== wave) { wave = b.waveN; for (const v of viewers) if (!b.has(v.key)) b.enqueue(v); }
    for (const u of b.units) {
      if (u.born > b.t) continue;
      let s = st.get(u.id);
      if (!s) st.set(u.id, (s = { flips: 0, toggles: 0, idle: 0, life: 0, kind: u.kind, team: u.team, flip: u.flip, act: u.act, x: u.x, y: u.y, moved: 0, step: 0, frozen: 0, frozenMax: 0 }));
      s.life += 1 / 60;
      if (u.flip !== s.flip) { s.flips++; s.flip = u.flip; }
      const walking = u.act === "run", was = s.act === "run";
      if (walking !== was) s.toggles++;
      s.act = u.act;
      s.step = Math.hypot(u.x - s.x, u.y - s.y);
      s.moved += s.step; s.x = u.x; s.y = u.y;
      if (u.act === "idle") s.idle += 1 / 60;
      // frozen: standing and doing nothing although there is something to do (an enemy they are after, a gate to
      // break or to mend, the other giant)
      const K = b.T.kind[u.kind], g = b.gates[u.lane];
      const work = (u.target && !u.target.gone) || (!K.heal && (u.team === "A" || b.rage)) || (u.team === "D" && u.kind === "pawn" && !b.rage && !u.goLane && g.hp < g.max * 0.95);
      if (work && u.act === "idle" && b.t - u.actAt > 0.8 && s.step < 0.002) { s.frozen += 1 / 60; if (s.frozen > s.frozenMax) s.frozenMax = s.frozen; } else s.frozen = 0;
    }
    if (Math.abs(t % 30 - 20) < 1 / 120) {       // where the defenders' villagers stand, and the state of each gate
      const c = { N: 0, E: 0, S: 0, W: 0 };
      for (const u of b.units) if (u.team === "D" && u.kind === "pawn") c[u.goLane || u.lane]++;
      pawnLanes.push(`t=${Math.round(t)} dân ${["N", "E", "S", "W"].map((f) => `${f}:${c[f]}(cổng ${Math.round(b.gateRatio(f) * 100)}%${b.gates[f].broken ? " vỡ" : ""}, địch ${b.units.filter((u) => u.team === "A" && u.lane === f).length})`).join(" ")}`);
    }
  }
  const list = [...st.values()].filter((s) => s.life > 6);
  const rate = (f) => list.map((s) => f(s) / s.life);
  const avg = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length), max = (a) => a.reduce((x, y) => Math.max(x, y), 0);
  const flips = rate((s) => s.flips), tog = rate((s) => s.toggles), idle = rate((s) => s.idle);
  const twitchy = list.filter((s) => s.flips / s.life > 1 || s.toggles / s.life > 1.5).length;
  const frozen = list.filter((s) => s.frozenMax >= 3);
  const frozenKinds = {};
  for (const s of frozen) frozenKinds[`${s.team}:${s.kind}`] = (frozenKinds[`${s.team}:${s.kind}`] || 0) + 1;
  return { frozen: frozen.length, frozenKinds, units: list.length, flipAvg: avg(flips), flipMax: max(flips), togAvg: avg(tog), togMax: max(tog), idleAvg: avg(idle), twitchy, pawnLanes };
}

const MAIN = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (MAIN) {
  for (const [label, opt] of [["trận thường 10 v 10", {}], ["trận thường 40 v 40", { n: 40 }], ["trận nộ 10 v 10", { rage: true }], ["trận nộ 40 v 40", { rage: true, n: 40 }]]) {
    const r = measure(opt);
    console.log(`${label.padEnd(22)} ${r.units} quân · quay mặt ${r.flipAvg.toFixed(2)}/giây (nhiều nhất ${r.flipMax.toFixed(1)}) · đi-dừng ${r.togAvg.toFixed(2)}/giây (nhiều nhất ${r.togMax.toFixed(1)}) · đứng yên ${Math.round(r.idleAvg * 100)}% thời gian · ${r.twitchy} quân giật · ${r.frozen} quân đứng đơ quá 3 giây ${JSON.stringify(r.frozenKinds)}`);
    if (!opt.rage && !opt.n) for (const l of r.pawnLanes) console.log("   " + l);
  }
}

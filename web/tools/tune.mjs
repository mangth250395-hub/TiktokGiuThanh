// Plays many matches with no picture and prints how they end: `npm run tune`. Used to keep the two teams close.
import { Battle } from "../src/game/battle.js";

function rng(seed) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }

/** One match: nD and nA viewers, each of a kind given by tiers(i) (0..6). Returns { winner, t, firstBreach }. */
/** rage: the match of fury (two giants); likeD / likeA: viewers of each team who keep sending likes (0.4 a second each, the most rules.js lets one viewer give). */
export function play({ nD = 8, nA = 8, tiersD = () => 0, tiersA = () => 0, seed = 1, seconds = 240, boost, rage = false, likeD = 0, likeA = 0 } = {}) {
  const b = new Battle({ rand: rng(seed) });
  const viewers = [];
  for (let i = 0; i < nD; i++) viewers.push({ key: `d${i}`, team: "D", tier: tiersD(i), name: `D${i}` });
  for (let i = 0; i < nA; i++) viewers.push({ key: `a${i}`, team: "A", tier: tiersA(i), name: `A${i}` });
  b.reset(viewers, { boost, rage, len: seconds });
  let firstBreach = null, wave = 0;
  for (let t = 0; t < seconds && !b.over; t += 0.1) {
    b.update(0.1);
    if (rage) { b.feed("D", likeD * 0.04); b.feed("A", likeA * 0.04); }
    for (const e of b.take()) if (e.type === "breach" && firstBreach === null) firstBreach = b.t;
    if (b.waveLeft() < 0.15 || b.waveN !== wave) { wave = b.waveN; for (const v of viewers) if (!b.has(v.key)) b.enqueue(v); }
  }
  if (rage) return { winner: b.over ? b.winner : b.giantLead(), over: b.over, t: b.t, firstBreach, hall: b.hallRatio(), gD: b.giantRatio("D"), gA: b.giantRatio("A") };
  return { winner: b.over ? "A" : "D", t: b.t, firstBreach, hall: b.hallRatio() };
}

export function table(cases, runs = 60) {
  for (const [label, opt] of cases) {
    let a = 0, tt = 0, fb = 0, nb = 0, hall = 0;
    for (let i = 0; i < runs; i++) {
      const r = play({ ...opt, seed: 1000 + i * 7 });
      if (r.winner === "A") { a++; tt += r.t; }
      if (r.firstBreach !== null) { fb += r.firstBreach; nb++; }
      hall += r.hall;
    }
    console.log(`${label.padEnd(34)} đánh thắng ${String(Math.round((a / runs) * 100)).padStart(3)}%  thắng lúc ${a ? Math.round(tt / a) : "-"}s  thủng lần đầu ${nb ? Math.round(fb / nb) : "-"}s (${nb}/${runs})  đình còn ${Math.round((hall / runs) * 100)}%`);
  }
}

/** The match of fury: how often the attackers win, how often a giant falls before the time, what is left of each. */
export function rageTable(cases, runs = 60) {
  for (const [label, opt] of cases) {
    let a = 0, ko = 0, tt = 0, gD = 0, gA = 0;
    for (let i = 0; i < runs; i++) {
      const r = play({ ...opt, rage: true, seed: 2000 + i * 7 });
      if (r.winner === "A") a++;
      if (r.over) { ko++; tt += r.t; }
      gD += r.gD; gA += r.gA;
    }
    console.log(`NỘ ${label.padEnd(31)} đánh thắng ${String(Math.round((a / runs) * 100)).padStart(3)}%  có người gục ${String(Math.round((ko / runs) * 100)).padStart(3)}% (lúc ${ko ? Math.round(tt / ko) : "-"}s)  còn lại xanh ${Math.round((gD / runs) * 100)}% đỏ ${Math.round((gA / runs) * 100)}%`);
  }
}

const MAIN = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (MAIN) {
  // a live as it is: most viewers are villagers, some have earned a sword, a few have given an item
  const mix = (i) => [0, 0, 0, 1, 0, 0, 2, 0, 1, 0, 0, 3, 0, 0, 1, 0, 0, 4, 0, 0][i % 20];
  const rich = (i) => [0, 1, 2, 1, 3, 0, 4, 1, 2, 3][i % 10];
  table([
    ["0 v 0 (chỉ lính có sẵn)", { nD: 0, nA: 0 }],
    ["3 v 3 dân", { nD: 3, nA: 3 }],
    ["8 v 8 dân", { nD: 8, nA: 8 }],
    ["8 v 8 hỗn hợp", { nD: 8, nA: 8, tiersD: mix, tiersA: mix }],
    ["8 v 8 nhiều lính", { nD: 8, nA: 8, tiersD: rich, tiersA: rich }],
    ["30 v 30 nhiều lính", { nD: 30, nA: 30, tiersD: rich, tiersA: rich }],
    ["30 v 30 hỗn hợp", { nD: 30, nA: 30, tiersD: mix, tiersA: mix }],
    ["120 v 120 hỗn hợp", { nD: 120, nA: 120, tiersD: mix, tiersA: mix }],
    ["8 v 16 hỗn hợp", { nD: 8, nA: 16, tiersD: mix, tiersA: mix }],
    ["16 v 8 hỗn hợp", { nD: 16, nA: 8, tiersD: mix, tiersA: mix }],
    ["8 v 8, đánh có 1 tướng", { nD: 8, nA: 8, tiersD: mix, tiersA: (i) => (i === 0 ? 6 : mix(i)) }],
    ["8 v 8, thủ có 1 tướng", { nD: 8, nA: 8, tiersA: mix, tiersD: (i) => (i === 0 ? 6 : mix(i)) }],
    ["8 v 8, mỗi bên 1 tướng", { nD: 8, nA: 8, tiersA: (i) => (i === 0 ? 6 : mix(i)), tiersD: (i) => (i === 0 ? 6 : mix(i)) }],
    ["8 v 8, đánh có 1 đội trưởng", { nD: 8, nA: 8, tiersD: mix, tiersA: (i) => (i === 0 ? 5 : mix(i)) }],
    ["8 v 8, đánh +8%", { nD: 8, nA: 8, tiersD: mix, tiersA: mix, boost: { D: 1, A: 1.08 } }],
    ["8 v 8, thủ +8%", { nD: 8, nA: 8, tiersD: mix, tiersA: mix, boost: { D: 1.08, A: 1 } }],
  ]);
  rageTable([
    ["0 v 0", { nD: 0, nA: 0 }],
    ["3 v 3 dân", { nD: 3, nA: 3 }],
    ["8 v 8 hỗn hợp", { nD: 8, nA: 8, tiersD: mix, tiersA: mix }],
    ["8 v 8 nhiều lính", { nD: 8, nA: 8, tiersD: rich, tiersA: rich }],
    ["30 v 30 hỗn hợp", { nD: 30, nA: 30, tiersD: mix, tiersA: mix }],
    ["120 v 120 hỗn hợp", { nD: 120, nA: 120, tiersD: mix, tiersA: mix }],
    ["8 v 8, 4 người tim mỗi bên", { nD: 8, nA: 8, tiersD: mix, tiersA: mix, likeD: 4, likeA: 4 }],
    ["8 v 8, cả 8 tim mỗi bên", { nD: 8, nA: 8, tiersD: mix, tiersA: mix, likeD: 8, likeA: 8 }],
    ["8 v 8, xanh 5 tim, đỏ 3", { nD: 8, nA: 8, tiersD: mix, tiersA: mix, likeD: 5, likeA: 3 }],
    ["8 v 8, xanh 3 tim, đỏ 5", { nD: 8, nA: 8, tiersD: mix, tiersA: mix, likeD: 3, likeA: 5 }],
    ["30 v 30, xanh 20 tim, đỏ 10", { nD: 30, nA: 30, tiersD: mix, tiersA: mix, likeD: 20, likeA: 10 }],
    ["8 v 8, đỏ có 1 tướng", { nD: 8, nA: 8, tiersD: mix, tiersA: (i) => (i === 0 ? 6 : mix(i)) }],
    ["8 v 8, xanh có 1 tướng", { nD: 8, nA: 8, tiersA: mix, tiersD: (i) => (i === 0 ? 6 : mix(i)) }],
    ["8 v 8, đỏ +9%", { nD: 8, nA: 8, tiersD: mix, tiersA: mix, boost: { D: 1, A: 1.09 } }],
    ["8 v 8, xanh +9%", { nD: 8, nA: 8, tiersD: mix, tiersA: mix, boost: { D: 1.09, A: 1 } }],
  ]);
}

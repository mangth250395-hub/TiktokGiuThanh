// Tries values for the giants (TUNE.giant) and prints the fury-match table: node tools/rage-sweep.mjs '{"dps":2.4,"hall":0.2}'
import { TUNE } from "../src/game/battle.js";
import { rageTable } from "./tune.mjs";
Object.assign(TUNE.giant, JSON.parse(process.argv[2] || "{}"));
const mix = (i) => [0, 0, 0, 1, 0, 0, 2, 0, 1, 0, 0, 3, 0, 0, 1, 0, 0, 4, 0, 0][i % 20];
const rich = (i) => [0, 1, 2, 1, 3, 0, 4, 1, 2, 3][i % 10];
console.log(JSON.stringify(TUNE.giant));
rageTable([
  ["0 v 0", { nD: 0, nA: 0 }],
  ["3 v 3 dân", { nD: 3, nA: 3 }],
  ["8 v 8 hỗn hợp", { nD: 8, nA: 8, tiersD: mix, tiersA: mix }],
  ["8 v 8 nhiều lính", { nD: 8, nA: 8, tiersD: rich, tiersA: rich }],
  ["30 v 30 hỗn hợp", { nD: 30, nA: 30, tiersD: mix, tiersA: mix }],
  ["120 v 120 hỗn hợp", { nD: 120, nA: 120, tiersD: mix, tiersA: mix }],
  ["8 v 8, cả 8 tim mỗi bên", { nD: 8, nA: 8, tiersD: mix, tiersA: mix, likeD: 8, likeA: 8 }],
  ["8 v 8, xanh 5 tim, đỏ 3", { nD: 8, nA: 8, tiersD: mix, tiersA: mix, likeD: 5, likeA: 3 }],
  ["8 v 8, xanh 3 tim, đỏ 5", { nD: 8, nA: 8, tiersD: mix, tiersA: mix, likeD: 3, likeA: 5 }],
  ["8 v 8, đỏ có 1 tướng", { nD: 8, nA: 8, tiersD: mix, tiersA: (i) => (i === 0 ? 6 : mix(i)) }],
  ["8 v 8, xanh có 1 tướng", { nD: 8, nA: 8, tiersA: mix, tiersD: (i) => (i === 0 ? 6 : mix(i)) }],
  ["8 v 8, đỏ +9%", { nD: 8, nA: 8, tiersD: mix, tiersA: mix, boost: { D: 1, A: 1.09 } }],
  ["8 v 8, xanh +9%", { nD: 8, nA: 8, tiersD: mix, tiersA: mix, boost: { D: 1.09, A: 1 } }],
], Number(process.argv[3]) || 50);

// Tries values of TUNE on a few cases of the ordinary match: node tools/tune-sweep.mjs '{"hallMax":520}' [runs]
import { TUNE } from "../src/game/battle.js";
import { table } from "./tune.mjs";
Object.assign(TUNE, JSON.parse(process.argv[2] || "{}"));
const mix = (i) => [0, 0, 0, 1, 0, 0, 2, 0, 1, 0, 0, 3, 0, 0, 1, 0, 0, 4, 0, 0][i % 20];
const rich = (i) => [0, 1, 2, 1, 3, 0, 4, 1, 2, 3][i % 10];
// a live as the rules make it now: mostly Dân, those who answered a question are Lính kiếm (no higher without an item),
// one in ten came from a small item
const live = (i) => [0, 0, 1, 0, 0, 1, 0, 1, 0, 2][i % 10];
console.log(process.argv[2] || "{}");
table([["8 v 8 thực tế", { nD: 8, nA: 8, tiersD: live, tiersA: live }], ["20 v 20 thực tế", { nD: 20, nA: 20, tiersD: live, tiersA: live }], ["50 v 50 thực tế", { nD: 50, nA: 50, tiersD: live, tiersA: live }],
  ["15 v 25 thực tế", { nD: 15, nA: 25, tiersD: live, tiersA: live }], ["25 v 15 thực tế", { nD: 25, nA: 15, tiersD: live, tiersA: live }], ["0 v 0", { nD: 0, nA: 0 }], ["3 v 3 dân", { nD: 3, nA: 3 }], ["8 v 8 dân", { nD: 8, nA: 8 }], ["8 v 8 hỗn hợp", { nD: 8, nA: 8, tiersD: mix, tiersA: mix }],
  ["8 v 8 nhiều lính", { nD: 8, nA: 8, tiersD: rich, tiersA: rich }], ["30 v 30 hỗn hợp", { nD: 30, nA: 30, tiersD: mix, tiersA: mix }], ["30 v 30 nhiều lính", { nD: 30, nA: 30, tiersD: rich, tiersA: rich }],
  ["120 v 120 hỗn hợp", { nD: 120, nA: 120, tiersD: mix, tiersA: mix }], ["8 v 16 hỗn hợp", { nD: 8, nA: 16, tiersD: mix, tiersA: mix }], ["16 v 8 hỗn hợp", { nD: 16, nA: 8, tiersD: mix, tiersA: mix }]], Number(process.argv[3]) || 50);

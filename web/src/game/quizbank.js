// The questions of this game (data/quiz400.js: "vui" fun ones, "biet" general knowledge, "meo" trick questions),
// without any whose answer is also a team word here ("thu", "đỏ", "xanh"…): answering must never choose a team.
import { QUIZ } from "../data/quiz400.js";
import { fold } from "./quiz.js";
import { readCommand } from "./rules.js";

export const BANK = QUIZ.filter((q) => q.a.every((a) => fold(a).split(" ").length <= 3) && !q.a.some((a) => readCommand(a) || readCommand(fold(a))));

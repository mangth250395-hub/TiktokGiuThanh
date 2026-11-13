import test from "node:test";
import assert from "node:assert/strict";
import { QUIZ } from "../src/data/quiz400.js";
import { BANK } from "../src/game/quizbank.js";
import { Quiz, fold } from "../src/game/quiz.js";
import { readCommand } from "../src/game/rules.js";

test("the bank: at least 400 questions of the three kinds, answers of at most 3 words, none twice", () => {
  assert.ok(BANK.length >= 400, `${BANK.length} questions kept of ${QUIZ.length}`);
  const kinds = { vui: 0, biet: 0, meo: 0 };
  const seen = new Set();
  for (const q of BANK) {
    assert.ok(q.k in kinds, `kind "${q.k}" (${q.q})`);
    kinds[q.k]++;
    assert.ok(q.q.trim().endsWith("?") && q.q.length <= 110, q.q);
    assert.ok(Array.isArray(q.a) && q.a.length >= 1, q.q);
    for (const a of q.a) assert.ok(fold(a) && fold(a).split(" ").length <= 3, `"${a}" (${q.q})`);
    assert.ok(!/đố mẹo/i.test(q.q), `the label is the game's: ${q.q}`);
    const key = fold(q.q);
    assert.ok(!seen.has(key), `twice: ${q.q}`);
    seen.add(key);
  }
  assert.ok(kinds.meo >= 90 && kinds.vui >= 120 && kinds.biet >= 150, JSON.stringify(kinds));
});

test("no answer of the quiz is read as thủ / đánh / đổi (answering never chooses a team)", () => {
  for (const q of BANK) for (const a of q.a) {
    assert.equal(readCommand(a), null, `"${a}" (${q.q})`);
    assert.equal(readCommand(fold(a)), null, `"${fold(a)}" without accents (${q.q})`);
  }
});

test("a right answer is found inside a comment, once per viewer, in time only; the kind comes with the question", () => {
  const quiz = new Quiz([{ k: "meo", q: "Món gì?", a: ["phở", "phở bò"] }], { rand: () => 0.5 });
  const c = quiz.start(1000);
  assert.equal(c.k, "meo");
  assert.equal(c.words, 1);
  assert.equal(quiz.check("1", "chắc là PHO", 2000), true);
  assert.equal(quiz.check("1", "phở", 3000), false);            // already found
  assert.equal(quiz.check("2", "bún", 3000), false);
  assert.equal(quiz.check("2", "phở", c.until + 1), false);     // too late
});

test("the questions never say xu or quà (they are read aloud); trick questions are spread out", () => {
  for (const q of QUIZ) assert.ok(!/(^|[^\p{L}])(xu|quà)(?![\p{L}])/iu.test(`${q.q} ${q.a.join(" ")}`), q.q);
  const quiz = new Quiz(BANK, { rand: (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })() });
  let last = "", twice = 0;
  for (let i = 0; i < 200; i++) { const c = quiz.start(i * 40_000); if (c.k === "meo" && last === "meo") twice++; last = c.k; }
  assert.ok(twice <= 2, `${twice} trick questions right after another`);
});

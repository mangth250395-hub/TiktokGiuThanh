// The quiz ("đố vui", asked by the user 10/11/2026): a question open QUIZ_OPEN_MS, answered by commenting one or two
// words; the first right answer of each viewer gives points to their province (rules.js quizRight). Then the answer
// is shown for QUIZ_REVEAL_MS and the next question comes. Questions go round the whole bank before one comes again.
import { QUIZ } from "../data/quiz400.js";

export const QUIZ_OPEN_MS = 30_000;    // 30 s to answer (the user, 10/11/2026: 25 s was too short), then the answer
export const QUIZ_REVEAL_MS = 5000;
export const QUIZ_BOARD_MS = 8000;     // someone was right: the ranking of the fastest stays a little longer

/** Text to compare: no accents, no case, no signs ("Phở!" = "pho", "Đà" = "da"). */
export function fold(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[đĐ]/g, "d").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim();
}

export class Quiz {
  constructor(bank = QUIZ, { rand = Math.random } = {}) {
    this.bank = bank;
    this.rand = rand;
    this.order = [];
    this.cur = null;
    this.last = -1;
    this.shuffle();                  // a new order at every start of the app
  }

  /** Shuffled anew (every start of the app, and the "Trộn câu hỏi" button), then spread: two questions of the same
   *  kind (a proverb, a riddle, a food question…) never follow each other, and an answer does not come back soon. */
  shuffle() {
    const idx = this.bank.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    const kind = (i) => this.bank[i].k === "meo" ? "meo" : this.bank[i].q.match(/^(Tục ngữ|Ca dao|Thành ngữ|Câu đố|Truyện[^:]*):/)?.[1] || "";
    const answer = (i) => fold(this.bank[i].a[0]);
    const out = [];
    while (idx.length) {
      const recentKinds = out.slice(-2).map(kind), recentAnswers = out.slice(-40).map(answer);
      let j = idx.findIndex((i) => !recentKinds.includes(kind(i)) && !recentAnswers.includes(answer(i)));
      if (j < 0) j = idx.findIndex((i) => kind(i) !== recentKinds[recentKinds.length - 1]);
      if (j < 0) j = 0;
      out.push(idx.splice(j, 1)[0]);
    }
    if (out.length > 1 && out[0] === this.last) out.push(out.shift());   // a new round never starts with the last one
    this.order = out.reverse();      // taken from the end
  }

  _next() {
    if (!this.order.length) this.shuffle();
    return (this.last = this.order.pop());
  }

  /** A new question: { q, t, shown (the answer said at the end), words, until, right: [names of all who found it],
   *  fast: [the first three, { name, avatar, s (seconds taken) }] }. Everyone right in time gets the points. */
  start(now = Date.now()) {
    const it = this.bank[this._next()];
    const keys = it.a.map(fold).filter(Boolean);
    this.cur = { q: it.q, k: it.k || "vui", shown: it.a[0], keys, words: fold(it.a[0]).split(" ").length,
      at: now, until: now + QUIZ_OPEN_MS, reveal: 0, right: [], fast: [], winners: [], answered: new Set() };
    return this.cur;
  }

  /** A comment of a viewer (key): true when it holds the answer and they had not found it yet. */
  check(key, text, now = Date.now()) {
    const c = this.cur;
    if (!c || c.reveal || now > c.until || c.answered.has(key)) return false;
    const f = ` ${fold(text)} `;
    if (!c.keys.some((k) => f.includes(` ${k} `))) return false;
    c.answered.add(key);
    return true;
  }

  /** Time is up: the answer is shown. */
  close(now = Date.now()) {
    if (this.cur) this.cur.reveal = now;
    return this.cur;
  }

  stop() { this.cur = null; }
}

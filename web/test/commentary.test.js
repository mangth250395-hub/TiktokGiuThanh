import test from "node:test";
import assert from "node:assert/strict";
import { Game, newState } from "../src/game/rules.js";
import { Battle } from "../src/game/battle.js";
import { Commentator, PRI } from "../src/game/commentary.js";

function rng(seed = 1) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }
const user = (id, name) => ({ id: String(id), unique_id: `u${id}`, nickname: name });
function setup() {
  const clock = { t: 1_000_000 };
  const game = new Game(newState()), battle = new Battle({ rand: rng(3) });
  const talk = new Commentator(game, battle, { now: () => clock.t, rand: rng(7) });
  return { game, battle, talk, clock };
}
const gift = (game, id, name, each, count = 1) => {
  const ev = { user: user(id, name), gift: { name: "Rose", diamonds: each }, count, coins: each * count };
  return [...game.gift(ev), ...game.giftDone(ev)];
};

// TikTok flags begging: the commentator never says "xu" or "quà", and never asks for gifts, likes, shares or follows
// ... and never the word "máu" (the user, 11/11/2026): strength is "sức"
const FORBIDDEN = /(^|[^\p{L}])(xu|quà|máu)(?![\p{L}])|tặng|thả tim|hãy chia sẻ|hãy theo dõi|bấm theo dõi|nhấn theo dõi|chia sẻ live/iu;

test("no line ever says xu or quà, or asks for anything", () => {
  const { game, battle, talk, clock } = setup();
  const lines = [];
  const say = (list) => { for (const l of list) if (l) lines.push(l.text); };
  for (let round = 0; round < 6; round++) {
    say(talk.onEffects(game.comment({ user: user(round * 10 + 1, "Lan"), text: "thủ" })));
    say(talk.onEffects(game.comment({ user: user(round * 10 + 2, "Minh"), text: "hello" })));
    say(talk.onEffects(game.comment({ user: user(round * 10 + 1, "Lan"), text: "đổi" })));
    say(talk.onEffects(game.comment({ user: user(round * 10 + 1, "Lan"), text: "đánh" })));
    for (const each of [1, 5, 10, 20, 30, 99, 7, 50, 500]) { say(talk.onEffects(gift(game, round * 10 + 3 + (each % 3), "Hoa", each, 1 + (round % 2)))); clock.t += 1500; say(talk.flush()); }
    say(talk.onEffects(game.quizRight({ user: user(round * 10 + 2, "Minh") })));
    say(talk.onEffects(game.quizRight({ user: user(round * 10 + 2, "Minh") })));
    say(talk.onEffects(game.follow({ user: user(round * 10 + 2, "Minh") })));
    say(talk.onEffects(game.share({ user: user(round * 10 + 2, "Minh") })));
    for (let n = 0; n < 7; n++) say(talk.onEffects(game.died(String(round * 10 + 3), n)));
    for (let n = 0; n < 7; n++) say(talk.onEffects(game.died(String(round * 10 + 4), n)));
    say(talk.onEffects([{ type: "countdown", seconds: 60 }, { type: "countdown", seconds: 30 }, { type: "countdown", seconds: 10 }]));
    say(talk.onBattle([
      { type: "wave", n: 2 + round, came: { D: 4, A: 5 } }, { type: "wave", n: 9, came: { D: 0, A: 0 } },
      { type: "first_blood", key: "1", name: "Lan", team: "D", victim: "Minh" },
      { type: "streak", key: "1", name: "Lan", team: "D", n: [3, 5, 8, 12][round % 4] },
      { type: "died", key: "5", name: "Hoa", tier: 6, lane: "N", byKey: "1", byName: "Lan", byTier: round % 2 ? 0 : 3 },
      { type: "died", key: "6", name: "Tí", tier: 5, lane: "S", byKey: null, byName: "", byTier: 0 },
      { type: "gate_half", face: "N" }, { type: "breach", face: "E", key: round % 2 ? "1" : null, name: "Lan" }, { type: "rebuilt", face: "E" },
      { type: "hall_mark", mark: 0.5 }, { type: "hall_mark", mark: 0.25 },
      { type: "giant_mark", team: round % 2 ? "D" : "A", mark: 0.5 }, { type: "giant_mark", team: round % 2 ? "A" : "D", mark: 0.25 },
    ]));
    say([talk.matchStart(4, [], "rage", round % 2 ? "D" : "A"), talk.matchStart(5, [], null, null, true)]);
    say(talk.onBattle([{ type: "giant_lead", team: round % 2 ? "D" : "A" }]));
    for (const x of [
      { n: 3, kind: null, winner: "A", reason: "fell", hallLeft: 0, wins: { D: 0, A: 3 }, final: false, nextKind: "rage", lead: "A", resting: 2, board: {} },
      { n: 4, kind: "rage", winner: "D", reason: round % 2 ? "giant" : "time", hallLeft: 1, wins: { D: 3, A: 3 }, final: false, levelled: true, nextKind: null, lead: "A", board: {} },
      { n: 4, kind: "rage", winner: "A", reason: "giant", hallLeft: 1, wins: { D: 0, A: 4 }, final: true, lead: "A", board: {},
        series: { n: 1, matches: 4, wins: { D: 0, A: 4 }, winner: "A", top: [] } },
    ]) say(talk.matchScript(x));
    say([talk.matchStart(round + 1, round ? [{ key: "1" }] : []), talk.quizAsk({ q: "Con gì kêu meo meo?", k: ["vui", "biet", "meo"][round % 3] }),
      talk.quizResult({ shown: "mèo", right: round % 2 ? ["Lan", "Minh", "Hoa", "Tí"] : [] }, round % 2 ? ["Lan", "Minh", "Hoa"] : [])]);
    for (let i = 0; i < 12; i++) say([talk.filler()]);
    const e = game.endMatch(round % 2 ? "A" : "D", "time", { killer: { key: String(round * 10 + 3), value: 4 } }, round % 2 ? 0 : 0.08 + round * 0.1);
    say(talk.matchScript(e));
    clock.t += 70_000;
    say(talk.flush());
  }
  assert.ok(lines.length > 150, `${lines.length} lines`);
  for (const l of lines) {
    assert.ok(!FORBIDDEN.test(l), `forbidden: ${l}`);
    assert.ok(!/undefined|NaN|null|\[object/.test(l), `broken: ${l}`);
    assert.ok(l.length < 200, `too long (${l.length}): ${l}`);
  }
});

test("an item that stands out is thanked at once, with what the giver became; small ones are gathered", () => {
  const { game, talk, clock } = setup();
  game.comment({ user: user(1, "Lan"), text: "thủ" });
  let out = talk.onEffects(gift(game, 1, "Lan", 99));
  assert.equal(out.length, 1);
  assert.equal(out[0].pri, PRI.BIG);
  assert.match(out[0].text, /Lan/);
  assert.match(out[0].text, /Tướng/);
  assert.equal(out[0].cam, "u:1");
  game.comment({ user: user(2, "Minh"), text: "đánh" });
  game.comment({ user: user(3, "Hoa"), text: "đánh" });
  out = talk.onEffects(gift(game, 2, "Minh", 1));
  out.push(...talk.onEffects(gift(game, 3, "Hoa", 1)));
  assert.deepEqual(out, []);                                    // gathered
  clock.t += 5000;
  out = talk.flush().filter((l) => l.pri === PRI.THANKS);
  assert.equal(out.length, 1);
  assert.match(out[0].text, /Minh và Hoa|Hoa và Minh/);
});

test("several of one rank at once are told as several; the same wording never comes twice in a row", () => {
  const { game, talk } = setup();
  game.comment({ user: user(1, "Lan"), text: "thủ" });
  const out = talk.onEffects(gift(game, 1, "Lan", 500));          // 5 Tướng + 1 Lính giáo
  assert.match(out[0].text, /năm Tướng|Tướng của Lan.*năm người/);
  let last = "";
  for (let i = 0; i < 40; i++) {
    const t = talk.onBattle([{ type: "first_blood", key: "1", name: "Lan", team: "D" }])[0].text;
    assert.notEqual(t, last);
    last = t;
  }
  const seen = new Set();
  for (let i = 0; i < 90; i++) seen.add(talk.filler().text);
  assert.ok(seen.size >= 30, `${seen.size} different lines when it is quiet`);
});

test("an item is cheered by how it compares with what has been coming, not by its value alone", () => {
  const { game, talk, clock } = setup();
  const names = ["An", "Bình", "Chi", "Dũng", "Giang", "Hà", "Khoa", "Lan", "Minh", "Nga", "Oanh", "Phúc"];
  names.forEach((n, i) => game.comment({ user: user(i + 1, n), text: i % 2 ? "thủ" : "đánh" }));
  const give = (i, each) => { clock.t += 2000; return talk.onEffects(gift(game, i, names[i - 1], each)); };
  assert.deepEqual(give(1, 1), []);                              // small ones are gathered
  assert.deepEqual(give(2, 1), []);
  assert.deepEqual(give(3, 1), []);
  assert.match(talk.flush().find((l) => l.pri === PRI.THANKS).text, /Mở hàng|bất ngờ|Ấm lòng|Cảm ơn An, Bình và Chi/);
  let out = give(4, 5);                                          // five times the usual of the last minute
  assert.match(out[0].text, /mặt bằng|Nổi bật|vượt hẳn/);
  out = give(5, 99);                                             // the biggest since the start
  assert.match(out[0].text, /Lớn nhất|Kỷ lục|kỷ lục/);
  assert.equal(out[0].pri, PRI.BIG);
  for (let i = 6; i <= 11; i++) give(i, 99);                     // then everyone sends as much
  assert.deepEqual(give(12, 99), []);                            // it no longer stands out: thanked with the others
  clock.t += 5000;
  assert.ok(talk.flush().some((l) => l.pri === PRI.THANKS && /bạn khác/.test(l.text)));      // one line for them all
});

test("the fastest right answers are named in order, then how many more were right", () => {
  const { talk } = setup();
  assert.match(talk.quizResult({ shown: "mèo", right: ["Lan", "Minh", "Hoa", "Tí", "Bo"] }, ["Lan", "Minh", "Hoa"]).text, /^Đáp án là mèo\. .*Lan.*Minh.*Hoa.*hai bạn/);
  assert.match(talk.quizResult({ shown: "mèo", right: ["Lan"] }, ["Lan"]).text, /Lan/);
  assert.match(talk.quizResult({ shown: "mèo", right: [] }, []).text, /^Đáp án là mèo\. /);
});

test("the turns of the match come before greetings; a leader's fall is told with who did it", () => {
  const { talk } = setup();
  const out = talk.onBattle([
    { type: "breach", face: "N", key: null, name: "" },
    { type: "died", key: "5", name: "Hoa", tier: 6, lane: "N", byKey: "1", byName: "Tí", byTier: 0 },
    { type: "died", key: "7", name: "Bo", tier: 2, lane: "N", byKey: "1", byName: "Tí", byTier: 1 },
  ]);
  assert.equal(out.length, 2);
  assert.ok(out[0].pri > PRI.JOIN && out[1].pri > PRI.JOIN);
  assert.match(out[0].text, /bắc/);
  assert.match(out[1].text, /Dân Tí.*Tướng Hoa/);
});

test("a rank earned with a right answer is told with why; the character of the comment falls back to Dân", () => {
  const { game, talk } = setup();
  game.comment({ user: user(1, "Lan"), text: "thủ" });
  let out = talk.onEffects(game.quizRight({ user: user(1, "Lan") }));
  assert.equal(out.length, 1);
  assert.match(out[0].text, /Lan trả lời đúng.*Lính kiếm/);
  out = talk.onEffects(gift(game, 1, "Lan", 99));
  assert.match(out[0].text, /Tướng của Lan/);                   // one more character, not a new rank for the first
  out = talk.onEffects(game.quizRight({ user: user(1, "Lan") }));     // already a Lính kiếm: one more Dân
  assert.match(out[0].text, /Lan.*thêm một Dân/);
  game.quizRight({ user: user(1, "Lan") });                           // that Dân becomes a Lính kiếm
  out = talk.onEffects(game.quizRight({ user: user(1, "Lan") }));     // all soldiers: strength back
  assert.match(out[0].text, /Lan.*hồi sức/);
  assert.deepEqual(talk.onEffects(game.died("1", 1)), []);      // the general (an item) is gone: the field tells of its fall
  out = talk.onEffects(game.died("1", 0));                      // the character of the comment (a Lính kiếm)
  assert.equal(out.length, 1);
  assert.match(out[0].text, /Lính kiếm của Lan.*Dân/);
});

test("the match of fury is told: how it starts, a giant in danger, how it ends, what it does to the series", () => {
  const { talk, battle } = setup();
  assert.match(talk.matchStart(4, [], "rage", "A").text, /[Tt]rận nộ/);
  assert.match(talk.matchStart(4, [], "rage", "A").text, /Thành Xanh/);         // the team behind: its last chance
  assert.match(talk.matchStart(5, [], null, null, true).text, /hoà|ngang nhau/);          // after the level: an ordinary match that settles it
  const out = talk.onBattle([{ type: "giant_mark", team: "D", mark: 0.25 }]);
  assert.match(out[0].text, /khổng lồ Thành Xanh/);
  assert.equal(out[0].cam, "G");
  let lines = talk.matchScript({ n: 4, kind: "rage", winner: "D", reason: "giant", hallLeft: 1, wins: { D: 3, A: 3 }, final: false, levelled: true, nextKind: null, lead: "A", board: {} }).map((l) => l.text);
  assert.match(lines[0], /khổng lồ Quân Đỏ.*Thành Xanh thắng trận nộ/);
  assert.ok(lines.some((l) => /ba đều/.test(l)));
  lines = talk.matchScript({ n: 3, kind: null, winner: "A", reason: "fell", hallLeft: 0, wins: { D: 0, A: 3 }, final: false, nextKind: "rage", lead: "A", board: {} }).map((l) => l.text);
  assert.ok(lines.some((l) => /trận nộ/.test(l) && /Thành Xanh/.test(l)));
  battle.reset([], { rage: true });
  const quiet = new Set();
  for (let i = 0; i < 30; i++) quiet.add(talk.filler().text);
  assert.ok(quiet.size >= 12, `${quiet.size} different lines`);
  assert.ok(![...quiet].some((l) => /cừu|cánh cổng|gõ thủ|vá cổng/i.test(l)), "in the match of fury every quiet line is about the fight");
  assert.ok([...quiet].filter((l) => /khổng lồ/.test(l)).length >= 6);
  // those who give their giant strength are named, and a change of lead is told
  const { game: g2, talk: t2, battle: b2, clock } = setup();
  g2.comment({ user: user(1, "Lan"), text: "thủ" });
  g2.startRage("A");
  b2.reset(g2.roster(), { rage: true });
  assert.deepEqual(t2.onEffects(g2.like({ user: user(1, "Lan"), count: 15 })), []);       // gathered
  clock.t += 8000;
  const fedLine = t2.flush().find((l) => /Lan/.test(l.text));
  assert.ok(fedLine && /Thành Xanh/.test(fedLine.text) && fedLine.cam === "G");
  assert.match(t2.onBattle([{ type: "giant_lead", team: "A" }])[0].text, /Quân Đỏ/);
});

test("a trick question is announced as one", () => {
  const { talk } = setup();
  assert.match(talk.quizAsk({ q: "Cái gì càng rửa càng bẩn?", k: "meo" }).text, /^Đố mẹo!/);
  assert.match(talk.quizAsk({ q: "Thủ đô nước ta là gì?", k: "biet" }).text, /^Đố hiểu biết!/);
  assert.match(talk.quizAsk({ q: "Con gì?", k: "vui" }).text, /^Đố vui!/);
});

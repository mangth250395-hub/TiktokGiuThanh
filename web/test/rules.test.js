import test from "node:test";
import assert from "node:assert/strict";
import { Game, newState, readCommand, giftTier, giftSplit, GIANT, TIERS, STEP, FREE_MAX, FREE_UNITS, HEAL, MAX_UNITS } from "../src/game/rules.js";

const user = (id, name = `Bạn ${id}`) => ({ id: String(id), unique_id: `u${id}`, nickname: name });
const types = (out) => out.map((e) => e.type);
const gift = (g, id, each, count = 1) => g.gift({ user: user(id), gift: { name: "Hoa", diamonds: each }, count, coins: each * count });

test("commands: thủ / đánh / đổi, with or without accents, only in a short comment", () => {
  assert.deepEqual(readCommand("thủ"), { kind: "join", team: "D" });
  assert.deepEqual(readCommand("Giữ thành!"), { kind: "join", team: "D" });
  assert.deepEqual(readCommand("xanh"), { kind: "join", team: "D" });
  assert.deepEqual(readCommand("em vào đánh nha"), { kind: "join", team: "A" });
  assert.deepEqual(readCommand("danh"), { kind: "join", team: "A" });
  assert.deepEqual(readCommand("đỏ"), { kind: "join", team: "A" });
  assert.deepEqual(readCommand("đổi"), { kind: "switch", team: null });
  assert.deepEqual(readCommand("doi sang thu"), { kind: "switch", team: "D" });
  assert.equal(readCommand("thư"), null);                       // another word
  assert.equal(readCommand("hôm nay tôi đánh răng rồi mới đi ngủ"), null);
  assert.equal(readCommand("thủ đánh"), null);                  // both teams: nothing
  assert.equal(readCommand("mùa thu vàng"), null);
});

test("any comment gives a character: the named team, or else the team with fewer people", () => {
  const g = new Game(newState());
  assert.deepEqual(types(g.comment({ user: user(1), text: "thủ" })), ["join"]);
  assert.equal(g.s.users["1"].team, "D");
  const out = g.comment({ user: user(2), text: "chào cả nhà" });
  assert.equal(out[0].type, "join");
  assert.equal(out[0].auto, true);
  assert.equal(g.s.users["2"].team, "A");                       // D has one, A none
  g.comment({ user: user(3), text: "đánh" });
  assert.equal(g.comment({ user: user(4), text: "phở" }).find((e) => e.type === "join").team, "D");
  assert.deepEqual(g.comment({ user: user(5), text: "   " }), []);   // nothing said
  assert.equal(g.members("D"), 2);
  assert.equal(g.members("A"), 2);
  assert.equal(types(g.comment({ user: user(1), text: "lại là tôi" })).join(), "cheer");   // once only
});

test("đổi: the other team when the gates next open, once per match", () => {
  const g = new Game(newState());
  g.comment({ user: user(1), text: "thủ" });
  assert.equal(g.comment({ user: user(1), text: "đánh" })[0].type, "locked");
  assert.equal(g.comment({ user: user(1), text: "đổi" })[0].type, "switch_planned");
  assert.equal(g.s.users["1"].team, "D");                       // not before the gate
  const moved = g.wave();
  assert.equal(moved.length, 1);
  assert.equal(g.s.users["1"].team, "A");
  assert.equal(g.members("A"), 1);
  const again = g.comment({ user: user(1), text: "đổi" });
  assert.equal(again[0].type, "locked");
  assert.equal(again[0].once, true);
  assert.deepEqual(g.wave(), []);
});

const ranks = (g, id) => g.bodies(String(id)).map((b) => b.tier);

test("every item adds one more character of its rank for the giver, up to 30; past that an item gives life back", () => {
  assert.equal(giftTier(1).rank, 1);
  assert.equal(giftTier(99).rank, 6);
  assert.equal(giftTier(50).rank, 5);                           // between two values: the lower one
  assert.equal(MAX_UNITS, 30);
  const g = new Game(newState());
  g.comment({ user: user(1), text: "thủ" });
  assert.deepEqual(ranks(g, 1), [0]);                           // the character of their comment
  let out = gift(g, 1, 10);
  assert.deepEqual(types(out), ["giving", "spawn"]);
  assert.deepEqual([out[1].unit, out[1].tier], [1, 3]);
  assert.equal(out[0].added, 1);
  assert.deepEqual(ranks(g, 1), [0, 3]);                        // the first one is still there
  assert.deepEqual(g.bodies("1").map((b) => b.uk), ["1#0", "1#1"]);
  out = gift(g, 1, 1, 3);                                       // a combo of three: three more
  assert.deepEqual(types(out), ["giving", "spawn", "spawn", "spawn"]);
  assert.deepEqual(ranks(g, 1), [0, 3, 1, 1, 1]);
  gift(g, 1, 99);
  assert.equal(g.view("1").tier, 6);                            // their best one frames their picture
  assert.equal(g.giftDone({ user: user(1), gift: { diamonds: 99 }, count: 1, coins: 99 })[0].added, 5);   // all the gifts since the last thanks
  for (let i = 0; i < 30; i++) gift(g, 1, 5);
  assert.equal(g.bodies("1").length, 30);                       // never more
  g.giftDone({ user: user(1), gift: { diamonds: 5 }, count: 1, coins: 5 });
  out = gift(g, 1, 99, 2);                                      // at the limit: life back for one of theirs, once
  assert.deepEqual(types(out), ["giving", "heal"]);
  assert.deepEqual([out[0].added, out[1].part, out[1].why], [0, 1, "gift"]);
  assert.equal(g.giftDone({ user: user(1), gift: { diamonds: 99 }, count: 2, coins: 198 })[0].added, 0);
  // someone who never spoke: the item puts them in a team, with the character of a comment and the one of the item
  out = gift(g, 7, 5);
  assert.equal(out[0].type, "join");
  assert.deepEqual(ranks(g, 7), [0, 2]);
});

test("after a match a Dân rests until its owner comments again; a rank or an item's character comes out by itself", () => {
  const g = new Game(newState());
  for (const [id, text] of [[1, "thủ"], [2, "đánh"], [3, "thủ"], [4, "đánh"]]) g.comment({ user: user(id), text });
  g.quizRight({ user: user(2) });                                // 2: a Lính kiếm
  gift(g, 3, 5);                                                 // 3: a Dân and a Lính giáo
  g.s.match.elapsed = 100_000;
  g.comment({ user: user(4), text: "hello" });                   // 4 spoke just before the end: plainly here
  g.s.match.elapsed = 120_000;
  const e = g.endMatch("D", "time");
  assert.equal(e.resting, 2);                                    // 1, and the Dân of 3
  assert.deepEqual(g.roster().map((b) => b.uk), ["2#0", "3#1", "4#0"]);
  assert.deepEqual([g.members("D"), g.members("A")], [1, 2]);    // 1 is not counted while resting; 3 still has a character in play
  g.like({ user: user(1), count: 50 });                          // a like is not a comment
  assert.deepEqual(g.bodies("1"), []);
  let out = g.comment({ user: user(1), text: "alo" });
  assert.deepEqual(types(out), ["back", "cheer"]);
  assert.deepEqual(g.roster().map((b) => b.uk), ["1#0", "2#0", "3#1", "4#0"]);
  assert.equal(g.members("D"), 2);
  assert.deepEqual(types(g.comment({ user: user(1), text: "alo" })), ["cheer"]);     // only once
  out = g.quizRight({ user: user(3) });                          // a right answer is a comment too
  assert.ok(types(out).includes("back"));
  assert.deepEqual(ranks(g, 3), [1, 2]);
  assert.equal(g.endMatch("A", "fell").resting, 1);              // 4 is still a Dân and said nothing in this match
});

test("an item whose value is not one of the six is dealt into characters, the biggest first, nothing lost", () => {
  assert.deepEqual(giftSplit(99), [6]);
  assert.deepEqual(giftSplit(50), [5, 4]);                       // 30 + 20
  assert.deepEqual(giftSplit(199), [6, 6, 1]);                   // 99 + 99 + 1
  assert.deepEqual(giftSplit(7), [2, 1, 1]);                     // 5 + 1 + 1
  assert.deepEqual(giftSplit(0.4), [1]);                         // never nothing
  assert.equal(giftSplit(50000).length, 30);                     // never more than one viewer can own
  for (const v of [2, 3, 15, 29, 42, 98, 100, 500, 1234]) assert.equal(giftSplit(v).reduce((n, r) => n + TIERS[r].gift, 0), v);
  const g = new Game(newState());
  g.comment({ user: user(1), text: "thủ" });
  let out = gift(g, 1, 50);
  assert.deepEqual(types(out), ["giving", "spawn", "spawn"]);
  assert.deepEqual(out[0].units, [[5, 1], [4, 1]]);
  assert.deepEqual([out[0].rank, out[0].added], [5, 2]);
  assert.deepEqual(ranks(g, 1), [0, 5, 4]);
  out = gift(g, 1, 7, 2);                                        // two items of 7: each is dealt
  assert.deepEqual(out[0].units, [[2, 2], [1, 4]]);
  assert.deepEqual(ranks(g, 1), [0, 5, 4, 2, 1, 1, 2, 1, 1]);
  const done = g.giftDone({ user: user(1), gift: { diamonds: 7 }, count: 2, coins: 14 })[0];
  assert.deepEqual([done.rank, done.same, done.added], [5, 1, 8]);     // everything since the last thanks: the best one, how many of it
  out = gift(g, 1, 500);                                         // 5 x 99 + 5
  assert.deepEqual(out[0].units, [[6, 5], [2, 1]]);
  assert.deepEqual([g.giftDone({ user: user(1), gift: { diamonds: 500 }, count: 1, coins: 500 })[0].same], [5]);
});

test("right answers, in order: their Dân becomes a Lính kiếm, then one more Dân, then that one a Lính kiếm, then strength back", () => {
  assert.equal(STEP, 10);
  assert.equal(TIERS[FREE_MAX].name, "Lính kiếm");
  const g = new Game(newState());
  g.comment({ user: user(1), text: "thủ" });
  gift(g, 1, 1);                                                // one more character: the answer is for the first
  let out = g.quizRight({ user: user(1) });
  const up = out.find((e) => e.type === "promote");
  assert.deepEqual([up.free, up.unit, up.from, up.tier, up.why], [true, 0, 0, 1, "quiz"]);
  assert.deepEqual(ranks(g, 1), [1, 1]);
  assert.equal(FREE_UNITS, 2);
  out = g.quizRight({ user: user(1) });                         // no higher without an item: one more Dân instead
  const more = out.find((e) => e.type === "recruit");
  assert.ok(more && !out.some((e) => e.type === "promote"));
  assert.deepEqual(g.bodies("1").map((b) => [b.n, b.tier, b.item]), [[0, 1, false], [1, 1, true], [2, 0, false]]);
  out = g.quizRight({ user: user(1) });                         // that Dân becomes a Lính kiếm
  assert.deepEqual([out.find((e) => e.type === "promote").unit, ranks(g, 1)], [2, [1, 1, 1]]);
  out = g.quizRight({ user: user(1) });                         // all of them soldiers: strength back
  assert.ok(!out.some((e) => e.type === "promote" || e.type === "recruit"));
  const heal = out.find((e) => e.type === "heal");
  assert.ok(heal.part > 0.3 && heal.why === "quiz");
  // the Dân a right answer added is like the one of the comment: it falls back to Dân, it is never lost
  assert.equal(g.died("1", 2)[0].type, "demoted");
  assert.equal(g.died("1", 1)[0].type, "lost");                 // the one from an item is gone
  assert.deepEqual(g.bodies("1").map((b) => [b.n, b.tier]), [[0, 1], [2, 0]]);
  assert.ok(g.quizRight({ user: user(1) }).some((e) => e.type === "promote"));      // a Dân again: up again first
  // an answer before they have a character counts when they get one
  const g3 = new Game(newState());
  g3.quizRight({ user: user(3) });
  assert.equal(g3.s.users["3"].team, null);
  assert.ok(g3.comment({ user: user(3), text: "alo" }).some((e) => e.type === "promote"));
  assert.deepEqual(ranks(g3, 3), [1]);
});

test("likes, shares and follows are cheap: a little life back for one character, never a rank", () => {
  const g = new Game(newState());
  g.comment({ user: user(2), text: "đánh" });
  // hearts are counted: nothing before the count (10), then exactly what the label says (5), the rest waits
  let out = g.like({ user: user(2), count: 6 });
  assert.equal(out.some((e) => e.type === "heal"), false);
  assert.ok(out.some((e) => e.type === "hurry"));
  assert.equal(g.like({ user: user(2), count: 6 }).find((e) => e.type === "heal").hp, HEAL.like);      // 12: one count, 2 wait
  assert.equal(g.like({ user: user(2), count: 7 }).some((e) => e.type === "heal"), false);             // 9 waiting
  assert.equal(g.like({ user: user(2), count: 1 }).find((e) => e.type === "heal").hp, HEAL.like);      // the tenth
  assert.equal(g.like({ user: user(2), count: 5000 }).find((e) => e.type === "heal").hp, HEAL.like);   // a flood gives once
  assert.equal(g.like({ user: user(2), count: 1 }).find((e) => e.type === "heal").hp, HEAL.like);      // and one more count was kept, no more
  assert.equal(g.like({ user: user(2), count: 1 }).some((e) => e.type === "heal"), false);
  assert.deepEqual([HEAL.likes, HEAL.like], [10, 5]);            // the user's numbers
  out = g.share({ user: user(2) });
  assert.equal(out.find((e) => e.type === "heal").hp, HEAL.share);
  assert.ok(!g.share({ user: user(2) }).some((e) => e.type === "heal"));       // once a minute
  assert.equal(g.follow({ user: user(2) }).find((e) => e.type === "heal").hp, HEAL.follow);
  assert.deepEqual(g.follow({ user: user(2) }), []);            // once ever
  assert.deepEqual(ranks(g, 2), [0]);                           // thousands of likes: still a Dân
  assert.deepEqual(g.like({ user: user(9), count: 30 }), []);   // someone with no character: nothing, and not kept
  assert.equal(g.s.users["9"], undefined);
  assert.equal(g.follow({ user: user(9) })[0].type, "followed");
  assert.equal(g.s.users["9"], undefined);
});

test("falling: the character of the comment comes back as a Dân; one that came from an item is gone", () => {
  const g = new Game(newState());
  g.comment({ user: user(1), text: "thủ" });
  gift(g, 1, 99); gift(g, 1, 20);
  g.quizRight({ user: user(1) });
  assert.deepEqual(ranks(g, 1), [1, 6, 4]);
  let out = g.died("1", 1);                                     // the general, from an item
  assert.deepEqual(types(out), ["lost"]);
  assert.deepEqual([out[0].unit, out[0].from, out[0].units], [1, 6, 2]);
  assert.deepEqual(g.bodies("1").map((b) => `${b.uk}:${b.tier}`), ["1#0:1", "1#2:4"]);
  assert.deepEqual(g.died("1", 1), []);                         // it is no longer theirs
  out = g.died("1", 0);                                         // the one of their comment
  assert.deepEqual([out[0].type, out[0].from], ["demoted", 1]);
  assert.equal(g.died("1", 0)[0].type, "fell");                 // a Dân stays a Dân
  g.died("1", 2);
  assert.deepEqual(ranks(g, 1), [0]);                           // they always keep the character of their comment
  out = gift(g, 1, 1);                                          // a new one never takes the key of one that is gone
  assert.equal(out[1].unit, 3);
  assert.deepEqual(g.died("nobody", 0), []);
});

test("the end of a match ranks the two teams, with what each did on the field", () => {
  const g = new Game(newState());
  for (let i = 1; i <= 8; i++) g.comment({ user: user(i), text: i % 2 ? "thủ" : "đánh" });
  gift(g, 2, 5);                                                // 25 points
  g.quizRight({ user: user(1) });                               // 10 points
  const scores = new Map([["3", { score: 40, kills: 3 }], ["4", { score: 12, kills: 1 }], ["1", { score: 5, kills: 0 }], ["77", { score: 99, kills: 9 }]]);
  assert.equal(g.topPeople(1, g.s.match.people, scores)[0].key, "3");     // the live ranking counts the field too
  const e = g.endMatch("D", "time", { killer: { key: "3", value: 3 }, nobody: { key: "9", value: 1 } }, 0.5, scores);
  assert.deepEqual(e.board.D.map((p) => [p.key, p.points, p.kills]), [["3", 40, 3], ["1", 15, 0]]);
  assert.deepEqual(e.board.A.map((p) => [p.key, p.points, p.units]), [["2", 25, 2], ["4", 12, 1]]);
  assert.deepEqual(e.size, { D: 4, A: 4 });
  assert.equal(e.people[0].key, "3");
  assert.equal(e.awards.killer.name, "Bạn 3");
  assert.equal(e.awards.nobody, undefined);
  assert.equal(e.final, false);
  assert.ok(g.s.boost.A > 1 && g.s.boost.D === 1);              // the loser starts a little stronger
});

test("one comment is good for the whole series; when the series is over everyone comments again", () => {
  const g = new Game(newState());
  g.setSeries(2);
  g.comment({ user: user(1), text: "thủ" });
  g.comment({ user: user(2), text: "đánh" });
  gift(g, 2, 30);
  g.s.users["1"].seen = 0;                                      // gone from the live for a long time: still in
  let e = g.endMatch("A", "fell", {}, 0);
  assert.equal(e.final, false);
  assert.equal(g.s.match.n, 2);
  assert.deepEqual(g.roster().map((b) => `${b.uk}:${b.tier}`), ["1#0:0", "2#0:0", "2#1:5"]);     // those who did not fall are kept for the next match
  assert.deepEqual(types(g.comment({ user: user(1), text: "tôi đây" })), ["cheer"]);              // no second character
  e = g.endMatch("D", "time", {}, 0.4);
  assert.equal(e.final, true);
  assert.equal(e.series.winner, null);                          // 1 : 1
  assert.equal(e.series.top[0].key, "2");
  assert.equal(e.series.top[0].tier, 5);                        // shown as they were
  assert.equal(g.s.match.n, 1);
  assert.deepEqual(g.s.users, {});                              // a new series: nobody is in it yet
  assert.deepEqual([g.members("D"), g.members("A"), g.roster().length], [0, 0, 0]);
  assert.deepEqual(g.s.boost, { D: 1, A: 1 });
  assert.equal(g.comment({ user: user(1), text: "chơi tiếp" })[0].type, "join");                  // they comment again
  g.resetSeries();                                              // the button does the same
  assert.deepEqual(g.s.users, {});
});

test("a team that cannot be caught: the match of fury; the leader wins it and the series is over, the other wins it and they play on, level", () => {
  // 3 - 0: the 4th match is the match of fury; the team ahead wins it: over at once, 4 - 0
  let g = new Game(newState());
  g.comment({ user: user(1), text: "thủ" });
  let e;
  for (let i = 0; i < 2; i++) { e = g.endMatch("A", "fell"); assert.deepEqual([e.final, e.nextKind], [false, null]); }
  e = g.endMatch("A", "fell");
  assert.deepEqual([e.final, e.nextKind, e.lead, g.s.match.n, g.s.match.kind], [false, "rage", "A", 4, "rage"]);
  e = g.endMatch("A", "giant");
  assert.deepEqual([e.kind, e.final, e.series.winner, e.series.wins.A, e.series.wins.D, e.series.matches], ["rage", true, "A", 4, 0, 4]);
  assert.deepEqual([g.s.match.n, g.s.match.kind, g.s.series.rage], [1, null, null]);        // a new series
  // 3 - 1 after four: the other team wins the match of fury: level 3 - 3, one last match decides
  g = new Game(newState());
  for (const w of ["D", "A", "D"]) g.endMatch(w, "time");
  e = g.endMatch("D", "time");
  assert.deepEqual([e.nextKind, e.lead, e.wins.D, e.wins.A], ["rage", "D", 3, 1]);
  e = g.endMatch("A", "giant");
  assert.deepEqual([e.final, e.levelled, e.nextKind, e.wins.D, e.wins.A, g.s.match.kind, g.s.match.n], [false, true, null, 3, 3, null, 6]);   // on with an ordinary match
  e = g.endMatch("A", "fell");
  assert.deepEqual([e.kind, e.final, e.series.winner, e.series.wins.A, e.series.wins.D, e.series.matches], [null, true, "A", 4, 3, 6]);       // level as they were: its winner has the series
  // 3 - 0, then level in the 4th: the 5th is an ordinary match and settles it; no second match of fury
  g = new Game(newState());
  for (let i = 0; i < 3; i++) g.endMatch("D", "time");
  e = g.endMatch("A", "giant");
  assert.deepEqual([e.levelled, e.wins.D, e.wins.A, g.s.match.n, g.s.match.kind], [true, 3, 3, 5, null]);
  e = g.endMatch("D", "time");
  assert.deepEqual([e.final, e.nextKind, e.series.winner, e.series.matches], [true, null, "D", 5]);
  // 3 - 2 after all five: still one chance for the team behind
  g = new Game(newState());
  for (const w of ["D", "A", "D", "A"]) assert.equal(g.endMatch(w, "time").nextKind, null);
  assert.equal(g.endMatch("D", "time").nextKind, "rage");
  // likes in the match of fury go to the giant of the viewer's team, a little at a time for each viewer
  g = new Game(newState());
  g.comment({ user: user(1), text: "thủ" });
  g.startRage("A");
  assert.deepEqual([g.s.match.kind, g.s.series.lead, g.s.series.wins.A, g.s.series.wins.D], ["rage", "A", 3, 0]);
  let out = g.like({ user: user(1), count: 15 });
  let f = out.find((x) => x.type === "feed");
  assert.deepEqual([f.team, f.hp, out.some((x) => x.type === "heal")], ["D", GIANT.perViewer, false]);
  assert.equal(g.like({ user: user(1), count: 15 }).some((x) => x.type === "feed"), false);      // no more in this window
  f = g.share({ user: user(1) }).find((x) => x.type === "feed");
  assert.equal(f.hp, GIANT.share);                               // a share and a follow are rare: whole
  assert.equal(g.follow({ user: user(1) }).find((x) => x.type === "feed").hp, GIANT.follow);
  assert.deepEqual([GIANT.likes, GIANT.perViewer, GIANT.share, GIANT.follow], [10, 2, 1, 5]);       // the user's numbers
  g.comment({ user: user(2), text: "đánh" });
  assert.equal(g.like({ user: user(2), count: 9 }).some((x) => x.type === "feed"), false);       // nine hearts: not yet
  assert.equal(g.like({ user: user(2), count: 1 }).find((x) => x.type === "feed").hp, GIANT.perViewer);     // the tenth: 2, never a part of it
  assert.deepEqual(g.like({ user: user(9), count: 15 }), []);    // no character, no team: nothing
});

test("the strength a soldier has left goes with it into the next match; a Dân rests and comes back whole", () => {
  const g = new Game(newState());
  g.comment({ user: user(1), text: "thủ" });
  g.quizRight({ user: user(1) });                               // a Lính kiếm
  gift(g, 1, 30);                                               // and a Đội trưởng
  g.comment({ user: user(2), text: "đánh" });                   // a Dân
  g.endMatch("D", "time", {}, 1, null, new Map([["1#0", 0.4], ["1#1", 0.9996], ["2#0", 0.3]]));
  assert.deepEqual(g.bodies("1").map((b) => [b.uk, b.hp]), [["1#0", 0.4], ["1#1", undefined]]);      // hurt: kept; whole: nothing to keep
  assert.equal(g.s.users["2"].army[0].hp, 0.3);
  g.died("2", 0);                                               // it falls: it comes back whole
  assert.equal(g.s.users["2"].army[0].hp, undefined);
  g.endMatch("D", "time", {}, 1, null, new Map([["1#1", 0.5]]));   // not on the field at the end: whole again
  assert.deepEqual(g.bodies("1").map((b) => [b.uk, b.hp]), [["1#0", undefined], ["1#1", 0.5]]);
});

test("the clock: countdown marks, time up once; a session saved by earlier rules comes back with one Dân each", () => {
  const g = new Game(newState(90_000));
  g.tick(1000);
  const seen = [];
  for (let t = 2000; t <= 100_000; t += 1000) seen.push(...g.tick(t).map((e) => e.seconds || e.type));
  assert.deepEqual(seen, [60, 30, 10, "time_up"]);
  const old = newState();
  old.rules = 2;
  old.users = { 5: { name: "Cũ", team: "D", tier: 4, lives: 3, pts: 90 }, 6: { name: "Chưa", team: null, tier: 0 } };
  const g2 = new Game(old);
  assert.deepEqual(g2.s.users["5"].army, [{ n: 0, tier: 0 }]);
  assert.equal(g2.s.users["5"].tier, undefined);
  assert.equal(g2.members("D"), 1);
  assert.deepEqual(g2.roster().map((b) => b.uk), ["5#0"]);
});

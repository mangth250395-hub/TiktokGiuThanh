// What a review of the whole game found before it was made public (13/11/2026): each fault, kept from coming back.
import test from "node:test";
import assert from "node:assert/strict";
import { Game, newState, userKey } from "../src/game/rules.js";

const user = (id, name = `Bạn ${id}`) => ({ id: String(id), unique_id: `u${id}`, nickname: name });

test("a viewer whose @id is the name of a part of every object is a viewer like any other", () => {
  assert.equal(userKey({ id: "123", unique_id: "abc" }), "123");
  assert.equal(userKey({ id: "", unique_id: "abc" }), "abc");
  assert.equal(userKey({ unique_id: "__proto__" }), "@__proto__");
  assert.equal(userKey({ unique_id: "constructor" }), "@constructor");
  assert.equal(userKey({}), "?");
  assert.equal(userKey(null, ""), "");
  const g = new Game(newState());
  for (const uid of ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"]) {
    const who = { id: "", unique_id: uid, nickname: "EVIL" };
    assert.equal(g.comment({ user: who, text: "đánh" })[0].type, "join", uid);      // (it used to throw, or to write onto every object)
    assert.equal(g.s.users[`@${uid}`].name, "EVIL");
    g.like({ user: who, count: 30 });
    g.share({ user: who });
    g.follow({ user: who });
  }
  assert.equal({}.name, undefined);
  assert.equal({}.team, undefined);
  assert.equal(Object.keys(g.s.users).length, 5);
  assert.equal(g.members("A"), 5);
  // a follow from someone with no character, and such a name: remembered under a key of its own too
  g.follow({ user: { id: "", unique_id: "__proto__x" } });
  assert.equal({}.name, undefined);
});

test("like points are counted as the likes come, at the rate of that moment", () => {
  const g = new Game(newState(), { likes: 20 });
  g.comment({ user: user(1), text: "thủ" });
  const pts = () => g.s.users["1"].pts || 0;
  g.like({ user: user(1), count: 600 });
  assert.equal(pts(), 30);
  g.setPoints({ likes: 10 });                    // the operator changes "N tim = 1 điểm"
  g.like({ user: user(1), count: 1 });
  assert.equal(pts(), 30);                       // (it used to give the 30 points of the 600 likes a second time)
  g.like({ user: user(1), count: 9 });
  assert.equal(pts(), 31);
  g.setPoints({ likes: 100 });
  g.like({ user: user(1), count: 99 });
  assert.equal(pts(), 31);
  g.like({ user: user(1), count: 1 });           // (and raising the rate used to freeze the points for a long time)
  assert.equal(pts(), 32);
});

test("a resting viewer whose last soldier falls back to Dân is no longer counted in play", () => {
  const g = new Game(newState());
  g.comment({ user: user(1), text: "thủ" });
  g.comment({ user: user(2), text: "thủ" });
  const u = g.s.users["1"];
  u.army = [{ n: 0, tier: 1 }];                  // a Lính kiếm earned with a right answer (no item)
  u.rest = true;                                 // they did not speak at the end of the last match
  g._count();
  assert.equal(g.members("D"), 2);               // the soldier comes out by itself: in play
  assert.equal(g.died("1", 0)[0].type, "demoted");
  assert.equal(g.members("D"), 1);               // now a Dân of a resting viewer: out until they speak again
});

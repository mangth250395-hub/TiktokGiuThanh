import test from "node:test";
import assert from "node:assert/strict";
import { Battle, FACES, KINDS, TUNE, facePos, H } from "../src/game/battle.js";
import { play } from "../tools/tune.mjs";

function rng(seed = 1) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }
const viewers = (nD, nA, tier = 0) => [
  ...Array.from({ length: nD }, (_, i) => ({ key: `d${i}`, team: "D", tier, name: `D${i}` })),
  ...Array.from({ length: nA }, (_, i) => ({ key: `a${i}`, team: "A", tier, name: `A${i}` })),
];
function run(b, seconds, each = null) {
  const seen = [];
  for (let t = 0; t < seconds && !b.over; t += 0.1) { b.update(0.1); const e = b.take(); seen.push(...e); each?.(e); }
  return seen;
}

test("a wave every 20 seconds: everyone waiting comes on the field at once, with soldiers of the place", () => {
  const b = new Battle({ rand: rng(3) });
  b.reset(viewers(3, 3));
  assert.equal(b.units.length, 0);
  assert.equal(b.waiting("D"), 3);
  let seen = run(b, 3);
  const w = seen.find((e) => e.type === "wave");
  assert.deepEqual([w.n, w.came.D, w.came.A], [1, 3, 3]);
  assert.equal(b.count("D", true), 3);
  assert.ok(b.count("D") > 3, "soldiers of the place came too");
  assert.equal(TUNE.wave, 20);
  assert.ok(b.waveLeft() > TUNE.wave - 3 && b.waveLeft() <= TUNE.wave);
  b.enqueue({ key: "late", team: "A", tier: 0, name: "Late" });
  assert.equal(b.alive("late"), false);
  assert.equal(b.has("late"), true);
  seen = run(b, TUNE.wave);
  assert.equal(seen.filter((e) => e.type === "wave").length, 1);
  assert.ok(seen.some((e) => e.type === "spawn" && e.key === "late"));
});

test("characters fight, fall and are gone until the next wave; every number stays sound", () => {
  const b = new Battle({ rand: rng(5) });
  b.reset(viewers(6, 6, 1));
  const seen = run(b, 60);
  const died = seen.filter((e) => e.type === "died");
  assert.ok(died.length > 3, `${died.length} fell`);
  assert.ok(seen.some((e) => e.type === "swing"));
  const fallen = died.find((e) => e.key);
  assert.ok(fallen, "a viewer fell");
  for (const u of b.units) { assert.ok(Number.isFinite(u.x) && Number.isFinite(u.y) && u.hp > 0 && u.hp <= u.max + 1e-6, `unit ${u.id}`); assert.ok(FACES.includes(u.lane)); }
  for (const f of FACES) { const g = b.gates[f]; assert.ok(g.hp >= 0 && g.hp <= g.max + 1e-6); }
  assert.ok(b.hall.hp >= 0 && b.hall.hp <= b.hall.max);
  const a = b.awards();
  assert.ok(a.killer && a.killer.value >= 1);
});

test("a gate at zero is down: the blows go on to the castle; mended to 30% it stands again", () => {
  const b = new Battle({ rand: rng(7) });
  b.hitGate("N", TUNE.gateMax * 0.6);
  assert.ok(b.take().some((e) => e.type === "gate_half"));
  b.hitGate("N", TUNE.gateMax);
  assert.equal(b.gates.N.broken, true);
  assert.equal(b.take().filter((e) => e.type === "breach").length, 1);
  b.hitGate("N", 50);                                            // through the open gate: the castle
  assert.equal(b.hall.hp, b.hall.max - 50);
  b.mend("N", TUNE.gateMax * 0.2);
  assert.equal(b.gates.N.broken, true);
  b.mend("N", TUNE.gateMax * 0.15);
  assert.equal(b.gates.N.broken, false);
  assert.ok(b.take().some((e) => e.type === "rebuilt"));
});

test("the castle at zero: the attackers win, said once, with its marks on the way", () => {
  const b = new Battle({ rand: rng(9) });
  b.hitHall(b.hall.max - 1);
  assert.equal(b.over, false);
  b.hitHall(50);
  assert.equal(b.over, true);
  assert.equal(b.winner, "A");
  const ev = b.take();
  assert.equal(ev.filter((e) => e.type === "hall_fell").length, 1);
  assert.deepEqual(ev.filter((e) => e.type === "hall_mark").map((e) => e.mark), [0.5, 0.25]);
  b.hitHall(50); b.update(1);
  assert.equal(b.take().length, 0);
});

test("a rank changes a character where it stands, or brings a waiting one on the field at once", () => {
  const b = new Battle({ rand: rng(11) });
  b.reset(viewers(2, 2));
  run(b, 3);
  const u = b.byKey.get("d0"), hp0 = u.max;
  b.promote("d0", 6);
  assert.equal(u.kind, "general");
  assert.ok(u.max > hp0 * 5 && u.hp === u.max);
  assert.ok(b.take().some((e) => e.type === "promote" && e.tier === 6));
  b.enqueue({ key: "new", team: "A", tier: 0, name: "New" });
  assert.equal(b.promote("new", 3), null);                      // waiting: at the next wave
  assert.equal(b.alive("new"), false);
  const nu = b.promote("new", 3, 0, { now: true });
  assert.equal(nu.kind, "archer");
  assert.equal(b.alive("new"), true);
  b.removeViewer("new");
  assert.equal(b.has("new"), false);
  assert.equal(KINDS.length, 7);
});

test("a viewer with several characters: they fight on the same side, the best one stands for them, each falls alone", () => {
  const b = new Battle({ rand: rng(31) });
  const mine = [0, 1, 2].map((n) => ({ key: "v", uk: `v#${n}`, n, team: "D", tier: [0, 6, 1][n], name: "V" }));
  b.reset([...mine, ...viewers(0, 3)]);
  assert.equal(b.lead("v").uk, "v#1");                          // waiting: the highest rank
  assert.equal(b.waiting("D"), 3);
  run(b, 1.7);                                                  // the first wave has just left
  const [pawn, general, sword] = mine.map((m) => b.byUk.get(m.uk));
  assert.ok(pawn && general && sword);
  assert.equal(general.lane, sword.lane);                       // the fighters of one viewer: the same side (their villager goes where a gate needs mending)
  assert.equal(b.byKey.get("v"), general);
  assert.deepEqual([pawn.lead, general.lead, sword.lead], [false, true, false]);
  b.take();
  b._hurt(general, 1e9, null);                                  // the leader falls: the others stay, the next best leads
  const died = b.take().find((e) => e.type === "died");
  assert.deepEqual([died.key, died.uk, died.n], ["v", "v#1", 1]);
  assert.equal(b.hasUnit("v#1"), false);
  assert.equal(b.byKey.get("v"), sword);
  assert.equal(b.has("v"), true);
  b.enqueue({ key: "v", uk: "v#1", n: 1, team: "D", tier: 0, name: "V" });   // it waits again, as a Dân
  assert.equal(b.queue.get("v#1").kind, "pawn");
  assert.equal(b.count("D", true), 2);
  b.removeViewer("v");
  assert.deepEqual([b.has("v"), b.hasUnit("v#0"), b.hasUnit("v#1")], [false, false, false]);
});

test("a little life back goes to ONE character of the viewer, the most hurt; what each did is one number for the ranking", () => {
  const b = new Battle({ rand: rng(21) });
  b.reset([{ key: "v", uk: "v#0", n: 0, team: "D", tier: 1, name: "V" }, { key: "v", uk: "v#1", n: 1, team: "D", tier: 1, name: "V" }, ...viewers(0, 2, 1)]);
  run(b, 3);
  const a1 = b.byUk.get("v#0"), a2 = b.byUk.get("v#1");
  a1.hp = a1.max * 0.5; a2.hp = a2.max * 0.2;
  assert.equal(b.heal("v", 4), 4);
  assert.ok(Math.abs(a2.hp - (a2.max * 0.2 + 4)) < 1e-9);       // the most hurt one
  assert.equal(a1.hp, a1.max * 0.5);                            // the other: nothing
  assert.ok(b.heal("v", 0, 0.6) > a2.max * 0.5);
  assert.equal(b.heal("nobody", 5), 0);
  b.stat("v").kills = 2; b.stat("v").gate = 14.4; b.stat("v").heal = 10;
  assert.deepEqual(b.scores().get("v"), { score: 39, kills: 2, gate: 14, heal: 10, mend: 0 });
});

test("a very big live: at most fieldCap viewers of a team on the field, the others keep their place", () => {
  const b = new Battle({ rand: rng(23) });
  b.reset(viewers(TUNE.fieldCap + 40, 5));
  run(b, 3);
  assert.equal(b.count("D", true), TUNE.fieldCap);
  assert.equal(b.waiting("D"), 40);
  assert.equal(b.count("A", true), 5);
});

test("positions: a gate is in the middle of its wall, a camp outside it", () => {
  assert.deepEqual(facePos("N", 0, 0), [0, -H]);
  assert.deepEqual(facePos("E", 0, 10), [H + 10, 0]);
  assert.deepEqual(facePos("S", 0.5, 0), [-H / 2, H]);
});

test("the field can be saved and brought back: gates and castle as they were", () => {
  const b = new Battle({ rand: rng(13) });
  b.reset(viewers(4, 4, 1));
  run(b, 12);
  b.hitGate("W", 30);
  b.hitHall(100);
  assert.equal(b.over, false);
  const snap = JSON.parse(JSON.stringify(b.snapshot()));
  const again = new Battle({ rand: rng(17) });
  again.reset(viewers(4, 4, 1));
  assert.equal(again.restore(snap), true);
  for (const f of FACES) { assert.ok(Math.abs(again.gateRatio(f) - b.gateRatio(f)) < 1e-6); assert.equal(again.gates[f].broken, b.gates[f].broken); }
  assert.ok(Math.abs(again.hallRatio() - b.hallRatio()) < 1e-6);
  assert.equal(again.restore({ walls: {} }), false);            // a field saved by the first rules: ignored
});

test("balance: even teams are close whatever the size of the live; a leader weighs", () => {
  const mix = (i) => [0, 0, 0, 1, 0, 0, 2, 0, 1, 0, 0, 3, 0, 0, 1, 0, 0, 4, 0, 0][i % 20];
  const share = (opt, n = 24) => { let a = 0; for (let i = 0; i < n; i++) if (play({ ...opt, seed: 500 + i * 13 }).winner === "A") a++; return a / n; };
  const small = share({ nD: 8, nA: 8, tiersD: mix, tiersA: mix }), big = share({ nD: 40, nA: 40, tiersD: mix, tiersA: mix }, 12);
  assert.ok(small > 0.12 && small < 0.88, `8 v 8: attackers win ${small}`);
  assert.ok(big > 0.08 && big < 0.92, `40 v 40: attackers win ${big}`);
  const withGeneral = share({ nD: 8, nA: 8, tiersD: mix, tiersA: (i) => (i === 0 ? 6 : mix(i)) }, 12);
  assert.ok(withGeneral > small, `a general helps (${withGeneral} > ${small})`);
});

test("an item for someone already that high: full life, a rush, and out of the queue at once", () => {
  const b = new Battle({ rand: rng(27) });
  b.reset(viewers(2, 2, 3));
  run(b, 3);
  const u = b.byKey.get("a0");
  u.hp = 1;
  assert.equal(b.refresh("a0"), u);                             // (a viewer with one character: its key is the viewer's)
  assert.equal(u.hp, u.max);
  assert.ok(u.hurry > b.t);
  b.enqueue({ key: "late", team: "D", tier: 2, name: "Late" });
  assert.equal(b.refresh("late").kind, "lancer");
  assert.equal(b.alive("late"), true);
  assert.equal(b.refresh("nobody"), null);
});

test("the match of fury: two giants trade blows harder and harder; likes hold one up; the one that falls loses the match", () => {
  let b = new Battle({ rand: rng(5) });
  b.reset(viewers(4, 4), { rage: true, len: 240 });
  assert.ok(b.giants.D && b.giants.A);
  assert.ok(b.giants.D.x < 0 && b.giants.A.x > 0 && b.giants.D.y > H);        // face to face before the south gate
  let seen = run(b, 20);
  const hits = seen.filter((e) => e.type === "giant_hit");
  assert.ok(hits.some((e) => e.team === "D") && hits.some((e) => e.team === "A"));
  assert.ok(b.giantRatio("D") < 1 && b.giantRatio("A") < 1);
  const before = b.giants.D.hp;
  assert.ok(b.feed("D", 40) > 0);                                // strength back
  assert.ok(b.giants.D.hp > before && b.giants.D.hp <= b.giants.D.max);
  assert.equal(new Battle({ rand: rng(5) }).feed("D", 40), 0);   // not the match of fury: no giant
  // nobody storms the walls in this match: everyone comes to the two giants, before the south gate, to fight
  // the other team's fighters and strike the other team's giant
  for (const f of FACES) assert.equal(b.gateRatio(f), 1);
  assert.ok(b.units.length >= 4 && b.units.every((u) => u.lane === "S"));
  assert.ok(seen.some((e) => e.type === "died"), "they fought");
  assert.ok(b.units.filter((u) => u.team === "D" && u.born < b.t - 10).some((u) => u.d > 0), "the defenders came out");
  {
    const c = new Battle({ rand: rng(9) });                     // the fighters' blows count: with no fighters at all a giant has more left
    c.reset([], { rage: true });
    c.T = { ...TUNE, npcWave: 0 };
    run(c, 60);
    const d = new Battle({ rand: rng(9) });
    d.reset(viewers(0, 12, 1), { rage: true });
    d.T = { ...TUNE, npcWave: 0 };
    run(d, 60);
    assert.ok(d.giants.D.hp < c.giants.D.hp - 5, `struck by the attackers: ${Math.round(d.giants.D.hp)} against ${Math.round(c.giants.D.hp)}`);
  }
  // the castle does not fall in this match: a blow on it is a blow on the defenders' giant
  const hall = b.hall.hp, g = b.giants.D.hp;
  b.hitHall(100);
  assert.equal(b.hall.hp, hall);
  assert.ok(b.giants.D.hp < g);
  // nobody helps: a giant falls before the end of the time, and the other team wins
  seen = run(b, 400);
  const fell = seen.find((e) => e.type === "giant_fell");
  assert.ok(fell && b.over && b.winner === (fell.team === "D" ? "A" : "D"));
  assert.ok(seen.some((e) => e.type === "giant_mark" && e.mark === 0.5));
  for (const f of FACES) assert.equal(b.gateRatio(f), 1);       // to the end
  assert.ok(b.t > 120 && b.t < 240, `fell at ${Math.round(b.t)} s`);
  // one team keeps sending likes: its giant outlasts the other
  let won = 0;
  for (let i = 0; i < 12; i++) won += play({ nD: 8, nA: 8, rage: true, likeD: 6, likeA: 2, seed: 50 + i }).winner === "D" ? 1 : 0;
  assert.ok(won >= 10, `the helped giant won ${won} of 12`);
  // saved and restored with what the giants had left
  b = new Battle({ rand: rng(6) });
  b.reset(viewers(2, 2), { rage: true });
  run(b, 30);
  const snap = b.snapshot(), c = new Battle({ rand: rng(7) });
  c.reset(viewers(2, 2), { rage: true });
  c.restore(snap);
  assert.equal(Math.round(c.giants.A.hp), Math.round(b.giants.A.hp));
});

test("the defenders' villagers go where the gates need them: massed at a gate that is going, spread when all is quiet", () => {
  const b = new Battle({ rand: rng(11) });
  b.T = { ...TUNE, npcWave: 0 };
  b.reset(viewers(12, 0));
  run(b, 12);
  let at = { N: 0, E: 0, S: 0, W: 0 };
  for (const u of b.units) at[u.goLane || u.lane]++;
  assert.ok(Math.max(...Object.values(at)) - Math.min(...Object.values(at)) <= 1, `spread: ${JSON.stringify(at)}`);
  b.gates.E.hp = 5; b.gates.E.hitAt = b.t;                       // one gate is nearly down
  run(b, 14, () => { b.gates.E.hp = Math.min(b.gates.E.hp, 8); });
  at = { N: 0, E: 0, S: 0, W: 0 };
  for (const u of b.units) at[u.goLane || u.lane]++;
  assert.ok(at.E >= 5, `massed at the gate in danger: ${JSON.stringify(at)}`);
  assert.ok(at.N >= 1 && at.S >= 1 && at.W >= 1, `nobody leaves a gate empty: ${JSON.stringify(at)}`);
});

test("nobody twitches and nobody stands frozen: no turning round again and again, no standing still with an enemy or a gate to deal with", async () => {
  const { measure } = await import("../tools/jitter.mjs");
  for (const opt of [{ n: 10 }, { n: 30 }, { n: 10, rage: true }]) {
    const r = measure({ ...opt, seconds: 90 });
    assert.ok(r.twitchy <= r.units * 0.05, `${JSON.stringify(opt)}: ${r.twitchy} of ${r.units} twitch`);      // it was 17% before the fix (58 of 342)
    assert.equal(r.frozen, 0, `${JSON.stringify(opt)}: ${r.frozen} stand frozen with something to do ${JSON.stringify(r.frozenKinds)}`);
    assert.ok(r.flipAvg < 0.5 && r.togAvg < 0.6, `${JSON.stringify(opt)}: turns ${r.flipAvg.toFixed(2)}/s, starts and stops ${r.togAvg.toFixed(2)}/s`);
  }
});

test("a character comes on the field with the strength it had left; what everyone has left can be read at the end", () => {
  const b = new Battle({ rand: rng(4) });
  b.reset([{ key: "v", uk: "v#0", n: 0, team: "D", tier: 1, name: "V", hp: 0.4 }, { key: "w", uk: "w#1", n: 1, team: "D", tier: 5, name: "W", item: true }]);
  assert.equal(b.strengths().get("v#0"), 0.4);                  // waiting: what it carries
  run(b, 2);
  const v = b.byUk.get("v#0"), w = b.byUk.get("w#1");
  assert.ok(Math.abs(v.hp / v.max - 0.4) < 0.03, `came out with ${v.hp / v.max}`);
  assert.equal(w.hp, w.max);
  assert.deepEqual([v.item, w.item], [false, true]);
  v.hp = v.max * 0.25;
  assert.ok(Math.abs(b.strengths().get("v#0") - 0.25) < 0.01);
  run(b, 8);                                                    // out of the fight they get their breath back, but slowly
  assert.ok(v.gone || v.hp / v.max < 0.45, `after 8 s of rest: ${v.hp / v.max}`);
});

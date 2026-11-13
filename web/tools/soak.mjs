// A long live, played fast with no picture: `npm run soak` (hours of live in a minute). It drives the rules, the
// fight and the commentator the way main.js does, with a steady stream of new viewers, likes from people who never
// comment, gifts and quiz answers, and prints after each hour what could grow: viewers kept, the size of the saved
// session, memory, and how long a step of the fight takes. Nothing here should climb from hour to hour.
import { Game, newState } from "../src/game/rules.js";
import { Battle } from "../src/game/battle.js";
import { Commentator } from "../src/game/commentary.js";

const HOURS = Number(process.argv[2] || 6), PER_SECOND = Number(process.argv[3] || 2);   // new commenters per second
let now = 1_800_000_000_000;
Date.now = () => now;
let seed = 12345;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const game = new Game(newState());
const battle = new Battle({ rand: rnd });
const talk = new Commentator(game, battle, { now: () => now, rand: rnd });
let nextId = 1, lines = 0, maxStep = 0, steps = 0, stepSum = 0;
const user = (id) => ({ id: String(id), unique_id: `u${id}`, nickname: `Người ${id}` });

const uk = (key, n) => `${key}#${n}`;
const muster = (key) => { for (const b of game.bodies(key)) if (!battle.hasUnit(b.uk)) battle.enqueue(b); };
function apply(effects) {
  for (const e of effects) {
    if (e.type === "join") muster(e.key);
    else if (e.type === "switched") { battle.removeViewer(e.key); muster(e.key); }
    else if (e.type === "cheer") { if (!battle.has(e.key)) muster(e.key); }
    else if (e.type === "spawn" || e.type === "promote") { muster(e.key); battle.promote(uk(e.key, e.unit), e.tier, 0, { now: !e.free }); }
    else if (e.type === "heal") battle.heal(e.key, e.hp || 0, e.part || 0);
    else if (e.type === "hurry") battle.hurry(e.key);
    else if (e.type === "feed") battle.feed(e.team, e.hp);
    else if (e.type === "recruit") muster(e.key);
  }
  lines += talk.onEffects(effects).length;
}

const matches = Math.round((HOURS * 3600) / 248);
console.log(`live of ${HOURS} h: ${matches} matches, ${PER_SECOND} new commenters a second (${Math.round(PER_SECOND * 3600)} an hour)`);
let waveDone = -1, hour = 0, rages = 0, series = 0;
for (let m = 0; m < matches; m++) {
  battle.reset(game.roster(), { boost: game.s.boost, rage: game.s.match.kind === "rage", len: game.s.matchMs / 1000 });
  if (battle.rage) rages++;
  waveDone = -1;
  game.lastTick = null;
  for (let t = 0; t < 2400 && !battle.over; t++) {
    now += 100;
    apply(game.tick(now));
    if (t % 10 === 0) {
      // new viewers comment; some who are here speak again, like, answer the quiz, give
      for (let i = 0; i < PER_SECOND; i++) apply(game.comment({ user: user(nextId++), text: ["thủ", "đánh", "hello", "chào cả nhà"][Math.floor(rnd() * 4)] }));
      const known = Math.max(1, nextId - 1 - Math.floor(rnd() * 600));
      apply(game.like({ user: user(known), count: 15 }));
      apply(game.like({ user: user(`like${Math.floor(rnd() * 1e9)}`), count: 15 }));        // someone who only presses the heart
      if (rnd() < 0.3) apply(game.quizRight({ user: user(known) }));
      if (rnd() < 0.05) apply(game.share({ user: user(known) }));
      if (rnd() < 0.03) apply(game.follow({ user: user(`f${nextId}`) }));
      if (rnd() < 0.04) { const each = [1, 1, 1, 5, 5, 10, 20, 30, 99][Math.floor(rnd() * 9)]; const ev = { user: user(known), gift: { name: "Rose", diamonds: each }, count: 1, coins: each }; apply(game.gift(ev)); apply(game.giftDone(ev)); }
      if (rnd() < 0.2) apply(game.comment({ user: user(known), text: "đổi" }));
      lines += talk.flush().length;
    }
    if (battle.waveLeft() < 0.15 && waveDone !== battle.waveN) {
      waveDone = battle.waveN;
      apply(game.wave());
      for (const v of game.roster()) if (!battle.hasUnit(v.uk)) battle.enqueue(v);
    }
    const t0 = performance.now();
    battle.update(0.1);
    const dt = performance.now() - t0;
    steps++; stepSum += dt; if (dt > maxStep) maxStep = dt;
    const ev = battle.take();
    for (const e of ev) if (e.type === "died" && e.key) apply(game.died(e.key, e.n));
    lines += talk.onBattle(ev).length;
  }
  const e = battle.rage
    ? game.endMatch(battle.over ? battle.winner : battle.giantLead(), battle.over ? "giant" : "time", battle.awards(), battle.hallRatio(), battle.scores(), battle.strengths())
    : game.endMatch(battle.over ? "A" : "D", battle.over ? "fell" : "time", battle.awards(), battle.hallRatio(), battle.scores(), battle.strengths());
  if (e.final) series++;
  lines += talk.matchScript(e).length;
  game.s.battle = battle.snapshot();
  if (Math.floor(((m + 1) * 248) / 3600) > hour || m === matches - 1) {
    hour = Math.floor(((m + 1) * 248) / 3600);
    globalThis.gc?.();
    const json = JSON.stringify(game.s);
    console.log(`after ${String(hour).padStart(2)} h: viewers kept ${String(Object.keys(game.s.users).length).padStart(5)} of ${nextId - 1} seen, ${game.roster().length} characters · session ${(json.length / 1024).toFixed(0).padStart(5)} KB · followers ${Object.keys(game.s.followers).length}`
      + ` · field ${battle.units.length} · memory ${(process.memoryUsage().heapUsed / 1048576).toFixed(0)} MB · step avg ${(stepSum / steps).toFixed(2)} ms, worst ${maxStep.toFixed(1)} ms`
      + ` · commentator keeps ${talk.named.size} names, ${Object.keys(talk.last).length} marks · ${lines} lines · ${series} series over, ${rages} matches of fury`);
    maxStep = 0; steps = 0; stepSum = 0;
  }
}

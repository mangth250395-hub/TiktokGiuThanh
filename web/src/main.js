// The game page: hub events -> rules -> the field (battle), the picture, the camera, the voice.
// The session is saved to disk by the app (/api/state), so closing and reopening goes on with the same match.
import "@fontsource/be-vietnam-pro/400.css";
import "@fontsource/be-vietnam-pro/600.css";
import "@fontsource/be-vietnam-pro/800.css";
import "./style.css";
import { Game, POINTS, TEAMS, TIERS, GIFT_TIERS, STEP, FREE_MAX, newState } from "./game/rules.js";
import { Battle } from "./game/battle.js";
import { Commentator, PRI } from "./game/commentary.js";
import { Speech } from "./game/speech.js";
import { Director, GIFT_PRI } from "./game/director.js";
import { giftName, speakName } from "./game/speakable.js";
import { Quiz, QUIZ_OPEN_MS, QUIZ_REVEAL_MS, QUIZ_BOARD_MS } from "./game/quiz.js";
import { BANK } from "./game/quizbank.js";
import { Field } from "./scene/field.js";
import { loadAssets, kindPic, spritePic } from "./scene/assets.js";
import { BattleSound } from "./sfx.js";
import * as ui from "./ui.js";
import { Demo } from "./demo.js";
import { cleanChannel, isTestChannel, sameChannel } from "./game/channel.js";
import { userKey } from "./game/rules.js";

const HUB_PORT = 8765;           // the hub's port when the app does not say another one (/api/hub)
// a channel named "thu_..." (thu_nghiem) is for tests: the hub never connects it to TikTok, only fake events
const isTest = isTestChannel;
const BREAK_S = 5;               // the break between two matches (the user, 11/11/2026: "đếm 5 giây thôi")
// the result of a match stays this long, whatever the voice has had time to say (it waited for every line before: up
// to 30 s; the user: "màn kết trận hơi lâu ... hình như nó còn đợi bình luận"). The end of a series: a little longer
const RESULT_MS = 6500, FINAL_MS = 9000;
const SPEECH_CAM_PRI = 17;       // a line of the commentator asks for the camera below any gift and any newcomer (20)
const FINALE_S = 30;             // the last seconds: the camera stays on the fight, only big items cut in
const api = async (path, body) => {
  const r = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
};

async function boot() {
  ui.fitStage();
  const [settings, saved] = await Promise.all([api("/api/settings").catch(() => ({})), api("/api/state").catch(() => null)]);
  const cfg = { channel: "", matchMs: 240_000, seriesMatches: 5, voice: "vi-VN-NamMinhNeural", rate: 0, volume: 1, speech: true, sound: true, sfx: 0.6,
    quiz: true, legend: true, ...settings };
  cfg.points = { ...POINTS, ...(settings.points || {}) };
  let rageOn = false;           // the match of fury is on: the card of how to play says what likes do in it
  const legend = () => { ui.buildLegend(cfg.legend !== false, kindPic); ui.buildFree(cfg.legend !== false, cfg.points, STEP, TIERS.slice(0, FREE_MAX + 1).map((T) => T.id), kindPic, cfg.seriesMatches || 5, rageOn); };
  legend();
  // the pictures of the pack: the field draws plain shapes until they are there, then the panels get theirs
  loadAssets().then(() => ui.setArt({ castle: spritePic("blue/castle", 128) }));

  // errors of the page are written in the app's log (%APPDATA%\TikTokGiuThanh\app.log): a freeze can be traced
  let reported = 0, reportedAt = 0;
  function report(where, err) {
    console.error(`[${where}]`, err);
    const now = Date.now();
    if (now - reportedAt > 60_000) { reportedAt = now; reported = 0; }
    if (++reported > 5) return;
    const text = `${where}: ${err?.stack || err?.message || err}`.slice(0, 2000);
    fetch("/api/log", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) }).catch(() => {});
  }
  window.addEventListener("error", (ev) => report("page", ev.error || ev.message));
  window.addEventListener("unhandledrejection", (ev) => report("promise", ev.reason));

  // (whole: with the parts the page cannot start without; one lacking `match` passed the constructor and stopped the
  // page a few lines further, at every launch)
  const part = (x) => !!x && typeof x === "object" && !Array.isArray(x);
  let okState = part(saved) && saved.v === 1 && saved.game === "giuthanh" && [saved.session, saved.match, saved.users].every(part);
  let game;
  try {
    game = new Game(okState ? saved : newState(cfg.matchMs), cfg.points);
  } catch (err) {
    // a saved session the game cannot read (a file cut short or changed by hand): it used to stop the page at
    // "Lỗi khởi động" for good. A new session starts instead; the app keeps the old file in backups/ at the first save
    report("saved session unreadable, a new one starts", err);
    okState = false;
    game = new Game(newState(cfg.matchMs), cfg.points);
  }
  game.setSeries(cfg.seriesMatches);
  game.s.matchMs = cfg.matchMs;
  game.s.hub ||= { epoch: null, seq: {} };
  const battle = new Battle();
  battle.reset(game.roster(), fieldOpts());
  if (okState && game.s.battle && game.s.match.elapsed > 0) battle.restore(game.s.battle);
  const field = new Field(document.getElementById("field"), battle);
  const director = new Director(field);
  const talk = new Commentator(game, battle);
  talk.quizOn = cfg.quiz;
  const sound = new BattleSound();
  sound.set({ on: cfg.sound, sfx: cfg.sfx });
  sound.start();
  const snd = (kind, arg) => { try { sound[kind]?.(arg); } catch (err) { report("sound", err); } };   // a sound that fails never stops the show

  let dirty = false;
  let inSummary = false;        // a match's result is being shown, or the break before the next
  let frozen = null;            // what the top shows meanwhile: { n, timer, hall, people, wins }
  let held = false;

  // ---------- the camera ----------
  /** What the field needs to know of the match that starts: who lost last, and whether it is the match of fury. */
  function fieldOpts() { return { boost: game.s.boost, rage: game.s.match.kind === "rage", len: game.s.matchMs / 1000 }; }
  const finale = () => !inSummary && !game.s.paused && (game.timeLeftMs() <= FINALE_S * 1000 || battle.hallRatio() < 0.2
    || (battle.rage && Math.min(battle.giantRatio("D"), battle.giantRatio("A")) < 0.2));
  /** Ask for the camera. In the last seconds only big items get a shot: the fight itself is the show. */
  function cam(id, pri, shot = "medium") {
    if (!id || inSummary) return;
    if (finale() && pri < GIFT_PRI + 20) return;
    director.request(id, pri, shot);
  }
  const giftPri = (coins) => GIFT_PRI + Math.min(55, Math.round(10 * Math.log2(1 + coins)));

  // ---------- the voice ----------
  const speech = new Speech({
    settings: () => ({ enabled: cfg.speech, voice: cfg.voice, rate: cfg.rate, volume: cfg.volume }),
    // a thank-you (or a big item) stops a tip, a greeting, a quiz line being said; never the turns of the match
    cut: { from: PRI.THANKS, below: PRI.ASK },
    onStart: (item) => {
      sound.duck(true);
      if (item.key) field.spot(item.key, 7000);
      if (!item.summary && item.cam) cam(item.cam, Math.min(item.pri, SPEECH_CAM_PRI), "medium");
    },
    onEnd: () => {
      sound.duck(false);
      if (held && !inSummary) { director.release(); held = false; }
    },
  });
  const say = (lines) => { for (const l of lines) if (l) speech.push(l); };

  // ---------- effects of the rules ----------
  const uk = (key, n) => `${key}#${n}`;
  /** Every character of a viewer is in the match (waiting, if it is not on the field). */
  // what a viewer just did, floating up in the left column; one of a kind per viewer every 1.5 s (likes come in floods)
  const actedAt = new Map();
  function acted(e, why, text) {
    const k = `${e.key}:${why}`, now = performance.now();
    if (now - (actedAt.get(k) || 0) < 1500) return;
    if (actedAt.size > 400) actedAt.clear();
    actedAt.set(k, now);
    // the match of fury: behind the giant of their team, not in the column (someone with no team feeds no giant: not shown)
    const fury = battle.rage && !inSummary;
    if (fury && e.team !== "D" && e.team !== "A") return;
    ui.pointLive({ key: e.key, name: e.name, avatar: e.avatar, team: e.team, tier: e.tier, why, text, at: fury ? e.team : null });
  }
  /** "+2 Tướng +1 Lính kiếm" from [[rank, how many]] (the two highest ranks; the rest as "+n quân"). */
  const lotText = (groups) => {
    const head = groups.slice(0, 2).map(([r, c]) => `+${c} ${TIERS[r].name}`);
    const rest = groups.slice(2).reduce((n, g) => n + g[1], 0);
    return head.concat(rest ? [`+${rest} quân`] : []).join(" ") || "+1 quân";
  };
  /** "5", or "0,4" for less than one (a single like). */
  const amount = (x) => (x >= 1 ? String(Math.round(x)) : (Math.round(x * 10) / 10).toFixed(1).replace(".", ","));
  const muster = (key) => { for (const b of game.bodies(key)) if (!battle.hasUnit(b.uk)) battle.enqueue(b); };
  function apply(effects) {
    if (!effects.length) return;
    dirty = true;
    // an item can add several characters at once (a combo, or a value dealt into several ranks): they all come out,
    // but the card, the camera and the fanfare are for the whole lot, once, with the highest rank
    const lots = new Map();        // viewer key -> { shown, groups: [[rank, how many]] }
    for (const e of effects) if (e.type === "giving") lots.set(e.key, { shown: false, groups: e.units || [] });
    for (const e of effects) {
      switch (e.type) {
        case "join":       // they stand waiting where everyone sees them: the camera goes and greets them there
          if (!inSummary) muster(e.key);
          acted(e, "comment", "vào trận");
          snd("join");
          field.arrive(e.key);
          field.spot(e.key, 7000);
          cam(`u:${e.key}`, 20, talk.quiet() ? "close" : "medium");
          break;
        case "back":       // their Dân rested since the end of the last match: they spoke again, it waits for the next wave
          if (!inSummary) muster(e.key);
          acted(e, "comment", "ra trận");
          snd("join");
          field.arrive(e.key);
          field.spot(e.key, 5000);
          break;
        case "switched":
          battle.removeViewer(e.key);
          if (!inSummary) muster(e.key);
          field.arrive(e.key);
          field.spot(e.key, 6000);
          break;
        case "cheer":          // someone already in a team speaks again
          if (!inSummary && !battle.has(e.key)) muster(e.key);
          if (talk.quiet() && battle.alive(e.key)) cam(`u:${e.key}`, 8, "medium");
          break;
        case "quiz_right": acted(e, "quiz", "đúng!"); break;
        case "recruit":      // a right answer for someone whose Dân is a soldier already: one more Dân, out with the next wave
          if (!inSummary) muster(e.key);
          snd("join");
          break;
        case "spawn":          // an item: one more character for the giver, on the field at once
        case "promote": {      // a right answer (free), or an item past their limit: one of theirs changes rank
          const T = TIERS[e.tier], id = uk(e.key, e.unit);
          field.spot(e.key, 9000);
          if (e.free) {
            snd("rankUp");
            if (!inSummary) { muster(e.key); battle.promote(id, e.tier); }
            cam(`u:${e.key}`, 16, "medium");
            break;
          }
          if (!inSummary) { muster(e.key); battle.promote(id, e.tier, 0, { now: true }); }
          const lot = lots.get(e.key);
          if (lot?.shown) break;
          if (lot) lot.shown = true;
          if (e.tier < 5) snd("tier");
          const big = e.tier >= 5;
          ui.callout({ team: e.team, name: e.name, uid: e.uid, avatar: e.avatar, tier: e.tier, power: lot ? lotText(lot.groups) : `+1 ${T.name}`, pic: kindPic(e.team, T.id), big });
          cam(`u:${e.key}`, giftPri(e.coins || T.gift), big || talk.quiet() ? "close" : "medium");
          if (big) {
            director.keep(`u:${e.key}`, 5000);
            ui.cine(4200);
            ui.banner(`${T.name.toUpperCase()} XUẤT TRẬN!`, e.team === "D" ? "d" : "a", 2000);
            snd("hero", e.tier);
          }
          break;
        }
        case "giving":
          snd("plus", e.coins);
          // what the item gave is on the big card at the top (see "spawn"); with nothing added (they own all they can), that card says so
          if (!e.added) ui.callout({ team: e.team, name: e.name, uid: e.uid, avatar: e.avatar, tier: e.tier, power: "hồi đầy sức", pic: null, big: false });
          break;
        case "hurry": battle.hurry(e.key); break;
        case "feed":         // the match of fury: likes, shares and follows give strength to the giant of their team
          if (!inSummary) battle.feed(e.team, e.hp);
          acted(e, e.why, `+${amount(e.hp)} sức`);
          break;
        case "heal":         // likes, a share, a follow: a little life back for one of theirs; a right answer at the top rank: a lot
          if (!inSummary && battle.heal(e.key, e.hp || 0, e.part || 0) > 0 && e.part) { field.spot(e.key, 5000); snd("heal"); }
          if (!e.part) acted(e, e.why, `+${amount(e.hp)} sức`);
          else if (e.why === "gift") cam(`u:${e.key}`, giftPri(5), "medium");     // at their limit of characters: an item gives life back
          break;
        case "countdown": snd("tension"); break;
        case "time_up": finishMatch(battle.rage ? battle.giantLead() : "D", "time"); break;
        default:
      }
    }
    say(talk.onEffects(effects));
  }

  // ---------- what happens on the field ----------
  let soundAt = 0;
  /** Blows come by the dozen: at most one such sound every 70 ms. */
  const blow = (kind, arg) => { const now = performance.now(); if (now - soundAt > 70) { soundAt = now; snd(kind, arg); } };
  function onBattle(events) {
    if (!events.length) return;
    field.onEvents(events);
    for (const e of events) {
      switch (e.type) {
        case "wave":
          snd("gate");
          ui.waveOpen();
          break;
        case "died":
          snd("fall", e.tier >= 5);
          if (e.key) apply(game.died(e.key, e.n));
          if (e.key && e.tier >= 5) { snd("crash"); cam(e.lane, 34, "medium"); }
          break;
        case "swing": if (e.big) blow("thud", true); else if (!e.gate && !e.hall) snd("clink"); break;
        case "hit": if (e.kind !== "press") blow("thud"); break;
        case "hall_hit": ui.hallHit(); if (e.kind !== "press") blow("thud", true); break;
        case "shot": blow("arrows"); break;
        case "mend": blow("knock"); break;
        case "heal": snd("heal"); break;
        case "gate_half": cam(e.face, 22, "medium"); break;
        case "breach":
          snd("breach");
          ui.banner("CỔNG VỠ!", "a", 2200);
          cam(e.face, 38, "close");
          break;
        case "rebuilt":
          snd("rise");
          ui.banner("DỰNG LẠI CỔNG!", "d", 2000);
          cam(e.face, 30, "medium");
          break;
        case "hall_mark": snd("boom", true); snd("danger"); cam("C", 36, "medium"); break;
        // the camera goes to the one that did it (field.act), not to the viewer's highest rank
        case "first_blood": field.act(e.key, e.id, 5000); field.spot(e.key, 5000); cam(`u:${e.key}`, 18, "medium"); break;
        case "streak": field.act(e.key, e.id, 6000); field.spot(e.key, 6000); cam(`u:${e.key}`, e.n >= 5 ? 28 : 14, e.n >= 5 ? "close" : "medium"); snd("streak", e.n); break;
        case "hall_fell": finishMatch("A", "fell"); break;
        // ---- the match of fury ----
        case "giant_hit": blow("thud", true); ui.duelHit(e.team === "D" ? "a" : "d"); break;
        case "giant_fed": blow("heal"); break;
        case "giant_mark":
          snd("danger"); snd("boom", true);
          ui.banner(`KHỔNG LỒ ${e.team === "D" ? "XANH" : "ĐỎ"} ${e.mark <= 0.25 ? "SẮP GỤC!" : "CÒN MỘT NỬA!"}`, e.team === "D" ? "d" : "a", 2000);
          cam("G", 40, "medium");
          break;
        case "giant_lead": snd("rise"); cam("G", 30, "medium"); break;
        case "giant_fell": snd("crash"); finishMatch(e.winner, "giant"); break;
        default:
      }
    }
    say(talk.onBattle(events));
  }

  // ---------- the end of a match ----------
  function finishMatch(winner, reason) {
    if (inSummary) return;
    const hallLeft = battle.hallRatio();
    const giants = battle.rage ? { D: battle.giantRatio("D"), A: battle.giantRatio("A") } : null;
    const e = game.endMatch(winner, reason, battle.awards(), hallLeft, battle.scores(), battle.strengths());
    e.giants = giants;
    dirty = true;
    runSummary(e);
  }

  // "Phiên mới" / "Loạt mới" pressed while a result is shown: that showing is dropped (it had to wait before: the
  // button did nothing for the 25 seconds of a result, and the user took it for broken)
  let summaryRun = 0;
  async function runSummary(e) {
    const run = ++summaryRun;
    inSummary = true;
    try { await summaryAndBreak(e, run); } catch (err) { report("summary", err); }
    if (run !== summaryRun) return;        // started clean meanwhile
    // whatever went wrong above, the next match starts: the game never stays stuck on a result
    try { ui.resultHide(); ui.breakCountdown(e.next, 0); } catch { /* the panels only */ }
    held = false;
    frozen = null;
    inSummary = false;
    game.lastTick = null;
    director.release();
    director.hold(null); director.release();
    snd("horn");
    if (e.nextKind === "rage") {       // the match of fury opens on the two giants
      ui.banner("TRẬN NỘ!", "a", 2800); ui.cine(3400); snd("hero", 6);
      director.hold("G", "medium"); held = true;
      setTimeout(() => { if (held && !inSummary && !speech.busy()) { director.release(); held = false; } }, 5000);
    } else ui.banner(`TRẬN ${e.next}`, "g", 1800);
    speech.push(talk.matchStart(e.next, e.moved, e.nextKind, e.lead, e.levelled));
    if (e.final) lighten();
    dirty = true;
  }

  async function summaryAndBreak(e, run) {
    speech.clear(Infinity);        // nothing else is said now: straight to the result
    field.finish(e.winner);
    const rage = e.kind === "rage";
    frozen = { n: e.n, kind: e.kind, duel: e.giants || { D: 0, A: 0 }, timer: rage ? (e.reason === "giant" ? "GỤC NGÃ" : "HẾT GIỜ") : e.winner === "D" ? "HẾT GIỜ" : "THÀNH SẬP",
      hall: e.hallLeft, people: e.people, wins: e.wins };
    ui.banner(rage ? (e.levelled ? "CÂN BẰNG TỈ SỐ!" : `${TEAMS[e.winner].name.toUpperCase()} THẮNG TRẬN NỘ!`) : e.winner === "D" ? "THÀNH XANH GIỮ ĐƯỢC THÀNH!" : "LÂU ĐÀI ĐÃ SẬP!",
      e.winner === "D" ? "d" : "a", 2600);
    snd(e.final ? "seriesEnd" : rage || e.winner === "D" ? "victory" : "castleFall");
    director.hold(rage ? "G" : e.winner === "A" ? "C" : null, "medium");
    held = true;
    const script = talk.matchScript(e).map((l) => ({ ...l, summary: true }));
    speech.warm(script.slice(0, 2).map((l) => l.text));      // its first lines are made while the banner shows
    await new Promise((r) => setTimeout(r, 1200));
    if (run !== summaryRun) return;
    ui.result(e);
    ui.clearCards();
    try {
      await Promise.race([speech.playScript(script), new Promise((r) => setTimeout(r, e.final ? FINAL_MS : RESULT_MS))]);
    } finally {
      speech.endScript();          // the line being said ends by itself; the rest is dropped
    }
    if (run !== summaryRun) return;
    ui.resultHide();
    // the field of the next match: gates whole again, everyone waiting for the first wave
    battle.reset(game.roster(), fieldOpts());
    waveDone = -1;
    field.finish(null);
    director.release(); held = false;
    director.hold(null); director.release();
    frozen = null;                 // the top shows the match to come: full time, the hall whole again
    for (let s = BREAK_S; s > 0; s--) {
      if (run !== summaryRun) return;
      ui.breakCountdown(e.next, s, BREAK_S, e.nextKind);
      snd("tick");
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  /** After the last match of a series: viewers who left with no team and no gift are forgotten, so a long live stays
   *  light. Done in place: the page never reloads (the stream must not blink). */
  function lighten() {
    fetch("/api/log", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: `series over: everyone forgotten, ${Object.keys(game.s.users).length} kept` }) }).catch(() => {});
  }

  // ---------- the quiz (đố vui): 30 s to answer by comment, everyone right gets points for their character ----------
  const quiz = new Quiz(BANK);
  /** A comment: maybe the answer to the quiz (then it is not read as "thủ" / "đánh"), else what it asks of the game. */
  function onComment(ev) {
    const key = userKey(ev.user);
    const now = Date.now(), c = quiz.cur;
    if (c && quiz.check(key, ev.text, now)) {
      // a right answer: noted, and nothing on the screen or in the voice shows it. Who was right, and what they win,
      // comes when the time is up (the user, 11/11/2026: said at once, it gave the answer away to everyone else)
      c.winners.push({ user: ev.user, key, s: Math.max(0, (now - c.at) / 1000) });
      apply(game.comment({ ...ev, text: "." }));      // a comment like any other: a character for a newcomer, a Dân back from its rest
      return;
    }
    apply(game.comment(ev));
  }
  /** The time of a question is up (or the match ends on it): everyone who was right gets what a right answer gives,
   *  the fastest first. */
  function settleQuiz(c) {
    if (!c || c.settled) return;
    c.settled = true;
    for (const w of c.winners || []) {
      // (a name the filter refuses, or that cannot be read, is never said as it is: "một bạn", as everywhere else)
      c.right.push(speakName(w.user?.nickname, w.user?.unique_id) || "một bạn");
      apply(game.quizRight({ user: w.user }));
      if (c.fast.length < 3) {       // the three fastest, for the ranking shown with the answer
        const u = game.s.users[w.key] || {};
        c.fast.push({ name: w.user?.nickname || (w.user?.unique_id ? `@${w.user.unique_id}` : "Một bạn"),
          avatar: w.user?.avatar_hub || u.avatar || "", team: u.team || null, tier: u.team ? game.top(u) : 0, s: w.s });
      }
    }
    if (c.winners?.length) snd("ding");
  }
  function runQuiz(now) {
    if (!cfg.quiz || inSummary) {            // off, or a result is shown: no question (a new one after)
      if (quiz.cur) { settleQuiz(quiz.cur); quiz.stop(); ui.quizHide(); }
      return;
    }
    const c = quiz.cur;
    if (!c || (c.reveal && now - c.reveal >= (c.right.length ? QUIZ_BOARD_MS : QUIZ_REVEAL_MS))) {
      const q = quiz.start(now);
      ui.quizShow(q);
      snd("quizOpen");
      ui.quizTick(Math.ceil(QUIZ_OPEN_MS / 1000), QUIZ_OPEN_MS / 1000);
      if (talk.quiet()) speech.push(talk.quizAsk(q));     // read aloud only when it is quiet
    } else if (!c.reveal && now >= c.until) {
      quiz.close(now);
      settleQuiz(c);
      const names = c.right.filter(Boolean).slice(0, 3);
      ui.quizReveal(c, names);
      snd("reveal");
      ui.quizFast(c.fast, c.right.length);
      if (c.right.length || talk.quiet()) speech.push(talk.quizResult(c, names));
    } else if (!c.reveal) ui.quizTick(Math.max(0, Math.ceil((c.until - now) / 1000)), QUIZ_OPEN_MS / 1000);
  }

  /** "Phiên mới" / "Loạt mới": the field and the panels start clean. */
  function startClean() {
    if (inSummary) {               // a result or the break before a match is on: dropped at once
      summaryRun++;
      inSummary = false; frozen = null; held = false;
      try { ui.resultHide(); ui.breakCountdown(1, 0); } catch { /* the panels only */ }
      try { speech.endScript(); } catch { /* nothing was being said */ }
    }
    speech.stop();                 // nothing of the old session is said any more
    game.lastTick = null;
    battle.reset(game.roster(), fieldOpts());
    waveDone = -1;
    field.finish(null);
    ui.clearCards();
    quiz.stop(); ui.quizHide();
    director.release(); director.hold(null); director.release();
    dirty = true;
  }

  // ---------- commands of the control window ----------
  let hub = null;
  // (from the highest one of the session that was restored: starting at 0 again, "+5 mỗi đội" spoke as the test viewers
  // already there and added nobody, and "Đỏ nhận" gave its item to a blue one)
  let botN = Math.max(0, ...Object.keys(game.s.users).map((k) => (k.startsWith("thu-") ? Number(k.slice(4)) || 0 : 0)));
  let rageTimer = 0;
  const BOT_NAMES = ["An", "Bình", "Chi", "Dũng", "Giang", "Hà", "Khoa", "Lan", "Minh", "Nga", "Oanh", "Phúc", "Quân", "Sơn", "Thảo", "Uyên", "Vy", "Yến", "Tùng", "Hiếu"];
  // the test viewers have names like real ones, with no number (the user took "Hà 25" for a value of the game): a
  // first name, then a second one once the first twenty are taken; a number only past two hundred
  const BOT_SECOND = ["", "Anh", "My", "Linh", "Bảo", "Nhi", "Long", "Trang", "Đức", "Mai"];
  const botName = (id) => {
    const i = id - 1, first = BOT_NAMES[i % BOT_NAMES.length], round = Math.floor(i / BOT_NAMES.length);
    return round < BOT_SECOND.length ? `${first} ${BOT_SECOND[round]}`.trim() : `${first} ${id}`;
  };
  const bot = (id) => ({ id: `thu-${id}`, unique_id: `thu${id}`, nickname: botName(id), avatar_hub: "" });
  function onCommand(c) {
    switch (c.cmd) {
      case "reset_series": game.resetSeries(); startClean(); ui.banner("LOẠT MỚI", "g", 1800); break;
      case "new_session": clearTimeout(rageTimer); demo.stop(); game.newSession(); startClean(); ui.banner("PHIÊN MỚI", "g", 1800); break;
      case "pause": game.s.paused = true; dirty = true; break;
      case "resume": game.s.paused = false; game.lastTick = null; dirty = true; break;
      case "end_match": if (!inSummary) finishMatch(c.winner === "A" ? "A" : "D", "button"); break;
      case "say": if (c.text) speech.push({ text: String(c.text), pri: PRI.BIG, ttl: 60_000 }); break;
      case "settings": applySettings(c.settings || {}); break;
      case "sim":          // through the hub like a real viewer; with no hub open, straight into the game
        if (hub?.connected && cfg.channel) hub.simulate(cfg.channel, c.payload || {}); else simLocal(c.payload || {});
        break;
      case "sim_local": simLocal(c.payload || {}); break;
      case "quiz_shuffle": settleQuiz(quiz.cur); quiz.shuffle(); quiz.stop(); ui.quizHide(); break;
      case "gift_test": {  // a test button: an item of this value from a test viewer of this team (made if there is none)
        const worth = Math.floor(Number(c.tier) || 0);      // any value: one that is not one of the six is dealt into several
        if (inSummary || worth < 1) break;
        const team = c.team === "A" ? "A" : "D";
        let key = Object.keys(game.s.users).find((k) => k.startsWith("thu-") && game.s.users[k].team === team);
        if (!key) { const id = ++botN; key = `thu-${id}`; apply(game.comment({ user: bot(id), text: team === "D" ? "thủ" : "đánh" })); }
        const u = game.s.users[key];
        const ev = { user: { id: key, unique_id: u.uid, nickname: u.name, avatar_hub: u.avatar }, gift: { name: `Vật phẩm ${worth}`, diamonds: worth }, count: 1, coins: worth };
        apply(game.gift(ev)); apply(game.giftDone(ev));
        break;
      }
      case "wave_now": if (!inSummary) battle.nextWave = battle.t + 0.2; break;
      case "rage_test":    // a test button: the match that is on becomes the match of fury (lead: the team that is ahead)
        if (inSummary) break;
        game.startRage(c.lead === "D" ? "D" : "A");
        battle.reset(game.roster(), fieldOpts());
        waveDone = -1;
        ui.banner("TRẬN NỘ!", "a", 2800); snd("hero", 6);
        speech.push(talk.matchStart(game.s.match.n, [], "rage", game.s.series.lead));
        dirty = true;
        break;
      case "demo":         // a crowded live played by the game itself (demo.js): on, or off; rage: straight into the match of fury
        clearTimeout(rageTimer);
        if (c.off) { demo.stop(); break; }
        demo.start({ pace: Number(c.pace) || 1 });
        if (c.rage) rageTimer = setTimeout(() => { if (demo.on) onCommand({ cmd: "rage_test", lead: c.lead === "D" ? "D" : "A" }); }, 4000);
        break;
      case "bots_points": {   // the test viewers send likes, and most of them answer the question that is open
        const q = quiz.cur;
        for (const [key, u] of Object.entries(game.s.users)) {
          if (!key.startsWith("thu-")) continue;
          const user = { id: key, unique_id: u.uid, nickname: u.name, avatar_hub: u.avatar };
          onEvent({ type: "like", user, count: 25 });
          if (q && !q.reveal && Math.random() < 0.6) onEvent({ type: "comment", user, text: q.shown });
        }
        break;
      }
      case "bots": {     // test viewers straight into the game (not through the hub): n for each team
        const n = Math.max(1, Math.min(60, Number(c.n) || 5));
        for (let i = 0; i < n * 2; i++) {
          const id = ++botN;
          const team = c.team === "D" || c.team === "A" ? c.team : i % 2 ? "A" : "D";
          apply(game.comment({ user: bot(id), text: team === "D" ? "thủ" : "đánh" }));
        }
        break;
      }
      case "events":     // a past live played again from the control window
        for (const ev of c.list || []) onEvent(ev);
        break;
      default:
    }
  }
  const demo = new Demo({ onEvent: (ev) => onEvent(ev), quiz: () => quiz.cur });
  /** A like, a share or a follow: the picture of whoever did it floats up, with or without a character (the user,
   *  10/11/2026: most of those who press the heart never commented, so nothing was floating). Nothing is kept of
   *  them. With a character, the life it gives back has already shown it ("+máu"): the same one is not shown twice. */
  function seenDoing(ev, why) {
    const key = userKey(ev.user, "");
    if (!key) return;
    const u = game.s.users[key];
    acted({ key, name: u?.name || ev.user?.nickname || "", avatar: u?.avatar || ev.user?.avatar_hub || "", team: u?.team || null, tier: u?.team ? game.top(u) : 0 }, why, "");
  }
  /** A test from the control window when the hub is not open (or for what the hub cannot play): straight into the game. */
  function simLocal(p) {
    const name = String(p.user || "Khách thử");
    const user = { id: `sim-${name}`, unique_id: name.toLowerCase().replace(/\s+/g, "_"), nickname: name, avatar_hub: "" };
    const count = Math.max(1, Number(p.count) || 1);
    if (p.kind === "comment") onEvent({ type: "comment", user, text: String(p.text || "") });
    else if (p.kind === "gift") {
      const each = Math.max(1, Number(p.diamonds) || 1), ev = { user, gift: { name: p.gift || "Rose", diamonds: each }, count, coins: each * count };
      onEvent({ type: "gift", ...ev }); onEvent({ type: "gift_done", ...ev });
    } else if (p.kind === "like") onEvent({ type: "like", user, count });
    else if (p.kind === "share" || p.kind === "follow") onEvent({ type: p.kind, user });
  }
  function onEvent(ev) {
    if (ev.type === "comment") onComment(ev);
    else if (ev.type === "gift") apply(game.gift(ev));
    else if (ev.type === "gift_done") apply(game.giftDone(ev));
    else if (ev.type === "like") { apply(game.like(ev)); seenDoing(ev, "like"); }
    else if (ev.type === "share") { apply(game.share(ev)); seenDoing(ev, "share"); }
    else if (ev.type === "follow") { apply(game.follow(ev)); seenDoing(ev, "follow"); }
    else if (ev.type === "join") apply(game.seen(ev));
  }
  function applySettings(s) {
    const oldCh = cfg.channel;
    Object.assign(cfg, s);
    talk.quizOn = cfg.quiz;
    game.s.matchMs = cfg.matchMs;
    if (!cfg.speech) speech.stop();
    sound.set({ on: cfg.sound, sfx: cfg.sfx });
    if (s.seriesMatches) game.setSeries(s.seriesMatches);
    if (s.points) { cfg.points = { ...POINTS, ...s.points }; game.setPoints(cfg.points); }
    legend();
    if (hub && cfg.channel !== oldCh) {
      if (oldCh) {
        hub.unsubscribe(oldCh);
        // its numbering is forgotten: the control window lets the hub close a channel no game listens to any more, and
        // a channel opened again counts from 0 (kept, the old position would throw every new event away)
        delete hub.pos.seq[cleanChannel(oldCh)];
        game.s.hub = hub.pos;
        dirty = true;
      }
      hub.simOnly = isTest(cfg.channel);
      if (cfg.channel) { hub.subscribe([cfg.channel]); if (!hub.simOnly) hub.watch(cfg.channel); }
    }
  }
  const es = new EventSource("/api/stream");
  es.onmessage = (m) => { try { onCommand(JSON.parse(m.data)); } catch (err) { report("command", err); } };

  // ---------- the hub ----------
  let hubState = "Đang tìm TikTok Live Hub…";
  let live = null;
  async function connectHub() {
    let port = HUB_PORT;
    while (!window.TikTokLiveHub) {
      try {
        // the port is the hub's own setting: the app knows it (8765 unless it was changed in the hub's page)
        port = Number((await fetch("/api/hub").then((r) => r.json()).catch(() => ({}))).port) || HUB_PORT;
        await new Promise((res, rej) => {
          const s = document.createElement("script");
          s.src = `http://127.0.0.1:${port}/tiktok-live-hub.js?t=${Date.now()}`;
          s.onload = res;
          s.onerror = () => { s.remove(); rej(new Error("hub")); };
          document.head.appendChild(s);
        });
      } catch {
        hubState = "Chưa mở TikTok Live Hub";
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    hub = new window.TikTokLiveHub({ url: `ws://127.0.0.1:${port}/ws`, channels: cfg.channel ? [cfg.channel] : [],
      client: "Giữ thành", simOnly: isTest(cfg.channel) });
    hub.pos = game.s.hub.epoch ? game.s.hub : { epoch: null, seq: {} };   // continue where the saved game stopped
    const keep = () => { game.s.hub = hub.pos; dirty = true; };
    // the hub names a channel in lower case, without @ or link: compared the same way (see game/channel.js)
    const mine = (e) => sameChannel(e.ch, cfg.channel);
    for (const type of ["comment", "gift", "gift_done", "like", "share", "follow", "join"])
      hub.on(type, (e) => { keep(); if (mine(e)) { try { onEvent(e); } catch (err) { report(`event ${type}`, err); } } });
    hub.on("live_start", (e) => { keep(); if (mine(e)) live = true; });
    hub.on("live_end", (e) => { keep(); if (mine(e)) live = false; });
    hub.on("reset", keep);
    hub.on("subscribed", (e) => { if (cfg.channel && sameChannel(e.ch, cfg.channel)) live = !!e.live; });
    hub.on("open", () => { hubState = ""; });
    hub.on("close", () => { hubState = "Mất kết nối TikTok Live Hub"; });
    hub.on("error", (e) => console.warn("[hub]", e.message || e));
    hub.connect();
    if (cfg.channel && !isTest(cfg.channel)) hub.watch(cfg.channel);
  }
  connectHub();

  // ---------- the field's clock: a timer, not the frames (frames stop when the window is hidden, the match must not) ----------
  let lastStep = performance.now();
  let waveDone = -1;             // the wave whose opening has been prepared
  setInterval(() => {
    const now = performance.now();
    let dt = Math.min(0.25, (now - lastStep) / 1000);
    lastStep = now;
    try {
      const running = !inSummary && !game.s.paused;
      if (running) {
        apply(game.tick(Date.now()));
        // the gates are about to open: the planned moves ("đổi") are made, and everyone of a team who is not on the
        // field (new, fallen, back in the live) is waiting behind a gate
        // (within this step: a long one, up to a quarter of a second on a busy computer, used to jump over the moment,
        // and those waiting stayed out one more wave)
        if (battle.waveLeft() < 0.15 + dt && waveDone !== battle.waveN) {
          waveDone = battle.waveN;
          apply(game.wave());
          for (const v of game.roster()) if (!battle.hasUnit(v.uk)) battle.enqueue(v);
        }
        for (let left = dt; left > 0.0005 && !battle.over; left -= 0.05) battle.update(Math.min(0.05, left));
        onBattle(battle.take());
      } else game.lastTick = Date.now();
      field.update(dt);
      director.update(now);
      // the last seconds: when nothing else is shown, the camera stays on the breach (or the whole field)
      if (running && finale() && director.overview && !director.holding) {
        const base = battle.gates[battle.front].broken ? battle.front : null;
        if (base && field.focused !== base) field.focus(base, "medium");
      }
    } catch (err) { report("step", err); }
  }, 16);

  // ---------- the slower clock: gathered lines, the quiz, the tips ----------
  let lastTickSecond = 0;
  setInterval(() => {
    try {
      const left = Math.ceil(game.timeLeftMs() / 1000);
      if (!inSummary && !game.s.paused && left <= 10 && left > 0 && left !== lastTickSecond) { lastTickSecond = left; snd("heartbeat", left); }
      say(talk.flush());
      runQuiz(Date.now());
      if (!inSummary && !game.s.paused && !speech.busy() && speech.idleFor() > (battle.rage ? 2500 : talk.quiet() ? 6000 : 12_000)) speech.push(talk.filler());
    } catch (err) { report("tick", err); }
  }, 200);

  // ---------- every frame: the picture ----------
  let uiAt = 0, topAt = -1e9, shownKind;
  let frameErrAt = -1e9;
  function frame(t) {
    requestAnimationFrame(frame);    // first: an error in one frame never stops the picture
    try {
      field.draw();
      ui.giantBacks(battle.rage && !inSummary ? field.giantBacks() : null);
      if (t - uiAt > 200) {
        uiAt = t;
        const se = game.s.series;
        ui.setScore({ nD: game.members("D"), nA: game.members("A"), wD: frozen ? frozen.wins.D : se.wins.D, wA: frozen ? frozen.wins.A : se.wins.A,
          n: frozen ? frozen.n : game.s.match.n, of: Math.max(game.seriesMatches, frozen ? frozen.n : game.s.match.n), kind: frozen ? frozen.kind : game.s.match.kind,
          on: { D: battle.count("D", true), A: battle.count("A", true) }, wait: { D: battle.waiting("D"), A: battle.waiting("A") } });
        ui.setWave(inSummary ? 0 : battle.waveLeft(), battle.T.wave, battle.waveN);
        ui.setTimer(game.timeLeftMs(), game.s.paused, frozen ? frozen.timer : null);
        const kind = frozen ? frozen.kind : game.s.match.kind;
        if (kind !== shownKind) { shownKind = kind; rageOn = kind === "rage"; ui.setMode(kind); legend(); }
        if (rageOn) ui.setDuel(frozen ? frozen.duel.D : battle.giantRatio("D"), frozen ? frozen.duel.A : battle.giantRatio("A"));
        else ui.setHall(frozen ? frozen.hall : battle.hallRatio());
        if (frozen) ui.setPeople(frozen.people, `TOP TRẬN ${frozen.n}`);
        else if (t - topAt > 1000) { topAt = t; ui.setPeople(game.topPeople(3, game.s.match.people, battle.scores()), "TOP TRẬN NÀY"); }
        ui.status(hubState || (cfg.channel ? "" : "Chưa chọn kênh: mở cửa sổ Điều khiển"));
      }
    } catch (err) { if (t - frameErrAt > 10_000) { frameErrAt = t; report("frame", err); } }
  }
  requestAnimationFrame(frame);

  // ---------- saving, and what the control window shows ----------
  const SAVE_MS = 5000;
  let savedAt = 0;
  const snapshot = () => { game.s.battle = inSummary ? null : battle.snapshot(); return game.s; };
  setInterval(() => {
    const now = Date.now();
    const every = Object.keys(game.s.users).length > 1500 ? SAVE_MS * 3 : SAVE_MS;     // a very big session: written less often
    if ((dirty || !inSummary) && now - savedAt >= every) {
      dirty = false; savedAt = now;
      api("/api/state", snapshot()).catch(() => { dirty = true; });
    }
    api("/api/game-status", {
      match: game.s.match.n, of: game.seriesMatches, left: game.timeLeftMs(), paused: game.s.paused, inSummary,
      hub: hubState || "ok", channel: cfg.channel, live,
      viewers: Object.keys(game.s.users).length, d: game.members("D"), a: game.members("A"), waiting: battle.queue.size,
      wins: game.s.series.wins, hall: Math.round(battle.hallRatio() * 100), wave: battle.waveN, waveLeft: Math.ceil(battle.waveLeft()),
      speaking: speech.current?.text || "",
    }).catch(() => {});
  }, 2000);
  window.addEventListener("beforeunload", () => navigator.sendBeacon?.("/api/state", new Blob([JSON.stringify(snapshot())], { type: "application/json" })));

  // the first match of this run
  snd("horn");
  speech.push(talk.matchStart(game.s.match.n));

  // for testing from the console: __game.onEvent({type:"comment",user:{id:"1",nickname:"An"},text:"thủ"})
  window.__game = { game, battle, field, director, talk, speech, quiz, sound, apply, onEvent, onCommand, finishMatch, hub: () => hub, tiers: GIFT_TIERS };
}

boot().catch((e) => {
  console.error(e);
  ui.status("Lỗi khởi động: " + (e?.message || e));
});

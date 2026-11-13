// The panels around the field (plain DOM; text always set with textContent: nicknames come from strangers).
import { AWARDS, TIERS, TEAMS, HEAL, GIANT } from "./game/rules.js";
import { icon, mountIcons } from "./icons.js";

const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

/** 1rem = 1% of the stage's height: the whole page scales with the window (1080 x 1920 for the live). */
export function fitStage() {
  const s = $("#stage");
  const set = () => { document.documentElement.style.fontSize = s.getBoundingClientRect().height / 100 + "px"; };
  set();
  mountIcons();
  new ResizeObserver(set).observe(s);
  window.addEventListener("resize", set);
}

/** A viewer's picture in a ring (the colour of their team, a frame by their level); with no picture (or one that does
 *  not load) a round in a colour of their own with their initial. */
function face(avatar, name, team = null, tier = 0) {
  const lvl = tier >= 6 ? 5 : tier >= 5 ? 4 : tier >= 3 ? 3 : tier >= 1 ? 2 : 1;
  const box = el("span", `av ${team === "D" ? "d" : team === "A" ? "a" : ""}${lvl >= 2 ? ` l${Math.min(5, lvl)}` : ""}`);
  const ph = () => {
    const n = String(name || "?").trim();
    let h = 0; for (const ch of n) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    const e = el("span", "ph", (n[0] || "?").toUpperCase());
    e.style.background = `linear-gradient(135deg, hsl(${h % 360} 62% 58%), hsl(${(h + 40) % 360} 58% 36%))`;
    return e;
  };
  if (!avatar) box.append(ph());
  else {
    const img = document.createElement("img");
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.onerror = () => img.replaceWith(ph());
    img.src = avatar;
    box.append(img);
  }
  if (lvl >= 2 && team) box.append(el("i", `tm ${team === "D" ? "d" : "a"}`));   // the frame took the ring: a dot keeps the team
  return box;
}
const shown = (name, uid) => name || (uid ? `@${uid}` : "Một bạn");

// ---------- the top ----------
export function setScore(s) {
  $("#n-d").textContent = s.nD; $("#n-a").textContent = s.nA;
  $("#w-d").textContent = s.wD; $("#w-a").textContent = s.wA;
  // "TRẬN 2/5", or the name of a match that is not like the others
  const box = $("#match-box"), kind = s.kind || "";
  if (box.dataset.kind !== kind) {
    box.dataset.kind = kind;
    box.classList.toggle("sp", !!kind);
    if (kind) box.textContent = "TRẬN NỘ";
    else box.replaceChildren("TRẬN ", Object.assign(document.createElement("b"), { id: "match-n" }), "/", Object.assign(document.createElement("span"), { id: "match-of" }));
  }
  if (!kind) { $("#match-n").textContent = s.n; $("#match-of").textContent = s.of; }
  $("#on-d").textContent = s.on.D; $("#on-a").textContent = s.on.A;
  $("#wait-d").textContent = s.wait.D; $("#wait-a").textContent = s.wait.A;
}
/** The pictures of the pack for the panels (once it has loaded). */
export function setArt({ castle }) {
  if (castle) $("#castle-pic").src = castle;
}
/** The seconds until the 4 gates open again. */
export function setWave(left, total, n) {
  const w = $("#wave"), s = Math.ceil(left);
  w.hidden = !(left > 0);
  $("#wave-n").textContent = s;
  w.classList.toggle("hot", s <= 5);
  void total; void n;
}
export function waveOpen() { const w = $("#wave"); w.classList.remove("open"); void w.offsetWidth; w.classList.add("open"); }

let timerShown = null;
/** The clock. Each digit sits in a cell of its own width, so the box never moves as the seconds change. */
export function setTimer(leftMs, paused, text = null) {
  const t = $("#timer");
  const s = Math.max(0, Math.ceil(leftMs / 1000));
  const clock = !text && !paused;
  const str = text ?? (paused ? "TẠM DỪNG" : `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`);
  if (str !== timerShown) {
    timerShown = str;
    if (clock) t.replaceChildren(...[...str].map((ch) => el("span", ch === ":" ? "c" : "n", ch)));
    else t.textContent = str;
  }
  t.classList.toggle("hot", clock && s <= 10 && s > 0);
  t.style.fontSize = "";
  t.classList.toggle("txt", !clock);
}

export function setHall(ratio) {
  const p = Math.max(0, Math.round(ratio * 100));
  $("#hall-pct").textContent = `${p}%`;
  const f = $("#hall-fill");
  f.style.width = `${p}%`;
  $("#hallbar").classList.toggle("low", ratio <= 0.25);
}
/** The match of fury: the bar of the castle gives way to the strength of the two giants, face to face. */
let modeShown;
export function setMode(kind) {
  if (kind === modeShown) return;
  modeShown = kind;
  $("#hallbar").classList.toggle("rage", kind === "rage");
}
export function setDuel(d, a) {
  for (const [id, r] of [["d", d], ["a", a]]) {
    const p = Math.max(0, Math.round(r * 100));
    $(`#duel-${id}`).style.width = `${p}%`;
    $(`#duel-p${id}`).textContent = `${p}%`;
    $(`#duel .g.${id}`).classList.toggle("low", r <= 0.25);
  }
}
const duelHitAt = { d: 0, a: 0 };
export function duelHit(id) {
  const now = performance.now();
  if (now - duelHitAt[id] < 500) return;
  duelHitAt[id] = now;
  const g = $(`#duel .g.${id}`); g.classList.remove("hit"); void g.offsetWidth; g.classList.add("hit");
}
let hallHitAt = 0;
export function hallHit() {
  const now = performance.now();
  if (now - hallHitAt < 500) return;
  hallHitAt = now;
  const b = $("#hallbar"); b.classList.remove("hit"); void b.offsetWidth; b.classList.add("hit");
}

export function status(text) {
  const s = $("#status");
  s.hidden = !text;
  s.textContent = text || "";
}

// ---------- big moments ----------
let bannerTimer = 0;
export function banner(text, cls = "", ms = 2400) {
  const b = $("#banner");
  clearTimeout(bannerTimer);
  if (!text) { b.hidden = true; return; }
  b.className = cls; b.textContent = text; b.hidden = false;
  b.style.animation = "none"; void b.offsetWidth; b.style.animation = "";
  bannerTimer = setTimeout(() => { b.hidden = true; }, ms);
}

let calloutTimer = 0;
/** A viewer's item called something onto the field: their picture, their name, what came (and its picture).
 *  big: the biggest items, shown larger while the field darkens around the middle. */
export function callout({ team, name, uid, avatar, tier = 0, power, count = 1, pic = null, big = false }) {
  const c = $("#callout");
  clearTimeout(calloutTimer);
  const halo = el("div", "halo"); halo.append(face(avatar, name, team, tier));
  const txt = el("div", "txt");
  txt.append(el("div", "who", shown(name, uid)), el("div", "what", `${power.toUpperCase()}${count > 1 ? ` ×${count}` : ""}`));
  const kids = [halo, txt];
  if (pic) { const im = document.createElement("img"); im.className = "picon"; im.alt = ""; im.src = pic; kids.push(im); }
  c.replaceChildren(...kids);
  c.className = `${team === "D" ? "d" : "a"}${big ? " big" : ""}`;
  c.hidden = false;
  c.style.animation = "none"; void c.offsetWidth; c.style.animation = "";
  calloutTimer = setTimeout(() => { c.hidden = true; }, big ? 4200 : 3400);
}
let cineTimer = 0;
/** The field darkens around the middle for `ms` (a very big item is on). */
export function cine(ms = 3200) {
  const c = $("#cine");
  c.classList.add("on");
  clearTimeout(cineTimer);
  cineTimer = setTimeout(() => c.classList.remove("on"), ms);
}

// ---------- top players of the match ----------
let peopleKey = "";
export function setPeople(list, title = "TOP TRẬN NÀY") {
  const k = title + "|" + list.map((p) => `${p.key}:${p.points}:${p.team}`).join(",");
  if (k === peopleKey) return;
  peopleKey = k;
  $("#people-title").textContent = title;
  const ol = $("#people-list");
  if (!list.length) { ol.replaceChildren(el("li", "none", "Chưa có ai ghi điểm")); return; }
  ol.replaceChildren(...list.slice(0, 3).map((p, i) => {
    const li = el("li", p.team === "D" ? "d" : p.team === "A" ? "a" : "");
    const m = icon("medal", i + 1); m.classList.add("medal");
    li.append(m, face(p.avatar, p.name, p.team, p.tier), el("span", "nm", shown(p.name, p.uid)), el("span", "p", String(p.points)));
    return li;
  }));
}

// ---------- what a viewer just did (a like, a share, a follow, a right answer, joining): their small picture floats
// up in the free space of the left column, with the sign of what they did as a badge on its corner and, when
// something was gained, a word ("+5 sức", "vào trận"). Made like the floats of the map game, which the user pointed to
// (10/11/2026: "nhìn nó lỗi lỗi, sao không tham khảo TiktokMapLive"): small, straight up with a little sway, never
// tilted, spread across the width, never two starting at once, one per viewer and kind at a time ----------
const WHY_ICON = { comment: "chat", like: "heart", share: "share", follow: "follow", quiz: "quiz" };
const MAX_FLOATS = 8;      // more at once: the newest are simply not shown (nothing is lost, it is only a picture)
const FLOAT_MS = 3200;
const FLOAT_GAP = 230;     // between two starts: a flood of likes rises as a steady stream, not as a heap
const SLOTS = [0, 2, 4, 1, 3];     // where the next one starts across the column: far from the one before
const floats = new Map();  // viewer|kind -> its float
// three streams, each with its own pace: the left column, and in the match of fury the back of each giant
const lanes = { col: { next: 0, slot: 0, n: 0, max: MAX_FLOATS }, D: { next: 0, slot: 0, n: 0, max: 6 }, A: { next: 0, slot: 0, n: 0, max: 6 } };
/** g.at: "D" | "A" in the match of fury (behind the giant of that team: the user, 11/11/2026: "khi nộ thì bong bóng
 *  bay không hiện chỗ này nữa mà hiện sau lưng mỗi con khổng lồ"); otherwise the left column. */
export function pointLive(g) {
  const key = `${g.key ?? g.name}|${g.why}`, now = performance.now();
  const lane = lanes[g.at] ? g.at : "col", L = lanes[lane];
  if (floats.has(key) || L.n >= L.max) return;
  const start = Math.max(now, L.next), delay = start - now;
  if (delay > 1500) return;
  L.next = start + FLOAT_GAP;
  const f = el("div", "float");
  f.dataset.why = g.why || "";
  f.append(face(g.avatar, g.name, g.team, g.tier), icon(WHY_ICON[g.why] || "star"));
  if (g.text) f.append(el("span", "pts", g.text));
  const dur = FLOAT_MS + Math.round(Math.random() * 600), slot = SLOTS[L.slot++ % SLOTS.length];
  // behind a giant: a narrow stream, each one a step farther out than the one before; in the column: across its width
  f.style.setProperty("--x", lane === "col" ? `${Math.max(0, Math.min(70, slot * 17 + (Math.random() - 0.5) * 6))}%` : `${(slot * 0.85 + Math.random() * 0.4).toFixed(2)}rem`);
  f.style.setProperty("--sway", `${(Math.random() - 0.5) * 3}rem`);
  f.style.setProperty("--dur", `${dur}ms`);
  f.style.animationDelay = `${Math.round(delay)}ms`;
  floats.set(key, f); L.n++;
  (lane === "col" ? $("#floats") : $(`#gfloats .ga[data-team="${lane}"]`)).append(f);
  setTimeout(() => { if (f.isConnected) L.n = Math.max(0, L.n - 1); f.remove(); if (floats.get(key) === f) floats.delete(key); }, delay + dur + 100);
}
/** Every frame of the match of fury: where the back of each giant is on the screen (field.giantBacks()), so what
 *  floats up there follows the camera. null: no giants (nothing is shown there). */
let backsOn = false;
export function giantBacks(backs) {
  const box = $("#gfloats");
  if (!backs) { if (backsOn) { backsOn = false; box.hidden = true; } return; }
  if (!backsOn) { backsOn = true; box.hidden = false; }
  for (const a of box.children) {
    const p = backs[a.dataset.team];
    // the camera close on the two giants: their backs are off the picture; the floats stay inside it, by the edge
    const x = p.side < 0 ? Math.max(p.x, 0.23) : Math.min(p.x, 0.77), y = Math.min(0.7, Math.max(0.3, p.y));
    a.style.left = `${(x * 100).toFixed(2)}%`; a.style.top = `${(y * 100).toFixed(2)}%`;
    a.style.setProperty("--gz", Math.min(1.5, 0.9 + (p.z - 1) * 0.45).toFixed(3));
    a.classList.toggle("l", p.side < 0);
    a.classList.toggle("gone", !p.up);
  }
}

export function clearCards() {
  floats.clear();
  for (const L of Object.values(lanes)) L.n = 0;
  $("#floats").replaceChildren();
  for (const a of $("#gfloats").children) a.replaceChildren();
  $("#callout").hidden = true;
  $("#cine").classList.remove("on");
}

// ---------- the result of a match, the break ----------
const AWARD_ORDER = ["killer", "breaker", "healer", "mender"];
const AWARD_ICON = { killer: "sword", breaker: "hammer", healer: "shield", mender: "wood" };
const AWARD_UNIT = { killer: " mạng", breaker: " điểm", healer: " sức", mender: " điểm" };
export function result(e) {
  const r = $("#result");
  const W = TEAMS[e.winner];
  const kids = [];
  if (e.final && e.series) {
    const s = e.series;
    kids.push(el("div", "rt", `CHUNG CUỘC ${s.matches} TRẬN`));
    const rw = el("div", "rw" + (s.winner ? "" : " g"), s.winner ? `${TEAMS[s.winner].name.toUpperCase()} VÔ ĐỊCH` : "HAI ĐỘI HOÀ");
    kids.push(rw);
    const rs = el("div", "rs"); rs.append(`${TEAMS.D.name} `, el("b", "d", String(s.wins.D)), " : ", el("b", "a", String(s.wins.A)), ` ${TEAMS.A.name}`);
    kids.push(rs);
    const rows = el("div", "rows");
    s.top.forEach((p, i) => {
      const row = el("div", `row ${p.team === "D" ? "d" : "a"}`);
      const txt = el("div"); txt.append(el("div", "t", `Nổi bật nhất · hạng ${i + 1}`), el("div", "n", shown(p.name, p.uid)));
      row.append(icon("medal", i + 1), face(p.avatar, p.name, p.team, p.tier), txt, el("div", "v", `${p.points} điểm`));
      row.firstChild.classList.add("medal");
      rows.append(row);
    });
    kids.push(rows);
    r.className = s.winner === "D" ? "d" : s.winner === "A" ? "a" : "";
  } else {
    const Lo = TEAMS[e.winner === "D" ? "A" : "D"];
    kids.push(el("div", "rw", `${W.name.toUpperCase()} THẮNG`));
    kids.push(el("div", "rt", e.kind === "rage"
      ? `TRẬN NỘ · ${e.reason === "giant" ? `người khổng lồ ${Lo.name} đã gục` : `hết giờ, người khổng lồ ${W.name} còn nhiều sức hơn`}`
      : `KẾT QUẢ TRẬN ${e.n} · ${e.winner === "D" ? `giữ được thành, lâu đài còn ${Math.round(e.hallLeft * 100)}%` : "lâu đài đã sập"}`));
    // what it means for the series
    if (e.levelled) kids.push(el("div", "rl", "CÂN BẰNG TỈ SỐ! Trận sau phân thắng bại"));
    else if (e.nextKind === "rage" && e.lead) kids.push(el("div", "rl", `${TEAMS[e.lead === "D" ? "A" : "D"].name} còn một cơ hội: TRẬN NỘ`));
    // the score of the series, big, between the emblems of the two teams
    const vs = el("div", "vs");
    const emblem = (name) => Object.assign(document.createElement("img"), { src: `/ts/ui/icon_${name}.png`, alt: "" });
    vs.append(emblem("shield"), el("b", `d${e.winner === "D" ? " up" : ""}`, String(e.wins.D)), el("i", null, ":"), el("b", `a${e.winner === "A" ? " up" : ""}`, String(e.wins.A)), emblem("sword"));
    kids.push(vs);
    // the ranking of the two teams, side by side: the winners on the left, their first on a card of their own
    const board = el("div", "board");
    const line = (p, i, max) => {
      const row = el("div", "br");
      const rk = i < 3 ? icon("medal", i + 1) : el("b", "rk", String(i + 1));
      if (i < 3) rk.classList.add("medal");
      const info = el("div", "bi");
      const bar = el("i", "bar"); bar.append(Object.assign(el("i"), { style: `width:${Math.max(6, Math.round((p.points / max) * 100))}%` }));
      const top = el("div", "bt"); top.append(el("span", "bn", shown(p.name, p.uid)), el("b", "bp", String(p.points)));
      info.append(top, bar);
      row.append(rk, face(p.avatar, p.name, p.team, p.tier), info);
      return row;
    };
    const col = (team, won) => {
      const c = el("div", `col ${team === "D" ? "d" : "a"}${won ? " won" : ""}`);
      const head = el("div", "ch");
      head.append(el("b", null, TEAMS[team].name.toUpperCase()), el("span", null, `${e.size?.[team] ?? ""} người`), el("em", null, won ? "THẮNG" : "THUA"));
      c.append(head);
      const list = e.board?.[team] || [], max = list[0]?.points || 1;
      if (!list.length) { c.append(el("div", "none", "chưa ai ghi điểm")); return c; }
      if (won) {                                   // the first of the winners: a card of their own
        const p = list[0], mvp = el("div", "mvp");
        const halo = el("div", "halo"); halo.append(icon("crown"), face(p.avatar, p.name, p.team, p.tier));
        const info = el("div", "mi");
        const chips = el("div", "chips");
        chips.append(el("span", "pt", `${p.points} điểm`));
        if (p.kills) chips.append(el("span", null, `hạ ${p.kills}`));
        if (p.units > 1) chips.append(el("span", null, `${p.units} quân`));
        info.append(el("div", "ml", "DẪN ĐẦU TRẬN"), el("div", "mn", shown(p.name, p.uid)), chips);
        mvp.append(halo, info);
        c.append(mvp);
        list.slice(1, 5).forEach((q, i) => c.append(line(q, i + 1, max)));
      } else list.slice(0, 4).forEach((q, i) => c.append(line(q, i, max)));
      return c;
    };
    board.append(col(e.winner, true), col(e.winner === "D" ? "A" : "D", false));
    kids.push(board);
    r.className = e.winner === "D" ? "d" : "a";
  }
  r.replaceChildren(...kids);
  r.hidden = false;
  r.style.animation = "none"; void r.offsetWidth; r.style.animation = "";
}
export function resultHide() { $("#result").hidden = true; }

export function breakCountdown(next, seconds, total = 10, kind = null) {
  const b = $("#break");
  if (!(seconds > 0)) { b.hidden = true; return; }
  b.hidden = false;
  b.classList.toggle("rage", kind === "rage");
  b.querySelector(".next").textContent = kind === "rage" ? "TRẬN NỘ BẮT ĐẦU SAU" : `TRẬN ${next} BẮT ĐẦU SAU`;
  const n = b.querySelector(".n");
  n.textContent = seconds;
  n.style.animation = "none"; void n.offsetWidth; n.style.animation = "";      // each second lands with a beat
  b.classList.toggle("hot", seconds <= 3);
  b.querySelector(".arc").style.strokeDashoffset = String(276.5 * (1 - seconds / total));
}

// ---------- the quiz ----------
const quizEl = () => $("#quiz");
export function quizShow(c) {
  const q = quizEl();
  q.hidden = false;
  q.classList.remove("reveal");
  q.querySelector(".qtext").textContent = c.q;
  q.querySelector("h3").textContent = { vui: "ĐỐ VUI", biet: "ĐỐ HIỂU BIẾT", meo: "ĐỐ MẸO" }[c.k] || "ĐỐ VUI";
  q.classList.toggle("meo", c.k === "meo");
  q.classList.toggle("biet", c.k === "biet");
  q.querySelector(".qfoot").textContent = c.k === "meo" ? `Câu này lừa đấy! Bình luận câu trả lời (${c.words} chữ)` : `Bình luận câu trả lời (${c.words} chữ)`;
  const f = q.querySelector(".qfast"); f.hidden = true; f.replaceChildren();
}
export function quizTick(left, total) {
  const q = quizEl();
  q.querySelector(".qn").textContent = left;
  q.querySelector(".qring .arc").style.strokeDashoffset = String(106.8 * (1 - left / total));
}
export function quizReveal(c) {
  const q = quizEl();
  q.classList.add("reveal");
  q.querySelector(".qn").textContent = "";
  const foot = q.querySelector(".qfoot");
  foot.replaceChildren(el("span", "al", "ĐÁP ÁN"), el("b", null, c.shown), el("span", "ar", c.right.length ? `${c.right.length} người đúng` : "chưa ai đúng"));
}
/** The ranking of the three fastest right answers, under the answer: medal, picture, name, seconds; then how many
 *  more were right (the user, 10/11/2026). right: how many found it in all. */
export function quizFast(fast, right = fast.length) {
  const f = quizEl().querySelector(".qfast");
  f.hidden = !fast.length;
  if (!fast.length) { f.replaceChildren(); return; }
  const kids = [el("div", "ft", "NHANH NHẤT")];
  fast.forEach((p, i) => {
    const row = el("div", `f r${i + 1}`);
    const m = icon("medal", i + 1); m.classList.add("medal");
    row.append(m, face(p.avatar, p.name, p.team, p.tier), el("span", "nm", p.name), el("span", "s", `${p.s.toFixed(1)} giây`));
    kids.push(row);
  });
  const more = right - fast.length;
  if (more > 0) kids.push(el("div", "fm", `và ${more} người khác cũng đúng`));
  f.replaceChildren(...kids);
}
export function quizHide() { quizEl().hidden = true; }

// ---------- what each item makes of the giver's character (the user's 6 values) ----------
/** pic(team, kind): the face of a kind of character (a URL). The two leaders are in gold and shown bigger. */
export function buildLegend(show = true, pic = null) {
  const box = $("#legend");
  box.hidden = !show;
  box.replaceChildren(...TIERS.slice(1).map((T, i) => {
    const hero = i >= 4;
    const it = el("span", `it r${i + 1}${hero ? " hero" : ""}`);
    const pics = el("span", "pics");
    for (const team of hero ? ["D"] : ["D", "A"]) {
      const src = pic?.(team, T.id);
      if (src) { const im = document.createElement("img"); im.alt = ""; im.src = src; pics.append(im); }
    }
    it.append(pics, el("b", "coin", String(T.gift)), el("span", "nm", T.name), el("span", "lv", T.does));
    return it;
  }));
}

// ---------- what likes, shares and follows give: one slim strip on the top edge of the quiz panel, beside its
// title (the user, 11/11/2026: "cục này cho gọn về bên trên khung đố") ----------
/** points: the settings; step: quiz points for one rank; ranks: the kinds a right answer leads through (ids, the
 *  last is the highest reached this way); pic(team, kind): the face of a kind; series: matches in a series. */
export function buildFree(show, points, step, ranks, pic, series = 5, rage = false) {
  const box = $("#free");
  box.hidden = !show;
  // one short chip for each thing a viewer can do: its sign, how much of it, what it gives
  const chip = (ic, label, gain) => { const c = el("span", `fc ${ic === "heart" ? "like" : ic}`); c.append(icon(ic)); if (label) c.append(el("span", null, label)); c.append(el("b", null, gain)); return c; };
  // what a right answer gives, written in the quiz panel itself, in the user's words (11/11/2026: "Đúng: Lên lính
  // kiếm + Dân > Hồi sức"; "LÊN 1 BẬC" was misleading, the first strip with every step was too long)
  const win = $("#quiz .qwin");
  win.replaceChildren();
  if (points.quiz >= step) {
    const face = (id) => { const src = pic?.("D", id); return src ? Object.assign(document.createElement("img"), { src, alt: "" }) : ""; };
    win.append(el("b", null, "ĐÚNG:"), face(ranks[ranks.length - 1]), el("span", null, "Lên Lính kiếm"), el("i", null, "+"), face(ranks[0]), el("span", null, "Dân"),
      el("i", null, "›"), icon("heart"), el("span", null, "Hồi sức"));
  }
  const kids = rage
    ? [chip("heart", `${GIANT.likes} tim`, `+${GIANT.perViewer}`), chip("share", "", `+${GIANT.share}`), chip("follow", "", `+${GIANT.follow}`), el("span", "fu", "sức khổng lồ")]
    : [chip("heart", `${HEAL.likes} tim`, `+${HEAL.like}`), chip("share", "", `+${HEAL.share}`), chip("follow", "", `+${HEAL.follow}`), el("span", "fu", "sức")];
  void series;
  box.classList.toggle("rage", !!rage);
  box.replaceChildren(...kids);
}

// The control window: settings, match buttons, tests, and the hub's own page (the connection to TikTok) inside it.
// Talks to the game window through the app (/api/cmd), and asks the hub what it knows over the hub's own socket.
import "@fontsource/be-vietnam-pro/400.css";
import "@fontsource/be-vietnam-pro/700.css";
import "./control.css";
import { readLog } from "./game/replay.js";
import { channelNote, channelUsed, otherChannels, wayNote } from "./conn.js";

const $ = (s) => document.querySelector(s);
const post = (path, body) => fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const cmd = (c) => post("/api/cmd", c);
const POINT_KEYS = ["comment", "likes", "coin", "share", "follow", "quiz"];
// the test boxes keep what was last typed or chosen
const REMEMBER = ["sim-user", "sim-text", "sim-gift", "sim-count", "replay-speed"];

let cfg = {};
// the hub (the part that connects to TikTok): where it answers, whether it does, what it last said
let hubPort = 8765, hubUp = null, hubLoaded = false, hubLink = null, hubInfo = null, gameOpen = false;
let wantTab = "";      // one of the hub's own pages to open at once ("proxy")
let replay = null;     // a past live being played again (stopped by "Phiên mới" and "Loạt mới")
async function load() {
  fill(await fetch("/api/settings").then((r) => r.json()));
}

/** Shows the settings as saved by the app (it may have corrected a value: out of range, empty). */
function fill(saved) {
  cfg = saved;
  $("#channel").value = cfg.channel || "";
  $("#match-ms").value = String(cfg.matchMs || 240000);
  $("#series").value = String(cfg.seriesMatches || 5);
  $("#speech").checked = cfg.speech !== false;
  $("#voice").value = cfg.voice || "vieneu:Adam bựa";
  $("#rate").value = String(cfg.rate ?? 0);
  $("#volume").value = String(cfg.volume ?? 1);
  $("#sound").checked = cfg.sound !== false;
  $("#sfx").value = String(cfg.sfx ?? 0.6);
  for (const k of POINT_KEYS) $(`#p-${k}`).value = String(cfg.points?.[k] ?? "");
  $("#quiz").checked = cfg.quiz !== false;
  $("#legend").checked = cfg.legend !== false;
  for (const [id, v] of Object.entries(cfg.controls || {})) { const el = document.getElementById(id); if (el && REMEMBER.includes(id)) el.value = v; }
  for (const id of Object.keys(SLIDES)) slide(id);
  renderConn();
}

// ---------- the tabs: one at a time, the last one opened comes back at the next launch ----------
function openTab(name) {
  if (!document.querySelector(`.tab[data-tab="${name}"]`)) name = "live";
  for (const b of document.querySelectorAll(".tabs button")) { b.classList.toggle("on", b.dataset.tab === name); b.setAttribute("aria-selected", String(b.dataset.tab === name)); }
  for (const s of document.querySelectorAll(".tab")) s.classList.toggle("on", s.dataset.tab === name);
  document.body.classList.toggle("hubtab", name === "hub");     // the hub's page takes the whole window
  window.scrollTo(0, 0);
  if (name === "hub") showHub();
  try { localStorage.setItem("gt-tab", name); } catch { /* no storage: it opens on the first tab */ }
}
for (const b of document.querySelectorAll(".tabs button")) b.onclick = () => openTab(b.dataset.tab);
try { openTab(localStorage.getItem("gt-tab") || "live"); } catch { openTab("live"); }

// ---------- the sliders say their value ----------
const pct = (v) => `${Math.round(v * 100)}%`;
const SLIDES = { rate: (v) => (v > 0 ? `+${v}%` : v < 0 ? `−${-v}%` : "thường"), volume: pct, sfx: pct };
function slide(id) { document.querySelector(`output[for="${id}"]`).textContent = SLIDES[id](Number($(`#${id}`).value)); }
for (const id of Object.keys(SLIDES)) $(`#${id}`).addEventListener("input", () => slide(id));

let savedTimer = 0;
function savedNote(ok) {
  const el = $("#saved");
  el.textContent = ok ? "Đã lưu ✓" : "Chưa lưu được: ứng dụng có đang chạy không?";
  el.classList.toggle("ok", ok);
  el.classList.toggle("bad", !ok);
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => {
    el.textContent = "Thay đổi được lưu ngay";
    el.classList.remove("ok", "bad");
  }, 2500);
}

/** Saves what changed, then the game takes the new settings at once. */
async function save(part, path = "/api/settings") {
  try {
    const r = await post(path, part);
    if (!r.ok) throw new Error(String(r.status));
    fill(await r.json());
    await cmd({ cmd: "settings", settings: cfg });
    savedNote(true);
  } catch (e) {
    console.error(e);
    savedNote(false);
  }
}

$("#reset-settings").onclick = () => {
  if (confirm("Đưa thời gian trận, số trận, điểm, giọng đọc, âm thanh về mặc định?\nKênh vẫn giữ nguyên.")) save({}, "/api/settings/reset");
};
// the app names the channel as the hub does (lower case, the ID out of a pasted link) and the box then shows that name
$("#save-channel").onclick = async () => {
  const old = cfg.channel;
  await save({ channel: $("#channel").value });
  if (old && old !== cfg.channel) dropUnused(old);       // the hub stops watching the channel of before
};
$("#channel").onkeydown = (e) => { if (e.key === "Enter") $("#save-channel").click(); };
$("#match-ms").onchange = (e) => save({ matchMs: Number(e.target.value) });
// a box emptied (to type another number) is not a 0: saved as it was, "Số trận mỗi loạt" became 1 and the match in play
// the last of its series; the box shows the saved value again
const typed = (el) => (el.value.trim() !== "" && Number.isFinite(Number(el.value)) ? Number(el.value) : null);
$("#series").onchange = (e) => { const v = typed(e.target); if (v === null) fill(cfg); else save({ seriesMatches: v }); };
$("#speech").onchange = (e) => save({ speech: e.target.checked });
$("#voice").onchange = (e) => save({ voice: e.target.value });
$("#rate").onchange = (e) => save({ rate: Number(e.target.value) });
$("#volume").onchange = (e) => save({ volume: Number(e.target.value) });
$("#sound").onchange = (e) => save({ sound: e.target.checked });
$("#sfx").onchange = (e) => save({ sfx: Number(e.target.value) });
$("#quiz").onchange = (e) => save({ quiz: e.target.checked });
$("#legend").onchange = (e) => save({ legend: e.target.checked });
$("#quiz-shuffle").onclick = () => cmd({ cmd: "quiz_shuffle" });
for (const k of POINT_KEYS) $(`#p-${k}`).onchange = (e) => { const v = typed(e.target); if (v === null) fill(cfg); else save({ points: { [k]: v } }); };
for (const id of REMEMBER) {
  const el = document.getElementById(id);
  if (el) el.addEventListener("change", () => post("/api/settings", { controls: { [id]: el.value } }).catch(() => {}));
}

let paused = false;
$("#pause").onclick = () => cmd({ cmd: paused ? "resume" : "pause" });
$("#end-d").onclick = () => cmd({ cmd: "end_match", winner: "D" });
$("#end-a").onclick = () => cmd({ cmd: "end_match", winner: "A" });
const stopReplay = () => { if (replay) replay.stop = true; };
$("#reset-series").onclick = () => {
  if (confirm("Bắt đầu loạt mới từ trận 1?\nTỉ số về 0 : 0, mọi người phải bình luận lại để có nhân vật.")) { stopReplay(); cmd({ cmd: "reset_series" }); }
};
$("#new-session").onclick = () => {
  if (confirm("Xoá toàn bộ người chơi, điểm, tỉ số và bắt đầu phiên mới?\nKhông lấy lại được.")) { stopReplay(); cmd({ cmd: "new_session" }); }
};
$("#say").onclick = () => { const t = $("#say-text").value.trim(); if (t) { cmd({ cmd: "say", text: t }); $("#say-text").value = ""; } };
$("#say-text").onkeydown = (e) => { if (e.key === "Enter") $("#say").click(); };

// ---------- tests ----------
$("#bots-5").onclick = () => cmd({ cmd: "bots", n: 5 });
$("#bots-20").onclick = () => cmd({ cmd: "bots", n: 20 });
for (const b of document.querySelectorAll(".tiers button")) b.onclick = () => cmd({ cmd: "gift_test", team: b.dataset.team, tier: Number(b.dataset.tier) });
for (const [id, team] of [["#odd-d", "D"], ["#odd-a", "A"]])
  $(id).onclick = () => cmd({ cmd: "gift_test", team, tier: Math.max(1, Math.min(50000, Math.floor(Number($("#odd-coins").value) || 1))) });
$("#open-data").onclick = () => post("/api/open-data", {});
fetch("/api/ping").then((r) => r.json()).then((p) => { $("#version").textContent = `bản ${p.version}`; }).catch(() => {});
$("#wave-now").onclick = () => cmd({ cmd: "wave_now" });
$("#rage-a").onclick = () => cmd({ cmd: "rage_test", lead: "A" });
$("#rage-d").onclick = () => cmd({ cmd: "rage_test", lead: "D" });
$("#bots-like").onclick = () => cmd({ cmd: "bots_points" });
$("#demo-on").onclick = () => cmd({ cmd: "demo" });
$("#demo-rage").onclick = () => cmd({ cmd: "demo", rage: true, lead: "A" });
$("#demo-off").onclick = () => cmd({ cmd: "demo", off: true });
// a test viewer goes through the hub like a real one. A gift acts for the giver's team, so a test viewer with no
// team yet comments what is in the box first (as a real viewer would)
const commented = new Set();
const simComment = (user) => { commented.add(user); return cmd({ cmd: "sim", payload: { kind: "comment", user, text: $("#sim-text").value } }); };
const simUser = () => $("#sim-user").value || "Khách thử";
async function joinFirst(user) {
  if (commented.has(user) || !$("#sim-text").value.trim()) return;
  await simComment(user);
  await new Promise((r) => setTimeout(r, 600));
}
$("#sim-comment").onclick = () => simComment(simUser());
$("#sim-gift-btn").onclick = async () => {
  const user = simUser();
  await joinFirst(user);
  const [gift, diamonds] = $("#sim-gift").value.split("|");
  cmd({ cmd: "sim", payload: { kind: "gift", user, gift, diamonds: Number(diamonds), count: Number($("#sim-count").value) || 1 } });
};
for (const kind of ["share", "follow"]) $(`#sim-${kind}`).onclick = () => cmd({ cmd: "sim", payload: { kind, user: simUser() } });
$("#sim-like").onclick = async () => { const user = simUser(); await joinFirst(user); cmd({ cmd: "sim", payload: { kind: "like", user, count: 15 } }); };

// ---------- replay of a past live ----------
$("#replay-start").onclick = async () => {
  const f = $("#replay-file").files[0];
  if (!f) { $("#replay-info").textContent = "Chọn file log trước."; return; }
  const events = readLog(await f.text());
  if (!events.length) { $("#replay-info").textContent = "File này không có bình luận hay vật phẩm."; return; }
  if (replay) replay.stop = true;
  const me = (replay = { stop: false });
  const speed = Number($("#replay-speed").value) || 1;
  const t0 = events[0].t, start = performance.now();
  let i = 0;
  while (i < events.length && !me.stop) {
    const now = t0 + ((performance.now() - start) / 1000) * speed;
    const due = [];
    while (i < events.length && events[i].t <= now && due.length < 200) due.push(events[i++].ev);
    if (due.length) await cmd({ cmd: "events", list: due });
    const left = Math.round((events[events.length - 1].t - now) / speed);
    $("#replay-info").textContent = `${i}/${events.length} sự kiện · còn khoảng ${Math.max(0, Math.floor(left / 60))} phút`;
    await new Promise((r) => setTimeout(r, 250));
  }
  $("#replay-info").textContent = me.stop ? `Đã dừng ở ${i}/${events.length}` : `Xong ${events.length} sự kiện`;
};
$("#replay-stop").onclick = () => { if (replay) replay.stop = true; };

$("#open-hub").onclick = () => post("/api/open-hub", {});
// the VieNeu voice loads at start (some seconds; the first time it is downloaded): Edge speaks meanwhile
const VOICE_STATE = { off: "", loading: "Đang mở giọng VieNeu… (tạm đọc bằng Edge)", ready: "Giọng VieNeu sẵn sàng ✓",
  failed: "Giọng VieNeu lỗi, đang đọc bằng Edge" };
async function voiceState() {
  try {
    const v = await fetch("/api/voice-state").then((r) => r.json());
    const vn = String($("#voice").value).startsWith("vieneu:");
    $("#voice-state").textContent = vn ? (VOICE_STATE[v.state] || "") : "";
    $("#voice-state").title = v.error || "";
  } catch { /* the dev server has no voice */ }
}
setInterval(voiceState, 3000);
voiceState();
// TikTok LIVE Studio / OBS capture the window pixel for pixel: 1080 x 1920 real pixels is a sharp live picture
$("#fit-game").onclick = async () => {
  const out = $("#fit-state");
  try {
    const res = await post("/api/fit-game", {});
    if (!res.ok) throw new Error(String(res.status));
    const r = await res.json();
    out.textContent = r.width >= 1080 ? `Đã chỉnh: ${r.width}×${r.height} điểm ảnh` : `Màn hình chỉ đủ ${r.width}×${r.height} (nhỏ hơn 1080×1920)`;
  } catch { out.textContent = "Không chỉnh được (chỉ có trong ứng dụng)"; }
};

// ---------- the hub: its own page, shown inside this window (as in the map game) ----------
$("#go-hub").onclick = () => { wantTab = "proxy"; openTab("hub"); };      // the hub's page where the way to TikTok is chosen
/** Does the hub answer on its port? Its icon loads: nothing is read across origins. */
const hubAnswers = () => new Promise((res) => {
  const i = new Image();
  const done = (ok) => { clearTimeout(t); res(ok); };
  const t = setTimeout(() => { i.src = ""; res(false); }, 3000);     // it took the connection and never answered
  i.onload = () => done(true);
  i.onerror = () => done(false);
  i.src = `http://127.0.0.1:${hubPort}/favicon.ico?t=${Date.now()}`;
});
function showHub() {
  $("#hub-frame").hidden = !hubUp;
  $("#hub-none").hidden = hubUp !== false;
  if (hubUp && (!hubLoaded || wantTab)) {
    $("#hub-frame").src = `http://127.0.0.1:${hubPort}/?embed=1${wantTab ? `&p=${wantTab}` : ""}`;
    hubLoaded = true;
  }
  wantTab = "";
  fitHub();
}
/** The hub's page reaches the bottom of the window (it scrolls inside itself). */
function fitHub() {
  const f = $("#hub-frame");
  if (!f.hidden) f.style.height = `${Math.max(320, window.innerHeight - f.getBoundingClientRect().top - 12)}px`;
}
window.addEventListener("resize", fitHub);

// what the hub knows, asked over its own socket every few seconds: the channel's connection and the way to TikTok are
// shown on the first tab, under the box where the channel is typed
async function linkHub() {
  if (hubLink || !hubUp) return;
  if (!window.TikTokLiveHub) {
    await new Promise((res) => {
      const s = document.createElement("script");
      s.src = `http://127.0.0.1:${hubPort}/tiktok-live-hub.js?t=${Date.now()}`;
      s.onload = res;
      s.onerror = () => { s.remove(); res(); };
      document.head.append(s);
    });
  }
  if (!window.TikTokLiveHub || hubLink) return;
  hubLink = new window.TikTokLiveHub({ url: `ws://127.0.0.1:${hubPort}/ws`, channels: [], client: "Giữ thành · Điều khiển", resume: false });
  hubLink.on("hello", () => hubLink.status());
  hubLink.on("status", (s) => { hubInfo = s; renderConn(); });
  hubLink.on("close", () => { hubInfo = null; renderConn(); });
  hubLink.connect();
}
setInterval(() => { if (hubLink?.connected) hubLink.status(); }, 3000);

/** The card of the channel: its state, the way to TikTok, and the other channels the hub still watches. */
function renderConn() {
  const ch = cfg.channel || "";
  const c = channelNote(ch, !!hubUp, hubInfo, gameOpen), w = wayNote(!!hubUp, hubInfo);
  $("#ch-state").className = "chstate " + c.state;
  put("#ch-state", c.text);
  put("#px-state", w.text);
  const box = $("#ch-others"), others = otherChannels(ch, hubInfo);
  const key = JSON.stringify(others);
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.hidden = !others.length;
  // (names of channels come from the hub: put in as text, never as HTML)
  box.replaceChildren(others.length ? "Hub còn theo dõi:" : "", ...others.map((o) => {
    const chip = document.createElement("span");
    chip.className = "chip" + (o.used ? " used" : "");
    chip.append(`@${o.name}${o.used ? " (game khác đang dùng)" : ""}`);
    if (!o.used) {
      const b = document.createElement("button");
      b.textContent = "Bỏ";
      b.title = `Thôi theo dõi @${o.name}`;
      b.onclick = () => { hubLink?.unwatch(o.name); setTimeout(() => hubLink?.status(), 400); };
      chip.append(b);
    }
    return chip;
  }));
}
/** The hub's status, asked now. */
const hubStatusNow = () => new Promise((res) => {
  if (!hubLink?.connected) { res(null); return; }
  const on = (s) => { hubLink.off("status", on); res(s); };
  hubLink.on("status", on);
  hubLink.status();
  setTimeout(() => { hubLink?.off("status", on); res(null); }, 3000);
});
/** The channel was changed: the hub stops watching the old one, unless a game still listens to it (each watched
 *  channel is a connection to TikTok and requests to the sign server, for nothing). */
async function dropUnused(name) {
  await new Promise((r) => setTimeout(r, 2500));          // the game has left it by now
  const s = await hubStatusNow();
  if (!s || name === cfg.channel || channelUsed(name, s)) return;
  hubLink.unwatch(name);
  setTimeout(() => hubLink?.status(), 400);
}
let polling = false, misses = 0;
async function pollHub() {
  if (polling) return;
  polling = true;
  try { await pollHubNow(); } finally { polling = false; }
}
async function pollHubNow() {
  let h = { state: "", mode: "none" };
  try { h = await fetch("/api/hub").then((r) => r.json()); } catch { /* the app does not answer */ }
  if (h.port) hubPort = h.port;
  const was = hubUp;
  const ok = await hubAnswers();
  misses = ok ? 0 : misses + 1;
  if (!ok && was && misses < 2) return;          // one lost answer: its page (a form half typed) is not thrown away
  hubUp = ok;
  if (!hubUp) { hubLoaded = false; hubInfo = null; }      // it comes back: its page is loaded again
  if (hubUp !== was && document.body.classList.contains("hubtab")) showHub();
  if (hubUp) linkHub();
  if (hubUp !== was) renderConn();
  put("#hub-state2", hubUp ? `Phần kết nối TikTok đang chạy${h.mode === "external" ? " (dùng hub đang mở riêng)" : ""}`
    : `Phần kết nối TikTok chưa chạy${h.state && h.mode === "none" ? `: ${h.state}` : ""}`);
  if (h.state && h.mode === "none") put("#hub-none-why", `Lý do: ${h.state}. Đóng ứng dụng rồi mở lại; nếu vẫn vậy, xem file app.log (thẻ Trực tiếp, nút Mở thư mục nhật ký).`);
  $("#open-hub").disabled = h.mode === "none";
  $("#nav-hub").className = "dot " + (hubUp ? "ok" : "bad");
}
pollHub();
setInterval(pollHub, 5000);

async function poll() {
  try {
    const s = await fetch("/api/game-status").then((r) => r.json());
    if (gameOpen !== !!(s && s.match)) { gameOpen = !!(s && s.match); renderConn(); }
    if (!s || !s.match) { board("off"); put("#st-conn", "Cửa sổ game chưa mở"); put("#st-chan", ""); return; }
    paused = !!s.paused;
    put("#pause", paused ? "Tiếp tục trận" : "Tạm dừng trận");
    const left = Math.ceil(s.left / 1000);
    board(s.hub === "ok" ? "" : "warn");
    put("#st-conn", s.hub === "ok" ? "Đã nối TikTok Live Hub" : String(s.hub));
    put("#st-chan", s.channel ? `@${s.channel}${s.live === true ? " · đang live" : s.live === false ? " · chưa live" : ""}` : "Chưa chọn kênh");
    put("#st-d", `${s.d} người`);
    put("#st-a", `${s.a} người`);
    put("#st-wd", String(s.wins?.D ?? 0));
    put("#st-wa", String(s.wins?.A ?? 0));
    put("#st-match", `Trận ${s.match}/${s.of} · ${s.inSummary ? "đang tổng kết" : s.paused ? "tạm dừng" : `còn ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`}`);
    const hall = Math.max(0, Math.min(100, Number(s.hall) || 0));
    $("#st-hall").style.width = `${hall}%`;
    $("#st-hall").classList.toggle("low", hall <= 30);
    put("#st-hallp", `${hall}%`);
    put("#st-wave", `Đợt ${s.wave ?? 0} · đợt sau ${s.waveLeft ?? 0}s${s.waiting ? ` · ${s.waiting} người chờ` : ""}`);
    put("#st-say", s.speaking ? `Đang nói: ${s.speaking}` : "");
    $("#st-say").title = s.speaking || "";
  } catch {
    board("off"); put("#st-conn", "Không đọc được trạng thái");
  }
}
// (written only when it changed: a selection in the window is not lost every second)
function put(sel, text) { const el = $(sel); if (el.textContent !== text) el.textContent = text; }
function board(state) { const el = $("#board"), cls = state ? `board ${state}` : "board"; if (el.className !== cls) el.className = cls; }

load();
poll();
setInterval(poll, 1000);

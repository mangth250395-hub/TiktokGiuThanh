// What the control window says about the channel of the live, from what the hub reports (its "status" message): the
// channel and its connection in one place, beside the box where the channel is typed. (In the map game the channel
// was typed in the game and again in the hub's page, and nothing told which of the two the game listened to.)

import { isTestChannel } from "./game/channel.js";

/** The hub's word for a proxy that works is "chạy"; anything else is said as it is. */
const works = (p) => !p.error && p.state === "chạy";
const GONE = /UserNotFound|not capable of going LIVE|has never gone live|does not exist/i;

/** Proxies are turned off in the hub (its setting `use_proxy`): it connects straight from this computer.
 *  A hub from before that setting does not say: it always went through proxies. */
export const isDirect = (info) => info?.settings?.use_proxy === false;

/** The way to TikTok in a line: { state: "ok" | "wait" | "bad" | "", text, direct, running, total }. */
export function wayNote(hubUp, info) {
  const none = { direct: false, running: 0, total: 0 };
  if (!hubUp) return { ...none, state: "bad", text: "Phần kết nối TikTok chưa chạy" };
  if (!info) return { ...none, state: "", text: "Đang hỏi phần kết nối…" };
  if (isDirect(info)) {
    const d = info.direct || {};
    return { ...none, direct: true, state: d.error ? "bad" : "ok",
      text: d.error ? `Nối thẳng, không dùng proxy · ${d.state || d.error}` : "Nối thẳng, không dùng proxy" };
  }
  const all = info.proxies || [], run = all.filter(works);
  if (!all.length) return { ...none, state: "bad", text: "Đang bật dùng proxy nhưng chưa có proxy nào" };
  const rest = all.filter((p) => !works(p)).map((p) => `${p.name}: ${p.error || p.state}`);
  return { direct: false, state: run.length ? "ok" : "bad", running: run.length, total: all.length,
    text: [`Proxy: ${run.length}/${all.length} đang chạy`, ...rest].join(" · ") };
}

/** The channel of the game: { state, text }. `gameOpen`: the game window reports (it is the one that asks the hub). */
export function channelNote(ch, hubUp, info, gameOpen = true) {
  if (!ch) return { state: "bad", text: "Chưa nhập kênh." };
  if (isTestChannel(ch)) return { state: "", text: `@${ch} là kênh thử: không nối TikTok, chỉ nhận bình luận và vật phẩm giả ở thẻ Thử.` };
  if (!hubUp) return { state: "bad", text: "Phần kết nối TikTok chưa chạy: đóng ứng dụng rồi mở lại." };
  if (!info) return { state: "", text: "Đang hỏi phần kết nối…" };
  if (!isDirect(info) && !(info.proxies || []).length)
    return { state: "bad", text: "Đang bật dùng proxy nhưng chưa có proxy: vào thẻ Kết nối để thêm proxy, hoặc chọn Nối thẳng." };
  const c = (info.channels || []).find((x) => x.name === ch);
  if (!c) return { state: "wait", text: gameOpen ? `Đang bắt đầu theo dõi @${ch}…` : `Cửa sổ game chưa mở: mở game thì @${ch} mới được theo dõi.` };
  const links = c.links || [], up = links.filter((l) => l.up).map((l) => l.proxy);
  const lost = c.gap_open_s != null ? ` · đang mất kết nối ${Math.round(c.gap_open_s)} giây` : "";
  if (c.live) {
    const via = isDirect(info) ? "nối thẳng" : `nhận qua ${up.join(", ") || "…"}`;
    return { state: lost ? "wait" : "ok",
      text: `@${ch} đang live · ${via} · ${c.stats?.comments ?? 0} bình luận, ${c.stats?.coins ?? 0} xu${lost}` };
  }
  if (links.some((l) => GONE.test(`${l.last_reason || ""} ${l.state || ""}`))) {
    return { state: "bad", text: `TikTok không tìm thấy kênh @${ch}, hoặc kênh này chưa từng live: kiểm tra lại ID.` };
  }
  const why = links.map((l) => l.state).find(Boolean);
  return { state: "wait", text: `@${ch} chưa live${why ? ` (${why})` : ""}` };
}

/** Does a game listen to this channel? The hub's own pages listen to every channel (they show its events): they are
 *  not games, and a channel only they listen to may go. */
export function channelUsed(name, info) {
  // an older hub does not say who listens to what: not known means "used" (a channel is never closed on a guess)
  if (!Array.isArray(info?.clients) || info.clients.some((c) => !Array.isArray(c.subs))) return true;
  const own = new Set([`http://127.0.0.1:${info.port}`, `http://localhost:${info.port}`]);
  return info.clients.some((c) => !own.has(c.origin) && c.subs.includes(name));
}

/** Other channels the hub still watches: [{ name, used }] (used: a game listens to it, so it must stay). */
export function otherChannels(ch, info) {
  if (!info) return [];
  const names = new Set([...(info.watched || []), ...(info.channels || []).map((c) => c.name)]);
  names.delete(ch);
  return [...names].sort().map((name) => ({ name, used: channelUsed(name, info) }));
}

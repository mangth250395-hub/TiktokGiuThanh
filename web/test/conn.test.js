import { test } from "node:test";
import assert from "node:assert/strict";
import { channelNote, channelUsed, isDirect, otherChannels, wayNote } from "../src/conn.js";

const px = (name, state = "chạy", error = "") => ({ name, state, error });
const link = (proxy, up, state = "", last_reason = "") => ({ proxy, up, state, last_reason });
// a hub that goes through proxies (as every hub did before the setting `use_proxy`)
const info = (over = {}) => ({ proxies: [px("proxy1")], channels: [], watched: [], clients: [], settings: { use_proxy: true }, ...over });
// a hub with proxies turned off: straight from this computer
const straight = (over = {}) => info({ proxies: [], settings: { use_proxy: false }, direct: { name: "trực tiếp", state: "chạy", error: "" }, ...over });

test("an older hub does not say whether proxies are on: it always used them", () => {
  assert.equal(isDirect({ proxies: [] }), false);
  assert.equal(isDirect({ settings: {} }), false);
  assert.equal(isDirect(info()), false);
  assert.equal(isDirect(straight()), true);
  assert.equal(isDirect(null), false);
});

test("the way to TikTok in a line: proxies (none, some down, all running)", () => {
  assert.equal(wayNote(false, null).state, "bad");
  assert.equal(wayNote(true, null).state, "");
  assert.deepEqual([wayNote(true, info({ proxies: [] })).state, wayNote(true, info({ proxies: [] })).text],
    ["bad", "Đang bật dùng proxy nhưng chưa có proxy nào"]);
  const some = wayNote(true, info({ proxies: [px("proxy1"), px("proxy2", "chờ", "hết hạn")] }));
  assert.deepEqual([some.state, some.running, some.total, some.direct], ["ok", 1, 2, false]);
  assert.match(some.text, /1\/2 đang chạy · proxy2: hết hạn/);
  assert.equal(wayNote(true, info({ proxies: [px("proxy1", "đang đổi IP")] })).state, "bad");
});

test("the way to TikTok in a line: straight, with no proxy", () => {
  assert.deepEqual(wayNote(true, straight()), { direct: true, running: 0, total: 0, state: "ok", text: "Nối thẳng, không dùng proxy" });
  // proxies kept in the hub but turned off: they are not counted, and not called missing
  assert.equal(wayNote(true, straight({ proxies: [px("proxy1", "chưa kiểm tra")] })).text, "Nối thẳng, không dùng proxy");
  const down = wayNote(true, straight({ direct: { state: "mạng của máy chưa vào được TikTok: ConnectError", error: "ConnectError" } }));
  assert.equal(down.state, "bad");
  assert.match(down.text, /Nối thẳng.*chưa vào được TikTok/);
});

test("the channel: what is wrong is said first, in the order someone would fix it", () => {
  assert.equal(channelNote("", true, info()).text, "Chưa nhập kênh.");
  assert.match(channelNote("thu_nghiem", false, null).text, /kênh thử/);              // a test channel needs no hub
  assert.equal(channelNote("kenh", false, null).state, "bad");
  assert.match(channelNote("kenh", true, info({ proxies: [] })).text, /chưa có proxy/);
  assert.match(channelNote("kenh", true, info()).text, /Đang bắt đầu theo dõi @kenh/);
  assert.match(channelNote("kenh", true, info(), false).text, /Cửa sổ game chưa mở/);
  // straight: having no proxy is not something to fix
  assert.match(channelNote("kenh", true, straight()).text, /Đang bắt đầu theo dõi @kenh/);
});

test("the channel: live, not live yet, an ID TikTok does not know", () => {
  const live = info({ channels: [{ name: "kenh", live: true, links: [link("proxy1", true)], stats: { comments: 12, coins: 30 }, gap_open_s: null }] });
  assert.deepEqual(channelNote("kenh", true, live), { state: "ok", text: "@kenh đang live · nhận qua proxy1 · 12 bình luận, 30 xu" });
  const home = straight({ channels: [{ name: "kenh", live: true, links: [link("trực tiếp", true)], stats: { comments: 3, coins: 0 }, gap_open_s: null }] });
  assert.deepEqual(channelNote("kenh", true, home), { state: "ok", text: "@kenh đang live · nối thẳng · 3 bình luận, 0 xu" });
  const gap = info({ channels: [{ name: "kenh", live: true, links: [link("proxy1", false)], stats: {}, gap_open_s: 6.7 }] });
  assert.equal(channelNote("kenh", true, gap).state, "wait");
  assert.match(channelNote("kenh", true, gap).text, /đang mất kết nối 7 giây/);
  const off = info({ channels: [{ name: "kenh", live: false, links: [link("proxy1", false, "chờ live")], stats: {} }] });
  assert.deepEqual(channelNote("kenh", true, off), { state: "wait", text: "@kenh chưa live (chờ live)" });
  const typo = info({ channels: [{ name: "kenh.mau_20266", live: false, stats: {},
    links: [link("proxy1", false, "lỗi", "UserNotFoundError: The requested user is not capable of going LIVE on TikTok")] }] });
  assert.equal(channelNote("kenh.mau_20266", true, typo).state, "bad");
  assert.match(channelNote("kenh.mau_20266", true, typo).text, /không tìm thấy kênh/);
});

test("other channels the hub still watches, and whether a game listens to them", () => {
  const i = info({ watched: ["kenh", "cu"], channels: [{ name: "kenh" }, { name: "khac" }], clients: [{ name: "Bản đồ", subs: ["khac"] }] });
  assert.deepEqual(otherChannels("kenh", i), [{ name: "cu", used: false }, { name: "khac", used: true }]);
  assert.deepEqual(otherChannels("kenh", null), []);
});

test("the hub's own page listens to every channel: that does not keep a channel", () => {
  const i = info({ port: 8765, channels: [{ name: "cu" }], clients: [{ name: "hub", origin: "http://127.0.0.1:8765", subs: ["cu"] }] });
  assert.equal(channelUsed("cu", i), false);
  i.clients.push({ name: "Giữ thành", origin: "http://127.0.0.1:8767", subs: ["cu"] });
  assert.equal(channelUsed("cu", i), true);
  // an older hub that does not say who listens: never taken as "nobody"
  assert.equal(channelUsed("cu", { port: 8765 }), true);
  assert.equal(channelUsed("cu", { port: 8765, clients: [{ name: "game" }] }), true);
});

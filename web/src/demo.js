// A crowded live played by the game itself, to LOOK at the screen as it is with many people (the user, 11/11/2026:
// "giả lập trận đánh mạnh, tung hết hiệu ứng bong bóng và trận nộ"): sixty viewers with the kinds of names seen on
// TikTok (two letters, very long, with signs, account names) come in, then keep doing what viewers do: hearts all
// the time, shares, follows, comments, items of every value, answers to the questions (some right, some wrong).
// Everything goes through the same door as what the hub sends (onEvent), so the screen, the voice and the rules
// behave exactly as in a live. Nothing here is used in a real live; "Phiên mới" wipes it.

// (made-up names only: no well-known person's name, this file is public)
export const DEMO_NAMES = [
  "Nguyễn Hoàng Minh Anh", "🌸 Bé Thỏ Con 🌸", "Trần Thị Thu Hà Official", "Anh Ba Sài Gòn 1990", "Mẹ Bỉm Sữa Bán Hàng Online",
  "Hùng Râu Kẽm", "user8273645190", "Long", "Tí", "Shop Quần Áo Giá Sỉ Hà Nội", "Cô Giáo Thảo Vy", "Phúc Mập ✨", "kkk_2k5",
  "Chị Bảy Miền Tây", "PHẠM QUỐC KHÁNH", "Lê Văn Tèo", "Bố Của Bin", "Tiểu Long Nữ", "Mr. Vịt", "Hội Mê Bún Đậu",
  "Thánh Ăn Vặt Đà Nẵng", "Bảo", "Gia Hân 2k8", "Ông Nội Chơi Game", "Bé Ka", "Vy Vy 🍀", "Chú Tư Bolero", "Người Lạ Ơi",
  "Ngân Trần 97", "Tèo Biệt Thự", "Hoàng Tử Ngủ Trưa", "Út Cưng", "Mèo Sói", "Trùm Cuối", "Em Gái Xinh Đẹp Dễ Thương", "Thầy Giáo Ba",
  "Quỳnh Kẹo", "Hải Yến Bùi", "Hội Nghe Nhạc Khuya", "An", "Dì Tư Bán Bún", "Phúc Xí Muội", "Bé Na", "Vy Lê Nguyễn Ngọc", "anh_trai_mua",
  "Thảo Nhi Lê", "Cường Bánh Mì", "Phương Thúy Mai", "Tèo Em", "Bà Ngoại Vlog", "Chú Bảy Xe Ôm", "Hội Mê Game Đêm", "Linh Hà", "Su Su",
  "Hải Sút Xa 19", "Ngọc Lan", "Thiên An", "Bống", "Ngọc Hà Trương Thị", "Zin",
];
// people who only press the heart and never choose a team (most of a real live)
const LOOKERS = ["Khách qua đường", "Minh", "bé_mèo_2010", "Hoa Hồng Đen", "Tuấn", "Chị Hai", "người_xem_01", "Ngân", "Bin Bin", "Cô Ba"];
const CHAT = ["hay quá", "cố lên", "đánh đi", "giữ cổng", "vui ghê", "xin chào", "lên nào", "😂😂", "tiến lên", "ai thắng đây"];
const WRONG = ["con mèo", "không biết", "hà nội", "số 7", "cái bàn"];
// what an item is worth, by how often: mostly small ones, now and then a big one, sometimes an odd value
const GIFTS = [[1, 38], [5, 20], [10, 13], [20, 10], [30, 9], [99, 5], [50, 2], [65, 1], [3, 2]];

/** A drawn face (a person on a coloured ground) for a viewer: no real picture of anyone is used. */
export function demoFace(i) {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d"), h = (i * 47) % 360;
  const g = x.createLinearGradient(0, 0, 64, 64);
  g.addColorStop(0, `hsl(${h},70%,62%)`); g.addColorStop(1, `hsl(${(h + 70) % 360},70%,38%)`);
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  x.fillStyle = `hsl(${(h + 30) % 360},45%,82%)`;
  x.beginPath(); x.arc(32, 26, 13, 0, 7); x.fill();
  x.beginPath(); x.ellipse(32, 62, 22, 20, 0, 0, 7); x.fill();
  x.fillStyle = `hsl(${(h + 200) % 360},40%,22%)`;
  x.beginPath(); x.arc(32, 20, 13, 3.3, 6.1); x.fill();
  return c.toDataURL("image/png");
}

export class Demo {
  /** onEvent(ev): the door of the hub's events; quiz(): the question that is open (or null). */
  constructor({ onEvent, quiz }) {
    this.onEvent = onEvent; this.quiz = quiz;
    this.timer = 0; this.people = []; this.lookers = []; this.joined = 0; this.n = 0;
  }
  get on() { return !!this.timer; }
  /** pace: 1 a busy live, 2 a very busy one. */
  start({ pace = 1 } = {}) {
    this.stop();
    const tag = Date.now().toString(36);     // new people each time (a second run does not reuse the first one's characters)
    this.people = DEMO_NAMES.map((nickname, i) => ({ id: `demo-${tag}-${i}`, unique_id: `demo_${tag}_${i}`, nickname, avatar_hub: i % 4 === 3 ? "" : demoFace(i) }));
    this.lookers = LOOKERS.map((nickname, i) => ({ id: `look-${tag}-${i}`, unique_id: `look_${tag}_${i}`, nickname, avatar_hub: i % 3 ? demoFace(100 + i) : "" }));
    this.joined = 0; this.n = 0; this.pace = Math.max(0.5, Math.min(3, pace));
    this.timer = setInterval(() => { try { this.tick(); } catch { /* a demo never stops the game */ } }, 200);
  }
  stop() { clearInterval(this.timer); this.timer = 0; }
  pick(list = this.people.slice(0, Math.max(1, this.joined))) { return list[Math.floor(Math.random() * list.length)]; }
  tick() {
    const P = this.pace, n = this.n++, r = () => Math.random();
    // they come in over the first seconds, one team then the other
    for (let k = 0; k < 5 && this.joined < this.people.length; k++) {
      const u = this.people[this.joined];
      this.onEvent({ type: "comment", user: u, text: this.joined % 2 ? "đánh" : "thủ" });
      this.joined++;
    }
    if (this.joined < 12) return;
    // hearts: all the time, from those who play and from those who only watch
    const hearts = 1 + Math.floor(r() * 2.4 * P);
    for (let k = 0; k < hearts; k++) this.onEvent({ type: "like", user: r() < 0.2 ? this.pick(this.lookers) : this.pick(), count: 5 + Math.floor(r() * 21) });
    if (r() < 0.09 * P) this.onEvent({ type: "share", user: r() < 0.2 ? this.pick(this.lookers) : this.pick() });
    if (r() < 0.045 * P) this.onEvent({ type: "follow", user: r() < 0.2 ? this.pick(this.lookers) : this.pick() });
    if (r() < 0.1) this.onEvent({ type: "comment", user: this.pick(), text: this.pick(CHAT) });     // (and it brings a resting Dân back)
    // items: one every two seconds or so, sometimes several of the same at once
    if (r() < 0.1 * P) {
      let roll = r() * 100, each = 1;
      for (const [v, w] of GIFTS) { if (roll < w) { each = v; break; } roll -= w; }
      const count = r() < 0.85 ? 1 : 2 + Math.floor(r() * 4), user = this.pick();
      const ev = { user, gift: { name: "Rose", diamonds: each }, count, coins: each * count };
      this.onEvent({ type: "gift", ...ev }); this.onEvent({ type: "gift_done", ...ev });
    }
    // the question that is open: some find it, some do not
    const q = this.quiz();
    if (q && !q.reveal && r() < 0.22 * P) this.onEvent({ type: "comment", user: this.pick(), text: r() < 0.6 ? q.shown : this.pick(WRONG) });
    if (n > 5 * 60 * 12) this.stop();     // twelve minutes: it does not run for ever if forgotten
  }
}

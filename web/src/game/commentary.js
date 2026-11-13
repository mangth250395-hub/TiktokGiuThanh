// The commentator: what to say, and how urgent it is. No voice here (speech.js says the lines), no screen.
//
// Rules kept from the map game (decided with the user):
//   - NEVER ask for gifts, likes, shares or follows, and never say "xu" or "quà" (TikTok flags begging): a giver is
//     thanked by name, with the count and the name of the item, and with what their character became
//   - thank-yous come first; a gift that stands out (3 x the usual of the last minute, or 30+) gets its own line at
//     once, the others are gathered (quiet: after ~1 s, busy: 4 s); nobody is named again and again
//   - then the turns of the match (a gate down, mended, the castle at half, a leader fallen), the countdown, the
//     quiz, greetings (gathered when busy), follows and shares
//   - when it is quiet: how to play, where the match stands, a joke
// The tone the user asked for (10/11/2026): a sports commentator who is thrilled and funny, short sentences; then
// "phong phú câu từ hơn và hài hước hơn": every kind of line has several wordings and never the same one twice in a
// row (_pick), and the quiet moments take turns between a tip, where the match stands, and a joke.
import { TEAMS, TIERS, AWARDS, other } from "./rules.js";

const WHY = { quiz: "trả lời đúng", comment: "vừa nhập cuộc" };
import { FACE_NAMES } from "./battle.js";
import { speakName, giftName, count } from "./speakable.js";

export const PRI = { BIG: 80, THANKS: 66, TURN: 62, COUNT: 60, HERO: 58, KILL: 52, ASK: 50, LEVEL: 46, QUIZ: 45, WAVE: 34, JOIN: 30, SOCIAL: 28, TIP: 10 };
const QUIET_PER_MIN = 8;
const pct = (r) => Math.max(0, Math.round(r * 100));
const QUIZ_KIND = { vui: "Đố vui", biet: "Đố hiểu biết", meo: "Đố mẹo" };

// an item adds one more character for the giver: what is said, by rank (n: their name, T: their team, O: the other team)
const BECOME = [
  null,
  (n, T) => [
    `Thêm một Lính kiếm của ${n} xông ra cho ${T}!`,
    `${n} đưa thêm một Lính kiếm ra trận! Kiếm mới mài, bén lắm đấy!`,
    `Lính kiếm của ${n} nhập trận! Nhỏ mà có võ nha!`,
    `${T} có thêm một tay kiếm của ${n}! Vừa ra sân đã múa vèo vèo!`,
  ],
  (n, T, O) => [
    `Lính giáo của ${n} vào trận, đứng chắn cho ${T} như một bức tường!`,
    `Thêm một Lính giáo của ${n}! Muốn qua thì bước qua mũi giáo đã!`,
    `Lính giáo của ${n} ra đứng chắn! Trâu thế này thì ${O} đánh tới sáng mai!`,
    `${n} dựng thêm một bức tường biết đi cho ${T}!`,
  ],
  (n, T, O) => [
    `Cung thủ của ${n} đã lên dây cho ${T}! Bên kia coi chừng mưa tên!`,
    `${n} có thêm một Cung thủ! Từ xa cũng không yên đâu!`,
    `Cung thủ của ${n} vào vị trí! ${O} ơi, hôm nay trời có mưa, mà là mưa tên!`,
    `Thêm một Cung thủ của ${n}! Đứng xa mà bắn, khỏi lo bẩn áo!`,
  ],
  (n, T) => [
    `Thầy thuốc của ${n} ra trận! ${T} cứ yên tâm mà đánh!`,
    `${n} đưa thêm một Thầy thuốc! Đau đâu chữa đó, khỏi cần xếp hàng!`,
    `Thầy thuốc của ${n} đã tới! ${T} ngã chỗ nào, đứng dậy chỗ đó!`,
    `${T} có thêm Thầy thuốc của ${n}! Phòng khám lưu động mở cửa rồi!`,
  ],
  (n, T, O) => [
    `Đội trưởng của ${n} ra trận! Quân ${T} quanh đó mạnh hẳn lên!`,
    `${T} có thêm Đội trưởng của ${n}! Đứng gần là thấy khoẻ ra liền!`,
    `Đội trưởng của ${n} hô một tiếng, cả ${T} răm rắp xông lên!`,
    `Sếp tới rồi! Đội trưởng của ${n} ra trận, ${O} bắt đầu thấy lo!`,
  ],
  (n, T, O) => [
    `Tướng của ${n} xuất trận! ${T} có chủ tướng rồi, ${O} run chưa?`,
    `Trời ơi, Tướng của ${n} đã tới! Cả mặt trận của ${T} bừng bừng khí thế!`,
    `Tướng của ${n} giáng trần! ${O} ơi, giờ chạy còn kịp đấy!`,
    `Đất rung lên rồi! Tướng của ${n} bước ra, ${T} như hổ mọc thêm cánh!`,
  ],
];
// several of the same rank at once (c: how many, in words; R: the name of the rank)
const MANY = (c, R, n, T, O) => [
  `${n} đưa một lúc ${c} ${R} ra trận! ${T} đông vui hẳn lên!`,
  `Một lúc ${c} ${R} của ${n} kéo ra! ${O} đếm không kịp!`,
  `Cả một đội ${R} của ${n} ra sân, ${c} người liền! ${O} coi chừng!`,
];
const HEALED = (n) => [`Quân của ${n} được hồi đầy sức!`, `${n} tiếp sức, quân lại khoẻ như mới!`, `Quân của ${n} khoẻ lại rồi, đánh tiếp hiệp nữa!`];

export class Commentator {
  constructor(game, battle, { now = () => Date.now(), rand = Math.random } = {}) {
    this.game = game;
    this.battle = battle;
    this.now = now;
    this.rand = rand;
    this.quizOn = true;
    this.events = [];            // times of what happened lately (to know whether the live is quiet)
    this.giftSizes = [];         // [{ at, coins }] of the last minute
    this.giftAt = 0;             // when the last gift ended
    this.gifts = 0;              // how many since the start
    this.record = 0;             // the biggest one since the start
    this.thanks = [];            // gathered small gifts: { key, name, team, count, gift, coins, tier, at }
    this.thanksAt = 0;
    this.joins = [];             // gathered newcomers: { name, team, auto, moved, at }
    this.joinsAt = 0;
    this.social = { follow: [], share: [], at: 0 };
    this.named = new Map();      // viewer key -> when their name was last said
    this.last = {};              // kind of line -> when last said
    this.said = {};              // kind of line -> which wording was used last (a fixed set of kinds: it never grows)
    this.fed = { D: { hp: 0, names: [] }, A: { hp: 0, names: [] }, at: 0 };     // the match of fury: who gave their giant strength lately
    this.fill = 0;
    this.turn = { tip: 0, state: 0, joke: Math.floor(rand() * 97) };
  }

  name(e) { return speakName(e.name, e.uid) || "một bạn"; }
  /** One wording of a kind of line, never the one used last time for that kind. */
  _pick(kind, list) {
    let i = Math.floor(this.rand() * list.length) % list.length;
    if (list.length > 1 && this.said[kind] === i) i = (i + 1) % list.length;
    this.said[kind] = i;
    return list[i];
  }
  _mark(n = 1) { const t = this.now(); for (let i = 0; i < n; i++) this.events.push(t); }
  quiet() {
    const t = this.now();
    this.events = this.events.filter((x) => t - x < 60_000);
    return this.events.length < QUIET_PER_MIN;
  }
  _gap(kind, ms) {
    const t = this.now();
    if (t - (this.last[kind] || 0) < ms) return false;
    this.last[kind] = t;
    return true;
  }
  _usual() {
    const t = this.now();
    this.giftSizes = this.giftSizes.filter((g) => t - g.at < 60_000);
    const s = this.giftSizes.map((g) => g.coins).sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : 1;
  }

  // ---------- what the rules report ----------
  onEffects(effects) {
    const out = [], t = this.now();
    for (const e of effects) {
      switch (e.type) {
        case "join": this._mark(); this.joins.push({ key: e.key, name: this.name(e), team: e.team, auto: e.auto, at: t }); break;
        case "switched": this._mark(); this.joins.push({ key: e.key, name: this.name(e), team: e.team, moved: true, at: t }); break;
        case "back": this._mark(); this.joins.push({ key: e.key, name: this.name(e), team: e.team, back: true, at: t }); break;
        case "thanks": out.push(...this._thanks(e)); break;
        case "promote":
          this._mark();
          if (e.free && this._gap("promote-free", this.quiet() ? 4000 : 12_000)) {
            const n = this.name(e), R = TIERS[e.tier].name, why = WHY[e.why] || "đủ điểm";
            out.push({ text: this._pick("promote", [
              `${n} ${why}, lên ${R}!`,
              `Lên bậc! ${n} ${why}, giờ là ${R}!`,
              `${n} ${why}, từ ${TIERS[e.from].name} lên ${R}!`,
              `Có học có khác! ${n} ${why}, thăng lên ${R}!`,
              `Cái đầu cũng là vũ khí! ${n} ${why}, lên ${R}!`,
            ]), pri: PRI.LEVEL, ttl: 10_000, cam: `u:${e.key}`, key: e.key });
          }
          break;
        case "demoted": {
          const n = this.name(e), R = TIERS[e.from].name;
          if (e.from >= 5) out.push({ text: this._pick("demoted-big", [
            `${R} của ${n} ngã rồi! Đợt sau sẽ quay lại làm Dân.`,
            `${n} mất một ${R}, quân ấy về làm Dân!`,
            `${R} của ${n} gục xuống! Từ đỉnh cao về lại làm Dân, đau thật!`,
          ]), pri: PRI.HERO - 2, ttl: 10_000, key: e.key });
          else if (this.quiet() && this._gap("demoted", 12_000))
            out.push({ text: this._pick("demoted", [
              `${R} của ${n} ngã, về làm Dân. Trả lời đúng câu đố là lên bậc lại!`,
              `${R} của ${n} ngã, quay lại làm Dân!`,
              `${R} của ${n} ngã rồi, đợt sau quay lại làm Dân. Cây cuốc đã chờ sẵn!`,
              `${R} của ${n} nằm xuống, tỉnh dậy đã thành Dân. Đời mà!`,
            ]), pri: PRI.JOIN, ttl: 8000, key: e.key });
          break;
        }
        case "locked":
          if (this._gap("locked", 45_000)) out.push({ text: e.once
            ? this._pick("locked", [`${this.name(e)} ơi, mỗi trận chỉ đổi phe một lần thôi nhé!`, `${this.name(e)} ơi, mỗi trận đổi áo một lần thôi, đổi nữa chóng mặt lắm!`])
            : `${this.name(e)} đang ở ${TEAMS[e.team].name}. Muốn sang phe kia thì gõ đổi nhé.`, pri: PRI.JOIN, ttl: 10_000 });
          break;
        case "switch_planned":
          if (this._gap("switch", 15_000)) out.push({ text: this._pick("switch", [
            `${this.name(e)} sẽ sang ${TEAMS[e.to].name} ở đợt quân sau. Đổi áo nhanh như chớp!`,
            `${this.name(e)} xin sang ${TEAMS[e.to].name}, đợt sau là đổi phe!`,
            `${this.name(e)} chuẩn bị sang ${TEAMS[e.to].name}. Bên này giữ người không nổi rồi!`,
          ]), pri: PRI.JOIN, ttl: 10_000 });
          break;
        case "heal":
          if (e.part && e.why !== "gift" && this._gap("heal-quiz", this.quiet() ? 6000 : 20_000))
            out.push({ text: this._pick("heal", [
              `${this.name(e)} trả lời đúng, ${TIERS[e.tier].name} hồi sức, khoẻ lại ngay!`,
              `Đúng rồi! ${TIERS[e.tier].name} ${this.name(e)} được hồi sức!`,
              `${this.name(e)} đáp trúng phóc, ${TIERS[e.tier].name} hồi sức căng tràn!`,
            ]), pri: PRI.LEVEL - 4, ttl: 8000, key: e.key });
          break;
        case "feed": {       // the match of fury: strength for the giant of their team
          const f = this.fed[e.team];
          if (!f) break;
          f.hp += e.hp || 0;
          const n = this.name(e);
          if (f.names.length < 12 && !f.names.includes(n) && n !== "một bạn") f.names.push(n);
          break;
        }
        case "recruit":
          this._mark();
          if (this._gap("recruit", this.quiet() ? 4000 : 12_000)) out.push({ text: this._pick("recruit", [
            `${this.name(e)} trả lời đúng, có thêm một Dân ra trận!`,
            `${this.name(e)} đáp trúng, nhà thêm một Dân!`,
            `Đúng rồi! ${this.name(e)} được thêm một Dân nữa!`,
          ]), pri: PRI.LEVEL, ttl: 9000, key: e.key });
          break;
        case "followed": this._mark(); this.social.follow.push(this.name(e)); break;
        case "shared": this._mark(); this.social.share.push(this.name(e)); break;
        case "quiz_right": this._mark(); break;
        case "countdown": out.push(this._countdown(e.seconds)); break;
        default:
      }
    }
    return out.filter(Boolean);
  }

  /** What one gift (or combo) gave its giver, in a sentence. g: { name, team, rank, added, same }. */
  _became(g) {
    const n = g.name, T = TEAMS[g.team]?.name || "đội mình", O = g.team ? TEAMS[other(g.team)].name : "bên kia";
    if (g.added === 0) return this._pick("healed", HEALED(n));
    if (!BECOME[g.rank]) return `${n} có thêm quân!`;
    if (g.same > 1) return this._pick("many", MANY(count(g.same), TIERS[g.rank].name, n, T, O));
    return this._pick(`become${g.rank}`, BECOME[g.rank](n, T, O));
  }

  /**
   * A gift or a combo is over. How loud the thanks are depends on how it compares with what has been coming (the
   * user, 10/11/2026: "bất ngờ cảm thán với quà to hơn mặt bằng chung, tối ưu khi đông người tặng hoặc ít người tặng"):
   *   3  astonished: the biggest since the start, or ten times the usual of the last minute
   *   2  surprised: three times the usual, or a leader's item while such items are rare
   *   0  the others are gathered and thanked together, so a busy minute never floods the voice
   * With nothing in the last minute there is no "usual": the value alone decides, and the first one after a long
   * silence opens with a word of its own. When everyone sends big ones, a big one no longer stands out: gathered.
   */
  _thanks(e) {
    const t = this.now(), coins = e.coins || 0;
    const usual = this._usual(), recent = this.giftSizes.length;                    // before this one
    const silent = t - (this.giftAt || 0) > 120_000;
    const record = this.gifts >= 3 && coins > this.record && coins >= 10;
    const alike = this.giftSizes.filter((g) => g.coins >= coins * 0.8).length;      // as big as this one, lately
    const ratio = coins / Math.max(1, usual);
    this.giftSizes.push({ at: t, coins });
    this.giftAt = t; this.gifts++; this.record = Math.max(this.record, coins);
    this._mark(2);
    const leader = coins >= 30 || e.rank >= 5;
    const level = !recent ? (coins >= 99 ? 3 : leader ? 2 : 0)
      : record || (ratio >= 10 && coins >= 20) ? 3
        : (ratio >= 3 && coins >= 5) || (leader && alike < 2) ? 2 : 0;
    if (!level) {
      this.thanks.push({ key: e.key, name: this.name(e), team: e.team, count: e.count, gift: e.gift, coins, tier: e.tier, rank: e.rank, added: e.added, same: e.same, first: silent, at: t });
      if (!this.thanksAt) this.thanksAt = t;
      return [];
    }
    this.named.set(e.key, t);
    const n = this.name(e), what = `${e.count > 1 ? e.count + " " : ""}${giftName(e.gift)}`;
    const became = this._became({ name: n, team: e.team, rank: e.rank, added: e.added, same: e.same });
    const open = record ? this._pick("open-record", [
      `Ối trời ơi! ${n} gửi ${what}! Lớn nhất từ đầu buổi tới giờ!`,
      `Kỷ lục mới! ${n} với ${what}, chưa ai chơi lớn thế này!`,
      `Tôi có nhìn nhầm không? ${n} gửi ${what}! Phá kỷ lục của buổi nay rồi!`,
    ]) : level === 3 && recent ? this._pick("open-x10", [
      `Cái gì thế này! ${n} gửi ${what}! Gấp cả chục lần mặt bằng nãy giờ!`,
      `Khoan khoan! ${n} vừa gửi ${what}! Cả phòng đứng hình!`,
      `Trời đất ơi! ${n} với ${what}! Lớn vượt hẳn nãy giờ!`,
    ]) : level === 3 ? this._pick("open6", [
      `Trời ơi! Cảm ơn ${n} với ${what}!`,
      `Chấn động! ${n} vừa gửi ${what}!`,
      `Cả sân đứng hình! ${n} gửi ${what}!`,
      `Quá đỉnh! Cảm ơn ${n} với ${what}!`,
    ]) : ratio >= 3 && recent >= 2 ? this._pick("open-above", [
      `Ôi chà! ${n} gửi ${what}! To hơn hẳn mặt bằng nãy giờ!`,
      `Ồ! ${n} chơi lớn với ${what}! Nổi bật hẳn lên!`,
      `Bất ngờ chưa! ${n} gửi ${what}, vượt hẳn nãy giờ!`,
    ]) : this._pick("open5", [
      `Ôi! Cảm ơn ${n} với ${what}!`,
      `Hay quá! ${n} gửi ${what}!`,
      `Tuyệt vời! Cảm ơn ${n} với ${what}!`,
      `Ồ, bất ngờ quá! Cảm ơn ${n} với ${what}!`,
    ]);
    return [{ text: `${open} ${became}`, pri: level === 3 || e.rank >= 5 ? PRI.BIG : PRI.THANKS + 1, ttl: 25_000, key: e.key, cam: e.team ? `u:${e.key}` : null }];
  }
  /** first: nothing had come for a long while. */
  _open(n, what, first = false) {
    if (first) return this._pick("open-first", [`Mở hàng rồi! Cảm ơn ${n} với ${what}!`, `Ồ, bất ngờ chưa! Cảm ơn ${n} với ${what}!`, `Ấm lòng quá! Cảm ơn ${n} với ${what}!`]);
    return this._pick("open", [`Cảm ơn ${n} với ${what}!`, `${n} gửi ${what}, cảm ơn nhé!`, `Cảm ơn ${n} nhé, ${what} đã tới nơi!`, `${what} từ ${n}, cảm ơn nhiều!`]);
  }

  /** Called a few times a second: what was gathered and is now due. */
  flush() {
    const out = [], t = this.now(), quiet = this.quiet();
    // a long live: what is only kept to avoid saying a name twice is forgotten after a while
    if (t - (this.cleanAt || 0) > 60_000) {
      this.cleanAt = t;
      for (const [key, at] of this.named) if (t - at > 300_000) this.named.delete(key);
      for (const k of Object.keys(this.last)) if (t - this.last[k] > 600_000) delete this.last[k];
      if (this.social.follow.length > 200) this.social.follow.length = 200;
      if (this.social.share.length > 200) this.social.share.length = 200;
    }
    // small gifts
    if (this.thanks.length && t - this.thanksAt >= (quiet ? 1200 : 4000)) {
      const by = new Map();
      for (const g of this.thanks) {
        const x = by.get(g.key) || { ...g, count: 0, coins: 0, added: 0, rank: 0, same: 0 };
        x.count += g.count; x.coins += g.coins; x.gift = g.gift; x.tier = g.tier; x.added += g.added ?? 1; x.first ||= g.first;
        const r = g.rank || 0, s = g.same || 1;
        if (r > x.rank) { x.rank = r; x.same = s; } else if (r === x.rank) x.same += s;
        by.set(g.key, x);
      }
      this.thanks = []; this.thanksAt = 0;
      let list = [...by.values()].sort((a, b) => b.coins - a.coins);
      const fresh = list.filter((g) => t - (this.named.get(g.key) || 0) > (quiet ? 8000 : 25_000));
      const skipped = list.length - fresh.length;
      list = fresh;
      if (list.length === 1) {
        const g = list[0];
        this.named.set(g.key, t);
        const what = `${g.count > 1 ? g.count + " " : ""}${giftName(g.gift)}`;
        out.push({ text: `${this._open(g.name, what, g.first)} ${this._became(g)}`.trim(), pri: PRI.THANKS, ttl: 15_000, key: g.key, cam: `u:${g.key}` });
      } else if (list.length > 1) {
        const names = list.slice(0, 3).map((g) => g.name);
        for (const g of list.slice(0, 3)) this.named.set(g.key, t);
        const more = list.length - names.length + skipped;
        const who = names.length === 2 ? `${names[0]} và ${names[1]}` : `${names[0]}, ${names[1]} và ${names[2]}`;
        const tail = this._pick("thanks-many", [`Hai phe vừa có thêm quân!`, `Quân mới đang kéo ra sân!`, `Trận địa lại chật thêm rồi!`, `Thêm người thêm vui, thêm quân thêm loạn!`]);
        const rush = list.length + skipped >= 4 ? this._pick("rush", [`Dồn dập quá! `, `Liên tục, liên tục! `, `Không kịp thở luôn! `]) : "";    // many at once
        out.push({ text: `${rush}Cảm ơn ${who}${more > 0 ? ` cùng ${count(more)} bạn khác` : ""}! ${tail}`, pri: PRI.THANKS, ttl: 15_000 });
      }
    }
    // newcomers: one by one when it is quiet, together when busy
    if (this.joins.length && t - this.joinsAt >= (quiet ? 600 : 8000)) {
      this.joinsAt = t;
      const list = this.joins;
      this.joins = [];
      if (list.length === 1 || (quiet && list.length <= 2)) {
        for (const j of list) {
          const T = TEAMS[j.team].name;
          const text = j.back ? this._pick("back", [
            `${j.name} quay lại ${T} rồi!`,
            `${j.name} đã trở lại, ${T} thêm người!`,
            `Dân ${j.name} vác cuốc ra trận lần nữa!`,
          ]) : j.moved ? this._pick("moved", [
            `${j.name} đã sang ${T}!`,
            `${j.name} đổi áo, giờ đánh cho ${T}!`,
            `${j.name} quay xe sang ${T}! Bạn cũ giờ thành đối thủ!`,
          ]) : j.auto ? this._pick("join-auto", [
            `Chào ${j.name}! Bạn được xếp vào ${T}, đợt sau là ra trận!`,
            `${j.name} nhập cuộc bên ${T}! Muốn sang phe kia thì gõ đổi.`,
            `${T} đón ${j.name}! Đứng chờ đợt quân sau nhé!`,
            `${j.name} vừa tới, game xếp vào ${T}. Áo mới mặc có vừa không bạn?`,
            `Có lính mới! ${j.name} về với ${T}, đợt sau ra sân!`,
          ]) : this._pick("join", [
            `Chào ${j.name} vào ${T}!`,
            `${j.name} chọn ${T}, đợt sau là xung trận!`,
            `${T} có thêm ${j.name}!`,
            `${j.name} đã chọn ${T}! Chọn rồi là chơi tới cùng nha!`,
            `${T} mở cửa đón ${j.name}! Vào xếp hàng chờ đợt quân sau!`,
          ]);
          out.push({ text, pri: PRI.JOIN, ttl: 9000, cam: `u:${j.key}`, key: j.key });
        }
      } else {
        const d = list.filter((j) => j.team === "D").length, a = list.length - d;
        const parts = [];
        if (d) parts.push(`${count(d)} người vào ${TEAMS.D.name}`);
        if (a) parts.push(`${count(a)} người vào ${TEAMS.A.name}`);
        const p = parts.join(", ");
        out.push({ text: this._pick("join-many", [`Thêm ${p}!`, `Đông vui quá! Thêm ${p}!`, `Người đâu ra mà lắm thế! Thêm ${p}!`, `Sân sắp chật rồi! Thêm ${p}!`]), pri: PRI.JOIN, ttl: 9000 });
      }
    }
    // the match of fury: who is carrying their giant, every few seconds (said by name: that is what keeps them at it)
    if (this.battle.rage && t - this.fed.at >= 7000 && (this.fed.D.hp > 0 || this.fed.A.hp > 0)) {
      this.fed.at = t;
      const D = TEAMS.D.name, A = TEAMS.A.name, d = this.fed.D, a = this.fed.A;
      const who = (f) => { const n = f.names.filter((x) => x).slice(0, 2); return n.length === 2 ? `${n[0]} và ${n[1]}` : n[0] || ""; };
      const wd = who(d), wa = who(a);
      let text;
      if (d.hp > 0 && a.hp > 0 && Math.max(d.hp, a.hp) < Math.min(d.hp, a.hp) * 1.6) text = this._pick("fed-both", [
        `Hai bên thi nhau tiếp sức! ${wd || D} bên ${D}, ${wa || A} bên ${A}, không ai chịu kém!`,
        `Sức dồn về cả hai người khổng lồ! ${D} và ${A} giằng co từng chút một!`,
        `${wd ? wd + " tiếp sức cho " + D : D + " được tiếp sức"}, ${wa ? wa + " đáp lại cho " + A : A + " đáp lại ngay"}! Căng quá!`,
      ]);
      else {
        const T = d.hp >= a.hp ? D : A, O = d.hp >= a.hp ? A : D, w = d.hp >= a.hp ? wd : wa;
        text = this._pick("fed-one", [
          `${w || "Cả " + T} đang dồn sức cho người khổng lồ ${T}! Thanh sức bật lên!`,
          `Người khổng lồ ${T} được tiếp sức ào ạt${w ? ", cảm ơn " + w : ""}! ${O} bị bỏ lại rồi!`,
          `${T} tiếp sức không ngừng${w ? ", dẫn đầu là " + w : ""}! Người khổng lồ ${O} bắt đầu đuối!`,
          `${w ? w + " vừa tiếp sức" : "Sức đổ về"}, người khổng lồ ${T} đứng thẳng dậy! ${O} có theo kịp không?`,
        ]);
      }
      out.push({ text, pri: PRI.LEVEL, ttl: 6000, cam: "G" });
      this.fed.D = { hp: 0, names: [] }; this.fed.A = { hp: 0, names: [] };
    }
    // follows and shares: thanked (never asked for), gathered
    const s = this.social;
    if ((s.follow.length || s.share.length) && t - s.at >= (quiet ? 20_000 : 60_000)) {
      s.at = t;
      for (const [list, did] of [[s.follow, "theo dõi"], [s.share, "chia sẻ"]]) {
        if (!list.length) continue;
        const first = list[0], more = list.length - 1;
        const who = `${first}${more > 0 ? ` và ${count(more)} bạn khác` : ""}`;
        out.push({ text: this._pick("social", [`Cảm ơn ${who} đã ${did}!`, `${who} vừa ${did}, cảm ơn nhé!`, `${who} vừa ${did}, quý quá!`]), pri: PRI.SOCIAL, ttl: 12_000 });
      }
      s.follow = []; s.share = [];
    }
    return out;
  }

  // ---------- what the field reports ----------
  onBattle(events) {
    const out = [], D = TEAMS.D.name, A = TEAMS.A.name;
    for (const e of events) {
      const face = e.face ? FACE_NAMES[e.face] : "";
      switch (e.type) {
        case "wave": {
          const all = (e.came?.D || 0) + (e.came?.A || 0);
          if (e.n === 1) break;                                   // the start of the match says it
          if ((all >= 6 || this.quiet()) && this._gap("wave", 55_000))
            out.push({ text: all > 0
              ? this._pick("wave", [
                `Đợt quân thứ ${count(e.n)}! ${count(all)} người ùa ra trận!`,
                `Đợt ${count(e.n)} ra trận! Quân hai phe lao vào nhau!`,
                `Quân mới ra trận rồi! Ai vừa ngã thì quay lại báo thù đi nào!`,
                `Đợt ${count(e.n)} tới! ${count(all)} người lao ra như ong vỡ tổ!`,
                `Lại một đợt quân nữa! Ai vừa nằm thì dậy đi, hết giờ nghỉ rồi!`,
              ])
              : this._pick("wave0", [`Đợt quân thứ ${count(e.n)} ra trận!`, `Đợt ${count(e.n)} bắt đầu!`, `Đợt ${count(e.n)} tới rồi mà sân vắng quá! Gõ một câu là có nhân vật ra trận!`]), pri: PRI.WAVE, ttl: 4000 });
          break;
        }
        case "first_blood": {
          const n = speakName(e.name) || "Một bạn";
          out.push({ text: this._pick("first", [
            `${n} mở hàng, hạ gục người đầu tiên của trận!`,
            `Hạ gục đầu tiên! ${n} ra tay trước!`,
            `${n} khai màn! Người đầu tiên đã nằm xuống!`,
            `Chưa kịp ấm chỗ đã có người ngã! ${n} ra tay nhanh quá!`,
          ]), pri: PRI.KILL, ttl: 7000, cam: `u:${e.key}`, key: e.key });
          break;
        }
        case "streak": {
          const n = speakName(e.name) || "một bạn";
          const text = e.n >= 12 ? this._pick("streak12", [`Mười hai mạng! ${n} hoá thần chiến tranh rồi, ai cản lại đi!`, `Mười hai mạng! ${n} một mình một chợ, bên kia xin thua chưa?`])
            : e.n >= 8 ? this._pick("streak8", [`Tám mạng liên tiếp! ${n} đang một mình cân cả mặt trận!`, `Tám mạng! ${n} đánh như chưa từng được đánh!`])
              : e.n >= 5 ? this._pick("streak5", [`Năm mạng liền! Ai cản ${n} lại đi!`, `${n} hạ năm người không nghỉ, đáng sợ quá!`, `Năm mạng! ${n} đang vào cầu, đừng ai đứng gần!`])
                : this._pick("streak3", [`${n} hạ liền ba mạng, nóng máy rồi đấy!`, `Ba mạng liên tiếp cho ${n}!`, `${n} làm một lèo ba mạng! Tay đang nóng!`, `Một, hai, ba! ${n} hạ ba người gọn như ăn kẹo!`]);
          if (e.n >= 5 || this._gap("streak3", 15_000)) out.push({ text, pri: e.n >= 5 ? PRI.HERO : PRI.KILL, ttl: 8000, cam: `u:${e.key}`, key: e.key });
          break;
        }
        case "died":
          if (e.key && e.tier >= 5) {
            const n = speakName(e.name) || "một bạn", rank = TIERS[e.tier].name, by = e.byKey ? speakName(e.byName) : "";
            const text = by && e.byTier === 0 ? this._pick("died-dan", [
              `Không thể tin được! Dân ${by} vừa hạ ${rank} ${n}!`,
              `Chuyện lạ có thật! Dân ${by} cầm cuốc hạ luôn ${rank} ${n}!`,
              `Trời đất ơi! Dân ${by} hạ gục ${rank} ${n}! Kèo này ai mà đoán nổi!`,
            ]) : by ? this._pick("died-by", [
              `${rank} ${n} ngã xuống dưới tay ${by}!`,
              `${by} vừa hạ ${rank} ${n}! Cả mặt trận sững sờ!`,
              `${by} tiễn ${rank} ${n} về nghỉ! Một cú quá đẹp!`,
            ]) : this._pick("died", [
              `${rank} ${n} đã ngã xuống!`,
              `${rank} ${n} gục rồi! Một cây cột của đội vừa đổ!`,
              `${rank} ${n} đã ngã! Mặt trận ấy trống hẳn một khoảng!`,
            ]);
            out.push({ text, pri: PRI.HERO, ttl: 10_000, cam: e.lane });
          }
          break;
        case "gate_half":
          if (this._gap(`half:${e.face}`, 40_000))
            out.push({ text: this._pick("half", [
              `Cổng ${face} chỉ còn một nửa!`,
              `Cổng ${face} rung bần bật, còn một nửa thôi!`,
              `${A} đã đập nát nửa cánh cổng ${face}!`,
              `Cổng ${face} kêu răng rắc! Còn một nửa, ${D} vá nhanh lên!`,
              `Nửa cánh cổng ${face} bay màu rồi!`,
            ]), pri: PRI.TURN - 4, ttl: 7000, cam: e.face });
          break;
        case "breach": {
          const who = e.key ? speakName(e.name) : "";
          if (this._gap("breach", 10_000))
            out.push({ text: who
              ? this._pick("breach-who", [
                `${who} phá tung cổng ${face}! ${A} tràn vào lâu đài!`,
                `Cổng ${face} vỡ rồi, công đầu thuộc về ${who}!`,
                `${who} đạp tung cổng ${face}! Khỏi cần gõ cửa!`,
              ])
              : this._pick("breach", [
                `Cổng ${face} vỡ rồi! ${A} tràn vào, thẳng tới lâu đài!`,
                `Vỡ cổng ${face}! ${D} lùi về giữ lâu đài!`,
                `Cổng ${face} toang rồi! ${A} ùa vào như đi hội!`,
              ]), pri: PRI.TURN + 1, ttl: 10_000, cam: e.face });
          break;
        }
        case "rebuilt":
          if (this._gap("rebuilt", 12_000))
            out.push({ text: this._pick("rebuilt", [
              `Cổng ${face} dựng lại rồi! ${D} đóng cửa, không tiếp khách!`,
              `${D} vá xong cổng ${face}! Công sức của ${A} đổ sông đổ biển!`,
              `Cổng ${face} lành lại rồi! ${A} đập cả buổi, ${D} vá một phút!`,
              `${D} dựng lại cổng ${face}! Thợ mộc bên này đỉnh thật!`,
            ]), pri: PRI.TURN, ttl: 10_000, cam: e.face });
          break;
        case "giant_lead": {
          const T = TEAMS[e.team].name, O = TEAMS[other(e.team)].name;
          if (this._gap("giant-lead", 9000)) out.push({ text: this._pick("giant-lead", [
            `Đảo chiều rồi! Người khổng lồ ${T} vượt lên dẫn trước!`,
            `${T} lật lại thế trận! Giờ tới lượt ${O} phải đuổi!`,
            `Thế trận đổi chiều! Người khổng lồ ${T} đang khoẻ hơn!`,
          ]), pri: PRI.TURN, ttl: 7000, cam: "G" });
          break;
        }
        case "giant_mark": {
          const T = TEAMS[e.team].name, O = TEAMS[other(e.team)].name;
          out.push({ text: e.mark <= 0.25
            ? this._pick("giant25", [
              `Người khổng lồ ${T} sắp gục rồi! Cả ${T} nín thở!`,
              `Chỉ còn một phần tư sức! Người khổng lồ ${T} lảo đảo, ${O} ngửi thấy mùi chiến thắng!`,
              `Người khổng lồ ${T} quỵ một gối rồi! Còn gượng dậy nổi không đây?`,
            ])
            : this._pick("giant50", [
              `Người khổng lồ ${T} chỉ còn một nửa sức! ${O} đang ép tới!`,
              `Một nửa sức đã bay! Người khổng lồ ${T} bắt đầu thở dốc!`,
              `Người khổng lồ ${T} trúng đòn liên tiếp, còn đúng một nửa!`,
            ]), pri: PRI.TURN + 2, ttl: 9000, cam: "G" });
          break;
        }
        case "hall_mark":
          if (this._gap(`hall:${e.mark}`, 30_000))
            out.push({ text: e.mark <= 0.25
              ? this._pick("hall25", [
                `Lâu đài sắp sập! Còn một phần tư, ${D} cố lên!`,
                `Lâu đài chỉ còn một phần tư! Tim tôi cũng sắp sập theo!`,
                `Lâu đài lung lay lắm rồi, còn một phần tư! ${A} ngửi thấy mùi chiến thắng!`,
              ])
              : this._pick("hall50", [
                `Lâu đài còn một nửa! ${A} đang ép rất mạnh!`,
                `Mất nửa lâu đài rồi! ${D} ơi, tỉnh lại đi!`,
                `Lâu đài mất một nửa! Bên trong chắc đang gói ghém đồ đạc rồi!`,
              ]), pri: PRI.TURN, ttl: 10_000, cam: "C" });
          break;
        default:
      }
    }
    return out;
  }

  _state() {
    const b = this.battle, hall = pct(b.hallRatio());
    if (hall < 100) return `Lâu đài còn ${hall} phần trăm`;
    return `Cổng ${FACE_NAMES[b.front]} còn ${pct(b.gateRatio(b.front))} phần trăm`;
  }
  _countdown(seconds) {
    const hall = this.battle.hallRatio(), D = TEAMS.D.name, A = TEAMS.A.name;
    if (seconds === 60) return { text: this._pick("c60", [`Còn một phút! ${this._state()}.`, `Một phút cuối! ${this._state()}, chưa ai dám chớp mắt!`]), pri: PRI.COUNT, ttl: 8000 };
    if (seconds === 30) return { text: hall < 0.35
      ? this._pick("c30low", [`Ba mươi giây cuối! ${this._state()}, ${A} có kịp không?`, `Còn ba mươi giây! ${D} chỉ cần trụ thêm chút nữa!`, `Ba mươi giây! ${this._state()}, bên nào cũng toát mồ hôi!`])
      : this._pick("c30", [`Ba mươi giây cuối! ${this._state()}!`, `Còn ba mươi giây! ${A} phải nhanh lên thôi!`, `Ba mươi giây nữa! ${D} bắt đầu nhìn đồng hồ rồi!`]), pri: PRI.COUNT, ttl: 7000 };
    return { text: this._pick("c10", [`Mười giây cuối!`, `Mười giây nữa thôi!`, `Mười giây! Nín thở nào!`]), pri: PRI.COUNT + 5, ttl: 4000 };
  }

  // ---------- the match ----------
  /** kind: "rage" (the match of fury; lead: the team that is ahead). level: the score has just been levelled, this
   *  match settles the series. */
  matchStart(n, moved = [], kind = null, lead = null, level = false) {
    const D = TEAMS.D.name, A = TEAMS.A.name;
    if (kind === "rage") {
      const L = TEAMS[lead]?.name || A, T = TEAMS[lead ? other(lead) : "D"].name;
      return { text: this._pick("start-rage", [
        `Trận nộ bắt đầu! Hai người khổng lồ lao vào nhau! ${T} thắng thì cân bằng tỉ số, thua là hết loạt!`,
        `Trận nộ! ${T} còn đúng một cơ hội này. Người khổng lồ nào gục trước, đội đó thua!`,
        `Đất rung chuyển rồi! Trận nộ của hai người khổng lồ! ${L} muốn kết thúc, ${T} quyết lội ngược dòng!`,
      ]), pri: PRI.BIG, ttl: 20_000 };
    }
    if (level) return { text: this._pick("start-level", [
      `Trận ${count(n)}! Tỉ số đang hoà, ai thắng trận này là thắng cả loạt!`,
      `Hai phe ngang nhau rồi, đánh lại như thường! Trận ${count(n)} này sẽ phân thắng bại!`,
    ]), pri: PRI.BIG, ttl: 20_000 };
    let text = this._pick("start", [
      `Trận ${count(n)} bắt đầu! ${A} vây kín bốn mặt thành!`,
      `Vào trận ${count(n)}! ${D} giữ lâu đài, ${A} tìm đường vào!`,
      `Trận ${count(n)}! Ai chưa có nhân vật hoặc còn là Dân, gõ một câu là ra trận!`,
      `Trận ${count(n)} mở màn! ${D} đóng chặt cổng, ${A} xắn tay áo!`,
      `Trống nổi lên rồi! Trận ${count(n)}, bốn mặt thành cùng rực lửa!`,
    ]);
    if (moved.length) text += ` ${count(moved.length)} người đã đổi phe.`;
    return { text, pri: PRI.TURN, ttl: 15_000 };
  }

  /** The lines of the result of a match (said in order). */
  matchScript(e) {
    const W = TEAMS[e.winner], L = TEAMS[other(e.winner)], lines = [], tail = [], left = pct(e.hallLeft);
    if (e.kind === "rage") lines.push({ text: e.reason === "giant"
      ? this._pick("rage-ko", [
        `Người khổng lồ ${L.name} đổ rồi! ${W.name} thắng trận nộ!`,
        `Gục rồi! Người khổng lồ ${L.name} nằm xuống, ${W.name} thắng trận nộ!`,
        `Rầm một tiếng! Người khổng lồ ${L.name} ngã, đất còn rung! ${W.name} thắng trận nộ!`,
      ])
      : this._pick("rage-time", [
        `Hết giờ! Người khổng lồ ${W.name} còn nhiều sức hơn, ${W.name} thắng trận nộ!`,
        `Hết giờ rồi! Cả hai còn đứng, nhưng ${W.name} khoẻ hơn! ${W.name} thắng trận nộ!`,
      ]), cam: "G" });
    else lines.push({ text: e.winner === "D"
      ? (left <= 15 ? this._pick("win-d-close", [
        `Hết giờ! Thở không ra hơi! Lâu đài chỉ còn ${left} phần trăm mà ${W.name} vẫn giữ được!`,
        `Hết giờ rồi! Còn đúng ${left} phần trăm, ${W.name} thắng trong gang tấc!`,
        `Hết giờ! Lâu đài còn ${left} phần trăm, xiêu vẹo mà chưa đổ! ${W.name} thắng!`,
      ]) : this._pick("win-d", [
        `Hết giờ! Lâu đài vẫn đứng vững, còn ${left} phần trăm. ${W.name} thắng trận ${count(e.n)}!`,
        `Hết giờ rồi! ${L.name} không qua nổi, ${W.name} thắng trận ${count(e.n)}!`,
        `Hết giờ! ${L.name} gõ cửa cả trận mà chủ nhà không mở! ${W.name} thắng trận ${count(e.n)}!`,
      ]))
      : this._pick("win-a", [
        `Lâu đài sập rồi! ${W.name} thắng trận ${count(e.n)}!`,
        `Sập rồi! ${W.name} san phẳng lâu đài, thắng trận ${count(e.n)}!`,
        `Lâu đài đổ rầm! ${W.name} thắng trận ${count(e.n)}, ${L.name} tối nay ngủ ngoài trời!`,
      ]), cam: e.winner === "D" ? null : "C" });
    if (!e.final) {
      const d = e.wins.D, a = e.wins.A;
      if (e.levelled) lines.push({ text: this._pick("levelled", [
        `Không thể tin được! ${W.name} cân bằng tỉ số, ${count(d)} đều! Trận sau sẽ phân thắng bại!`,
        `Lội ngược dòng! Tỉ số ${count(d)} đều rồi! Đánh tiếp một trận nữa mới biết ai thắng!`,
      ]) });
      else if (e.nextKind === "rage" && e.lead) {
        const Ld = TEAMS[e.lead].name, Tr = TEAMS[other(e.lead)].name;
        lines.push({ text: `Tỉ số: ${TEAMS.D.name} ${count(d)}, ${TEAMS.A.name} ${count(a)}. ${this._pick("to-rage", [
          `${Tr} không thể đuổi kịp nữa, chỉ còn một cơ hội: trận nộ! Thắng thì cân bằng tỉ số, thua là hết!`,
          `${Ld} chạm tay vào chiến thắng! ${Tr} còn đúng một trận nộ để lật ngược!`,
        ])}` });
      } else {
        const tail = d === a ? " Đang hoà, căng như dây đàn!" : Math.abs(d - a) >= 2 ? ` ${TEAMS[d > a ? "A" : "D"].name} phải gỡ gấp thôi!` : "";
        lines.push({ text: `Tỉ số: ${TEAMS.D.name} ${count(d)}, ${TEAMS.A.name} ${count(a)}.${tail}` });
      }
      if (e.resting > 0) lines.push({ text: this._pick("rest", [
        `Sang trận sau, ai đang là Dân thì gõ lại một câu để ra trận nhé!`,
        `Ai còn là Dân thì bình luận lại một câu, trận sau mới ra sân nha!`,
        `Lính có bậc thì tự ra trận tiếp. Còn Dân thì gõ lại một câu nhé!`,
      ]) });
    } else {
      const s = e.series;
      if (e.kind === "rage") lines.push({ text: `${W.name} thắng luôn cả loạt, không cần đánh thêm trận nào nữa!`, final: true });
      lines.push({ text: s.winner
        ? `Chung cuộc ${count(s.matches)} trận: ${TEAMS[s.winner].name} thắng ${count(s.wins[s.winner])} ${count(s.wins[other(s.winner)])}!`
        : `Chung cuộc ${count(s.matches)} trận: hai phe hoà ${count(s.wins.D)} đều!`, final: true });
      if (s.top.length) lines.push({ text: `Nổi bật nhất loạt này: ${s.top.map((p) => this.name(p)).join(", ")}.`, final: true });
      lines.push({ text: this._pick("new-series", [
        `Loạt mới bắt đầu! Ai chơi tiếp thì gõ một câu để có nhân vật mới nhé!`,
        `Xoá bàn làm lại! Loạt mới rồi, gõ một câu là có nhân vật mới!`,
      ]), final: true });
    }
    // who stood out: last, said only if there is time left (the board shows it anyway)
    const best = e.board?.[e.winner]?.[0], rival = e.board?.[other(e.winner)]?.[0];
    if (best) tail.push({ text: `${this._pick("best", [`Dẫn đầu ${W.name}`, `Người hùng của ${W.name}`, `Xuất sắc nhất ${W.name}`])}: ${this.name(best)}${rival ? `. Bên ${L.name}, nổi bật nhất là ${this.name(rival)}` : ""}.` });
    else {
      const awards = Object.values(e.awards || {}).sort((a, b) => (b.team === e.winner) - (a.team === e.winner)).slice(0, 2);
      if (awards.length) tail.push({ text: awards.map((a) => `${AWARDS[a.kind]}: ${this.name(a)}`).join(". ") + "." });
    }
    lines.push(...tail);
    return lines.map((l) => ({ pri: 100, ...l }));
  }

  // ---------- the quiz ----------
  quizAsk(q) { return { text: `${QUIZ_KIND[q.k] || "Đố vui"}! ${q.q}`, pri: PRI.QUIZ, ttl: 12_000 }; }
  /** names: the fastest right answers, in order (three at most); c.right: everyone who was right. */
  quizResult(c, names) {
    const [a, b, d] = names, more = c.right.length - names.length;
    let who;
    if (!names.length) who = this._pick("quiz-none", ["Chưa ai trả lời đúng.", "Chưa ai đúng. Câu này khó, hay mọi người mải đánh nhau?", "Không ai đúng cả! Câu sau gỡ lại nhé!", "Trượt hết rồi! Đáp án nghe xong mới thấy tiếc!"]);
    else {
      who = names.length === 1 ? (more > 0 ? `Nhanh nhất là ${a}!` : this._pick("quiz-1", [`Chỉ có ${a} trả lời đúng. Giỏi quá!`, `${a} trả lời đúng, một mình một ngựa!`]))
        : names.length === 2 ? this._pick("quiz-2", [`Nhanh nhất là ${a}, sau đó là ${b}.`, `${a} về nhất, ${b} về nhì!`])
          : this._pick("quiz-3", [`Nhanh nhất là ${a}, rồi tới ${b} và ${d}.`, `${a} về nhất, ${b} về nhì, ${d} về ba!`]);
      if (more > 0) who += this._pick("quiz-more", [` Còn ${count(more)} bạn khác cũng trả lời đúng!`, ` Thêm ${count(more)} bạn nữa cũng đúng!`]);
    }
    return { text: `Đáp án là ${c.shown}. ${who}`, pri: PRI.QUIZ, ttl: 8000 };
  }

  /** When nobody says anything: in turn, how to play, where the match stands, a joke. */
  filler() {
    const g = this.game, b = this.battle, d = g.members("D"), a = g.members("A");
    const D = TEAMS.D.name, A = TEAMS.A.name, series = g.seriesMatches || 5, wins = g.s.series?.wins || { D: 0, A: 0 };
    const turn = ["tip", "state", "joke"][this.fill++ % 3];
    let lines;
    if (b.rage) {
      const gd = pct(b.giantRatio("D")), ga = pct(b.giantRatio("A"));
      const low = gd <= ga ? D : A, high = gd <= ga ? A : D, lo = Math.min(gd, ga);
      lines = turn === "tip" ? [
        `Trận nộ: người khổng lồ nào gục trước thì đội đó thua. Hết giờ thì bên còn nhiều sức hơn thắng.`,
        `Trận này không ai công thành. Lính hai phe kéo hết về chỗ hai người khổng lồ, đánh nhau và đánh cả người khổng lồ bên kia!`,
        `Lính ngã xuống là người khổng lồ phe mình yếu đi. Ra đòn trúng người khổng lồ bên kia là nó mất sức!`,
        `Quân mới vẫn ra trận ${b.T.wave} giây một đợt. Trận nộ không ai được nghỉ!`,
        `Giữ quân là giữ sức cho người khổng lồ. Đánh cho chắc tay vào!`,
      ] : turn === "state" ? [
        `Người khổng lồ ${D} còn ${gd} phần trăm sức, ${A} còn ${ga} phần trăm!`,
        gd === ga ? `Hai người khổng lồ ngang sức nhau, chưa ai chịu ai!` : `Người khổng lồ ${high} đang nhỉnh hơn! ${low} có lật lại được không?`,
        lo <= 40 ? `Người khổng lồ ${low} chỉ còn ${lo} phần trăm, đang hụt hơi! Cả ${low} dồn sức nào!` : `Còn ${count(Math.ceil(g.timeLeftMs() / 60_000))} phút! Càng về cuối đòn càng nặng, chưa biết ai gục trước!`,
        `${low} đang bị dẫn! Người khổng lồ ${low} cần sức lắm rồi, đánh mạnh lên nào!`,
        `Từng phần trăm sức lúc này đều quý! ${D} ${gd}, ${A} ${ga}!`,
      ] : [
        `Một đòn trời giáng! Đất dưới chân còn rung!`,
        `Hai người khổng lồ quần nhau, lửa bay tứ phía!`,
        `Lính hai phe lao vào nhau, không ai chịu lùi một bước!`,
        `Trận này không có chỗ cho người yếu tim đâu!`,
        `Tôi đứng bình luận thôi mà tay còn run đây này!`,
        `Đuốc vung tới đâu, lửa cháy tới đó! Ai mà đứng gần chắc cháy cả tóc!`,
        `Cả hai phe dồn hết sức vào trận này! Không ai muốn về tay trắng!`,
        `Ai gục, ai đứng? Chỉ vài giây nữa thôi là mọi thứ có thể đổi chiều!`,
      ];
    } else if (turn === "tip") lines = [
      `Gõ thủ để vào ${D} giữ thành, gõ đánh để vào ${A} phá thành. Gõ câu khác cũng có nhân vật, game tự xếp phe!`,
      `Cứ ${b.T.wave} giây có một đợt quân ra trận. Ai ngã thì chờ đợt sau là quay lại.`,
      `Dân vá cổng, Lính kiếm xông pha, Lính giáo chắn đường, Cung thủ bắn xa, Thầy thuốc hồi sức.`,
      this.quizOn ? `Đố đúng thì Dân lên Lính kiếm. Đúng lần nữa được thêm một Dân. Có đủ lính rồi thì đố đúng được hồi sức!` : `Nhân vật có bảy bậc, từ Dân tới Tướng.`,
      `Muốn sang phe kia thì gõ đổi, đợt quân sau là đổi áo. Mỗi trận một lần thôi nhé!`,
      `Hết giờ mà lâu đài còn đứng thì ${D} thắng. Lâu đài sập thì ${A} thắng.`,
      `Đội trưởng và Tướng làm quân quanh mình mạnh hơn. Đứng gần mà hưởng sái!`,
      `Quân từ bình luận ngã thì về làm Dân, chờ đợt sau là quay lại. Hết loạt ${count(series)} trận thì gõ lại một câu để vào loạt mới.`,
      `Nhân vật nào cũng mang tên và ảnh của chủ. Tìm xem mình đang đứng ở cổng nào nhé!`,
      `Quân có từ vật phẩm mà ngã là mất luôn. Quân từ bình luận ngã thì về làm Dân, hết trận Dân phải gõ lại mới ra tiếp.`,
      `Sức của lính giữ nguyên sang trận sau, không tự đầy lại đâu. Giữ lính cho khéo nhé!`,
      `Câu đố hết giờ mới biết ai đúng. Trả lời nhanh thì đứng đầu bảng!`,
      `Lên được Lính kiếm trở lên thì trận sau tự ra sân. Còn là Dân thì hết trận gõ lại một câu nhé!`,
    ];
    else if (turn === "state") {
      const hall = b.hallRatio();
      lines = [
        d + a > 0 ? `${D} có ${count(d)} người, ${A} có ${count(a)} người.${d > a * 1.5 && a > 0 ? ` ${A} đang thiếu người, ai vào giúp một tay không?` : a > d * 1.5 && d > 0 ? ` ${D} đang mỏng quá, ai vào giữ thành với?` : ""}`
          : `Chưa ai ra trận. Gõ một câu bất kỳ để mở màn nào!`,
        hall < 0.4 ? `${this._state()}. Người trong lâu đài chắc đang gói đồ rồi!` : `${this._state()}.`,
        b.waveN > 0 ? `Đang là đợt ${count(b.waveN)}. Còn ${count(Math.ceil(b.waveLeft()))} giây nữa đợt sau ra trận.` : `Đợt quân đầu sắp ra trận, chuẩn bị nào!`,
        wins.D + wins.A > 0 ? `Tỉ số loạt này: ${D} ${count(wins.D)}, ${A} ${count(wins.A)}.${wins.D === wins.A ? " Chưa bên nào chịu bên nào!" : ""}` : `Loạt ${count(series)} trận mới bắt đầu, chưa bên nào có điểm.`,
      ];
    } else lines = [
      `Mấy con cừu ngoài kia vẫn gặm cỏ như chưa có chuyện gì xảy ra.`,
      `Ai nghĩ ra việc xây lâu đài ngay giữa bãi chiến trường vậy nhỉ?`,
      `Thợ vá cổng của ${D} hôm nay tăng ca không lương.`,
      `${A} đập cổng nãy giờ, chắc quên là có thể gõ cửa.`,
      `Tôi mà là cánh cổng, tôi xin nghỉ việc từ trận một rồi.`,
      `Nghe nói Dân cầm cuốc cũng hạ được Tướng. Đừng coi thường ai cả!`,
      `Thầy thuốc chạy khắp sân mà không ai trả tiền khám. Nghề này bạc thật!`,
      `Cung thủ đứng xa bắn tới, bắn xong còn giả vờ nhìn đi chỗ khác.`,
      `Lính giáo đứng chắn cả buổi không than một câu. Nhân viên của năm đây rồi!`,
      `Ở đây không ai thua mãi, chỉ có ngã rồi quay lại thôi.`,
      `Bình luận viên như tôi đứng ngoài hò hét thì giỏi, chứ ra trận chắc ngã đầu tiên.`,
      `Hai phe đánh nhau hăng thế, chứ hết trận lại ngồi chung một phòng thôi mà.`,
      `Mấy cái cây ngoài kia đứng xem từ đầu tới giờ, chưa cây nào bỏ về.`,
      `Lâu đài này xây kiểu gì mà trận nào cũng có người đòi phá?`,
      `Con cừu kia mà biết gõ phím, chắc nó cũng chọn phe rồi.`,
      `Đánh nhau thì đánh, nhớ uống nước nha cả nhà!`,
      `Cổng thành mà biết nói, chắc nó đang hỏi: sao lại là tôi nữa?`,
      `Dân làng cầm cuốc ra trận. Ruộng thì bỏ đó, ai cày giùm đây?`,
    ];
    const i = this.turn[turn]++;
    return { text: lines[i % lines.length], pri: PRI.TIP, ttl: 6000 };
  }
}

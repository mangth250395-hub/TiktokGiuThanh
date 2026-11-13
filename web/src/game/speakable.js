// Turning live data into words a Vietnamese voice can read: gift names in Vietnamese, nicknames without emoji.

// TikTok gives gift names in English; a Vietnamese voice reads them badly. Unknown names are read as they are.
const GIFT_VI = {
  "rose": "hoa hồng", "rosa": "bó hoa hồng", "heart me": "trái tim", "finger heart": "tim ngón tay",
  "tiktok": "TikTok", "love you so much": "lời yêu thương", "wink wink": "cái nháy mắt", "you're awesome": "lời khen",
  "lucky pig": "heo may mắn", "gg": "GG", "ice cream cone": "kem ốc quế", "doughnut": "bánh donut",
  "hand hearts": "trái tim bàn tay", "heart": "trái tim", "hearts": "trái tim", "perfume": "nước hoa",
  "sunglasses": "kính râm", "corgi": "chú chó Corgi", "swan": "thiên nga", "train": "đoàn tàu",
  "fireworks": "pháo hoa", "rocket": "tên lửa", "sports car": "xe thể thao", "private jet": "máy bay riêng",
  "lion": "sư tử", "universe": "vũ trụ", "galaxy": "dải ngân hà", "money gun": "súng bắn tiền", "mic": "micro",
  "confetti": "pháo giấy", "cap": "mũ lưỡi trai", "hat and mustache": "mũ và ria mép", "motorcycle": "mô tô",
  "whale diving": "cá voi", "coral": "san hô", "cake slice": "bánh kem", "panda": "gấu trúc", "teddy bear": "gấu bông",
  "love bang": "tình yêu bùng nổ", "kiss": "nụ hôn", "air kiss": "nụ hôn gió", "thumbs up": "cái like",
  "tiny diny": "khủng long nhỏ", "mirror bloom": "gương hoa", "star": "ngôi sao", "crown": "vương miện",
  "dragon": "rồng", "unicorn": "kỳ lân", "butterfly": "bươm bướm", "balloon": "bóng bay", "bouquet": "bó hoa",
  "flower": "bông hoa", "flowers": "hoa", "gift box": "hộp bí mật", "diamond": "kim cương", "castle": "lâu đài",
  "yacht": "du thuyền", "jet": "máy bay", "plane": "máy bay", "car": "ô tô", "drama queen": "nữ hoàng",
  "doughnuts": "bánh donut", "mishka bear": "gấu Mishka", "hamsa protect": "bùa may mắn", "mirwas beat": "nhịp trống",
};

export function giftName(name) {
  const k = String(name || "").trim().toLowerCase();
  return GIFT_VI[k] || String(name || "món").trim();
}

const VI = "a-zàáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ";   // the Vietnamese alphabet (other look-alike letters are not read)
const NOT_VI = new RegExp(`[^${VI}0-9\s]`, "giu");
const TWO_VI = new RegExp(`[${VI}]{2}`, "iu");
const EMOJI_AND_MARKS = /[\p{Extended_Pictographic}\p{Emoji_Modifier}‍️⃣]/gu;

// words never said aloud (a nickname with one of them is not read; their @id is tried instead)
const BAD = /(^|[^\p{L}])(địt|đụ|lồn|buồi|cặc|đéo|đĩ|cứt|đm|đmm|dm|dmm|đcm|dcm|cđm|vcl|vkl|vl|clgt|cmm|loz|lìn|fuck|shit|bitch|dick|porn|sex)(?![\p{L}])/iu;

/** A nickname a voice can read: Vietnamese / Latin letters and digits only, words of 2+ letters, at most 3 words. */
export function speakName(nickname, uniqueId = "") {
  const clean = (s) => String(s || "").normalize("NFC").replace(EMOJI_AND_MARKS, " ")
    .replace(NOT_VI, " ").split(/\s+/)
    .filter((w) => /\d/.test(w) ? w.length >= 1 : w.length >= 2)      // a stray letter ("ã", "ậ") is not a name
    .join(" ").trim();
  // a name with letters, or a number ("123" is read as it is, not their @id: asked by the user, 10/11/2026)
  const ok = (t) => (TWO_VI.test(t) || /\d/.test(t)) && !BAD.test(t);
  let n = clean(nickname);
  if (!ok(n)) n = clean(String(uniqueId).replace(/[._]+/g, " "));
  if (!ok(n)) return "";
  const words = n.split(" ").slice(0, 3);
  // ALL CAPS is read letter by letter by some voices: "VĂN DANH" -> "Văn Danh"
  const fixed = words.map((w) => (w.length > 1 && w === w.toUpperCase() && /\p{L}/u.test(w)
    ? w[0] + w.slice(1).toLowerCase() : w));
  return fixed.join(" ").slice(0, 28).trim();
}

const SMALL = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín", "mười"];
/** Small counts in words (reads better: "ba bạn"); bigger ones stay digits, which the voice reads well. */
export function count(n) {
  return n >= 0 && n <= 10 ? SMALL[n] : String(n);
}

/** "30 hoa hồng và 2 trái tim" from [{name, count}] (the 2 biggest). */
export function giftList(gifts) {
  const g = [...gifts].filter((x) => x.count > 0).sort((a, b) => b.count - a.count).slice(0, 2);
  return g.map((x) => `${x.count} ${giftName(x.name)}`).join(" và ");
}

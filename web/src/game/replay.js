// Reading a past live from a log file, to play it again in the game (control window -> "Phát lại buổi live").

/** Events of a log file, in the shape the hub sends: hub logs (type) or connector logs (kind). */
export function readLog(text) {
  const out = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    const t = d.ts ? d.ts / 1000 : d.t;
    if (["comment", "gift", "gift_done", "like", "share", "follow"].includes(d.type) && d.user) {
      // no avatar: a replay must not load pictures from TikTok directly
      const user = { id: String(d.user.id || d.user.unique_id), unique_id: d.user.unique_id, nickname: d.user.nickname };
      out.push({ t, ev: { type: d.type, user, text: d.text, gift: d.gift, count: d.count, coins: d.coins } });
    } else if (["comment", "gift_add", "gift_done"].includes(d.kind) && d.unique_id) {
      const user = { id: d.unique_id, unique_id: d.unique_id, nickname: d.nickname };
      if (d.kind === "comment") out.push({ t, ev: { type: "comment", user, text: d.text } });
      else out.push({ t, ev: { type: d.kind === "gift_add" ? "gift" : "gift_done", user, gift: { name: d.gift_name, diamonds: d.diamonds },
        count: d.count, coins: d.coins } });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

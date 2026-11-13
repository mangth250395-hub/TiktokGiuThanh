// The name of a channel, as the hub names it (hub/config.py clean_channel): the TikTok ID in lower case, from what
// people type or paste: "kenh", "@Kenh ", "https://www.tiktok.com/@Kenh/live".
// Every event of the hub carries that name (ch). The game kept the name as it was typed and compared the two letter
// for letter: one capital, or a pasted link, and every comment, gift and answer was thrown away while the hub showed
// them coming in (seen in the map game, 11/11/2026; this game had the same fault until 0.4.0).

export function cleanChannel(name) {
  let s = String(name ?? "").trim();
  const m = s.match(/tiktok\.com\/@([^/?#\s]+)/i);
  if (m) s = m[1];
  return s.replace(/^@+/, "").trim().replace(/\/+$/, "").toLowerCase().slice(0, 64);
}

/** Is an event of the hub (its ch) for the channel of the game? No channel chosen: every event is. */
export const sameChannel = (ch, mine) => !cleanChannel(mine) || cleanChannel(ch) === cleanChannel(mine);

/** A channel named "thu_..." (thu_nghiem) is for tests: the hub never connects it to TikTok, only fake events. */
export const isTestChannel = (ch) => /^thu_/i.test(cleanChannel(ch));

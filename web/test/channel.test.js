import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanChannel, isTestChannel, sameChannel } from "../src/game/channel.js";

test("a channel is named as the hub names it: the ID in lower case, from a name, an @name or a pasted link", () => {
  for (const typed of ["Kenh.Live_1", "@Kenh.Live_1 ", " kenh.live_1/", "https://www.tiktok.com/@Kenh.Live_1/live?lang=vi",
    "tiktok.com/@kenh.live_1"]) assert.equal(cleanChannel(typed), "kenh.live_1", typed);
  assert.equal(cleanChannel(""), "");
  assert.equal(cleanChannel(null), "");
  assert.equal(cleanChannel("thu_Nghiem"), "thu_nghiem");
});

test("the events of the hub are the game's own however the channel was typed", () => {
  assert.equal(sameChannel("kenh.mau_2026", "Kenh.Mau_2026"), true);   // a capital: was thrown away
  assert.equal(sameChannel("kenh.mau_2026", "https://www.tiktok.com/@kenh.mau_2026"), true);
  assert.equal(sameChannel("kenh.mau_2026", "kenh.mau_20266"), false);  // another channel
  assert.equal(sameChannel("anything", ""), true);                                // no channel chosen: every event
});

test("a test channel is one whose name starts with thu_, however it was typed", () => {
  assert.equal(isTestChannel("thu_nghiem"), true);
  assert.equal(isTestChannel("@Thu_Nghiem"), true);
  assert.equal(isTestChannel("thuthuy"), false);
  assert.equal(isTestChannel(""), false);
});

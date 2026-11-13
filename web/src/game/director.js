// The camera director. Every moment worth seeing asks for the camera (a side of the citadel, the hall, a character);
// at busy times that is several requests a second, so:
//   - a shot lasts at least MIN_SHOT_MS; requests for the same place are merged
//   - the most important request goes first; a request waiting too long is dropped
//   - when too much waits, the camera pulls back to the whole field and only big moments get a shot
//   - the voice and the end of a match can take the camera over (hold / release)
// (the same director as the map game: places are the 4 sides "N" "E" "S" "W", the hall "C", a character "u:<key>")
export const MIN_SHOT_MS = 2600;
const STALE_MS = 6000;
const GIFT_STALE_MS = 15_000;   // a gift waits longer for its shot: a busy moment never makes it missed
// The order (the user, 10/11/2026): a gift > a newcomer choosing a province > someone with a province commenting it
// again. Busy (more than BUSY_QUEUE waiting): if gifts wait, only gifts (the bigger first); with no gift, the
// newcomers first, then the others, as when it is quiet. A gift cuts a shot of a comment at once (after PREEMPT_MS).
const PREEMPT_MS = 900;
const BIGGER_CUTS = 10;          // a gift this much higher (about 2x the points or more) cuts a smaller gift's shot
// a busy live with no gift: a province where several people come in at once goes first, and one just shown waits a
// little, so the camera goes round the provinces instead of jumping back and forth (gifts are not changed by this)
const CROWD_MAX = 5, RECENT_MS = 10_000, RECENT_LESS = 4;
const BUSY_QUEUE = 3;
export const GIFT_PRI = 40;
const BUSY_MIN_PRI = GIFT_PRI;
const BACK_TO_MAP_MS = 4500;   // nothing to show for this long: back to the whole map

export class Director {
  /** camera: { focus(id), overview() } */
  constructor(camera) {
    this.cam = camera;
    this.wait = new Map();       // id -> { pri, at, shot, n: how many asked }
    this.shown = new Map();      // id -> when it was last shown
    this.shot = null;            // { id, since }
    this.held = null;            // a province held by the voice or the round end (null = map)
    this.holding = false;
    this.lastShotEnd = 0;
    this.overview = true;
  }

  /** `shot`: "close" or "medium" (how near the camera goes). Requests for one province merge: the nearest wins. */
  request(id, pri = 10, shot = "medium", now = performance.now()) {
    if (!id) return;
    const w = this.wait.get(id);
    if (!w) { this.wait.set(id, { pri, at: now, shot, n: 1 }); return; }
    w.pri = Math.max(w.pri, pri);
    w.n = (w.n || 1) + 1;
    w.at = now;
    if (shot === "close") w.shot = "close";
  }

  /** The voice or the round end shows this province (null: the whole map) until release(). */
  hold(id, shot = "close") {
    this.holding = true;
    this.held = id;
    this.wait.delete(id);
    if (id) { this.cam.focus(id, shot); this.overview = false; } else { this.cam.overview(); this.overview = true; }
    this.shot = { id, since: performance.now() };
  }

  release() { this.holding = false; }

  /** An effect plays on the province being shown: stay there until it is over (no back-to-map, no next shot). */
  keep(id, ms, now = performance.now()) {
    if (this.shot?.id === id) this.kept = { id, until: Math.max(now + ms, this.kept?.id === id ? this.kept.until : 0) };
  }

  update(now = performance.now()) {
    if (this.holding) return;
    for (const [id, w] of this.wait) if (now - w.at > (w.pri >= BUSY_MIN_PRI ? GIFT_STALE_MS : STALE_MS)) this.wait.delete(id);
    const top = Math.max(-1, ...[...this.wait.values()].map((w) => w.pri));
    // an effect keeps the camera on its province, but not against a gift as big or bigger elsewhere once the shot has
    // been seen long enough (effects one after another in a province never starve a gift in another)
    if (this.kept && this.shot?.id === this.kept.id && now < this.kept.until
      && !(top >= BUSY_MIN_PRI && top >= (this.shot.pri ?? 0) && now - this.shot.since >= MIN_SHOT_MS)) return;
    const giftWaits = top >= BUSY_MIN_PRI;
    if (this.shot && now - this.shot.since < MIN_SHOT_MS) {
      // a gift does not wait for the end of a comment's shot, nor a much bigger gift for a small one's
      const pri = this.shot.pri ?? 0;
      const cut = giftWaits && now - this.shot.since >= PREEMPT_MS && (pri < BUSY_MIN_PRI || top >= pri + BIGGER_CUTS);
      if (!cut) return;
    }
    const busy = this.wait.size > BUSY_QUEUE;
    const giftsOnly = busy && giftWaits;
    const score = (id, w) => w.pri >= BUSY_MIN_PRI ? w.pri
      : w.pri + Math.min(CROWD_MAX, (w.n || 1) - 1) - (now - (this.shown.get(id) ?? -1e9) < RECENT_MS ? RECENT_LESS : 0);
    let best = null;
    for (const [id, w] of this.wait) {
      if (giftsOnly && w.pri < BUSY_MIN_PRI) continue;
      const sc = score(id, w);
      if (!best || sc > best.sc || (sc === best.sc && w.at < best.w.at)) best = { id, w, sc };
    }
    if (giftsOnly) for (const [id, w] of this.wait) if (w.pri < BUSY_MIN_PRI) this.wait.delete(id);
    if (best) {
      this.wait.delete(best.id);
      // the same province again (a combo going on): the shot goes on as it is, the camera does not swing round anew
      const same = !this.overview && this.shot?.id === best.id;
      this.shot = { id: best.id, since: now, pri: best.w.pri };
      this.shown.set(best.id, now);
      // (only the last seconds are ever looked at: what is older goes, a long live does not keep every viewer shown)
      if (this.shown.size > 200) for (const [id, at] of this.shown) if (now - at > 60_000) this.shown.delete(id);
      if (!same) this.cam.focus(best.id, best.w.shot);
      this.overview = false;
      return;
    }
    if (busy || (!this.overview && this.shot && now - this.shot.since > BACK_TO_MAP_MS)) {
      this.cam.overview();
      this.overview = true;
      this.shot = { id: null, since: now };
    }
  }
}

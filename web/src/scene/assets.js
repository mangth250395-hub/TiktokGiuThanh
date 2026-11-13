// The pictures of the field: the free pack "Tiny Swords" by Pixel Frog (https://pixelfrog-assets.itch.io/tiny-swords;
// free for personal and commercial projects, not to be redistributed as a pack). Copied to web/public/ts by hand
// (see README). Blue: the defenders. Red: the attackers.
// Every character sheet is a row of frames; (ax, ay) is where the feet are in a frame.

export const K = 0.3;              // field units for one pixel of the pack

const U = (fw, ax, ay, idle, run, attack, tall) => ({ fw, ax, ay, idle, run, attack, tall });
// tall: where the top of the HEAD is above the feet, in pixels of the pack, measured on the sheets (standing). What is
// drawn over a head (strength, pennant, picture, name) hangs from it. It was one guess for all (27 units, 36 for the
// wide sheet of the lancer, whose frame is wide for the lance, not tall for the body): over a general, drawn 1.75
// times bigger, everything floated 25 units above the helmet (the user, 11/11/2026).
export const SHEETS = {
  pawn: U(192, 96, 134, 8, 6, 3, 73),      // a villager with a hammer (the defenders: they mend)
  pawnaxe: U(192, 96, 134, 8, 6, 6, 73),   // a villager with an axe (the attackers: they chop the gate)
  pawnpick: U(192, 96, 134, 8, 6, 6, 73),  // soldiers of the place: a pickaxe (defenders), a knife (attackers)
  pawnknife: U(192, 96, 134, 8, 6, 4, 73),
  warrior: U(192, 96, 136, 8, 6, 4, 88),
  lancer: U(320, 160, 197, 12, 6, 3, 75),
  archer: U(192, 96, 135, 6, 4, 8, 88),
  monk: U(192, 96, 134, 6, 4, 11, 70),
};
/** The two giants of the match of fury: the hooded goblin with a torch of the old pack (a character of its own, not
 *  one of the soldiers: the user, 11/11/2026), in the colour of each team. Sheets "old/giant_<colour>_<idle|attack>". */
export const GIANT = { fw: 192, ax: 96, ay: 125, idle: 7, attack: 6, scale: 3.6, tall: 22 };

/** Which sheet a kind of character uses, and how big it is drawn. The two leaders wear gold (the pack's yellow
 *  units), much bigger than the others: what costs more must look it (the user, 10/11/2026). `npc`: the sheet of the
 *  soldiers of the place, so they do not all look like the viewers. */
export const LOOK = {
  pawn: { D: "pawn", A: "pawnaxe", npc: { D: "pawnpick", A: "pawnknife" }, scale: 1 },
  warrior: { D: "warrior", A: "warrior", scale: 1.08 },
  lancer: { D: "lancer", A: "lancer", scale: 1.12 },
  archer: { D: "archer", A: "archer", scale: 1.12 },
  monk: { D: "monk", A: "monk", scale: 1.16 },
  captain: { D: "warrior", A: "warrior", scale: 1.5, gold: true },
  general: { D: "lancer", A: "lancer", scale: 1.75, gold: true },
};
export const FX = {
  explosion: { src: "fx/explosion_01", fw: 192, n: 8 },
  explosion2: { src: "fx/explosion_02", fw: 192, n: 10 },
  dust: { src: "fx/dust_01", fw: 64, n: 8 },
  dust2: { src: "fx/dust_02", fw: 64, n: 10 },
  fire: { src: "fx/fire_02", fw: 64, n: 10 },
  fire2: { src: "fx/fire_03", fw: 64, n: 12 },
  heal: { src: "fx/heal", fw: 192, n: 11 },
  dead: { src: "fx/dead", fw: 128, n: 14, cols: 7 },      // a skull that comes and goes (2 rows of 7)
};

const FILES = [];
for (const c of ["blue", "red"]) {
  for (const sh of Object.keys(SHEETS)) for (const a of ["idle", "run", "attack"]) FILES.push(`${c}/${sh}_${a}`);
  FILES.push(`${c}/warrior_attack2`, `${c}/arrow`, `${c}/castle`, `${c}/tower`, `${c}/barracks`, `${c}/house1`, `${c}/house2`, `${c}/house3`, `${c}/archery`, `${c}/monastery`);
}
for (const c of ["blue", "red"]) for (const a of ["idle", "attack"]) FILES.push(`old/giant_${c}_${a}`);
for (const sh of ["warrior", "lancer"]) for (const a of ["idle", "run", "attack"]) FILES.push(`yellow/${sh}_${a}`);
FILES.push("yellow/warrior_attack2");
for (const f of Object.values(FX)) FILES.push(f.src);
FILES.push("deco/tiles", "deco/sheep", "deco/sheep_grass", "deco/gold", "old/castle_destroyed", "old/tower_destroyed", "old/house_blue", "old/house_red", "old/woodtower_red", "old/tent");
for (let i = 1; i <= 4; i++) FILES.push(`deco/tree${i}`, `deco/bush${i}`, `deco/rock${i}`);
for (let i = 1; i <= 18; i++) FILES.push(`old/deco${String(i).padStart(2, "0")}`);

const IMG = new Map();
let ready = false;
/** A picture by its name ("blue/warrior_idle"), or null while it is not loaded. */
export const img = (name) => IMG.get(name) || null;
export const assetsReady = () => ready;
export const color = (team) => (team === "D" ? "blue" : "red");

export function loadAssets(base = "/ts/") {
  return Promise.all(FILES.map((name) => new Promise((res) => {
    const im = new Image();
    im.onload = () => { IMG.set(name, im); res(); };
    im.onerror = () => res();                 // a missing picture never stops the game: that thing is simply not drawn
    im.src = `${base}${name}.png`;
  }))).then(() => { ready = true; });
}

const FACE = { pawn: "pawn", warrior: "warrior", lancer: "lancer", archer: "archer", monk: "monk", captain: "warrior", general: "lancer" };
/** The face of a kind of character (the portraits of the pack), for the panels: a URL. The leaders are in gold. */
export function kindPic(team, kind) {
  const gold = LOOK[kind]?.gold;
  return `/ts/ui/face_${gold ? "yellow" : color(team)}_${FACE[kind] || "pawn"}.png`;
}

/** A whole picture of the pack fitted in a square, for the panels (a data URL), or null while it is not loaded. */
export function spritePic(name, px = 96) {
  const im = img(name);
  if (!im) return null;
  const cv = document.createElement("canvas");
  cv.width = cv.height = px;
  const c = cv.getContext("2d");
  c.imageSmoothingEnabled = false;
  const k = px / Math.max(im.width, im.height) * 1.12;
  c.drawImage(im, (px - im.width * k) / 2, (px - im.height * k) / 2 - px * 0.06, im.width * k, im.height * k);
  return cv.toDataURL();
}

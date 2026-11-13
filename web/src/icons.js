// The game's own icons (instead of the system emoji, which look different and cheap on every computer):
// thin gold lines on the red theme, plus three medals. Static strings: never built from viewer text.

const line = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const ICONS = {
  star: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor"
    d="M12 2.2l2.6 7.1h7.5l-6.1 4.5 2.3 7.3L12 16.6l-6.3 4.5 2.3-7.3-6.1-4.5h7.5z"/></svg>`,
  // waiting gifts
  hourglass: line(`<path d="M6 3h12M6 21h12"/><path d="M7 3c0 5 5 6 5 9s-5 4-5 9"/><path d="M17 3c0 5-5 6-5 9s5 4 5 9"/>
    <path d="M9.5 18.5h5" stroke-width="2.4"/>`),
  chat: line(`<path d="M4 5.5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4.5 3.5V16.5H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z"/>
    <path d="M7.5 10.5h9M7.5 13.5h5.5"/>`),
  gift: line(`<rect x="3.5" y="9" width="17" height="4" rx=".8"/><path d="M5 13v7.5h14V13M12 9v11.5"/>
    <path d="M12 9c-1-3.5-5.5-4.5-5.5-2s3.5 2 5.5 2zM12 9c1-3.5 5.5-4.5 5.5-2s-3.5 2-5.5 2z"/>`),
  // what a fact is about
  food: line(`<path d="M3 12h18c0 4.5-4 7.5-9 7.5S3 16.5 3 12z"/><path d="M9 21h6"/>
    <path d="M14 3l5 6.5M17.5 2.5l3 7"/><path d="M8 9c-.8-1 .8-2 0-3M11 9c-.8-1 .8-2 0-3"/>`),
  places: line(`<path d="M2.5 19.5l6-9 4 5.5 3-4 6 7.5z"/><circle cx="17.5" cy="6" r="2"/>`),
  culture: line(`<path d="M12 2.5v2.5M9 5h6"/><path d="M8 5.5c-3.5 1.5-3.5 10 0 11.5h8c3.5-1.5 3.5-10 0-11.5z"/>
    <path d="M12 5.5v11.5M8.5 6.5c-1.2 3-1.2 6.7 0 9.5M15.5 6.5c1.2 3 1.2 6.7 0 9.5M10 17v2.5l2 1.5 2-1.5V17"/>`),
  history: line(`<path d="M2.5 9.5L12 4l9.5 5.5"/><path d="M4 9.5c2 .8 14 .8 16 0"/><path d="M5.5 11v8M9.5 11v8M14.5 11v8M18.5 11v8"/>
    <path d="M3 20.5h18"/>`),
  facts: line(`<path d="M2 15c2.5-2 4.5-2 7 0s4.5 2 7 0 4.5-2 6 0"/><path d="M2 19c2.5-2 4.5-2 7 0s4.5 2 7 0 4.5-2 6 0"/>
    <path d="M8 11l3-6 3 6M8.5 11h5"/>`),
  quiz: line(`<circle cx="12" cy="12" r="9"/><path d="M9.5 9.6a2.6 2.6 0 1 1 3.6 2.4c-.8.4-1.1.9-1.1 1.8"/><path d="M12 16.6v.4"/>`),
  heart: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor"
    d="M12 20.5s-7.5-4.6-9.2-9.4C1.7 7.9 3.6 4.5 7 4.5c2.1 0 3.6 1.2 5 3 1.4-1.8 2.9-3 5-3 3.4 0 5.3 3.4 4.2 6.6-1.7 4.8-9.2 9.4-9.2 9.4z"/></svg>`,
  share: line(`<path d="M14 4.5l6.5 6-6.5 6v-3.6c-5 0-8.2 1.6-10.5 5.1.8-5.5 3.9-9.4 10.5-10.1z"/>`),
  follow: line(`<circle cx="9.5" cy="8" r="3.5"/><path d="M3 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M18.5 8v6M15.5 11h6"/>`),
  pride: null,   // the star
  // ---- full-colour emblems of this game (flat shapes, the same hand as the characters on the field) ----
  // the village: a straw cone hat over two rice ears
  hat: `<svg viewBox="0 0 48 48" aria-hidden="true">
    <circle cx="24" cy="24" r="23" fill="#0c4a42"/><circle cx="24" cy="24" r="23" fill="none" stroke="#2fd3b9" stroke-width="2"/>
    <path d="M13 37c1-7 4-11 7-13M35 37c-1-7-4-11-7-13" fill="none" stroke="#e9d86a" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M12 33l3-1M11.6 29l3 .4M36 33l-3-1M36.4 29l-3 .4" stroke="#e9d86a" stroke-width="2" stroke-linecap="round"/>
    <path d="M5.5 28.5L24 9l18.5 19.5c-5 3.2-11.400 4.600-18.5 4.600S10.500 31.700 5.500 28.500z" fill="#f2dc8a"/>
    <path d="M24 9l18.5 19.5c-5 3.2-11.400 4.600-18.5 4.600z" fill="#d9bd5c"/>
    <path d="M24 9L14 31.500M24 9l10 22.500M24 9v24" stroke="#b8963c" stroke-width="1" opacity=".7"/>
    <path d="M5.500 28.500c5 3.200 11.400 4.600 18.500 4.600s13.500-1.400 18.500-4.600" fill="none" stroke="#a8842c" stroke-width="1.600"/></svg>`,
  // the camp: an iron helmet over two crossed swords
  helm: `<svg viewBox="0 0 48 48" aria-hidden="true">
    <circle cx="24" cy="24" r="23" fill="#5a1f08"/><circle cx="24" cy="24" r="23" fill="none" stroke="#ff8a4d" stroke-width="2"/>
    <path d="M9 40L33 14M39 40L15 14" stroke="#e6ecf2" stroke-width="3.200" stroke-linecap="round"/>
    <path d="M9 40l4-4M39 40l-4-4" stroke="#ffd54a" stroke-width="4.400" stroke-linecap="round"/>
    <path d="M11.500 28c0-9 5.500-15 12.500-15s12.500 6 12.500 15v2h-25z" fill="#aeb7c2"/>
    <path d="M24 13c7 0 12.500 6 12.500 15v2H24z" fill="#7d8794"/>
    <rect x="9.500" y="28.500" width="29" height="4.200" rx="1.600" fill="#5d6672"/>
    <path d="M22 30.500h4v8l-2 2-2-2z" fill="#5d6672"/>
    <path d="M24 13V7" stroke="#f0692d" stroke-width="3" stroke-linecap="round"/><circle cx="24" cy="6" r="2.600" fill="#ff8a4d"/></svg>`,
  // the village hall: a red roof with turned-up corners
  hall: `<svg viewBox="0 0 48 48" aria-hidden="true">
    <rect x="8" y="36" width="32" height="5" rx="1.500" fill="#b9a983"/>
    <rect x="11" y="24" width="26" height="13" fill="#8a3a22"/>
    <rect x="12.500" y="24" width="3" height="13" fill="#6e2b18"/><rect x="32.500" y="24" width="3" height="13" fill="#6e2b18"/>
    <path d="M20 37V29a4 4 0 0 1 8 0v8z" fill="#3d1a0e" stroke="#ffd54a" stroke-width="1"/>
    <path d="M2.500 26.500C9 24.500 12.500 19 14 11h20c1.500 8 5 13.500 11.500 15.500-7-2-36-2-43 0z" fill="#b2452a"/>
    <path d="M24 11h10c1.500 8 5 13.500 11.500 15.500-3.500-1-12.500-1.500-21.500-1.500z" fill="#8c3520"/>
    <rect x="13" y="8.500" width="22" height="3.200" rx="1" fill="#ffd54a"/><circle cx="24" cy="7.500" r="3" fill="#ffd54a"/>
    <path d="M2.500 26.500c-1.500-1-2-3-1.500-5M45.500 26.500c1.500-1 2-3 1.500-5" fill="none" stroke="#ffd54a" stroke-width="1.800" stroke-linecap="round"/></svg>`,
  crown: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 8.500l4.500 4L12 5l4.500 7.500 4.500-4-1.800 9.500H4.800z" fill="#ffd54a" stroke="#a8751a" stroke-width="1" stroke-linejoin="round"/>
    <rect x="4.600" y="18.600" width="14.800" height="2.400" rx="1" fill="#e6a91c"/>
    <circle cx="12" cy="13.500" r="1.500" fill="#ff5a4d"/></svg>`,
  quizmark: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2a10 10 0 0 1 8.700 14.900L22 22l-5.300-1.200A10 10 0 1 1 12 2z" fill="#ffd54a"/>
    <path d="M9.300 9.300a2.800 2.800 0 1 1 3.900 2.600c-.900.400-1.200 1-1.200 2" fill="none" stroke="#3a2a05" stroke-width="2.200" stroke-linecap="round"/>
    <circle cx="12" cy="17" r="1.300" fill="#3a2a05"/></svg>`,
};

/** Fills every <span data-icon="name"> of the page (the static emblems of index.html). */
export function mountIcons(root = document) {
  for (const n of root.querySelectorAll("[data-icon]")) {
    const name = n.dataset.icon === "quiz" ? "quizmark" : n.dataset.icon;
    if (ICONS[name]) { n.innerHTML = ICONS[name]; n.classList.add("ic"); }
  }
}


const METALS = {
  1: ["#fff0a0", "#e6a91c", "#7a4a00"],
  2: ["#ffffff", "#b5bcc8", "#3c4250"],
  3: ["#ffd2a6", "#c27a3a", "#4a2208"],
};

/** A medal for rank 1, 2 or 3. */
function medal(n) {
  const [a, b, ink] = METALS[n] || METALS[3];
  return `<svg viewBox="0 0 24 24" aria-hidden="true">
    <defs><linearGradient id="md${n}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
    <path d="M6.5 1.5h4.2l2 6.2-3.4 1.6z" fill="#c8102e"/><path d="M17.5 1.5h-4.2l-2 6.2 3.4 1.6z" fill="#9e0b22"/>
    <circle cx="12" cy="15" r="7.2" fill="url(#md${n})" stroke="rgba(255,255,255,.65)" stroke-width=".8"/>
    <circle cx="12" cy="15" r="5.4" fill="none" stroke="${ink}" stroke-opacity=".35" stroke-width=".7"/>
    <text x="12" y="18.3" text-anchor="middle" font-family="Be Vietnam Pro, Segoe UI, sans-serif" font-size="9.5"
      font-weight="800" fill="${ink}">${n}</text></svg>`;
}

/** An icon element: icon("gift"), icon("medal", 2). */
export function icon(name, arg) {
  const s = document.createElement("span");
  s.className = `ic ic-${name}`;
  s.innerHTML = name === "medal" ? medal(arg) : ICONS[name] || ICONS.star;
  return s;
}

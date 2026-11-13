"""Where things are kept, and the settings of the game.

  %APPDATA%\\TikTokGiuThanh\\settings.json   channel, match length, voice (kept on update / reinstall)
  %APPDATA%\\TikTokGiuThanh\\state.json      the session in progress: players, levels, matches (a restart goes on)
  %APPDATA%\\TikTokGiuThanh\\backups\\       the sessions before a "Phiên mới" (the last 20)
  %APPDATA%\\TikTokGiuThanh\\tts\\           the voice of lines already said (said again without asking again)

Nothing of the map game (%APPDATA%\\MapLive, or %APPDATA%\\TikTokMapLive, its name until 0.2.9) is ever written. Only
its voice model is read when it is there
(the same VieNeu model, about 580 MB: not downloaded a second time).
"""
from __future__ import annotations

import json
import os
import re
import sys
import tempfile
import threading
import time
from pathlib import Path

VERSION = "0.4.0"   # raise it with every build given to the user: the control window shows it
APP = "TikTokGiuThanh"
TITLE = "Giữ thành"
PORT = 8767
HUB_PORT = 8765

_ROAMING = Path(os.environ.get("APPDATA") or Path.home())
DATA_DIR = Path(os.environ.get("TIKTOKGIUTHANH_HOME") or _ROAMING / APP)
SETTINGS_FILE = DATA_DIR / "settings.json"
STATE_FILE = DATA_DIR / "state.json"
BACKUP_DIR = DATA_DIR / "backups"
TTS_DIR = DATA_DIR / "tts"
KEEP_BACKUPS = 20


def _hf_dir() -> Path:
    """The VieNeu voice model: this game's own folder, or the map game's when it already has the model."""
    own = DATA_DIR / "hf"
    # the map game's data folder: MapLive, or TikTokMapLive (its first name) on a computer that had it before
    shared = next((p for p in (_ROAMING / "MapLive" / "hf", _ROAMING / "TikTokMapLive" / "hf") if p.exists()),
                  _ROAMING / "MapLive" / "hf")
    forced = os.environ.get("TIKTOKGIUTHANH_HF")       # a development run: read the model where it already is
    if forced and Path(forced).exists():
        return Path(forced)
    # the map game's folder is only READ: taken when a model is really in it. (An empty or half-made folder there
    # would have received this game's 580 MB download: nothing of the map game is ever written.)
    has_model = shared.exists() and any((shared / "hub").glob("models--*"))
    if os.environ.get("TIKTOKGIUTHANH_HOME") or own.exists() or not has_model:
        return own
    return shared


HF_DIR = _hf_dir()

DEFAULTS = {
    "channel": "",
    "matchMs": 240_000,   # one match (trận): the village holds this long, or the attackers bring the hall down
    "seriesMatches": 5,   # matches in a series (loạt): then the overall result, and match 1 again
    "speech": True,
    "voice": "vieneu:Adam bựa",
    "rate": 0,            # percent, -50..+50
    "volume": 1.0,
    "sound": True,        # sound effects (no background music: the streamer plays their own)
    "sfx": 0.6,           # 0..1
    # points of a viewer's own character: joining a team (once per session), how many likes make 1 point,
    # per coin of a gift, per share, a follow (once ever), a right quiz answer
    "points": {"comment": 0, "likes": 20, "coin": 5, "share": 1, "follow": 2, "quiz": 10},
    "quiz": True,         # a question every 35 s, answered by comment (đố vui)
    "legend": True,       # the two small rows at the bottom of the screen: what each item calls onto the field
    # what was last typed / chosen in the test boxes of the control window (remembered between launches)
    "controls": {},
}
EDGE_VOICES = {"vi-VN-HoaiMyNeural", "vi-VN-NamMinhNeural"}
# VieNeu-TTS v3 Turbo (Apache 2.0, on this computer, CPU): its preset voices, "vieneu:<name>" in the settings.
# (name, male, region) - the male/female tells which Edge voice stands in while VieNeu is not ready
VIENEU_VOICES = [
    ("Adam bựa", True, "Bắc"), ("Adam", True, "Nam"), ("Hải Đăng", True, "Bắc"), ("Thiện Minh", True, "Bắc"),
    ("Minh Đức", True, "Bắc"), ("Phạm Tuyên", True, "Bắc"), ("Xuân Vĩnh", True, "Bắc"), ("Thanh Bình", True, "Bắc"),
    ("Quốc Tuấn", True, "Bắc"), ("Thiền Tâm Đức", True, "Bắc"), ("Quang Sơn", True, "Trung"), ("Thái Sơn", True, "Nam"),
    ("Minh Triết", True, "Nam"), ("Đức Trí", True, "Nam"),
    ("Trúc Ly", False, "Bắc"), ("Mai Anh", False, "Bắc"), ("Ngọc Huyền", False, "Bắc"), ("Ngọc Linh", False, "Bắc"),
    ("Đoan Trang", False, "Bắc"), ("Quỳnh Anh", False, "Bắc"), ("Ngọc Trân", False, "Trung"), ("Thùy Dung", False, "Nam"),
    ("Thục Đoan", False, "Nam"), ("Mỹ Duyên", False, "Nam"), ("Kim Thanh", False, "Nam"),
]
VOICES = EDGE_VOICES | {f"vieneu:{n}" for n, _, _ in VIENEU_VOICES}


def edge_stand_in(voice: str) -> str:
    """The Edge voice that speaks while a VieNeu voice is not ready (same gender)."""
    if voice in EDGE_VOICES:
        return voice
    male = next((m for n, m, _ in VIENEU_VOICES if f"vieneu:{n}" == voice), True)
    return "vi-VN-NamMinhNeural" if male else "vi-VN-HoaiMyNeural"


_lock = threading.Lock()


def web_dir() -> Path:
    """The built pages (web/dist): next to the code, or inside the exe."""
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent.parent))
    return base / "web" / "dist"


def clean_voice(voice) -> str:
    return voice if voice in VOICES else DEFAULTS["voice"]


def write_atomic(path: Path, text: str) -> None:
    """Never leave half a file (the app can be closed or the power cut while it writes)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=path.name, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())     # on the disk before it takes the old file's place (a power cut right after the
            #                          rename could otherwise leave the new name with nothing in it)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))   # utf-8-sig: a file saved by Notepad may start with a BOM
    except (OSError, ValueError):
        return default


def _int(value, default: int, low: int, high: int) -> int:
    try:
        return int(min(high, max(low, int(value))))
    except (TypeError, ValueError, OverflowError):      # OverflowError: 1e999 in a file edited by hand
        return default


def clean_channel(name) -> str:
    """The TikTok ID as the hub names a channel (hub/config.py clean_channel): lower case, from what people type or
    paste: "kenh", "@Kenh ", "https://www.tiktok.com/@Kenh/live". The hub's events carry that name and the game
    compares with it: kept as typed, one capital or a pasted link threw every comment away while the hub showed them
    coming in (seen in the map game, 11/11/2026). The page does the same (web/src/game/channel.js)."""
    s = str(name or "").strip()
    m = re.search(r"tiktok\.com/@([^/?#\s]+)", s, re.I)
    if m:
        s = m.group(1)
    return s.lstrip("@").strip().rstrip("/").lower()[:64]


def clean_settings(s: dict) -> dict:
    if not isinstance(s, dict):      # a settings.json holding null, a number, a text (edited by hand): the defaults
        s = {}
    out = dict(DEFAULTS)
    for k in DEFAULTS:
        if k in s:
            out[k] = s[k]
    out["channel"] = clean_channel(out["channel"])
    out["matchMs"] = _int(out["matchMs"], DEFAULTS["matchMs"], 60_000, 900_000)
    out["seriesMatches"] = _int(out["seriesMatches"], DEFAULTS["seriesMatches"], 1, 50)
    out["speech"] = bool(out["speech"])
    out["voice"] = clean_voice(out["voice"])
    out["rate"] = _int(out["rate"], 0, -50, 50)
    for k in ("volume", "sfx"):
        try:
            out[k] = float(min(1.0, max(0.0, float(out[k]))))
        except (TypeError, ValueError):
            out[k] = DEFAULTS[k]
    out["sound"] = bool(out["sound"])
    out["quiz"] = bool(out["quiz"])
    out["legend"] = bool(out["legend"])
    pts = dict(DEFAULTS["points"])
    for k, v in (out.get("points") if isinstance(out.get("points"), dict) else {}).items():
        if k in pts:
            pts[k] = _int(v, pts[k], 1 if k == "likes" else 0, 1000)
    out["points"] = pts
    ctl = out.get("controls") if isinstance(out.get("controls"), dict) else {}
    out["controls"] = {str(k)[:40]: str(v)[:200] for k, v in list(ctl.items())[:30]}
    return out


def load_settings() -> dict:
    return clean_settings(read_json(SETTINGS_FILE, {}))


def save_settings(s: dict) -> dict:
    s = clean_settings(s)
    with _lock:
        write_atomic(SETTINGS_FILE, json.dumps(s, ensure_ascii=False, indent=2))
    return s


def update_settings(part: dict) -> dict:
    """Only what changed is sent (a window with older values never puts them back); points and boxes are merged."""
    with _lock:
        cur = load_settings()
        for k, v in part.items():
            if k in ("points", "controls") and isinstance(v, dict):
                cur[k] = {**cur.get(k, {}), **v}
            else:
                cur[k] = v
        s = clean_settings(cur)
        write_atomic(SETTINGS_FILE, json.dumps(s, ensure_ascii=False, indent=2))
    return s


def reset_settings() -> dict:
    """Everything back to the defaults, except the channel."""
    return save_settings({"channel": load_settings()["channel"]})


def load_state():
    return read_json(STATE_FILE, None)


SESSION_ID = re.compile(r"[A-Za-z0-9_-]{1,40}")      # as the page makes it (letters and digits): it goes into a file name
STATE_PARTS = ("session", "match", "users")          # what the page cannot start without (web/src/game/rules.js)


def session_id(state) -> str:
    """The id of a saved session, or "" when it has none that may be part of a file name. It comes from a request:
    taken as it was, "x/../../y" wrote the backup anywhere on the disk."""
    session = state.get("session") if isinstance(state, dict) else None
    sid = session.get("id") if isinstance(session, dict) else None
    return sid if isinstance(sid, str) and SESSION_ID.fullmatch(sid) else ""


def check_state(state) -> None:
    """Refuses what is not a session of this game. A state without its parts, once saved, stopped the page at its
    next start ("Lỗi khởi động"), and every later save with it."""
    if not isinstance(state, dict) or state.get("v") != 1 or state.get("game") != "giuthanh":
        raise ValueError("not a game state")
    for part in STATE_PARTS:
        if not isinstance(state.get(part), dict):
            raise ValueError(f"not a game state: {part}")
    if not session_id(state):
        raise ValueError("not a game state: session id")


def _keep_old(old, raw_file: bool) -> None:
    """The session about to be replaced, kept in backups/ (the last KEEP_BACKUPS)."""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    if raw_file:        # a state.json nothing can read (cut short, edited by hand): kept as it is, to be looked at
        (BACKUP_DIR / f"{stamp}-khong-doc-duoc.json").write_bytes(STATE_FILE.read_bytes())
    else:
        write_atomic(BACKUP_DIR / f"{stamp}-{session_id(old)}.json", json.dumps(old, ensure_ascii=False))
    for f in sorted(BACKUP_DIR.glob("*.json"))[:-KEEP_BACKUPS]:
        f.unlink(missing_ok=True)


def save_state(state: dict) -> None:
    """Saves the session. When a new session replaces another, the old one is kept in backups/ first."""
    check_state(state)
    with _lock:
        old = read_json(STATE_FILE, None)
        unreadable = STATE_FILE.exists() and not session_id(old)
        try:
            if unreadable or session_id(old) != session_id(state):
                _keep_old(old, raw_file=unreadable)
        except OSError:
            pass        # the copy could not be written (disk full, a file held by another program): the session that
            #             goes on is saved all the same; losing it for the sake of the one before would be worse
        write_atomic(STATE_FILE, json.dumps(state, ensure_ascii=False))

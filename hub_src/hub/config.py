"""Hub settings (config.json) and where they live.

  %APPDATA%\\TikTokLiveHub\\config.json   normally: kept when the app is rebuilt or updated, shared by the exe and
                                         the source version
  config.json next to the exe            "portable" (a copy of the folder carried to another computer): used as is

Proxy keys, proxy passwords and the Euler key are encrypted with Windows DPAPI: readable only by this Windows user
on this computer. A config.json copied elsewhere loads without them (to be entered again, or brought over with
"Xuất cấu hình" / "Nhập cấu hình", which write and read them in clear).
"""
from __future__ import annotations

import base64
import copy
import json
import os
import re
import secrets
import sys
from pathlib import Path

VERSION = "0.2.6"
APP = "TikTokLiveHub"
SECRET_PREFIX = "dpapi:"


def exe_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[1]


def resource_dir() -> Path:
    """Read-only files shipped with the app (web/)."""
    base = getattr(sys, "_MEIPASS", None)
    return Path(base) / "hub" if base else Path(__file__).resolve().parent


def data_dir() -> Path:
    portable = exe_dir() / "config.json"
    if getattr(sys, "frozen", False) and portable.exists():
        return exe_dir()
    if os.environ.get("APPDATA"):
        return Path(os.environ["APPDATA"]) / APP
    # a Mac has no %APPDATA%: ~/Library/Application Support
    return (Path.home() / "Library" / "Application Support" if sys.platform == "darwin" else Path.home()) / APP


PORTABLE = getattr(sys, "frozen", False) and (exe_dir() / "config.json").exists()
CONFIG_FILE = data_dir() / "config.json"
LOG_DIR = data_dir() / "logs"
LEGACY = [Path(__file__).resolve().parents[1] / "config.json"] if not getattr(sys, "frozen", False) else []
LOAD_WARNINGS: list[str] = []   # said by the hub once it starts (a key that could not be read here, ...)

PROXY_DEFAULT = {"name": "", "type": "HTTP", "proxy": "", "user": "", "password": "", "key": "", "rotate_url": "",
                 "proxy_at": "", "rotated_at": 0, "expires_at": 0}

DEFAULT = {
    "port": 8765,
    "token": "",                  # control actions (watch, simulate) from pages that are not the hub's own
    "allowed_origins": [],        # extra web origins allowed to connect, besides localhost / 127.0.0.1 / file://
    "channels": [],               # watched from the start
    "proxies": [],                # 1 or more
    # True: everything to TikTok goes through the proxies, never the home network. False: straight from this
    # computer, no proxy. Not chosen yet (None): through the proxies when there are some, else straight.
    "use_proxy": None,
    "proxies_per_channel": 2,     # links per channel when the hub chooses (2 = one can change IP, the other goes on)
    "channel_proxies": {},        # channel -> [proxy names] chosen by hand (the others: chosen by the hub)
    "rotate_min_interval_s": 60,  # between two requests for a new IP, per key
    "rotate_at_expiry": True,     # the provider tells when the IP dies ("die sau 1265s"): take a new one right then
    "sign_api_key": "",           # Euler key (free); empty = the anonymous quota, per proxy IP
    "buffer_events": 20000,       # kept per channel, sent again to a game that reconnects with "since"
}
SECRET_FIELDS = ("key", "password")


class ConfigError(ValueError):
    pass


CHANNEL = re.compile(r"^[a-z0-9._]{2,24}$")


def clean_channel(name) -> str:
    """A TikTok ID from what people type or paste: "kenh", "@Kenh", "https://www.tiktok.com/@kenh/live".
    Also a file name for the log: anything else is refused (ValueError)."""
    s = str(name or "").strip()
    m = re.search(r"tiktok\.com/@([^/?#\s]+)", s, re.I)
    if m:
        s = m.group(1)
    s = s.lstrip("@").strip().rstrip("/").lower()
    if not CHANNEL.match(s):
        raise ValueError(f"\"{name}\" không phải ID kênh TikTok (chữ, số, dấu chấm, gạch dưới; 2–24 ký tự)")
    return s


def _clean_list(names) -> list:
    out = []
    for n in names or []:
        try:
            c = clean_channel(n)
        except ValueError:
            continue
        if c not in out:
            out.append(c)
    return out


# ---------- DPAPI (Windows) ----------
def _dpapi(data: bytes, protect: bool) -> bytes:
    import ctypes
    from ctypes import wintypes

    class BLOB(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]

    crypt32, kernel32 = ctypes.windll.crypt32, ctypes.windll.kernel32
    buf = ctypes.create_string_buffer(data, len(data))
    src = BLOB(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)))
    out = BLOB()
    fn = crypt32.CryptProtectData if protect else crypt32.CryptUnprotectData
    fn.argtypes = [ctypes.POINTER(BLOB), ctypes.c_void_p if not protect else wintypes.LPCWSTR, ctypes.c_void_p,
                   ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(BLOB)]
    fn.restype = wintypes.BOOL
    ok = fn(ctypes.byref(src), APP if protect else None, None, None, None, 0x1, ctypes.byref(out))  # UI_FORBIDDEN
    if not ok:
        raise OSError("DPAPI")
    try:
        return ctypes.string_at(out.pbData, out.cbData)
    finally:
        kernel32.LocalFree(out.pbData)


def protect(value: str) -> str:
    if not value or sys.platform != "win32":
        return value
    return SECRET_PREFIX + base64.b64encode(_dpapi(value.encode("utf-8"), True)).decode()


def unprotect(value: str) -> str:
    """Raises ValueError when it was encrypted on another computer / Windows user."""
    if not isinstance(value, str) or not value.startswith(SECRET_PREFIX):
        return value or ""
    try:
        return _dpapi(base64.b64decode(value[len(SECRET_PREFIX):]), False).decode("utf-8")
    except (OSError, ValueError) as e:
        raise ValueError("không giải mã được trên máy này") from e


# ---------- load / save ----------
def normalize(cfg: dict) -> dict:
    out = {**DEFAULT, **cfg}
    proxies = []
    for i, p in enumerate(out.get("proxies") or []):
        q = {**PROXY_DEFAULT, **p}
        q["name"] = q["name"] or f"proxy{i + 1}"
        q["type"] = "SOCKS5" if str(q["type"]).upper() == "SOCKS5" else "HTTP"
        proxies.append(q)
    out["proxies"] = proxies
    out["use_proxy"] = bool(proxies) if out.get("use_proxy") is None else bool(out["use_proxy"])
    out["channels"] = _clean_list(out.get("channels"))
    out["channel_proxies"] = {c: list(v) for k, v in (out.get("channel_proxies") or {}).items() if v
                              for c in _clean_list([k])}
    out["proxies_per_channel"] = max(1, int(out.get("proxies_per_channel") or 2))
    if not out["token"]:
        out["token"] = secrets.token_urlsafe(18)
    return out


def check(cfg: dict) -> None:
    """Refuse settings that would break the rules: two proxies on one key die together, and rotating one
    would kill the other's fresh IP."""
    keys = {}
    for p in cfg["proxies"]:
        if p["key"]:
            if p["key"] in keys:
                raise ConfigError(f"{p['name']} và {keys[p['key']]} dùng chung một key: hai proxy phải là hai key khác nhau")
            keys[p["key"]] = p["name"]
    names = [p["name"] for p in cfg["proxies"]]
    if len(set(names)) != len(names):
        raise ConfigError("Hai proxy trùng tên")


def decrypt(data: dict, warnings: list) -> dict:
    data = copy.deepcopy(data)
    for p in data.get("proxies") or []:
        for f in SECRET_FIELDS:
            try:
                p[f] = unprotect(p.get(f, ""))
            except ValueError:
                p[f] = ""
                warnings.append(f"{p.get('name', 'proxy')}: {'key' if f == 'key' else 'mật khẩu'} được lưu ở máy khác, "
                                "không đọc được ở đây: nhập lại ở tab Proxy (hoặc Nhập cấu hình)")
    try:
        data["sign_api_key"] = unprotect(data.get("sign_api_key", ""))
    except ValueError:
        data["sign_api_key"] = ""
        warnings.append("sign_api_key được lưu ở máy khác: nhập lại ở tab Cài đặt")
    return data


def encrypt(cfg: dict) -> dict:
    out = copy.deepcopy(cfg)
    for p in out["proxies"]:
        for f in SECRET_FIELDS:
            p[f] = protect(p.get(f, ""))
    out["sign_api_key"] = protect(out.get("sign_api_key", ""))
    return out


def _migrate(path: Path) -> None:
    """The first versions kept config.json next to the code (source version): bring it over once."""
    if path.exists() or path != CONFIG_FILE:
        return
    for old in LEGACY:
        if old.exists():
            try:
                data = json.loads(old.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            save(normalize(decrypt(data, [])), path)
            old.replace(old.with_name("config.migrated.json"))
            LOAD_WARNINGS.append(f"đã chuyển cấu hình cũ ({old}) sang {path}")
            return


def port_of(cfg: dict) -> int:
    """The port of this run: --port when given (not saved), else the saved one."""
    return int(cfg.get("_port") or cfg["port"])


def load(path: Path = CONFIG_FILE) -> dict:
    _migrate(path)
    data = {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        pass
    except ValueError as e:
        raise ConfigError(f"{path} không đọc được: {e}") from e
    cfg = normalize(decrypt(data, LOAD_WARNINGS))
    check(cfg)
    return cfg


def save(cfg: dict, path: Path = CONFIG_FILE) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    # keys starting with "_" belong to this run only (e.g. _port from --port): never saved
    data = {k: v for k, v in encrypt(cfg).items() if not k.startswith("_")}
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


# ---------- other computers, other apps ----------
EXPORT_FIELDS = ("channels", "proxies_per_channel", "channel_proxies", "sign_api_key", "rotate_min_interval_s",
                 "rotate_at_expiry", "port", "allowed_origins", "use_proxy")


def export(cfg: dict) -> dict:
    """Everything needed on another computer, keys in clear (the file must be kept private)."""
    out = {"tiktok_live_hub": VERSION, **{k: cfg[k] for k in EXPORT_FIELDS}}
    out["proxies"] = [{k: p[k] for k in ("name", "type", "proxy", "user", "password", "key", "rotate_url")} for p in cfg["proxies"]]
    return out


def read_import_file(path) -> dict:
    """A hub export ({"tiktok_live_hub": ..., "proxies": [...]}) or one proxy from the config file
    of another app. Returns {"proxies": [...], "settings": {...}}."""
    try:
        c = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise ValueError(f"không đọc được {path}: {e}") from e
    if not isinstance(c, dict):
        raise ValueError(f"{path} không phải file cấu hình proxy (cần một object JSON)")
    if isinstance(c.get("proxies"), list):
        c = decrypt(c, [])
        return {"proxies": [_proxy_fields(p) | {"name": str(p.get("name") or "")} for p in c["proxies"]],
                "settings": {k: c[k] for k in EXPORT_FIELDS if k in c and k != "port"}}
    p = c.get("proxy") if isinstance(c.get("proxy"), dict) else c
    return {"proxies": [_proxy_fields(p)], "settings": {}}


def _proxy_fields(p: dict) -> dict:
    return {
        "type": "SOCKS5" if str(p.get("type", "")).upper() == "SOCKS5" else "HTTP",
        "proxy": str(p.get("proxy") or "").strip(),
        "user": str(p.get("user") or "").strip(),
        "password": str(p.get("password") or ""),
        "key": str(p.get("key") or "").strip(),
        "rotate_url": str(p.get("rotate_url") or "").strip(),
    }


def read_external_proxy(path) -> dict:
    """One proxy from another app's config (kept for the command line --import)."""
    return read_import_file(path)["proxies"][0]

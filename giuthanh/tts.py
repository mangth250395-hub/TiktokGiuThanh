"""Text to speech for the commentator.

VieNeu-TTS v3 Turbo (the user's choice, 10/11/2026: "Adam bựa"): Vietnamese voices made on this computer (CPU,
ONNX Runtime, Apache 2.0), about 2-3 s for a long line, nothing online, no rate limit. Its model (about 580 MB) is in
%APPDATA%\\TikTokGiuThanh\\hf: read from there, downloaded once when it is missing. Loading takes some seconds at start;
meanwhile, or if it fails, the line is said by the Edge voice of the same gender (edge-tts, online), so the live is
never silent.

Each line is made once and kept in %APPDATA%\\TikTokGiuThanh\\tts: the same line said again costs nothing and starts
at once. The page asks for the next line in advance (prefetch), so most lines are ready when their turn comes.
VieNeu has no speed setting: the page plays its lines faster or slower (the rate setting, pitch kept).
(OmniVoice was tried and removed on 2026-11-10: it made the app several GB and its licence is non-commercial.)
"""
from __future__ import annotations

import asyncio
import hashlib
import os
import threading
import time
from pathlib import Path

from . import config as C

# the model's folder: set before huggingface_hub is first imported (it reads these once)
os.environ.setdefault("HF_HOME", str(C.HF_DIR))
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

MAX_CHARS = 400
KEEP_FILES = 3000
SAMPLE_RATE = 48_000

_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def _lock_for(key: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(key, threading.Lock())


def _say(msg: str) -> None:
    try:
        from .server import say
        say(msg)
    except Exception:  # noqa: BLE001 - no log: nothing to do
        pass


# ---------- VieNeu ----------
_vn = {"state": "off", "model": None, "error": "", "at": 0.0}
_vn_guard = threading.Lock()
_vn_run = threading.Lock()      # one line at a time: the engine uses the CPU cores itself


def vieneu_state() -> dict:
    """off / loading / ready / failed, and the error when it failed (shown in the control window)."""
    return {"state": _vn["state"], "error": _vn["error"]}


def start_vieneu() -> None:
    """Load the VieNeu model in the background (once; again after a failure, at most every 2 minutes)."""
    with _vn_guard:
        if _vn["state"] in ("loading", "ready"):
            return
        if _vn["state"] == "failed" and time.time() - _vn["at"] < 120:
            return
        _vn["state"], _vn["at"] = "loading", time.time()
    threading.Thread(target=_load, name="vieneu", daemon=True).start()


def _load() -> None:
    t0 = time.time()
    try:
        C.HF_DIR.mkdir(parents=True, exist_ok=True)
        import huggingface_hub.constants as hfc
        from vieneu import Vieneu

        # always the CPU engine (ONNX, no PyTorch): with PyTorch and an NVIDIA card around, VieNeu would pick its GPU
        # engine, which downloads other models and runs code fetched from the Hub (seen 10/11/2026 in the dev venv)
        # leave CPU for the game window and the hub (the live must not stutter: "giật giật" on the user's other computer,
        # 10/11/2026). Measured: 8 threads make a line only 20% faster than 2, for twice the CPU (about 4 cores busy)
        kw = {"backend": "onnx", "device": "cpu", "threads": max(1, min(2, (os.cpu_count() or 4) // 4))}
        hfc.HF_HUB_OFFLINE = True                 # the files already here: no network at all
        try:
            model = Vieneu(**kw)
        except Exception as e:  # noqa: BLE001 - not here yet: download it once (about 580 MB)
            _say(f"[TTS] tải giọng VieNeu lần đầu (khoảng 580 MB)… ({type(e).__name__})")
            hfc.HF_HUB_OFFLINE = False
            model = Vieneu(**kw)
            hfc.HF_HUB_OFFLINE = True
        _vn.update(model=model, state="ready", error="", at=time.time())
        _say(f"[TTS] giọng VieNeu sẵn sàng sau {time.time() - t0:.0f} giây")
    except Exception as e:  # noqa: BLE001 - the Edge voice goes on
        _vn.update(state="failed", error=f"{type(e).__name__}: {e}"[:300], at=time.time())
        _say(f"[TTS] không mở được giọng VieNeu, dùng giọng Edge: {type(e).__name__}: {e}")


# The game died of a stack overflow (0xc00000fd) four times in a live on the user's other computer (10/11/2026,
# app.log): writing the OGG file (libvorbis) and the ONNX engine need more stack than a thread of the web server has,
# and a stack overflow ends the whole process at once. So the voice is made in one thread of its own, with a big
# stack, and the file is written in small blocks.
VOICE_STACK = 64 * 2**20        # a web server thread has 1 MB (Python refuses 256 MB)
WRITE_BLOCK = 4096              # frames per write

# The voice queue. The page asks for the line it says now (NOW) and, while it plays, for the line it expects next
# (AHEAD: often not said in the end, another line comes first). The engine makes one line at a time; on a slower
# computer it can fall behind (seen 10/11/2026 on the user's other computer: lines given up still made one after the
# other, every new line waiting behind them and timing out, the voice gone for good). So:
#   - a line to say now goes before any line asked ahead (and a line asked ahead and then asked now moves up)
#   - one line ahead at most: a newer one replaces it; it is not made when it waited longer than AHEAD_TTL_S
#   - a line nobody waits for any more (the page gave up) is not made
NOW, AHEAD = 0, 1
NOW_WAIT_S = 25                 # longer than this: the line is late, the Edge voice says it
AHEAD_WAIT_S = 20
AHEAD_TTL_S = 12


class _Job:
    __slots__ = ("key", "fn", "prio", "asked", "state", "waiters", "done", "value", "error")

    def __init__(self, key, fn, prio):
        self.key, self.fn, self.prio, self.asked = key, fn, prio, time.time()
        self.state, self.waiters, self.done, self.value, self.error = "queued", 0, threading.Event(), None, None


_cv = threading.Condition()
_heap: list = []
_pending: dict[str, _Job] = {}
_seq = [0]
_worker = [None]
_stats = {"lines": 0, "audio_s": 0.0, "make_s": 0.0, "dropped": 0, "late": 0, "slow_told": False}


def _ensure_worker() -> None:
    """The voice thread: its own, with a big stack (the OGG writer and the ONNX engine need more than 1 MB: the game
    died of a stack overflow, 0xc00000fd, four times in a live on the user's other computer, 10/11/2026)."""
    if _worker[0] is not None:
        return
    old = threading.stack_size()
    try:
        threading.stack_size(VOICE_STACK)
        t = threading.Thread(target=_voice_loop, name="voice", daemon=True)
        t.start()
    finally:
        threading.stack_size(old)
    _worker[0] = t


def _push(job: _Job) -> None:
    import heapq
    _seq[0] += 1
    heapq.heappush(_heap, (job.prio, _seq[0], job))


def _drop(job: _Job, why: str) -> None:
    job.state, job.error = "dropped", TimeoutError(why)
    _pending.pop(job.key, None)
    _stats["dropped"] += 1
    job.done.set()


def _next_job() -> _Job:
    import heapq
    with _cv:
        while True:
            while not _heap:
                _cv.wait()
            prio, _, job = heapq.heappop(_heap)
            if job.state != "queued" or prio != job.prio:
                continue                                  # moved up (pushed again) or already over
            if job.waiters <= 0:
                _drop(job, "không ai chờ câu này nữa")
            elif job.prio == AHEAD and time.time() - job.asked > AHEAD_TTL_S:
                _drop(job, "câu đọc trước đã cũ")
            else:
                job.state = "running"
                return job


def _voice_loop() -> None:
    while True:
        job = _next_job()
        try:
            job.value = job.fn()
        except BaseException as e:  # noqa: BLE001 - given back to whoever waits
            job.error = e
        with _cv:
            job.state = "done"
            _pending.pop(job.key, None)
        job.done.set()


def voice_job(key: str, fn, prio: int = NOW, timeout_s: float | None = None):
    """fn() made in the voice thread, once for the same key however many ask; gives back what it returns or raises.
    TimeoutError when it is not ready in time (it is then not made at all, unless someone else still waits)."""
    timeout_s = timeout_s if timeout_s is not None else (NOW_WAIT_S if prio == NOW else AHEAD_WAIT_S)
    with _cv:
        _ensure_worker()
        job = _pending.get(key)
        if job is None:
            job = _pending[key] = _Job(key, fn, prio)
            if prio == AHEAD:                             # one line ahead at most: the newest
                for other in list(_pending.values()):
                    if other is not job and other.prio == AHEAD and other.state == "queued":
                        _drop(other, "có câu đọc trước mới hơn")
            _push(job)
        elif prio < job.prio and job.state == "queued":
            job.prio = prio                               # asked ahead, now asked for real: it goes first
            _push(job)
        job.waiters += 1
        _cv.notify()
    try:
        if not job.done.wait(timeout_s):
            if prio == NOW:
                _stats["late"] += 1
            raise TimeoutError("giọng đọc quá lâu")
    finally:
        with _cv:
            job.waiters -= 1
    if job.error:
        raise job.error
    return job.value


def in_voice_thread(fn, timeout_s: float = 60):
    """Run fn() in the voice thread (one at a time, a big stack)."""
    return voice_job(f"call:{id(fn)}:{time.time()}", fn, NOW, timeout_s)


def write_ogg(path: Path, audio, rate: int = SAMPLE_RATE) -> None:
    """In small blocks: written at once, a long line overflowed the stack (reproduced: 60 s at once on 64 KB)."""
    import soundfile as sf
    with sf.SoundFile(str(path), "w", samplerate=rate, channels=1, format="OGG", subtype="VORBIS") as f:
        for i in range(0, len(audio), WRITE_BLOCK):
            f.write(audio[i:i + WRITE_BLOCK])


def voice_stats() -> str:
    """How fast this computer makes the voice (written in app.log every few minutes)."""
    n = _stats["lines"]
    if not n:
        return "giọng VieNeu: chưa làm câu nào"
    x = _stats["make_s"] / max(0.1, _stats["audio_s"])
    with _cv:
        waiting = sum(1 for j in _pending.values() if j.state == "queued")
    return (f"giọng VieNeu: {n} câu, làm mất {x:.2f} lần thời gian đọc, bỏ {_stats['dropped']} câu không cần,"
            f" {_stats['late']} câu trễ, đang chờ {waiting}")


def _note_speed(audio_s: float, make_s: float) -> None:
    _stats["lines"] += 1
    _stats["audio_s"] += audio_s
    _stats["make_s"] += make_s
    x = _stats["make_s"] / max(0.1, _stats["audio_s"])
    if _stats["lines"] >= 5 and x > 0.7 and not _stats["slow_told"]:
        _stats["slow_told"] = True
        _say(f"[TTS] máy này làm giọng VieNeu chậm (mất {x:.2f} lần thời gian đọc): bình luận viên có thể nói thưa hơn")


def _make_vieneu(text: str, name: str, out: Path, prio: int = NOW) -> Path:
    def make():
        if out.exists():
            return out
        t0 = time.time()
        with _vn_run:
            audio = _vn["model"].infer(text, voice=name)
        if audio is None or len(audio) < SAMPLE_RATE // 10:
            raise RuntimeError("VieNeu không tạo được âm thanh")
        _note_speed(len(audio) / SAMPLE_RATE, time.time() - t0)
        C.TTS_DIR.mkdir(parents=True, exist_ok=True)
        tmp = out.with_suffix(".part")
        write_ogg(tmp, audio)                     # small on disk, played by the page
        tmp.replace(out)
        return out
    if out.exists():
        return out
    voice_job(out.name, make, prio)
    _trim()
    return out


# ---------- Edge ----------
async def _make_edge(text: str, voice: str, rate: int, out: Path) -> None:
    import edge_tts

    tmp = out.with_suffix(".part")
    com = edge_tts.Communicate(text, voice, rate=f"{rate:+d}%")
    await com.save(str(tmp))
    if not tmp.exists() or tmp.stat().st_size < 500:
        tmp.unlink(missing_ok=True)
        raise RuntimeError("không nhận được giọng đọc")
    tmp.replace(out)


def cache_path(text: str, voice: str, rate: int, ext: str = ".mp3") -> Path:
    h = hashlib.sha1(f"{voice}|{rate}|{text}".encode("utf-8")).hexdigest()
    return C.TTS_DIR / f"{h}{ext}"


def _cached(out: Path, make) -> Path:
    if out.exists():
        return out
    with _lock_for(out.name):           # the page may ask twice at once (prefetch + play): make it once
        if out.exists():
            return out
        C.TTS_DIR.mkdir(parents=True, exist_ok=True)
        make(out)
    _trim()
    return out


def speak(text: str, voice: str, rate: int = 0, engine: str | None = None, ahead: bool = False) -> Path:  # noqa: ARG001
    """The audio of a line (made now, or taken from the cache): .ogg from VieNeu, .mp3 from Edge. ahead: the page asks
    for a line it may say next (made after the lines to say now; given up when the voice has no time for it)."""
    text = " ".join(str(text).split())[:MAX_CHARS]
    if not text:
        raise ValueError("empty")
    voice = C.clean_voice(voice)
    rate = int(max(-50, min(50, rate)))
    if voice.startswith("vieneu:"):
        name = voice.split(":", 1)[1]
        if _vn["state"] == "ready":
            try:
                return _make_vieneu(text, name, cache_path(text, voice, 0, ".ogg"), AHEAD if ahead else NOW)
            except TimeoutError:
                if ahead:
                    raise                     # asked ahead: nothing more (no Edge line for it)
                _say("[TTS] giọng VieNeu chưa kịp câu này: đọc bằng Edge")
            except Exception as e:  # noqa: BLE001 - this line by Edge instead
                _say(f"[TTS] VieNeu lỗi ({type(e).__name__}: {e}): câu này đọc bằng Edge")
        else:
            start_vieneu()
        # the page speeds VieNeu lines up itself (rate): the Edge stand-in is made at normal speed, or it would be twice
        edge = C.edge_stand_in(voice)
        return _cached(cache_path(text, edge, 0), lambda out: asyncio.run(asyncio.wait_for(_make_edge(text, edge, 0, out), timeout=20)))
    return _cached(cache_path(text, voice, rate), lambda out: asyncio.run(asyncio.wait_for(_make_edge(text, voice, rate, out), timeout=20)))


_trim_lock = threading.Lock()
PART_OLD_S = 600        # an unfinished file this old belongs to a line that failed (no network): nobody writes it any more


def _mtime(p: Path) -> float:
    try:
        return p.stat().st_mtime
    except OSError:      # removed by another thread meanwhile
        return 0.0


def _trim() -> None:
    """Keeps the newest KEEP_FILES lines, and removes what failed lines left behind. Called from several threads at
    once (the same line asked twice): one at a time, and a file that is already gone or held is nothing to stop for
    (it used to throw the finished line away)."""
    if not _trim_lock.acquire(blocking=False):
        return           # another thread is at it
    try:
        files = sorted([*C.TTS_DIR.glob("*.mp3"), *C.TTS_DIR.glob("*.ogg")], key=_mtime)
        old_parts = [p for p in C.TTS_DIR.glob("*.part") if time.time() - _mtime(p) > PART_OLD_S]
        for f in [*files[:-KEEP_FILES], *old_parts]:
            try:
                f.unlink(missing_ok=True)
            except OSError:
                pass
    except OSError:
        pass
    finally:
        _trim_lock.release()

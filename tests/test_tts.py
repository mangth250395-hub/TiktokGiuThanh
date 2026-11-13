"""Unit tests for the commentator's voice (VieNeu on this computer, Edge as stand-in, cache), without the real model or
the real service."""
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

HOME = tempfile.mkdtemp(prefix="giuthanh-tts-test-")
os.environ["TIKTOKGIUTHANH_HOME"] = HOME

import numpy as np  # noqa: E402

from giuthanh import config as C  # noqa: E402
from giuthanh import tts  # noqa: E402


class FakeVieNeu:
    def __init__(self):
        self.calls = []

    def infer(self, text, voice=None):
        self.calls.append((text, voice))
        return np.zeros(tts.SAMPLE_RATE, dtype=np.float32)      # one second of silence


class TtsTest(unittest.TestCase):
    def setUp(self):
        C.TTS_DIR = Path(tempfile.mkdtemp(prefix="tts-cache-", dir=HOME))
        self.saved = dict(tts._vn)

    def tearDown(self):
        tts._vn.clear()
        tts._vn.update(self.saved)

    def test_a_line_is_made_once_then_taken_from_the_cache(self):
        calls = []

        async def fake_make(text, voice, rate, out):
            calls.append((text, voice, rate))
            out.write_bytes(b"\xff" * 1000)

        with patch.object(tts, "_make_edge", side_effect=fake_make):
            f1 = tts.speak("Chào mừng   Nghệ An", "vi-VN-NamMinhNeural", 10)
            f2 = tts.speak("Chào mừng Nghệ An", "vi-VN-NamMinhNeural", 10, engine="omnivoice")   # an old page: ignored
        self.assertEqual(f1, f2)
        self.assertEqual(calls, [("Chào mừng Nghệ An", "vi-VN-NamMinhNeural", 10)])

    def test_vieneu_voice_when_ready(self):
        fake = FakeVieNeu()
        tts._vn.update(state="ready", model=fake)
        f = tts.speak("Cảm ơn Lan với ba bông hồng!", "vieneu:Adam bựa", 15)
        self.assertEqual(f.suffix, ".ogg")
        self.assertGreater(f.stat().st_size, 200)
        self.assertEqual(tts.speak("Cảm ơn Lan với ba bông hồng!", "vieneu:Adam bựa", 30), f)   # speed: played by the page
        self.assertEqual(fake.calls, [("Cảm ơn Lan với ba bông hồng!", "Adam bựa")])

    def test_vieneu_not_ready_yet_the_edge_voice_of_the_same_gender_speaks(self):
        tts._vn.update(state="loading", model=None)
        calls = []

        async def fake_make(text, voice, rate, out):
            calls.append((voice, rate))
            out.write_bytes(b"\xff" * 1000)

        with patch.object(tts, "_make_edge", side_effect=fake_make), patch.object(tts, "start_vieneu"):
            tts.speak("Chào cả nhà", "vieneu:Adam bựa", 20)
            tts.speak("Chào cả nhà", "vieneu:Trúc Ly", 20)
        # made at normal speed: the page plays VieNeu-voice lines at the chosen speed (not twice)
        self.assertEqual(calls, [("vi-VN-NamMinhNeural", 0), ("vi-VN-HoaiMyNeural", 0)])

    def test_vieneu_fails_on_a_line_edge_says_it(self):
        class Broken:
            def infer(self, text, voice=None):
                raise RuntimeError("boom")
        tts._vn.update(state="ready", model=Broken())

        async def fake_make(text, voice, rate, out):
            out.write_bytes(b"\xff" * 1000)

        with patch.object(tts, "_make_edge", side_effect=fake_make):
            f = tts.speak("Chào cả nhà", "vieneu:Adam bựa")
        self.assertEqual(f.suffix, ".mp3")

    def test_unknown_or_old_voices(self):
        self.assertEqual(C.clean_voice("adam"), "vieneu:Adam bựa")     # Adam (OmniVoice, removed): VieNeu's Adam
        self.assertEqual(C.clean_voice("vieneu:Adam"), "vieneu:Adam")
        self.assertEqual(C.clean_voice("vieneu:Nobody"), C.DEFAULTS["voice"])
        self.assertEqual(C.clean_voice("nobody"), C.DEFAULTS["voice"])
        self.assertEqual(C.DEFAULTS["voice"], "vieneu:Adam bựa")
        s = C.clean_settings({"ttsEngine": "omnivoice", "voice": "adam"})
        self.assertEqual(s["voice"], "vieneu:Adam bựa")
        self.assertNotIn("ttsEngine", s)

    def test_empty_text_is_refused(self):
        with self.assertRaises(ValueError):
            tts.speak("   ", "vi-VN-HoaiMyNeural")


if __name__ == "__main__":
    unittest.main()


class StackTest(unittest.TestCase):
    """The game died of a stack overflow writing a VieNeu line (the user's other computer, 10/11/2026, four times in a
    live): writing a whole line of OGG at once needs a stack that grows with its length. Reproduced here: 60 s at once
    on a 64 KB stack ends the process; written in blocks, even 120 s is fine."""

    def _run(self, code: str) -> int:
        import subprocess
        import sys
        return subprocess.run([sys.executable, "-c", code], capture_output=True, timeout=120,
                              cwd=str(Path(__file__).resolve().parents[1])).returncode

    def test_a_long_line_written_on_a_small_stack(self):
        code = """
import os, tempfile, threading, numpy as np
from pathlib import Path
from giuthanh.tts import write_ogg
import soundfile as sf
a = ((np.random.rand(48000 * 120).astype('float32') - 0.5) * 0.2)
out = Path(tempfile.mkdtemp()) / 'x.ogg'
ok = []
def run():
    write_ogg(out, a)
    ok.append(len(sf.read(str(out))[0]) == len(a))
threading.stack_size(64 * 1024)
t = threading.Thread(target=run); t.start(); t.join()
raise SystemExit(0 if ok == [True] else 1)
"""
        self.assertEqual(self._run(code), 0)

    def test_the_voice_runs_in_its_own_thread_with_a_big_stack(self):
        import threading
        got = tts.in_voice_thread(lambda: (threading.current_thread().name, threading.stack_size()))
        self.assertEqual(got[0], "voice")
        self.assertEqual(tts.in_voice_thread(lambda: 7), 7)
        with self.assertRaises(ZeroDivisionError):
            tts.in_voice_thread(lambda: 1 / 0)


class VoiceQueueTest(unittest.TestCase):
    """The voice gone for good on a slower computer (the user, 10/11/2026: "nói được một lúc giật giật xong mất giọng
    luôn"): lines given up were still made, and every new line waited behind them. Now the line said now goes first,
    one line ahead at most, and nothing is made that nobody waits for."""

    def setUp(self):
        import threading
        self.gate = threading.Event()
        self.made = []
        self.threads = []
        # the voice thread is busy until the gate opens
        self._ask("busy", lambda: self.gate.wait(10), tts.NOW, 10)
        import time
        time.sleep(0.1)

    def tearDown(self):
        self.gate.set()
        for t in self.threads:
            t.join(10)

    def _ask(self, key, fn=None, prio=None, timeout=5):
        import threading
        out = {}

        def run():
            try:
                out["value"] = tts.voice_job(f"{self.id()}:{key}", fn or (lambda: self.made.append(key) or key),
                                             tts.NOW if prio is None else prio, timeout)
            except Exception as e:  # noqa: BLE001
                out["error"] = e
        t = threading.Thread(target=run)
        t.start()
        self.threads.append(t)
        return t, out

    def _wait(self, *ts):
        for t, _ in ts:
            t.join(10)

    def test_the_line_said_now_goes_before_a_line_asked_ahead(self):
        import time
        a = self._ask("ahead", prio=tts.AHEAD)
        time.sleep(0.05)
        n = self._ask("now")
        time.sleep(0.05)
        self.gate.set()
        self._wait(a, n)
        self.assertEqual(self.made, ["now", "ahead"])

    def test_one_line_ahead_at_most_the_newest(self):
        import time
        a1 = self._ask("ahead1", prio=tts.AHEAD)
        time.sleep(0.05)
        a2 = self._ask("ahead2", prio=tts.AHEAD)
        self._wait(a1)
        self.assertIsInstance(a1[1].get("error"), TimeoutError)     # given up at once, not after its wait
        self.gate.set()
        self._wait(a2)
        self.assertEqual(self.made, ["ahead2"])

    def test_a_line_nobody_waits_for_is_not_made(self):
        late = self._ask("late", timeout=0.1)
        self._wait(late)
        self.assertIsInstance(late[1].get("error"), TimeoutError)
        self.gate.set()
        n = self._ask("next")
        self._wait(n)
        self.assertEqual(self.made, ["next"])

    def test_asked_ahead_then_asked_now_is_made_once_and_first(self):
        import time
        other = self._ask("other", prio=tts.NOW)
        time.sleep(0.05)
        a = self._ask("x", prio=tts.AHEAD)
        time.sleep(0.05)
        n = self._ask("x", prio=tts.NOW)
        time.sleep(0.05)
        self.gate.set()
        self._wait(other, a, n)
        self.assertEqual(sorted(self.made), ["other", "x"])
        self.assertEqual(n[1].get("value"), "x")
        self.assertEqual(a[1].get("value"), "x")

    def test_a_slow_voice_falls_behind_but_comes_back(self):
        import time
        self.gate.set()
        slow = lambda k: (lambda: time.sleep(0.05) or self.made.append(k) or k)   # noqa: E731
        flood = [self._ask(f"f{i}", slow(f"f{i}"), tts.NOW, 0.02) for i in range(30)]   # all given up at once
        self._wait(*flood)
        t0 = time.time()
        n = self._ask("fresh", slow("fresh"), tts.NOW, 5)
        self._wait(n)
        self.assertEqual(n[1].get("value"), "fresh")
        self.assertLess(time.time() - t0, 0.5)                      # not behind 30 lines nobody wants
        self.assertLess(len(self.made), 5)

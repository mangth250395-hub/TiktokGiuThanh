"""Staying up during a long live: one copy only, a page that stays dead restarts the app, never in a loop."""
import os
import sys
import tempfile
import unittest
import uuid

os.environ.setdefault("TIKTOKGIUTHANH_HOME", tempfile.mkdtemp(prefix="giuthanh-tests-"))   # never the real data folder

from giuthanh import lifecycle  # noqa: E402
from giuthanh.app import AFTER_RELOAD_S, RELOAD_GAP_S, WATCH_S, watch_step  # noqa: E402
from giuthanh.server import Server  # noqa: E402


class LifecycleTest(unittest.TestCase):
    @unittest.skipUnless(sys.platform == "win32", "Windows mutex")
    def test_a_second_copy_is_refused_at_once(self):
        name = f"TikTokGiuThanh_Test_{uuid.uuid4().hex}"
        saved = lifecycle._mutex
        try:
            self.assertTrue(lifecycle.single_instance(name))
            self.assertFalse(lifecycle.single_instance(name))     # the same name again: another copy runs
        finally:
            lifecycle._mutex = saved

    @unittest.skipUnless(sys.platform == "win32", "Windows port sharing")
    def test_a_second_server_cannot_take_the_same_port(self):
        # seen 10/11/2026: two copies both served 8766, the game page reported to the other one
        a = Server(port=0, web=None)
        try:
            with self.assertRaises(OSError):
                Server(port=a.port, web=None)
        finally:
            a.httpd.server_close()

    def test_no_restart_loop(self):
        now = 10_000.0
        self.assertTrue(lifecycle.may_restart([], now))
        self.assertTrue(lifecycle.may_restart([now - 100, now - 200], now))
        self.assertFalse(lifecycle.may_restart([now - 100, now - 200, now - 300], now))
        self.assertTrue(lifecycle.may_restart([now - 100, now - 200, now - lifecycle.RESTART_WINDOW_S - 1], now))

    def test_watchdog_reloads_then_restarts_when_the_reload_did_nothing(self):
        t = 1_000_000.0
        self.assertEqual(watch_step(0, t, 0), "ok")                               # the page has not reported yet
        self.assertEqual(watch_step(t - 5, t, 0), "ok")                           # it reports
        self.assertEqual(watch_step(t - WATCH_S - 1, t, 0), "reload")             # silent: load it again
        last = t
        self.assertEqual(watch_step(t - WATCH_S - 1, t + 10, last), "wait")       # give the reload time
        self.assertEqual(watch_step(t + WATCH_S + 28, t + WATCH_S + 30, last), "ok")   # it came back, reports again
        self.assertEqual(watch_step(t - WATCH_S - 1, t + AFTER_RELOAD_S, last), "restart")   # still nothing: restart
        self.assertLess(AFTER_RELOAD_S, RELOAD_GAP_S)                             # restart comes before a 2nd reload


if __name__ == "__main__":
    unittest.main()


class GuardTest(unittest.TestCase):
    """The guard starts the game again when it dies, not when the user closed it (the user, 10/11/2026: the game
    closed by itself during a live on another computer)."""

    def test_closed_by_the_user_or_a_message_stops(self):
        self.assertEqual(lifecycle.guard_step(lifecycle.EXIT_CLOSED, [], 0, False)[0], "stop")
        self.assertEqual(lifecycle.guard_step(lifecycle.EXIT_MESSAGE, [], 0, False)[0], "stop")

    def test_a_crash_or_a_kill_restarts_and_says_the_code(self):
        step, why = lifecycle.guard_step(-1073741819, [], 0, False)        # 0xC0000005: access violation
        self.assertEqual(step, "restart")
        self.assertIn("0xc0000005", why)
        self.assertEqual(lifecycle.guard_step(1, [], 0, False)[0], "restart")   # ended by another program

    def test_the_game_asking_for_a_restart(self):
        self.assertEqual(lifecycle.guard_step(lifecycle.EXIT_RESTART, [1, 2, 3], 4, False)[0], "restart")

    def test_never_during_install_or_uninstall(self):
        self.assertEqual(lifecycle.guard_step(1, [], 0, True)[0], "stop")

    def test_no_crash_loop(self):
        now = 10_000.0
        self.assertEqual(lifecycle.guard_step(1, [now - 10, now - 20, now - 30], now, False)[0], "stop")


@unittest.skipUnless(sys.platform == "win32", "Windows")
class CrashReportTest(unittest.TestCase):
    """The cause of a crash on the computer that crashes, written in app.log (the user cannot debug it there)."""

    def test_health_measures_the_game_and_the_computer(self):
        line = lifecycle.health()
        self.assertRegex(line, r"^game \d+ MB · trình duyệt \d+ MB \(\d+ tiến trình\) · máy còn trống \d+ / \d+ MB$")

    def test_only_the_game_s_crashes_with_their_module_and_code(self):
        from unittest import mock
        text = """Event[0]
  Source: Application Error
  Event ID: 1000
  Description: 
Faulting application name: TikTokGiuThanh.exe, version: 0.0.0.0
Faulting module name: onnxruntime.dll, version: 1.20.0.0
Exception code: 0xc0000005

Event[1]
  Source: Application Error
  Description: 
Faulting application name: Other.exe, version: 1.0
Exception code: 0xc0000409
"""
        done = mock.Mock(stdout=text)
        with mock.patch.object(lifecycle.subprocess, "run", return_value=done):
            got = [l for l in lifecycle.crash_report() if l.startswith("Application")]
        self.assertEqual(len(got), 1)
        self.assertIn("onnxruntime.dll", got[0])
        self.assertIn("0xc0000005", got[0])

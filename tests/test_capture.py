"""The game window for a sharp live picture: 1080 x 1920 real pixels inside, or the biggest 9:16 that fits."""
import os
import tempfile
import unittest

os.environ.setdefault("TIKTOKGIUTHANH_HOME", tempfile.mkdtemp(prefix="giuthanh-tests-"))   # never the real data folder

from giuthanh.capture import plan  # noqa: E402


class PlanTest(unittest.TestCase):
    def test_a_4k_screen_gets_exactly_1080_by_1920(self):
        # the user's screen: 3840 x 2160 at 150 %, taskbar 72 px; window frame 16 x 39
        x, y, w, h, cw, ch = plan((0, 0, 3840, 2088), (16, 39))
        self.assertEqual((cw, ch), (1080, 1920))
        self.assertEqual((w, h), (1096, 1959))
        self.assertEqual((x, y), ((3840 - 1096) // 2, (2088 - 1959) // 2))

    def test_a_small_screen_gets_the_biggest_9_by_16_that_fits(self):
        x, y, w, h, cw, ch = plan((0, 0, 1920, 1040), (16, 39))
        self.assertLessEqual(h, 1040)
        self.assertEqual(cw * 16, ch * 9)
        self.assertEqual((cw, ch), (558, 992))

    def test_a_second_screen_left_of_the_main_one(self):
        x, y, w, h, cw, ch = plan((-2560, 688, 0, 2216), (16, 39))
        self.assertEqual(cw * 16, ch * 9)
        self.assertGreaterEqual(x, -2560)
        self.assertLessEqual(y + h, 2216)


if __name__ == "__main__":
    unittest.main()

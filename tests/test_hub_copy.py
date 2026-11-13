"""hub_src/ is a copy of the hub's own project (../TiktokLiveHub), carried in this repository so that a clone has
everything. Where the hub's project is there too (the author's computer), the copy must not be behind it: a build
would then pack one hub and a clone would run another."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import sync_hub  # noqa: E402


class HubCopyTest(unittest.TestCase):
    def test_the_copy_is_here(self):
        for name in ("server.py", "proxy.py", "link.py", "web/status.html", "web/tiktok-live-hub.js"):
            self.assertTrue((sync_hub.DST / name).is_file(), f"hub_src/hub/{name} is missing")

    @unittest.skipUnless((sync_hub.SRC / "server.py").exists(), "the hub's own project is not next to this one")
    def test_the_copy_is_not_behind_the_hub(self):
        src, dst = sync_hub.files(sync_hub.SRC), sync_hub.files(sync_hub.DST)
        self.assertEqual(sorted(src), sorted(dst), "run: python tools/sync_hub.py")
        changed = [n for n in src if src[n].read_bytes().replace(b"\r\n", b"\n") != dst[n].read_bytes().replace(b"\r\n", b"\n")]
        self.assertEqual(changed, [], "the hub changed: run python tools/sync_hub.py")

    def test_the_game_runs_the_copy_of_this_repository(self):
        import os
        from giuthanh import hubrun
        asked = os.environ.pop("TIKTOKGIUTHANH_HUB", None)
        try:
            self.assertEqual(hubrun.hub_source(), ROOT / "hub_src")       # never a folder that sits next to the clone
            os.environ["TIKTOKGIUTHANH_HUB"] = str(ROOT / "no-such-folder")
            self.assertEqual(hubrun.hub_source(), ROOT / "hub_src")
            os.environ["TIKTOKGIUTHANH_HUB"] = str(ROOT / "hub_src")      # asked for by name: taken
            self.assertEqual(hubrun.hub_source(), ROOT / "hub_src")
        finally:
            os.environ.pop("TIKTOKGIUTHANH_HUB", None)
            if asked is not None:
                os.environ["TIKTOKGIUTHANH_HUB"] = asked


if __name__ == "__main__":
    unittest.main()

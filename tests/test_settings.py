"""Settings are remembered as they are set (only what changed is sent), and can be put back to the defaults."""
import os
import tempfile
import unittest
from pathlib import Path

HOME = tempfile.mkdtemp(prefix="giuthanh-settings-test-")
os.environ["TIKTOKGIUTHANH_HOME"] = HOME

from giuthanh import config as C  # noqa: E402


class SettingsTest(unittest.TestCase):
    def setUp(self):
        C.SETTINGS_FILE = Path(tempfile.mkdtemp(dir=HOME)) / "settings.json"

    def test_a_change_is_kept_and_merged(self):
        C.update_settings({"channel": "@kenh", "rate": 15})
        C.update_settings({"points": {"share": 7}})                 # only this point changes
        C.update_settings({"controls": {"fx-team": "D"}})
        s = C.load_settings()
        self.assertEqual((s["channel"], s["rate"]), ("kenh", 15))
        self.assertEqual(s["points"]["share"], 7)
        self.assertEqual(s["points"]["comment"], 0)
        self.assertEqual(s["controls"], {"fx-team": "D"})

    def test_the_channel_is_named_as_the_hub_names_it(self):
        # the hub's events carry the ID in lower case: a capital or a pasted link must not make the game deaf to them
        for typed in ("Kenh.Live_1", "@Kenh.Live_1 ", " kenh.live_1/", "https://www.tiktok.com/@Kenh.Live_1/live?lang=vi"):
            self.assertEqual(C.update_settings({"channel": typed})["channel"], "kenh.live_1", typed)
        self.assertEqual(C.update_settings({"channel": ""})["channel"], "")
        self.assertEqual(C.update_settings({"channel": None})["channel"], "")

    def test_a_settings_file_edited_by_hand_never_stops_the_app(self):
        for text in ("null", "5", '"x"', "[1]", '{"matchMs": 1e999, "rate": 1e999, "points": {"quiz": 1e999}}', "", "{"):
            C.SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
            C.SETTINGS_FILE.write_text(text, encoding="utf-8")
            s = C.load_settings()
            self.assertEqual((s["matchMs"], s["rate"], s["points"]["quiz"]),
                             (C.DEFAULTS["matchMs"], 0, C.DEFAULTS["points"]["quiz"]), text)
            self.assertEqual(C.update_settings({"rate": 5})["rate"], 5, text)       # and the control window can repair it

    def test_reset_keeps_only_the_channel(self):
        C.update_settings({"channel": "kenh", "rate": 15, "points": {"share": 9}, "controls": {"sim-user": "An"}})
        s = C.reset_settings()
        self.assertEqual(s["channel"], "kenh")
        self.assertEqual(s["rate"], 0)
        self.assertEqual(s["points"], C.DEFAULTS["points"])
        self.assertEqual(s["controls"], {})
        self.assertEqual(C.load_settings(), s)


if __name__ == "__main__":
    unittest.main()

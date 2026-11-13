"""The app's local server: settings, saved session (with a backup when a new session starts), control -> game."""
import json
import os
import tempfile
import threading
import time
import unittest
import urllib.request
from pathlib import Path

HOME = tempfile.mkdtemp(prefix="giuthanh-test-")
os.environ["TIKTOKGIUTHANH_HOME"] = HOME

from giuthanh import config as C  # noqa: E402
from giuthanh.server import Server  # noqa: E402

# config.py reads the folder once, when giuthanh is first imported: make sure that was a test folder, not the real one
assert "giuthanh-" in str(C.DATA_DIR), f"the tests would write into {C.DATA_DIR}"


def call(port, path, body=None, host=None, headers=None):
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", method="POST" if body is not None else "GET",
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"content-type": "application/json", **({"Host": host} if host else {}), **(headers or {})})
    with urllib.request.urlopen(req, timeout=5) as r:
        return r.status, r.read()


def state(sid, users=None, **more):
    """A session as the page saves it (the parts the app looks at)."""
    return {"v": 1, "game": "giuthanh", "rules": 3, "session": {"id": sid}, "match": {"n": 1}, "users": users or {}, **more}


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        web = Path(HOME) / "web"
        web.mkdir(exist_ok=True)
        (web / "index.html").write_text("<h1>game</h1>", encoding="utf-8")
        (web / "control.html").write_text("<h1>control</h1>", encoding="utf-8")
        cls.srv = Server(port=0, web=web).start()
        cls.port = cls.srv.port

    @classmethod
    def tearDownClass(cls):
        cls.srv.stop()

    def test_pages(self):
        self.assertIn(b"game", call(self.port, "/")[1])
        self.assertIn(b"control", call(self.port, "/control")[1])
        with self.assertRaises(urllib.error.HTTPError) as e:
            call(self.port, "/../../secret.txt")
        self.assertEqual(e.exception.code, 404)
        # a folder beside the pages whose name starts like theirs is not theirs
        beside = Path(HOME) / "web-secret"
        beside.mkdir(exist_ok=True)
        (beside / "x.txt").write_text("secret", encoding="utf-8")
        import http.client
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        c.request("GET", "/../web-secret/x.txt")
        self.assertEqual(c.getresponse().status, 404)
        c.close()

    def test_other_hosts_are_refused(self):
        with self.assertRaises(urllib.error.HTTPError) as e:
            call(self.port, "/api/settings", host="evil.example.com")
        self.assertEqual(e.exception.code, 403)

    def test_settings_are_cleaned_and_kept(self):
        _, b = call(self.port, "/api/settings", {"channel": "@tenkenh ", "matchMs": 5, "voice": "x", "volume": 9})
        s = json.loads(b)
        self.assertEqual(s["channel"], "tenkenh")
        self.assertEqual(s["matchMs"], 60_000)
        self.assertEqual(s["voice"], C.DEFAULTS["voice"])        # an unknown voice: the default one
        self.assertEqual(s["volume"], 1.0)
        self.assertEqual(json.loads(call(self.port, "/api/settings")[1])["channel"], "tenkenh")

    def code(self, *a, **k):
        try:
            return call(self.port, *a, **k)[0]
        except urllib.error.HTTPError as e:
            return e.code

    def test_other_web_sites_are_refused(self):
        # any page open in a browser of this computer can send requests here: only the app's own pages may act
        evil = {"Origin": "https://evil.example"}
        for path, body in (("/api/cmd", {"cmd": "new_session"}), ("/api/cmd", {"cmd": "say", "text": "x"}),
                           ("/api/settings", {"channel": "theirs"}), ("/api/state", state("zzz")), ("/api/open-data", {}),
                           ("/api/log", {"text": "x"}), ("/api/game-status", {"match": 1})):
            self.assertEqual(self.code(path, body, headers=evil), 403, path)
            self.assertEqual(self.code(path, body, headers={"Origin": "null"}), 403, path)      # a sandboxed frame
        self.assertNotEqual(json.loads(call(self.port, "/api/settings")[1])["channel"], "theirs")
        # a picture or a script of another site asking for something (no Origin on such a request, but the browser says so)
        self.assertEqual(self.code("/api/tts?text=x", headers={"Sec-Fetch-Site": "cross-site"}), 403)
        self.assertEqual(self.code("/api/state", headers={"Sec-Fetch-Site": "cross-site"}), 403)
        # the app's own pages, and the pages of `npm run dev`
        own = {"Origin": f"http://127.0.0.1:{self.port}", "Sec-Fetch-Site": "same-origin"}
        self.assertEqual(self.code("/api/cmd", {"cmd": "wave_now"}, headers=own), 200)
        self.assertEqual(self.code("/api/cmd", {"cmd": "wave_now"}, headers={"Origin": "http://localhost:5179"}), 200)
        self.assertEqual(self.code("/api/ping", headers={"Sec-Fetch-Site": "same-origin"}), 200)
        self.assertEqual(self.code("/api/ping", headers={"Sec-Fetch-Site": "none"}), 200)             # the address typed
        self.assertEqual(self.code("/", headers={"Sec-Fetch-Site": "cross-site"}), 200)               # a page is no secret

    def test_a_backup_cannot_be_written_outside_its_folder(self):
        call(self.port, "/api/state", state("ok1"))
        for bad in ("x/../../../planted", "..\\..\\planted", "a*b", "a:b", "", "x" * 41, 7, None):
            self.assertEqual(self.code("/api/state", state(bad)), 400, repr(bad))
        self.assertEqual(json.loads(call(self.port, "/api/state")[1])["session"]["id"], "ok1")
        self.assertEqual([p for p in Path(HOME).rglob("planted*")], [])

    def test_what_is_not_a_whole_session_is_refused_and_blocks_nothing(self):
        call(self.port, "/api/state", state("good1", {"7": {"pts": 5}}))
        for broken in ({"v": 1, "game": "giuthanh", "rules": 3, "session": {"id": "abc"}},          # no users, no match
                       {"v": 1, "game": "giuthanh", "session": "x", "match": {}, "users": {}},
                       {"v": 1, "game": "giuthanh", "session": {"id": "abc"}, "match": {}, "users": []}, [1], "x"):
            self.assertEqual(self.code("/api/state", broken), 400)
        self.assertEqual(json.loads(call(self.port, "/api/state")[1])["users"]["7"]["pts"], 5)
        self.assertEqual(self.code("/api/state", state("good1", {"7": {"pts": 6}})), 200)             # saving goes on

    def test_a_state_file_nothing_can_read_is_kept_aside(self):
        C.STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        C.STATE_FILE.write_text('{"v": 1, "game": "giuthanh", "users": {"9": ', encoding="utf-8")     # cut short
        self.assertEqual(self.code("/api/state", state("new1")), 200)
        kept = list(C.BACKUP_DIR.glob("*-khong-doc-duoc.json"))
        self.assertEqual(len(kept), 1)
        self.assertIn('"9"', kept[0].read_text(encoding="utf-8"))
        self.assertEqual(json.loads(call(self.port, "/api/state")[1])["session"]["id"], "new1")

    def test_a_wrong_length_or_a_bottomless_body_is_refused(self):
        import http.client
        for length, body in (("-1", b""), ("9", b"[" * 9)):
            c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
            c.putrequest("POST", "/api/cmd")
            c.putheader("Content-Length", length)
            c.endheaders()
            c.send(body)
            self.assertEqual(c.getresponse().status, 400, length)
            c.close()
        deep = ("[" * 100_000).encode()
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        c.request("POST", "/api/cmd", body=deep, headers={"Content-Type": "application/json"})
        self.assertEqual(c.getresponse().status, 400)
        c.close()

    def test_the_page_cannot_fill_the_log(self):
        from giuthanh import server as S
        bus = S.Bus()
        self.assertEqual(sum(bus.may_log() for _ in range(S.LOG_PER_MIN + 40)), S.LOG_PER_MIN)

    def test_state_saved_and_old_session_backed_up(self):
        call(self.port, "/api/state", state("aaa", {"7": {"pts": 5}}))
        self.assertEqual(json.loads(call(self.port, "/api/state")[1])["users"]["7"]["pts"], 5)
        call(self.port, "/api/state", state("bbb"))
        backups = list(C.BACKUP_DIR.glob("*-aaa.json"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(json.loads(backups[0].read_text(encoding="utf-8"))["users"]["7"]["pts"], 5)
        with self.assertRaises(urllib.error.HTTPError):
            call(self.port, "/api/state", {"not": "a state"})
        with self.assertRaises(urllib.error.HTTPError):          # a session of the map game is never taken
            call(self.port, "/api/state", {"v": 1, "session": {"id": "ccc"}, "match": {}, "users": {}, "prov": {}})

    def test_control_command_reaches_the_game_stream(self):
        got = []

        def listen():
            with urllib.request.urlopen(f"http://127.0.0.1:{self.port}/api/stream", timeout=5) as r:
                for line in r:
                    if line.startswith(b"data: "):
                        got.append(json.loads(line[6:]))
                        return
        t = threading.Thread(target=listen, daemon=True)
        t.start()
        for _ in range(50):
            if self.srv.bus.clients:
                break
            time.sleep(0.02)
        _, b = call(self.port, "/api/cmd", {"cmd": "end_round"})
        self.assertEqual(json.loads(b)["games"], 1)
        t.join(3)
        self.assertEqual(got, [{"cmd": "end_round"}])

    def test_game_status_goes_stale(self):
        call(self.port, "/api/game-status", {"round": 3})
        self.assertEqual(json.loads(call(self.port, "/api/game-status")[1])["round"], 3)
        self.srv.bus.status_at -= 10
        self.assertEqual(json.loads(call(self.port, "/api/game-status")[1]), {})


if __name__ == "__main__":
    unittest.main()

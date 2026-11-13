"""Every test runs on its own data folder, never the real one (%APPDATA%/TikTokGiuThanh: the streamer's session and
settings). Set here, before any test module imports giuthanh: in the map game a test file once imported the app first and
the server tests wrote over the real session and settings (10/11/2026)."""
import os
import tempfile

os.environ["TIKTOKGIUTHANH_HOME"] = tempfile.mkdtemp(prefix="giuthanh-tests-")

"""Copies the hub's code (its own project, ../TiktokLiveHub) into hub_src/ of this repository.

The hub (the part that connects to TikTok LIVE) is developed in its own folder next to this one. This repository
carries a copy in hub_src/, so that whoever clones it has everything: with no ../TiktokLiveHub, the game and the build
take the hub from hub_src. Run this whenever the hub changed, before a commit (tests/test_hub_copy.py fails while the
copy is behind):

    python tools/sync_hub.py
"""
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT.parent / "TiktokLiveHub" / "hub"
DST = ROOT / "hub_src" / "hub"
SKIP = shutil.ignore_patterns("__pycache__", "*.pyc")


def files(folder: Path) -> dict:
    """Every file of a hub folder, by its path inside it."""
    return {f.relative_to(folder).as_posix(): f for f in folder.rglob("*")
            if f.is_file() and "__pycache__" not in f.parts and f.suffix != ".pyc"}


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")   # a Windows console: Vietnamese must not stop it
    except (AttributeError, ValueError):
        pass
    if not (SRC / "server.py").exists():
        print(f"Không thấy mã nguồn hub ở {SRC}: hub_src/ giữ nguyên")
        return 1
    if DST.exists():
        shutil.rmtree(DST)
    shutil.copytree(SRC, DST, ignore=SKIP)
    print(f"hub_src/hub: {len(files(DST))} file từ {SRC}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

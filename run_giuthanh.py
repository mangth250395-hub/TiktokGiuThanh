"""Entry point of the exe (PyInstaller).

The exe is a window app (no console). What the app and the hub inside it print (in Vietnamese) must go somewhere
that takes any character: a Windows stream in the local code page (cp1252) stops the hub at its first message
("'charmap' codec can't encode character", seen 10/11/2026). So:
  - started from a terminal with options (--selftest, --dev): printed into that terminal, in UTF-8
  - opened by a double click: written to %APPDATA%\\TikTokGiuThanh\\app.log, in UTF-8
"""
import sys


def _output() -> None:
    if not getattr(sys, "frozen", False):
        return
    if len(sys.argv) > 1:
        import ctypes
        if ctypes.windll.kernel32.AttachConsole(-1):          # the terminal that started us
            sys.stdout = sys.stderr = open("CONOUT$", "w", encoding="utf-8", errors="replace", buffering=1)
            return
    from giuthanh import config as C
    C.DATA_DIR.mkdir(parents=True, exist_ok=True)
    log = C.DATA_DIR / "app.log"
    try:
        if log.exists() and log.stat().st_size > 5_000_000:   # keep it small: start again past 5 MB
            log.replace(log.with_suffix(".old.log"))
    except OSError:
        pass
    sys.stdout = sys.stderr = open(log, "a", encoding="utf-8", errors="replace", buffering=1)


_output()

from giuthanh.app import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())

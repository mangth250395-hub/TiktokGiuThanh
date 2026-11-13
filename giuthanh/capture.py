"""A sharp picture for the live: the game window's inside made exactly 1080 x 1920 real pixels.

TikTok LIVE Studio / OBS capture the window pixel for pixel. The window used to open at 540 x 1000 (about 810 x 1440
real pixels on a 150 % screen): the live canvas (1080 x 1920) stretched it and the picture looked blurred (the user,
10/11/2026). The page draws everything in proportion to its height, so a bigger window is only sharper, the layout is
the same. When the screen is too small for 1920 real pixels, the biggest 9:16 that fits.
"""
from __future__ import annotations

import ctypes
import sys
from ctypes import wintypes

TARGET = (1080, 1920)


class _MonitorInfo(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.DWORD), ("rcMonitor", wintypes.RECT), ("rcWork", wintypes.RECT), ("dwFlags", wintypes.DWORD)]


def plan(work: tuple[int, int, int, int], frame: tuple[int, int], target: tuple[int, int] = TARGET) -> tuple[int, int, int, int, int, int]:
    """The window for a screen's work area (left, top, right, bottom) and the window's frame (extra width, extra height):
    (x, y, width, height) of the whole window and the inside (cw, ch) - 1080 x 1920, or the biggest 9:16 that fits."""
    left, top, right, bottom = work
    fw, fh = frame
    cw, ch = target
    room_w, room_h = right - left - fw, bottom - top - fh
    if ch > room_h or cw > room_w:
        ch = min(room_h, room_w * 16 // 9) // 16 * 16       # 16 px steps: width and height stay exactly 9:16
        cw = ch * 9 // 16
    w, h = cw + fw, ch + fh
    return left + max(0, (right - left - w) // 2), top + max(0, (bottom - top - h) // 2), w, h, cw, ch


def fit(window) -> tuple[int, int] | None:
    """Resize the game window (a pywebview window) so its inside is 1080 x 1920 real pixels. Returns the inside size."""
    if sys.platform != "win32":
        return None
    u32 = ctypes.windll.user32
    hwnd = wintypes.HWND(int(window.native.Handle.ToInt64()))
    if u32.IsZoomed(hwnd):
        u32.ShowWindow(hwnd, 9)                                       # SW_RESTORE: a maximized window cannot be sized
    wr, cr = wintypes.RECT(), wintypes.RECT()
    u32.GetWindowRect(hwnd, ctypes.byref(wr))
    u32.GetClientRect(hwnd, ctypes.byref(cr))
    frame = ((wr.right - wr.left) - cr.right, (wr.bottom - wr.top) - cr.bottom)
    u32.MonitorFromWindow.restype = wintypes.HANDLE
    mon = u32.MonitorFromWindow(hwnd, 2)                              # MONITOR_DEFAULTTONEAREST
    mi = _MonitorInfo()
    mi.cbSize = ctypes.sizeof(mi)
    u32.GetMonitorInfoW(wintypes.HANDLE(mon), ctypes.byref(mi))
    w = mi.rcWork
    x, y, ww, wh, cw, ch = plan((w.left, w.top, w.right, w.bottom), frame)
    u32.SetWindowPos(hwnd, None, x, y, ww, wh, 0x0004 | 0x0010)        # SWP_NOZORDER | SWP_NOACTIVATE
    u32.GetClientRect(hwnd, ctypes.byref(cr))
    return cr.right, cr.bottom

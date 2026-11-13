r"""Draws web/public/icon.ico (exe, windows) and icon.png: a teal rounded square with a golden straw hat (the village)
over a pale wall with battlements (the citadel), and a thin gold rim. Pure Python (PNG frames inside an ICO), no image
library needed.

    .venv\Scripts\python tools\make_icon.py
"""
import math
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "web" / "public" / "icon.ico"
RED_TOP, RED_BOTTOM = (26, 168, 148), (8, 84, 74)      # the background (teal: the village's colour)
WALL = (246, 240, 222)
GOLD_TOP, GOLD_BOTTOM = (255, 232, 130), (240, 170, 30)
RIM = (255, 210, 90)
SS = 4   # supersampling, for smooth edges

# the straw hat (nón lá): a wide cone
STAR = [(0.5, 0.2), (0.86, 0.58), (0.14, 0.58)]


def in_star(u: float, v: float) -> bool:
    inside = False
    for i in range(len(STAR)):
        (x1, y1), (x2, y2) = STAR[i], STAR[i - 1]
        if (y1 > v) != (y2 > v) and u < (x2 - x1) * (v - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def in_wall(u: float, v: float) -> bool:
    """A wall with three battlements, under the hat."""
    if not 0.2 <= u <= 0.8:
        return False
    if 0.72 <= v <= 0.84:
        return True
    return 0.65 <= v < 0.72 and any(a <= u <= a + 0.12 for a in (0.2, 0.44, 0.68))


def in_square(u: float, v: float, inset: float = 0.0) -> bool:
    r = 0.22 - inset
    qx, qy = max(abs(u - 0.5) - (0.5 - inset - r), 0), max(abs(v - 0.5) - (0.5 - inset - r), 0)
    return math.hypot(qx, qy) <= r


def mix(a, b, t):
    return [a[i] + (b[i] - a[i]) * t for i in range(3)]


def png(size: int) -> bytes:
    rows = []
    rim = 0.02 if size >= 48 else 0.0      # the rim only where it can be seen
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            acc = [0.0, 0.0, 0.0]
            alpha = 0
            for sy in range(SS):
                for sx in range(SS):
                    u, v = (x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size
                    if not in_square(u, v):
                        continue
                    alpha += 1
                    if in_star(u, v):
                        col = mix(GOLD_TOP, GOLD_BOTTOM, (v - 0.2) / 0.38)
                    elif in_wall(u, v):
                        col = WALL
                    elif rim and not in_square(u, v, rim):
                        col = RIM
                    else:
                        # a soft light from the top left
                        glow = max(0.0, 1 - math.hypot(u - 0.35, v - 0.3) * 1.4) * 0.25
                        col = mix(mix(RED_TOP, RED_BOTTOM, v), (150, 240, 222), glow)
                    acc = [acc[i] + col[i] for i in range(3)]
            k = SS * SS
            if alpha:
                row += bytes([round(c / alpha) for c in acc] + [round(255 * alpha / k)])
            else:
                row += bytes([0, 0, 0, 0])
        rows.append(bytes(row))
    raw = zlib.compress(b"".join(rows), 9)

    def chunk(t: bytes, d: bytes) -> bytes:
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)) + chunk(b"IDAT", raw) + chunk(b"IEND", b"")


def main() -> None:
    sizes = [16, 24, 32, 48, 64, 128, 256]
    frames = [png(s) for s in sizes]
    head = struct.pack("<HHH", 0, 1, len(frames))
    offset = 6 + 16 * len(frames)
    entries = b""
    for s, f in zip(sizes, frames):
        entries += struct.pack("<BBBBHHII", s % 256, s % 256, 0, 0, 1, 32, len(f), offset)
        offset += len(f)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_bytes(head + entries + b"".join(frames))
    (OUT.parent / "icon.png").write_bytes(frames[-1])
    print(f"{OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()

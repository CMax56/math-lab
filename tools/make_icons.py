#!/usr/bin/env python3
"""Make the PNG app icons (no Pillow needed — pure Python + zlib).

Run from anywhere:  python3 tools/make_icons.py

Writes into icons/:
  apple-touch-icon.png   180x180  (iPhone Home Screen)
  icon-192.png           192x192
  icon-512.png           512x512
  icon-maskable-512.png  512x512  (artwork shrunk into the Android safe zone)

The design matches icons/icon.svg: teal square, white right triangle,
amber sun. Takes a few seconds.
"""
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "icons"

TEAL = (0x0F, 0x76, 0x6E)
WHITE = (0xFF, 0xFF, 0xFF)
AMBER = (0xF5, 0x9E, 0x0B)


def color_at(x, y):
    """Color of the 512x512 design at point (x, y)."""
    if (x - 352) ** 2 + (y - 168) ** 2 <= 56 ** 2:
        return AMBER
    # Triangle (112,400) (400,400) (112,128): right angle at bottom-left.
    if x >= 112 and y <= 400 and y >= 128 + (x - 112) * (272 / 288):
        # Right-angle marker: square 112..156 x 356..400 outlined with a 10-unit stroke.
        in_outer = 107 <= x <= 161 and 351 <= y <= 405
        in_inner = 117 <= x <= 151 and 361 <= y <= 395
        if in_outer and not in_inner:
            return TEAL
        return WHITE
    return TEAL


def render(size, scale=1.0, ss=3):
    """Return PNG rows. scale < 1 shrinks the artwork toward the center (maskable)."""
    rows = []
    step = 512 / size
    offs = [(i + 0.5) / ss for i in range(ss)]
    n = ss * ss
    for py in range(size):
        row = bytearray()
        for px in range(size):
            r = g = b = 0
            for oy in offs:
                for ox in offs:
                    x = (px + ox) * step
                    y = (py + oy) * step
                    if scale != 1.0:
                        x = 256 + (x - 256) / scale
                        y = 256 + (y - 256) / scale
                    c = color_at(x, y)
                    r += c[0]
                    g += c[1]
                    b += c[2]
            row += bytes((round(r / n), round(g / n), round(b / n)))
        rows.append(bytes(row))
    return rows


def write_png(path, size, rows):
    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + r for r in rows)
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))
    path.write_bytes(png)


def main():
    OUT.mkdir(exist_ok=True)
    jobs = [
        ("apple-touch-icon.png", 180, 1.0),
        ("icon-192.png", 192, 1.0),
        ("icon-512.png", 512, 1.0),
        ("icon-maskable-512.png", 512, 0.8),
    ]
    for name, size, scale in jobs:
        write_png(OUT / name, size, render(size, scale))
        print("wrote", (OUT / name).relative_to(OUT.parent))


if __name__ == "__main__":
    main()

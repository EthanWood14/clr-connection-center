"""Build the C3 Shotgun Chrome extension: icons + the downloadable zip.

Run from the repo root after ANY change under chrome-extension/:

    python script/build-extension.py

Outputs:
  chrome-extension/icons/{16,48,128}.png   (regenerated, deterministic)
  client/public/c3-shotgun-extension.zip   (what C3 serves at /c3-shotgun-extension.zip)
  chrome-extension/hashes.json             (sha256 of every shipped file AND of the zip)

tests/shotgun-extension.test.ts compares hashes.json against the live files and
the zip bytes, so an extension edit that skips this script — or a commit that
forgets the regenerated zip — fails the suite instead of silently shipping
stale code.
"""
import hashlib
import io
import json
import os
import struct
import zipfile
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXT = os.path.join(ROOT, "chrome-extension")
ICONS = os.path.join(EXT, "icons")
ZIP_OUT = os.path.join(ROOT, "client", "public", "c3-shotgun-extension.zip")

# Files that ship inside the zip (everything Chrome needs, nothing else).
SHIPPED = [
    "manifest.json", "background.js", "content.js", "page-hook.js",
    "popup.html", "popup.js", "README.md",
    "icons/16.png", "icons/48.png", "icons/128.png",
]

# ── Icon drawing (stdlib-only PNG writer) ─────────────────────────────────────
BOLT = [(0.60, 0.06), (0.24, 0.56), (0.45, 0.56), (0.38, 0.94), (0.78, 0.40), (0.55, 0.40)]

def in_polygon(x, y, poly):
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside

def draw(size):
    ss = 4  # supersample for smooth edges
    n = size * ss
    radius = n * 0.22
    px = bytearray(n * n * 4)
    for yy in range(n):
        ny = (yy + 0.5) / n
        # subtle vertical gradient: orange-500 → orange-700
        bg = tuple(int(a + (b - a) * ny) for a, b in ((249, 194), (115, 65), (22, 12)))
        for xx in range(n):
            # rounded-rect mask
            dx = max(0, radius - xx, xx - (n - 1 - radius))
            dy = max(0, radius - yy, yy - (n - 1 - radius))
            if dx * dx + dy * dy > radius * radius:
                continue
            nx = (xx + 0.5) / n
            r, g, b = (255, 255, 255) if in_polygon(nx, ny, BOLT) else bg
            o = (yy * n + xx) * 4
            px[o:o + 4] = bytes((r, g, b, 255))
    # box-average downsample to target size
    out = bytearray(size * size * 4)
    for y in range(size):
        for x in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(ss):
                for sx in range(ss):
                    o = ((y * ss + sy) * n + (x * ss + sx)) * 4
                    for c in range(4):
                        acc[c] += px[o + c]
            o = (y * size + x) * 4
            out[o:o + 4] = bytes(v // (ss * ss) for v in acc)
    return bytes(out)

def png(size, rgba):
    def chunk(tag, data):
        raw = tag + data
        return struct.pack(">I", len(data)) + raw + struct.pack(">I", zlib.crc32(raw))
    raw = b"".join(b"\x00" + rgba[y * size * 4:(y + 1) * size * 4] for y in range(size))
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9))
            + chunk(b"IEND", b""))

os.makedirs(ICONS, exist_ok=True)
for size in (16, 48, 128):
    with open(os.path.join(ICONS, f"{size}.png"), "wb") as f:
        f.write(png(size, draw(size)))
    print(f"icon {size}px written")

# ── Zip, then hashes (hashes.json records the zip bytes too, so a commit that
# stages sources but forgets the regenerated zip fails the suite) ─────────────
os.makedirs(os.path.dirname(ZIP_OUT), exist_ok=True)
buf = io.BytesIO()
with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
    for rel in SHIPPED:
        # fixed timestamp → byte-identical zip for identical inputs (clean git diffs)
        # Entries live at the zip ROOT: Windows "Extract All" already wraps the
        # contents in a folder named after the zip, so a folder prefix here
        # produced a folder-in-a-folder — and picking the outer one gave
        # Chrome's "Manifest file is missing or unreadable".
        info = zipfile.ZipInfo(rel, date_time=(2026, 1, 1, 0, 0, 0))
        info.external_attr = 0o644 << 16
        with open(os.path.join(EXT, rel), "rb") as f:
            z.writestr(info, f.read(), zipfile.ZIP_DEFLATED)
with open(ZIP_OUT, "wb") as f:
    f.write(buf.getvalue())
print(f"zip written: {ZIP_OUT} ({len(buf.getvalue())} bytes)")

hashes = {}
for rel in SHIPPED:
    with open(os.path.join(EXT, rel), "rb") as f:
        hashes[rel] = hashlib.sha256(f.read()).hexdigest()
hashes["__zip_sha256"] = hashlib.sha256(buf.getvalue()).hexdigest()
with open(os.path.join(EXT, "hashes.json"), "w", encoding="utf-8", newline="\n") as f:
    json.dump(hashes, f, indent=2, sort_keys=True)
    f.write("\n")
print("hashes.json written")

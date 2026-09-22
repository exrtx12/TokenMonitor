"""Generates simple placeholder toolbar icons for the extension.
Run once: python scripts/make_icons.py
"""
from PIL import Image, ImageDraw
import os

SIZES = [16, 48, 128]
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "icons")
os.makedirs(OUT_DIR, exist_ok=True)

BG = (79, 124, 255, 255)   # brand blue
RING_BG = (255, 255, 255, 90)
RING_FG = (255, 255, 255, 255)

for size in SIZES:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    pad = max(1, size // 16)
    draw.ellipse([pad, pad, size - pad, size - pad], fill=BG)

    ring_pad = size // 4
    ring_box = [ring_pad, ring_pad, size - ring_pad, size - ring_pad]
    stroke = max(1, size // 10)
    draw.arc(ring_box, start=0, end=360, fill=RING_BG, width=stroke)
    draw.arc(ring_box, start=-90, end=180, fill=RING_FG, width=stroke)

    img.save(os.path.join(OUT_DIR, f"icon{size}.png"))

print("icons written to", os.path.abspath(OUT_DIR))

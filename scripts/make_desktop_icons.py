"""Generates tray/app icons for the Electron desktop widget.
Run once: python scripts/make_desktop_icons.py
"""
from PIL import Image, ImageDraw
import os

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "desktop", "assets")
os.makedirs(OUT_DIR, exist_ok=True)

BG = (79, 124, 255, 255)
RING_BG = (255, 255, 255, 90)
RING_FG = (255, 255, 255, 255)


def draw_icon(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    pad = max(1, size // 16)
    draw.ellipse([pad, pad, size - pad, size - pad], fill=BG)
    ring_pad = size // 4
    ring_box = [ring_pad, ring_pad, size - ring_pad, size - ring_pad]
    stroke = max(1, size // 10)
    draw.arc(ring_box, start=0, end=360, fill=RING_BG, width=stroke)
    draw.arc(ring_box, start=-90, end=180, fill=RING_FG, width=stroke)
    return img


tray_icon = draw_icon(64)
tray_icon.save(os.path.join(OUT_DIR, "tray-icon.png"))

icon_sizes = [16, 32, 48, 64, 128, 256]
icons = [draw_icon(s) for s in icon_sizes]
icons[-1].save(
    os.path.join(OUT_DIR, "icon.ico"),
    sizes=[(s, s) for s in icon_sizes],
)

print("desktop icons written to", os.path.abspath(OUT_DIR))

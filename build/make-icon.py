"""Draws build/icon.png, the placeholder app icon: a flask on an indigo rounded square.

Run from the repo root: python3 build/make-icon.py (needs Pillow). electron-builder turns the
1024px PNG into .icns and .ico. Linux desktops only look up the standard sizes, so those are written
to build/icons/ as well.
"""
import os

from PIL import Image, ImageDraw

S = 4  # draw at 4x and scale down for smooth edges
N = 1024 * S
cx = N // 2


def gradient(top, bottom):
    layer = Image.new('RGBA', (N, N))
    d = ImageDraw.Draw(layer)
    for y in range(N):
        t = y / N
        d.line([(0, y), (N, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip(top, bottom)) + (255,))
    return layer


# Background: rounded square inside the standard macOS icon margin
icon = Image.new('RGBA', (N, N), (0, 0, 0, 0))
mask = Image.new('L', (N, N), 0)
ImageDraw.Draw(mask).rounded_rectangle([100 * S, 100 * S, N - 100 * S, N - 100 * S], radius=185 * S, fill=255)
icon.paste(gradient((110, 108, 245), (72, 70, 200)), (0, 0), mask)

# Flask geometry
neck_half, neck_top, neck_bot = 65 * S, 250 * S, 470 * S
body_bot, body_half = 790 * S, 250 * S
liquid_top = 620 * S


def half_width(y):
    return neck_half + (body_half - neck_half) * (y - neck_bot) / (body_bot - neck_bot)


# Liquid: translucent white, composited so the background shows through
liquid = Image.new('RGBA', (N, N), (0, 0, 0, 0))
ld = ImageDraw.Draw(liquid)
ld.polygon(
    [(cx - half_width(liquid_top), liquid_top), (cx + half_width(liquid_top), liquid_top),
     (cx + body_half, body_bot), (cx - body_half, body_bot)],
    fill=(255, 255, 255, 120),
)
for bx, by, br in [(-60, 700, 22), (70, 740, 16), (10, 665, 12)]:
    ld.ellipse([cx + bx * S - br * S, by * S - br * S, cx + bx * S + br * S, by * S + br * S], fill=(255, 255, 255, 230))
icon = Image.alpha_composite(icon, liquid)

# Outline and rim
d = ImageDraw.Draw(icon)
outline = [(cx - neck_half, neck_top), (cx - neck_half, neck_bot), (cx - body_half, body_bot),
           (cx + body_half, body_bot), (cx + neck_half, neck_bot), (cx + neck_half, neck_top)]
d.line(outline, fill=(255, 255, 255, 255), width=34 * S, joint='curve')
d.rounded_rectangle([cx - neck_half - 40 * S, neck_top - 26 * S, cx + neck_half + 40 * S, neck_top + 14 * S],
                    radius=18 * S, fill=(255, 255, 255, 255))

os.makedirs('build/icons', exist_ok=True)
icon.resize((1024, 1024), Image.LANCZOS).save('build/icon.png')
for size in (16, 32, 48, 64, 128, 256, 512):
    icon.resize((size, size), Image.LANCZOS).save(f'build/icons/{size}x{size}.png')
print('wrote build/icon.png and build/icons/')

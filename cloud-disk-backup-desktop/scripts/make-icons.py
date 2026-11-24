"""Draws the app and tray icons (assets/*.png) with Pillow. Run: python3 scripts/make-icons.py"""
from PIL import Image, ImageDraw
import os

OUT = os.path.join(os.path.dirname(__file__), '..', 'assets')
os.makedirs(OUT, exist_ok=True)

def cloud(draw, s, ox, oy, fill):
    # A cloud from circles and a rounded base, in a 100x100 design grid scaled by s.
    def c(x, y, r): draw.ellipse([ox + (x - r) * s, oy + (y - r) * s, ox + (x + r) * s, oy + (y + r) * s], fill=fill)
    c(36, 58, 18); c(55, 46, 22); c(72, 60, 15)
    draw.rounded_rectangle([ox + 18 * s, oy + 56 * s, ox + 87 * s, oy + 76 * s], radius=10 * s, fill=fill)

def arrow(draw, s, ox, oy, fill):
    draw.polygon([(ox + 52 * s, oy + 44 * s), (ox + 64 * s, oy + 57 * s), (ox + 56 * s, oy + 57 * s), (ox + 56 * s, oy + 68 * s),
                  (ox + 48 * s, oy + 68 * s), (ox + 48 * s, oy + 57 * s), (ox + 40 * s, oy + 57 * s)], fill=fill)

def app_icon(size):
    k = 4  # supersampling
    S = size * k
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    grad = Image.new('RGBA', (S, S))
    gd = ImageDraw.Draw(grad)
    for y in range(S):
        t = y / S
        gd.line([(0, y), (S, y)], fill=(int(59 + (29 - 59) * t), int(130 + (109 - 130) * t), int(246 + (242 - 246) * t), 255))
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([S * 0.06, S * 0.06, S * 0.94, S * 0.94], radius=S * 0.22, fill=255)
    img.paste(grad, (0, 0), mask)
    d = ImageDraw.Draw(img)
    cloud(d, S / 100, 0, -S * 0.02, (255, 255, 255, 255))
    arrow(d, S / 100, 0, -S * 0.02, (37, 99, 235, 255))
    return img.resize((size, size), Image.LANCZOS)

def tray_icon(size, color):
    k = 8
    S = size * k
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cloud(d, S / 100, 0, -S * 0.12, color)
    arrow(d, S / 100, 0, -S * 0.12, (0, 0, 0, 0))
    return img.resize((size, size), Image.LANCZOS)

app_icon(512).save(os.path.join(OUT, 'icon.png'))
tray_icon(16, (0, 0, 0, 255)).save(os.path.join(OUT, 'trayTemplate.png'))
tray_icon(32, (0, 0, 0, 255)).save(os.path.join(OUT, 'trayTemplate@2x.png'))
tray_icon(32, (37, 99, 235, 255)).save(os.path.join(OUT, 'tray.png'))
print('icons written to', os.path.abspath(OUT))

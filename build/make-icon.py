"""Draws Prem's logo: a ring molecule whose atoms are also the nodes of a graph, with one bond branching
out to more nodes, as notes link out to other notes.

Run from the repo root: python3 build/make-icon.py (needs Pillow). It writes
  build/logo.svg              the vector mark on its tile, for the README and docs
  build/icon.png              1024 px; electron-builder turns it into .icns and .ico
  build/icons/<n>x<n>.png     the sizes Linux desktops look up
  site/assets/logo.svg        the site header's mark
  src/renderer/src/assets/logo.svg   the app's welcome screen
  site/assets/icon.png        128 px
  site/assets/favicon.png     32 px, simplified so it stays legible
Everything is drawn from the coordinates below, on a 1024 x 1024 canvas.
"""
import math
import os

from PIL import Image, ImageDraw

# Tile: the standard macOS icon margin and corner radius, with a grey-teal gradient around #89a5ab.
TILE = (100, 924)
RADIUS = 185
TOP, BOTTOM = (156, 182, 188), (111, 139, 146)  # around #89a5ab

# The ring: a hexagon with a point at the top, left of and below centre to leave room for the branch.
CX, CY, R = 404, 566, 165
RING = [(CX + R * math.cos(math.radians(a)), CY + R * math.sin(math.radians(a))) for a in (-90, -30, 30, 90, 150, 210)]
# The branch: from the ring's upper-right atom to a node, which forks to two more.
HUB = (640, 384)
LEAVES = [(756, 254), (780, 500)]
BOND = 30  # line width
ATOM = 44  # ring atom radius
NODE = 52  # branch leaf radius
LEAF_RING = 18  # width of a leaf's outline
DOUBLE_EDGES = [(0, 1), (2, 3), (4, 5)]  # a second, inner line on alternate bonds, as in a benzene ring
DOUBLE_INSET = 54


def inner_line(a, b):
    """The second line of a double bond: parallel to a–b, moved towards the ring's centre and shortened."""
    (x1, y1), (x2, y2) = a, b
    mx, my = (x1 + x2) / 2, (y1 + y2) / 2
    dx, dy = CX - mx, CY - my
    d = math.hypot(dx, dy)
    ox, oy = dx / d * DOUBLE_INSET, dy / d * DOUBLE_INSET
    shrink = 0.24
    return (
        (x1 + (x2 - x1) * shrink + ox, y1 + (y2 - y1) * shrink + oy),
        (x2 + (x1 - x2) * shrink + ox, y2 + (y1 - y2) * shrink + oy),
    )


def toward(a, b, gap):
    """The point `gap` short of b on the way from a, so a bond ends at a leaf's edge rather than under it."""
    (x1, y1), (x2, y2) = a, b
    d = math.hypot(x2 - x1, y2 - y1)
    return (x2 - (x2 - x1) / d * gap, y2 - (y2 - y1) / d * gap)


def bonds():
    ring = [(RING[i], RING[(i + 1) % 6]) for i in range(6)]
    branch = [(RING[1], HUB)] + [(HUB, toward(HUB, leaf, NODE)) for leaf in LEAVES]
    return ring, branch


def num(v):
    return f'{v:.1f}'.rstrip('0').rstrip('.')


def svg() -> str:
    ring, branch = bonds()

    def line(a, b):
        return f'<line x1="{num(a[0])}" y1="{num(a[1])}" x2="{num(b[0])}" y2="{num(b[1])}"/>'

    side = TILE[1] - TILE[0]
    parts = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-label="Prem">',
        '  <defs>',
        '    <linearGradient id="prem-tile" x1="0" y1="0" x2="0" y2="1">',
        f'      <stop offset="0" stop-color="rgb{TOP}"/>',
        f'      <stop offset="1" stop-color="rgb{BOTTOM}"/>',
        '    </linearGradient>',
        '  </defs>',
        f'  <rect x="{TILE[0]}" y="{TILE[0]}" width="{side}" height="{side}" rx="{RADIUS}" fill="url(#prem-tile)"/>',
        f'  <g stroke="#fff" stroke-width="{BOND}" stroke-linecap="round">',
    ]
    parts += [f'    {line(a, b)}' for a, b in ring + branch]
    parts += [f'    {line(*inner_line(RING[i], RING[j]))}' for i, j in DOUBLE_EDGES]
    parts += ['  </g>', '  <g fill="#fff">']
    parts += [f'    <circle cx="{num(x)}" cy="{num(y)}" r="{ATOM}"/>' for x, y in RING + [HUB]]
    parts += ['  </g>', f'  <g fill="#fff" fill-opacity="0.3" stroke="#fff" stroke-width="{LEAF_RING}">']
    parts += [f'    <circle cx="{num(x)}" cy="{num(y)}" r="{NODE}"/>' for x, y in LEAVES]
    parts += ['  </g>', '</svg>']
    return '\n'.join(parts) + '\n'


def png(size: int, simple: bool) -> Image.Image:
    """Draws the icon at 4x and scales it down. `simple` drops the double bonds and thickens lines for tiny sizes."""
    n = 4 * size
    s = n / 1024

    def p(pt):
        return (pt[0] * s, pt[1] * s)

    bond = BOND * (1.6 if simple else 1)
    atom = ATOM * (1.3 if simple else 1)
    node = NODE * (1.15 if simple else 1)
    leaf_ring = LEAF_RING * (1.6 if simple else 1)

    grad = Image.new('RGBA', (n, n))
    gd = ImageDraw.Draw(grad)
    for y in range(n):
        t = y / n
        gd.line([(0, y), (n, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip(TOP, BOTTOM)) + (255,))
    mask = Image.new('L', (n, n), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [TILE[0] * s, TILE[0] * s, TILE[1] * s, TILE[1] * s], radius=RADIUS * s, fill=255
    )
    icon = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    icon.paste(grad, (0, 0), mask)

    d = ImageDraw.Draw(icon)
    white = (255, 255, 255, 255)

    def disc(draw, pt, r, **kwargs):
        x, y = p(pt)
        draw.ellipse([x - r * s, y - r * s, x + r * s, y + r * s], **kwargs)

    def stroke(a, b, width):
        d.line([p(a), p(b)], fill=white, width=round(width * s))
        for pt in (a, b):  # round caps
            disc(d, pt, width / 2, fill=white)

    ring, branch = bonds()
    for a, b in ring + branch:
        stroke(a, b, bond)
    if not simple:
        for i, j in DOUBLE_EDGES:
            stroke(*inner_line(RING[i], RING[j]), bond)
    for pt in RING + [HUB]:
        disc(d, pt, atom, fill=white)

    # The leaves are translucent, composited so the tile shows through.
    leaves = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    ld = ImageDraw.Draw(leaves)
    for pt in LEAVES:
        disc(ld, pt, node, fill=(255, 255, 255, 77), outline=white, width=round(leaf_ring * s))
    icon = Image.alpha_composite(icon, leaves)
    return icon.resize((size, size), Image.LANCZOS)


if __name__ == '__main__':
    os.makedirs('build/icons', exist_ok=True)
    os.makedirs('site/assets', exist_ok=True)
    os.makedirs('src/renderer/src/assets', exist_ok=True)
    for path in ('build/logo.svg', 'site/assets/logo.svg', 'src/renderer/src/assets/logo.svg'):
        with open(path, 'w') as fh:
            fh.write(svg())
    png(1024, False).save('build/icon.png')
    for size in (16, 32, 48, 64, 128, 256, 512):
        png(size, size <= 32).save(f'build/icons/{size}x{size}.png')
    png(128, False).save('site/assets/icon.png')
    png(32, True).save('site/assets/favicon.png')
    print('wrote the logo to build/, site/assets/ and src/renderer/src/assets/')

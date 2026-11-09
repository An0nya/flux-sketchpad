"""Bake a cabin image for cabinStyle 'miata' (js/cabin-miata.js) from its source photo.

The photo's windshield and side windows are already transparent. This cuts two more kinds of hole, so the overlay draws its
own content UNDER the photo and the photo's wheel rim, stalks and window posts occlude it for free:
  - the gauge faces (descriptor gauges: tach, speedo, small.*; nothing below gauges.hub),
  - the mirror glasses (descriptor mirrors[].poly, minus mirrors[].posts, the opaque posts in front of them).
The geometry is the image descriptor DESC in js/cabin-miata.js (one source of truth), read through node.
(The convertible roof cut, descriptor cut, is applied at draw time, not baked.)

Usage (needs Pillow + numpy + node):  python3 tools/cabin-miata/bake.py <source.png> <out.png> [descriptor name, default: the one in use]
  e.g. bake.py miata-cabin-source.png img/cabin/miata-na.png miata-na  ·  bake.py miata-wide-alpha.png img/cabin/miata-wide.png miata-wide
"""
import json, os, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')


def descriptor(name=None):
    js = "const M = require(process.argv[1]); JSON.stringify(process.argv[2] ? M.DESCS[process.argv[2]] : M.DESC)"
    out = subprocess.run(['node', '-p', js, os.path.join(ROOT, 'js', 'cabin-miata.js')] + ([name] if name else []), capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def main(src, dst, name=None):
    d = descriptor(name)
    a = np.asarray(Image.open(src).convert('RGBA')).copy()
    H, W = a.shape[:2]
    assert (W, H) == (d['w'], d['h']), 'descriptor size %sx%s does not match the image %sx%s' % (d['w'], d['h'], W, H)
    g = d['gauges']; faces = [g['tach'], g['speedo']] + list(g['small'].values())
    m = Image.new('L', (W, H), 0); dr = ImageDraw.Draw(m)
    for cx, cy, r in faces: dr.ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
    hole = (np.asarray(m) > 0) & (np.mgrid[0:H, 0:W][0] < g['hub'])
    for mi in d['mirrors']:
        m = Image.new('L', (W, H), 0); ImageDraw.Draw(m).polygon([tuple(p) for p in mi['poly']], fill=255)
        glass = np.asarray(m) > 0
        for p0, p1 in mi.get('posts', []): glass[:, p0:p1 + 1] = False
        hole |= glass
    a[hole] = 0
    Image.fromarray(a).save(dst, optimize=True)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)

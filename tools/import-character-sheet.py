"""Import character sheets from 素材/ into the game's sprite assets.

A sheet is one character drawn three times on white paper: front, side, back, left to
right. This script cuts the three figures apart, keys the paper out with a border-seeded
flood fill (so white clothing inside the silhouette survives), normalises every figure to
the same sprite height, and writes:

    assets/characters/<id>/{front,side,back}.webp
    assets/characters/manifest.json            (existing entries are kept)

Run with the bundled python:
    python tools/import-character-sheet.py
Add `--preview DIR` to only write preview PNGs into DIR and leave assets/ alone.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / '素材'
OUT = ROOT / 'assets' / 'characters'

TARGET_H = 720        # same sprite height as the rest of the cast
TOL = 26              # per-channel distance still counted as paper
FEATHER = 0.7         # alpha blur, softens the keyed edge
VIEWS = ('front', 'side', 'back')

# sheet file name -> (id, sheet order matters only for the log)
SHEETS = {
    'o0aECSykABcERCKlWxiAggIieA02AzWfAAC1Ar~tplv-dy-aweme-images_q75.png': 'npc-lotus',
    'o4ARcr1aBIACyl0gAKiAC7eWyCfN1AAEiDgkAE~tplv-dy-aweme-images_q75.png': 'npc-inkstone',
    'o8ARcr2aBIACzl0gAKiACmeWyCfz1AAEiBgkAE~tplv-dy-aweme-images_q75.png': 'npc-mio',
    'oEAeBigREa1AKnACIClAyCiAkE3ocAfr0nA1gW~tplv-dy-aweme-images_q75.png': 'npc-yuki',
    'oEES3eC1UElcgiK901ABCgAACyAfAWaARIAkir~tplv-dy-aweme-images_q75.png': 'npc-scorch',
    'ogeI9XLAmATIAtACLUGfwXQgeIAwtftDfLoHHE~tplv-dy-aweme-images_q75.png': 'npc-haze',
    'oUakENC1AgAI1Ae2AiMCfAyAlWSBEi0grCKcRA~tplv-dy-aweme-images_q75.png': 'npc-amber',
}


def bg_color(rgb):
    h, w, _ = rgb.shape
    ring = np.concatenate([
        rgb[0:2].reshape(-1, 3), rgb[h - 2:h].reshape(-1, 3),
        rgb[:, 0:2].reshape(-1, 3), rgb[:, w - 2:w].reshape(-1, 3),
    ])
    return np.array(Counter(map(tuple, ring.tolist())).most_common(1)[0][0], dtype=np.int16)


def flood_bg(cand):
    """Scanline flood fill of `cand` seeded from every border pixel."""
    h, w = cand.shape
    filled = np.zeros((h, w), bool)
    stack = deque()
    for x in range(w):
        if cand[0, x]:
            stack.append((0, x))
        if cand[h - 1, x]:
            stack.append((h - 1, x))
    for y in range(h):
        if cand[y, 0]:
            stack.append((y, 0))
        if cand[y, w - 1]:
            stack.append((y, w - 1))
    while stack:
        y, x = stack.pop()
        if filled[y, x] or not cand[y, x]:
            continue
        x1 = x
        while x1 > 0 and cand[y, x1 - 1] and not filled[y, x1 - 1]:
            x1 -= 1
        x2 = x
        while x2 < w - 1 and cand[y, x2 + 1] and not filled[y, x2 + 1]:
            x2 += 1
        filled[y, x1:x2 + 1] = True
        for ny in (y - 1, y + 1):
            if 0 <= ny < h:
                row = cand[ny, x1:x2 + 1] & ~filled[ny, x1:x2 + 1]
                if row.any():
                    for i in np.nonzero(row)[0]:
                        stack.append((ny, x1 + int(i)))
        for nx in (x1 - 1, x2 + 1):
            if 0 <= nx < w and cand[y, nx] and not filled[y, nx]:
                stack.append((y, nx))
    return filled


def key_out(img):
    rgb = np.asarray(img.convert('RGB'), dtype=np.int16)
    paper = flood_bg(np.abs(rgb - bg_color(rgb)).max(axis=2) <= TOL)
    alpha = np.where(paper, 0, 255).astype(np.uint8)
    alpha = np.asarray(Image.fromarray(alpha, 'L').filter(ImageFilter.GaussianBlur(FEATHER)))
    alpha = np.where(paper, np.minimum(alpha, 250), 255).astype(np.uint8)
    rgba = np.dstack([np.asarray(img.convert('RGB'), dtype=np.uint8), alpha])
    ys, xs = np.nonzero(alpha > 8)
    return rgba, (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)


def runs(flags, min_len):
    idx = np.nonzero(flags)[0]
    if idx.size == 0:
        return []
    out, start, prev = [], int(idx[0]), int(idx[0])
    for v in idx[1:]:
        v = int(v)
        if v == prev + 1:
            prev = v
            continue
        if prev - start + 1 >= min_len:
            out.append((start, prev))
        start = prev = v
    if prev - start + 1 >= min_len:
        out.append((start, prev))
    return out


def bands_of(rgb):
    """Three column bands. When the figures touch, cut at the two deepest troughs."""
    mask = np.abs(rgb - bg_color(rgb)).max(axis=2) > 18
    col = mask.mean(axis=0)
    bands = runs(col > 0.004, max(8, rgb.shape[1] // 80))
    if len(bands) == 3:
        return bands
    w = rgb.shape[1]
    lo, hi = int(w * 0.18), int(w * 0.82)
    sm = np.convolve(col, np.ones(9) / 9, mode='same')
    first = lo + int(np.argmin(sm[lo:int(w * 0.5)]))
    second = int(w * 0.5) + int(np.argmin(sm[int(w * 0.5):hi]))
    return [(a, b) for a, b in ((0, first - 1), (first, second - 1), (second, w - 1))
            if b - a > w * 0.1]


def extract(path: Path):
    """-> list of (label, PIL RGBA at TARGET_H), one per figure, left to right."""
    im = Image.open(path)
    rgb = np.asarray(im.convert('RGB'), dtype=np.int16)
    out = []
    for (x0, x1) in bands_of(rgb):
        crop = im.crop((x0, 0, x1 + 1, im.height))
        rgba, bbox = key_out(crop)
        bw, bh = bbox[2] - bbox[0], bbox[3] - bbox[1]
        fig = Image.fromarray(rgba, 'RGBA').crop(bbox)
        scale = TARGET_H / bh
        out.append(fig.resize((max(1, round(bw * scale)), TARGET_H), Image.LANCZOS))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--preview', metavar='DIR', help='only dump PNGs here, do not touch assets/')
    args = ap.parse_args()

    if not SRC.is_dir():
        sys.exit(f'no {SRC}')

    preview = Path(args.preview) if args.preview else None
    if preview:
        preview.mkdir(parents=True, exist_ok=True)

    manifest_path = OUT / 'manifest.json'
    manifest = json.loads(manifest_path.read_text('utf-8')) if manifest_path.exists() else {}
    added = []

    for sheet, cid in SHEETS.items():
        path = SRC / sheet
        if not path.exists():
            print(f'! missing sheet {sheet}')
            continue
        figs = extract(path)
        if len(figs) != 3:
            print(f'! {cid}: {len(figs)} figures instead of 3 — skipped')
            continue
        entry = {'id': cid, 'height': TARGET_H, 'views': {}}
        for view, fig in zip(VIEWS, figs):
            if preview:
                fig.save(preview / f'{cid}-{view}.png')
            else:
                dest = OUT / cid
                dest.mkdir(parents=True, exist_ok=True)
                fig.save(dest / f'{view}.webp', 'WEBP', quality=92, method=6)
            entry['views'][view] = {'w': fig.width, 'h': fig.height,
                                    'aspect': round(fig.width / fig.height, 4)}
        manifest[cid] = entry
        added.append((cid, [f'{f.width}x{f.height}' for f in figs]))
        print(f'{cid:14s} {path.name[:18]} -> ' + ', '.join(f'{v}={a}' for v, a in zip(VIEWS, added[-1][1])))

    if not preview:
        manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), 'utf-8')
        total = sum(f.stat().st_size for f in OUT.rglob('*.webp'))
        print(f'\n{len(added)} characters imported, {len(manifest)} in manifest, '
              f'{total / 1024 / 1024:.2f} MB of WebP')


if __name__ == '__main__':
    main()
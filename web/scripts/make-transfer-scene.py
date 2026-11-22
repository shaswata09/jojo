"""
Draws the Transfer scene's two textures: web/public/transfer/scene.png and
web/public/transfer/scene-depth.webp.

WHY THIS FILE EXISTS

The scene used to sample two images that an earlier version of the Transfer
page pulled from a third-party image host and that were then vendored to stop
the request. Where they came from was never written down, so nobody could say
who owned them or under what terms they shipped. Rather than guess at a
licence, the owner chose to replace them with a picture this repository draws
itself. Everything below is original: the subject, the composition, the
lighting and the depth map are all computed here from a handful of numbers, so
the provenance of the shipped pixels is this file and nothing else.

WHAT IT DRAWS

Two devices and the records moving between them, which is what the Transfer
page does. A wide slab on the left, further back, stands for the computer; its
screen shows a small board of cards with one slot empty. A phone on the right,
nearer, shows a list with one fresh card at the top. Between them a stream of
the same cards arcs through the air from the far device to the near one.

The arc is laid out so that every card along it is nearer the camera than the
one before, so the depth map rises smoothly from the computer to the phone.
DataTransferScene.tsx (jojo's own scene, rewritten clean-room on 2026-11-21)
uses the depth for a gentle parallax and sends packets of light along lanes
fitted to this arc — so if the geometry here changes, re-fit those lanes.

The ground is a floor plane that exists only in the depth map. The colour map
leaves it transparent black, the same as the old image, but its depth rises
smoothly from the top of the frame to the bottom. Two reasons:

  - No flat region anywhere. A patch of constant depth lights up all at once
    when the band reaches its value, and the sweep lingers longest at its two
    ends; a flat sky at depth 0 would flash a red slab across the top of the
    card about one second in every twelve.
  - On the floor the band reads as a horizontal line moving down the frame,
    which ties the contours on the objects to a scan of the whole scene.

The camera looks down far enough that the floor fills the frame behind the
subject and no horizon shows.

THE TWO FILES

  scene.png         626 x 626 RGBA. Colour, premultiplied onto black, alpha is
                    coverage. The WebGPU path ignores the alpha (the plane is
                    opaque and the ground is black either way); the still
                    fallback is an <img>, and there the alpha lets the panel
                    show through around the subject.
  scene-depth.webp  626 x 626, greyscale stored as RGB, lossless. The shader
                    reads `.r` only. White is near. Values are monotonic in
                    inverse distance (what parallax is proportional to), then
                    remapped piecewise so the subject gets most of the 0..1
                    range and the floor the rest — ordering is preserved, so
                    the floor's contour line meets each object exactly where
                    that object stands.

Lossless rather than lossy for the depth: the band is two hundredths of the
range wide, and block artefacts from a lossy encoder would show up as ragged
contours, which is the one place the depth map is ever looked at directly.

The size has to stay 626 x 626 unless textures.ts changes with it; the plane's
aspect comes from MAP_WIDTH / MAP_HEIGHT there.

HOW TO RUN

    python3 web/scripts/make-transfer-scene.py            # writes both files
    python3 web/scripts/make-transfer-scene.py --out DIR  # writes into DIR

Needs numpy and Pillow (with WebP support, which the standard wheels have). No
network, no randomness: the same inputs give the same pixels. It ray-marches
signed distance fields at twice the output size and averages down, which takes
on the order of a minute.
"""

from __future__ import annotations

import argparse
import math
import os

import numpy as np
from PIL import Image

SIZE = 626
SUPERSAMPLE = 2

# ── Palette ──────────────────────────────────────────────────────────────────
# Linear-light values. The orange is jojo's (#ff7a1a family; the guided tour's
# --tour is #e2772f) converted to linear; the graphite is a near-black with a
# touch of warmth so it does not go blue next to the orange.

ORANGE = np.array([1.0, 0.195, 0.010])  # ≈ #ff7a1a in linear light
ORANGE_SOFT = np.array([0.80, 0.24, 0.05])
GRAPHITE = np.array([0.060, 0.057, 0.055])
CARD = np.array([0.150, 0.145, 0.140])
INK = np.array([0.50, 0.49, 0.47])
SCREEN = np.array([0.010, 0.0095, 0.009])
KEY_COLOUR = np.array([1.0, 0.96, 0.92])

# ── Camera ───────────────────────────────────────────────────────────────────

CAM_POS = np.array([0.30, 2.45, 7.6])
CAM_TARGET = np.array([0.0, 0.10, 0.0])
FOV_DEG = 33.0
FLOOR_Y = -1.05


def normalize(v):
    return v / np.linalg.norm(v, axis=-1, keepdims=True)


def rot(yaw=0.0, pitch=0.0, roll=0.0):
    """Local-to-world rotation from degrees: roll about z, then pitch about x, then yaw about y."""
    y, p, r = (math.radians(a) for a in (yaw, pitch, roll))
    ry = np.array([[math.cos(y), 0, math.sin(y)], [0, 1, 0], [-math.sin(y), 0, math.cos(y)]])
    rx = np.array([[1, 0, 0], [0, math.cos(p), -math.sin(p)], [0, math.sin(p), math.cos(p)]])
    rz = np.array([[math.cos(r), -math.sin(r), 0], [math.sin(r), math.cos(r), 0], [0, 0, 1]])
    return ry @ rx @ rz


class Slab:
    """A rounded box. `half` is the half-size, `radius` the corner rounding; local +z is the face."""

    def __init__(self, kind, centre, rotation, half, radius, screen=None):
        self.kind = kind
        self.centre = np.asarray(centre, dtype=float)
        self.rotation = rotation
        self.half = np.asarray(half, dtype=float)
        self.radius = radius
        self.screen = screen

    def local(self, p):
        return (p - self.centre) @ self.rotation  # world → local is R^T, i.e. p @ R

    def sdf(self, p):
        q = np.abs(self.local(p)) - self.half + self.radius
        outside = np.linalg.norm(np.maximum(q, 0.0), axis=-1)
        inside = np.minimum(np.max(q, axis=-1), 0.0)
        return outside + inside - self.radius

    def front_point(self, lift=0.0):
        return self.centre + self.rotation @ np.array([0.0, 0.0, self.half[2] + lift])


# ── The scene ────────────────────────────────────────────────────────────────

COMPUTER = Slab(
    'computer',
    centre=(-1.30, 0.22, -1.05),
    rotation=rot(yaw=30, pitch=-6, roll=1.5),
    half=(1.02, 0.66, 0.05),
    radius=0.045,
    screen='board',
)

PHONE = Slab(
    'phone',
    centre=(1.30, -0.10, 0.95),
    rotation=rot(yaw=-26, pitch=-9, roll=-5),
    half=(0.31, 0.62, 0.045),
    radius=0.075,
    screen='list',
)


def bezier(p0, p1, p2, p3, t):
    s = 1 - t
    return s**3 * p0 + 3 * s * s * t * p1 + 3 * s * t * t * p2 + t**3 * p3


class Bit:
    """A small glowing sphere: the loose data that travels with the cards."""

    kind = 'bit'
    screen = None

    def __init__(self, centre, radius):
        self.centre = np.asarray(centre, dtype=float)
        self.radius = radius
        self.rotation = np.eye(3)
        self.half = np.zeros(3)

    def local(self, p):
        return p - self.centre

    def sdf(self, p):
        return np.linalg.norm(p - self.centre, axis=-1) - self.radius


def arc():
    """The flight path: a raised cubic from just off the computer's screen to just off the phone's."""
    start = COMPUTER.front_point(0.12) + np.array([0.25, 0.10, 0.0])
    end = PHONE.front_point(0.12) + np.array([-0.05, 0.12, 0.0])
    c1 = start + np.array([0.70, 1.25, 0.40])
    c2 = end + np.array([-0.85, 1.20, -0.35])
    return start, c1, c2, end


def card_stream():
    """The cards in flight, along `arc()`.

    Spacing is uneven on purpose — a tight cluster leaving, a looser run across
    the top, a cluster arriving — so it reads as traffic rather than a ruler.
    Each card turns from the computer's angle to the phone's as it goes, with a
    roll and a dip in the middle of the flight so the faces catch the light at
    different angles instead of presenting one flat row.
    """
    path = arc()
    ts = [0.06, 0.14, 0.27, 0.39, 0.51, 0.63, 0.74, 0.84, 0.93]
    scales = [0.95, 0.88, 0.92, 0.84, 0.90, 0.86, 0.95, 0.90, 1.0]
    cards = []
    for i, (t, k) in enumerate(zip(ts, scales)):
        mid = math.sin(math.pi * t)
        yaw = 30 + (-26 - 30) * t
        pitch = -6 + (-9 + 6) * t - 32 * mid
        roll = 1.5 + (-5 - 1.5) * t + (24 if i % 2 else -18) * mid
        cards.append(
            Slab(
                'card',
                centre=bezier(*path, t),
                rotation=rot(yaw=yaw, pitch=pitch, roll=roll),
                half=(0.20 * k, 0.12 * k, 0.018),
                radius=0.016,
                screen='card',
            )
        )
    return cards


def bit_stream():
    """Sparks between and around the cards, scattered about the same arc.

    The scatter is a fixed function of the index (golden-angle offsets), not a
    random draw, so the picture is the same on every run without a seed to keep.
    """
    path = arc()
    bits = []
    count = 26
    golden = math.pi * (3 - math.sqrt(5))
    for i in range(count):
        t = 0.04 + 0.92 * (i + 0.5) / count
        spread = 0.10 + 0.16 * math.sin(math.pi * t)
        a = i * golden
        offset = np.array([math.cos(a) * 0.6, math.sin(a), math.cos(a * 1.7) * 0.8]) * spread
        r = 0.012 + 0.012 * ((i * 7) % 5) / 4
        bits.append(Bit(bezier(*path, t) + offset, r))
    return bits


OBJECTS = [COMPUTER, PHONE, *card_stream(), *bit_stream()]


def scene_sdf(p):
    d = OBJECTS[0].sdf(p)
    for obj in OBJECTS[1:]:
        d = np.minimum(d, obj.sdf(p))
    return d


def scene_id(p):
    ds = np.stack([obj.sdf(p) for obj in OBJECTS], axis=0)
    return np.argmin(ds, axis=0)


# ── 2D drawing helpers for the screens ───────────────────────────────────────


def rounded_rect(x, y, cx, cy, hw, hh, r, aa):
    """Coverage (0..1) of a rounded rectangle, antialiased over `aa` units."""
    qx = np.abs(x - cx) - hw + r
    qy = np.abs(y - cy) - hh + r
    d = np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - r
    return np.clip(0.5 - d / aa, 0.0, 1.0)


def circle(x, y, cx, cy, r, aa):
    return np.clip(0.5 - (np.hypot(x - cx, y - cy) - r) / aa, 0.0, 1.0)


def paint_card(colour, x, y, w, h, cx, cy, aa, lit=False, ghost=False):
    """One record card: a body, a status dot, two lines of 'text'. In place on `colour`.

    `x`, `y` are in the face's own units (y down); the card is w × h, centred.
    `ghost` draws only a dim outline — the slot a card has just left.
    """
    body = rounded_rect(x, y, cx, cy, w / 2, h / 2, h * 0.18, aa)
    if ghost:
        inner = rounded_rect(x, y, cx, cy, w / 2 - aa * 1.6, h / 2 - aa * 1.6, h * 0.16, aa)
        edge = np.clip(body - inner, 0, 1)
        colour += edge[..., None] * ORANGE_SOFT * 0.35
        return
    colour *= 1 - body[..., None]
    colour += body[..., None] * (CARD * (1.6 if lit else 1.0))
    dot = circle(x, y, cx - w * 0.36, cy, h * 0.13, aa)
    colour += dot[..., None] * (ORANGE * (1.0 if lit else 0.8) - colour * 0.9)
    line1 = rounded_rect(x, y, cx + w * 0.02, cy - h * 0.13, w * 0.24, h * 0.07, h * 0.07, aa)
    line2 = rounded_rect(x, y, cx - w * 0.06, cy + h * 0.15, w * 0.16, h * 0.055, h * 0.055, aa)
    colour += line1[..., None] * (INK * 0.9 - colour) * 0.9
    colour += line2[..., None] * (INK * 0.5 - colour) * 0.9
    if lit:
        ring = np.clip(
            body - rounded_rect(x, y, cx, cy, w / 2 - aa * 1.4, h / 2 - aa * 1.4, h * 0.16, aa), 0, 1
        )
        colour += ring[..., None] * ORANGE * 0.55


def screen_colour(obj, lx, ly, aa):
    """Colour of a face at local (lx, ly), for the points that landed on the front."""
    n = lx.shape[0]
    hx, hy = obj.half[0], obj.half[1]

    if obj.screen == 'card':
        # The flying card's face is the card itself, edge to edge.
        colour = np.tile(CARD, (n, 1))
        w, h = 2 * hx, 2 * hy
        dot = circle(lx, -ly, -w * 0.34, 0, h * 0.14, aa)
        colour += dot[..., None] * (ORANGE * 1.0 - colour)
        line1 = rounded_rect(lx, -ly, w * 0.06, -h * 0.13, w * 0.26, h * 0.07, h * 0.07, aa)
        line2 = rounded_rect(lx, -ly, -w * 0.03, h * 0.16, w * 0.17, h * 0.055, h * 0.055, aa)
        colour += line1[..., None] * (INK - colour) * 0.9
        colour += line2[..., None] * (INK * 0.55 - colour) * 0.9
        return colour, np.ones(n, dtype=bool)

    bezel = 0.05 if obj.screen == 'board' else 0.045
    sx, sy = hx - bezel, hy - bezel * (1.0 if obj.screen == 'board' else 1.6)
    on = (np.abs(lx) < sx) & (np.abs(ly) < sy)
    # Screen coordinates: u across 0..1, v down 0..1, measured in the face's
    # own units so cards stay rectangular on both devices.
    x = lx + sx
    y = sy - ly
    colour = np.tile(SCREEN, (n, 1))
    # A low warm glow from the bottom edge: the screen is on, and it is
    # jojo's colour that it is lit with.
    glow = np.clip(y / (2 * sy), 0, 1) ** 3
    colour += glow[..., None] * ORANGE * 0.006

    if obj.screen == 'board':
        # Three columns, the middle one missing its second card.
        W = 2 * sx
        col_w = W / 3
        cw, ch = col_w * 0.82, 0.19
        layout = [(0, 3), (1, 3), (2, 2)]
        for c, count in layout:
            cx = col_w * (c + 0.5)
            header = rounded_rect(x, y, cx - cw * 0.22, 0.10, cw * 0.26, 0.022, 0.02, aa)
            colour += header[..., None] * (INK * 0.6 - colour) * 0.9
            for r in range(count):
                cy = 0.27 + r * 0.25
                paint_card(colour, x, y, cw, ch, cx, cy, aa, ghost=(c == 1 and r == 1))
    else:
        W = 2 * sx
        cw, ch = W * 0.86, 0.17
        for r in range(5):
            cy = 0.16 + r * 0.215
            paint_card(colour, x, y, cw, ch, W / 2, cy, aa, lit=(r == 0))
    return colour, on


# ── Ray marching ─────────────────────────────────────────────────────────────


def camera_rays(n):
    forward = normalize(CAM_TARGET - CAM_POS)
    right = normalize(np.cross(forward, np.array([0.0, 1.0, 0.0])))
    up = np.cross(right, forward)
    half = math.tan(math.radians(FOV_DEG) / 2)
    coords = (np.arange(n) + 0.5) / n * 2 - 1
    sx, sy = np.meshgrid(coords * half, -coords * half)
    dirs = forward + sx[..., None] * right + sy[..., None] * up
    return normalize(dirs.reshape(-1, 3)), forward


def march(origins, dirs, t_max=20.0, steps=220):
    t = np.zeros(len(dirs))
    hit = np.zeros(len(dirs), dtype=bool)
    live = np.arange(len(dirs))
    for _ in range(steps):
        if live.size == 0:
            break
        p = origins + dirs[live] * t[live, None]
        d = scene_sdf(p)
        t[live] += d
        done = d < 2e-4
        hit[live[done]] = True
        gone = t[live] > t_max
        live = live[~(done | gone)]
    return t, hit


def normals_at(p, eps=6e-4):
    e = np.eye(3) * eps
    g = np.stack([scene_sdf(p + e[i]) - scene_sdf(p - e[i]) for i in range(3)], axis=-1)
    return normalize(g)


def ambient_occlusion(p, n):
    occ = np.zeros(len(p))
    weight = 1.0
    for i in range(1, 6):
        h = 0.035 * i
        occ += (h - scene_sdf(p + n * h)) * weight
        weight *= 0.7
    return np.clip(1 - 3.2 * occ, 0.0, 1.0)


def soft_shadow(p, light, k=10.0):
    res = np.ones(len(p))
    t = np.full(len(p), 0.02)
    for _ in range(48):
        d = scene_sdf(p + light * t[:, None])
        res = np.minimum(res, k * d / t)
        t += np.clip(d, 0.01, 0.25)
    return np.clip(res, 0.0, 1.0)


def shade(p, n, view, ids, aa):
    key = normalize(np.array([-0.55, 0.85, 0.55]))
    rim = normalize(np.array([0.75, 0.35, -0.75]))
    under = normalize(np.array([0.1, -1.0, 0.25]))

    albedo = np.tile(GRAPHITE, (len(p), 1))
    emissive = np.zeros((len(p), 3))
    gloss = np.full(len(p), 70.0)
    spec_k = np.full(len(p), 0.55)

    for k, obj in enumerate(OBJECTS):
        sel = np.nonzero(ids == k)[0]
        if sel.size == 0:
            continue
        if obj.kind == 'bit':
            # Lit from inside: brightest facing the camera, falling off to the
            # limb, so each reads as a small glowing bead rather than a disc.
            facing = np.clip(np.sum(n[sel] * view[sel], axis=1), 0, 1)
            emissive[sel] = ORANGE[None, :] * (0.35 + 0.9 * facing[:, None] ** 2)
            albedo[sel] = 0.0
            spec_k[sel] = 0.2
            continue
        local = obj.local(p[sel])
        nl = n[sel] @ obj.rotation
        front = (nl[:, 2] > 0.85) & (local[:, 2] > obj.half[2] - 0.01)
        f = sel[front]
        if f.size:
            col, on = screen_colour(obj, local[front, 0], local[front, 1], aa[f])
            if obj.screen == 'card':
                albedo[f] = col
            else:
                # A screen is a light source, not a painted surface: it keeps
                # its picture whichever way the key light falls, and it is
                # glass, so it reflects a little more sharply than the frame.
                g = f[on]
                albedo[g] = col[on] * 0.25
                emissive[g] = col[on]
                gloss[g] = 140.0
                spec_k[g] = 0.35

    ao = ambient_occlusion(p, n)
    shadow = soft_shadow(p + n * 0.003, key)

    ndl = np.clip((n @ key) * 0.8 + 0.2, 0.0, 1.0)  # a little wrap: graphite, not chrome
    diffuse = albedo * (KEY_COLOUR * (ndl * (0.35 + 0.65 * shadow))[:, None] * 1.3)
    half = normalize(key + view)
    spec = (np.clip(np.sum(n * half, axis=1), 0, 1) ** gloss * spec_k * shadow)[:, None] * KEY_COLOUR

    # The rim is what makes the subject belong to jojo: an orange light from
    # behind and to the right, strongest at grazing angles, so every edge that
    # turns away from the camera is drawn in the accent colour.
    fres = np.clip(1 - np.abs(np.sum(n * view, axis=1)), 0, 1) ** 2.2
    rim_term = (np.clip(n @ rim, 0, 1) * (0.1 + 0.9 * fres))[:, None] * ORANGE * 1.8

    # Warm bounce from below, as if off an orange-lit floor; keeps the
    # undersides from going to dead black.
    bounce = (np.clip(n @ under, 0, 1) * 0.10)[:, None] * ORANGE_SOFT
    ambient = albedo * 0.35

    colour = (diffuse + ambient + bounce) * ao[:, None] + spec + rim_term * ao[:, None] ** 0.5
    return colour + emissive


def tone(x):
    """Soft shoulder then sRGB. Keeps the rim from clipping to flat orange."""
    x = 1.0 - np.exp(-x * 1.15)
    a = 0.055
    return np.where(x <= 0.0031308, 12.92 * x, (1 + a) * np.power(np.clip(x, 0, None), 1 / 2.4) - a)


def render(size=SIZE, ss=SUPERSAMPLE):
    n = size * ss
    dirs, forward = camera_rays(n)
    origins = CAM_POS
    t, hit = march(origins, dirs)

    colour = np.zeros((len(dirs), 3))
    hp = np.nonzero(hit)[0]
    p = origins + dirs[hp] * t[hp, None]
    nrm = normals_at(p)
    ids = scene_id(p)
    # One output pixel, in world units at this distance, for the screens' edges.
    aa = (t[hp] * 2 * math.tan(math.radians(FOV_DEG) / 2) / size)
    colour[hp] = shade(p, nrm, -dirs[hp], ids, aa)

    # Depth along the camera axis — objects where the march hit, the floor
    # plane everywhere else.
    z = np.full(len(dirs), np.inf)
    z[hp] = (dirs[hp] @ forward) * t[hp]
    down = dirs[:, 1] < 0
    t_floor = np.where(down, (FLOOR_Y - CAM_POS[1]) / np.where(down, dirs[:, 1], -1), np.inf)
    z_floor = (dirs @ forward) * t_floor
    z = np.where(hit, z, z_floor)
    if not np.all(np.isfinite(z)):
        raise SystemExit('the horizon is in frame: tilt the camera down so the floor fills it')

    disparity = 1.0 / z
    obj_far = disparity[hp].min()
    obj_near = disparity[hp].max()
    # Increasing everywhere, so ordering survives, but not one straight line:
    #
    #   floor behind the subject   0.04 – 0.30
    #   the subject                0.30 – 0.88   linear in disparity
    #   floor nearer than it       0.88 – 1.00
    #
    # Most of the band's travel is spent on the things that are the point of
    # the picture. The two floor segments are spread by rank (each value goes
    # to its place in the sorted list of that segment's pixels) rather than
    # linearly. Disparity on a receding floor changes slowly near the top of
    # the frame and quickly near the bottom, so a linear map draws the band as
    # a fat slab at the top and a hairline at the bottom; by rank, every row of
    # floor gets about the same share of the range and the line keeps one
    # thickness all the way down. Ranking is monotonic, so where the floor's
    # line meets an object is still exactly where that object stands.
    depth = np.empty_like(disparity)
    behind = disparity < obj_far
    infront = disparity > obj_near
    middle = ~(behind | infront)
    depth[middle] = 0.30 + 0.58 * (disparity[middle] - obj_far) / (obj_near - obj_far)

    def by_rank(values, low, high):
        if values.size == 0:
            return values
        ranks = np.argsort(np.argsort(values, kind='stable'), kind='stable')
        return low + (high - low) * ranks / max(values.size - 1, 1)

    depth[behind] = by_rank(disparity[behind], 0.04, 0.30)
    depth[infront] = by_rank(disparity[infront], 0.88, 1.0)

    def down_sample(a):
        c = a.reshape(size, ss, size, ss, -1).mean(axis=(1, 3))
        return c

    rgb = down_sample(colour.reshape(n, n, 3))
    alpha = down_sample(hit.astype(float).reshape(n, n, 1))[..., 0]
    dep = down_sample(depth.reshape(n, n, 1))[..., 0]

    srgb = tone(rgb)  # premultiplied onto black already: misses are 0
    rgba = np.dstack([srgb, alpha])
    rgba8 = np.clip(np.round(rgba * 255), 0, 255).astype(np.uint8)
    dep8 = np.clip(np.round(dep * 255), 0, 255).astype(np.uint8)
    return rgba8, dep8


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    default_out = os.path.join(os.path.dirname(here), 'public', 'transfer')
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--out', default=default_out, help='directory to write both files into')
    args = ap.parse_args()

    rgba, depth = render()
    os.makedirs(args.out, exist_ok=True)
    colour_path = os.path.join(args.out, 'scene.png')
    depth_path = os.path.join(args.out, 'scene-depth.webp')
    Image.fromarray(rgba, 'RGBA').save(colour_path, optimize=True)
    Image.fromarray(np.dstack([depth] * 3), 'RGB').save(depth_path, lossless=True, quality=100, method=6)
    print(f'wrote {colour_path} and {depth_path} ({SIZE}x{SIZE})')


if __name__ == '__main__':
    main()

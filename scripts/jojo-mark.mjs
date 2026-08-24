/**
 * jojo's mark, as pixels: the robot head from `web/public/favicon.svg`.
 *
 * One drawing, three consumers — the browser tab has the SVG, the extension
 * toolbar and the two app launchers have rasters off this file. They must agree,
 * because a person sees the tab, the toolbar button and the home-screen icon
 * within a minute of each other and nothing tells them those are one product
 * except that they look like one.
 *
 * WHY RASTERISE IN PLAIN NODE. A browser step needs a browser on whatever
 * machine builds this and was measurably flaky; a native image library is a
 * compiled dependency for four hundred lines of rectangles. What is left is the
 * geometry below and thirty lines of zlib, both of which a reviewer can read.
 *
 * THE GEOMETRY IS THE FAVICON'S, in the favicon's own 512-unit viewBox, copied
 * across unchanged. That is the point: `favicon.svg` is the source, and moving
 * an ear there is a two-number edit here. What is deliberately NOT copied is the
 * favicon's shading — the darker left edge on head, visor and each eye. Those
 * paths are a few units wide at 512 and land inside a single pixel at 16, where
 * they only muddy the colour.
 */

import { deflateSync } from "node:zlib";

/** The favicon's palette, by the name of the thing it colours. */
export const PALETTE = {
  plate: [23, 23, 23], // #171717
  ear: [174, 182, 191], // #aeb6bf
  head: [230, 231, 232], // #e6e7e8
  visor: [87, 89, 107], // #57596b
  eye: [113, 220, 239], // #71dcef
};

/**
 * The head as a silhouette: one opaque colour, with the visor knocked out.
 *
 * Android's themed icons take the alpha channel of a `monochrome` layer and
 * paint it in whatever the wallpaper says, so only the SHAPE survives. A solid
 * blob of head would survive as a blob; leaving the visor transparent and the
 * eyes inside it opaque is what keeps it reading as a face at 48dp.
 */
export const SILHOUETTE = {
  plate: null,
  ear: [0, 0, 0],
  head: [0, 0, 0],
  visor: null,
  eye: [0, 0, 0],
};

/** Inside a rounded rectangle — the shape an SVG `rx` describes. */
function inRounded(x, y, rx, ry, w, h, r) {
  if (x < rx || y < ry || x > rx + w || y > ry + h) return false;
  const cx = Math.min(Math.max(x, rx + r), rx + w - r);
  const cy = Math.min(Math.max(y, ry + r), ry + h - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

/**
 * Which part of the robot covers this point, in the favicon's 512-unit space.
 *
 * Tested front to back, so the answer is what a viewer would SEE rather than
 * what was drawn last: eyes, the visor they sit in, the head around it, then the
 * ears. Ears last is load-bearing — they run from x=8 and the head starts at
 * x=46, so the two overlap by 18 units and the SVG paints the head over them.
 */
function robotAt(x, y) {
  if (inCircle(x, y, 196, 256, 41)) return "eye";
  if (inCircle(x, y, 316, 256, 41)) return "eye";
  if (inRounded(x, y, 106, 153, 300, 206, 99)) return "visor";
  if (inRounded(x, y, 46, 117, 420, 278, 133)) return "head";
  if (inRounded(x, y, 8, 200, 56, 112, 21)) return "ear";
  if (inRounded(x, y, 448, 200, 56, 112, 21)) return "ear";
  return null;
}

/**
 * The plate behind the robot, in canvas space (0..1 on both axes).
 *
 *   `rounded` — the favicon's own squircle. Browser tab, extension, legacy icon.
 *   `square`  — edge to edge. iOS, which rounds the corners itself and rejects
 *               an icon that arrives with a transparent pixel in them.
 *   `circle`  — Android's `ic_launcher_round`, for launchers that ask for one.
 *   `none`    — no plate at all. The adaptive foreground layer, which is drawn
 *               over a separate background and must not paint its own.
 */
function onPlate(x, y, shape) {
  if (shape === "square") return true;
  if (shape === "circle") return inCircle(x, y, 0.5, 0.5, 0.5);
  if (shape === "rounded") return inRounded(x, y, 0, 0, 1, 1, 115 / 512);
  return false;
}

/**
 * How much of the canvas the favicon's 512-unit box should cover.
 *
 * On a full-bleed icon, all of it. On Android's adaptive canvas it has to
 * shrink, and the reason is masking: of the 108dp a launcher is handed, the
 * outer 18dp on each side is the system's to crop, so the mark has to live
 * inside the middle 72dp — and on the round mask most launchers use, inside a
 * 72dp CIRCLE rather than a square. What decides the size is therefore not the
 * robot's width but its farthest corner from centre, which is the outer top
 * corner of an ear.
 *
 * Sized so that corner sits on a 60dp circle, six dp clear of the 72dp one that
 * gets cropped. That margin is the whole point and was learnt the hard way: at
 * 68dp across, which is what "fits inside 72" works out to, the ears cleared the
 * crop by 1.1dp and the icon rendered on a Pixel with its ears grazing the edge
 * of the circle. A mark that touches its own mask reads as a mistake even to
 * someone who could not say why.
 */
const MARK_DIAMETER_DP = 60;
const ADAPTIVE_CANVAS_DP = 108;
/** The outer corner of an ear: (248, 56) from centre, in the favicon's units. */
const ROBOT_RADIUS = Math.hypot(248, 56);
export const ADAPTIVE_SPAN =
  (512 * (MARK_DIAMETER_DP / 2 / ROBOT_RADIUS)) / ADAPTIVE_CANVAS_DP;

/**
 * RGBA bytes for one square icon.
 *
 * Supersampled 4x per axis, which is what keeps the plate's rounded corner and
 * the eyes from stair-stepping. Coverage becomes alpha: a pixel half inside the
 * plate comes out half opaque, so the edge is antialiased without anything
 * anywhere knowing what antialiasing is.
 */
export function paint(
  size,
  { plate = "rounded", span = 1, colors = PALETTE, samples = 4 } = {},
) {
  const px = Buffer.alloc(size * size * 4);
  const total = samples * samples;

  for (let iy = 0; iy < size; iy += 1) {
    for (let ix = 0; ix < size; ix += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let hits = 0;

      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const cx = (ix + (sx + 0.5) / samples) / size;
          const cy = (iy + (sy + 0.5) / samples) / size;

          // Outside the plate is outside the icon, robot included. It never
          // reaches that far at either span, but a clip that depends on the
          // artwork staying put is not a clip.
          const inside = onPlate(cx, cy, plate);
          if (!inside && plate !== "none") continue;

          // Canvas back to the favicon's own coordinates, about the centre.
          const part =
            robotAt(
              ((cx - 0.5) / span) * 512 + 256,
              ((cy - 0.5) / span) * 512 + 256,
            ) ?? (inside ? "plate" : null);

          const c = part === null ? null : colors[part];
          if (!c) continue;
          r += c[0];
          g += c[1];
          b += c[2];
          hits += 1;
        }
      }

      if (hits === 0) continue;
      const i = (iy * size + ix) * 4;
      px[i] = Math.round(r / hits);
      px[i + 1] = Math.round(g / hits);
      px[i + 2] = Math.round(b / hits);
      px[i + 3] = Math.round((hits / total) * 255);
    }
  }

  return px;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
}

/**
 * A minimal PNG: signature, IHDR, IDAT, IEND.
 *
 * `opaque` drops the alpha channel and writes colour type 2 rather than 6. That
 * is not a size optimisation — App Store Connect rejects an app icon that has an
 * alpha channel at all, whether or not any pixel in it is transparent.
 */
export function png(size, rgba, { opaque = false } = {}) {
  const stride = opaque ? 3 : 4;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = opaque ? 2 : 6; // truecolour, with alpha or without

  // Each scanline is prefixed with its filter type; 0 is "none", which costs a
  // little size and removes every way to get the filtering wrong.
  const row = size * stride + 1;
  const raw = Buffer.alloc(size * row);
  for (let y = 0; y < size; y += 1) {
    raw[y * row] = 0;
    for (let x = 0; x < size; x += 1) {
      const from = (y * size + x) * 4;
      const to = y * row + 1 + x * stride;
      raw[to] = rgba[from];
      raw[to + 1] = rgba[from + 1];
      raw[to + 2] = rgba[from + 2];
      if (!opaque) raw[to + 3] = rgba[from + 3];
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

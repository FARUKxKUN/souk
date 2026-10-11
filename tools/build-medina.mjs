/**
 * Procedural medina kit. Generates every piece of the souk's architecture and props in code,
 * with UVs into a tiny 8x4 flat-colour atlas, and writes one glb with one material, one
 * texture and one named node per piece (the same shape build-kit.mjs gives the KayKit packs).
 *
 * Nothing is downloaded: the geometry and the atlas are both made here, so the licence is ours.
 * Pieces are authored on a 2-unit module grid, +Z is the front, y=0 is the ground, and
 * door/window/awning pieces have their origin on the wall face so a recipe can stick them on.
 *
 * Usage: build-medina.mjs [out.glb]
 */
import { Document, NodeIO } from '@gltf-transform/core'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { deflateSync, crc32 } from 'node:zlib'

const OUT = process.argv[2] || 'public/assets/medina.glb'
const COLS = 8
const ROWS = 4
const CELL_PX = 32

/** Atlas swatches. Indices are part of kit.js's CELL table: change both together. */
const SWATCH = {
  0: 0xeee4d0, // plaster
  1: 0xf4f1ea, // WHITE whitewash
  2: 0xd9c7a3, // LIME limestone
  3: 0xb9a98c, // SHADE
  4: 0x24202f, // DARK doorway void
  5: 0x1f5fa8, // BLUE Bou Said
  6: 0x17487f, // BLUE_DARK
  7: 0xb5603a, // TERRA terracotta
  8: 0xb87333, // COPPER
  9: 0xe8a050, // LAMP lantern glass
  10: 0x7a5230, // WOOD
  11: 0xe0c58a, // TRIM: repainted to each repo's accent, glows at night
  12: 0xa8322d, // RED chechia
  13: 0x6b7a3a, // OLIVE
  14: 0xe9d9b0, // CREAM awning
  15: 0x3f8f86, // MINT dome tile
  16: 0x3a3a42, // IRON
  17: 0xc9a45a, // STRAW
}
const C = { WHITE: 1, LIME: 2, SHADE: 3, DARK: 4, BLUE: 5, BLUE_DARK: 6, TERRA: 7, COPPER: 8, LAMP: 9, WOOD: 10, TRIM: 11, RED: 12, OLIVE: 13, CREAM: 14, MINT: 15, IRON: 16, STRAW: 17 }

// ── tiny PNG writer ───────────────────────────────────────────────────────────────────
function png(w, h, rgb) {
  const stride = w * 3 + 1
  const raw = Buffer.alloc(stride * h)
  for (let y = 0; y < h; y++) rgb.copy(raw, y * stride + 1, y * w * 3, (y + 1) * w * 3)
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body) >>> 0)
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function atlasPng() {
  const w = COLS * CELL_PX
  const h = ROWS * CELL_PX
  const px = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cell = Math.floor(y / CELL_PX) * COLS + Math.floor(x / CELL_PX)
      const hex = SWATCH[cell] ?? 0xeee4d0
      const o = (y * w + x) * 3
      px[o] = (hex >> 16) & 255
      px[o + 1] = (hex >> 8) & 255
      px[o + 2] = hex & 255
    }
  }
  return png(w, h, px)
}

// ── vector helpers ────────────────────────────────────────────────────────────────────
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a) => {
  const l = Math.hypot(...a) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}
const centroid = (pts) => pts.reduce((s, p) => add(s, p), [0, 0, 0]).map((q) => q / pts.length)

// ── mesh builder ──────────────────────────────────────────────────────────────────────
class Mesh {
  constructor() {
    this.pos = []
    this.nrm = []
    this.uv = []
    this.idx = []
  }

  /** One flat convex polygon. Its normal points away from `ref` (or toward it if `inward`). */
  face(pts, cell, ref, inward = false) {
    const natural = norm(cross(sub(pts[1], pts[0]), sub(pts[2], pts[0])))
    const awayFromRef = dot(natural, sub(centroid(pts), ref)) >= 0
    const ordered = awayFromRef === !inward ? pts : [...pts].reverse()
    const n = norm(cross(sub(ordered[1], ordered[0]), sub(ordered[2], ordered[0])))
    const tu = ((cell % COLS) + 0.5) / COLS
    const tv = (Math.floor(cell / COLS) + 0.5) / ROWS
    const base = this.pos.length / 3
    for (const p of ordered) {
      this.pos.push(...p)
      this.nrm.push(...n)
      this.uv.push(tu, tv)
    }
    for (let i = 1; i < ordered.length - 1; i++) this.idx.push(base, base + i, base + i + 1)
  }

  /** A convex solid from points and faces (index lists). */
  solid(points, faces, cell) {
    const ref = centroid(points)
    for (const f of faces) this.face(f.map((i) => points[i]), cell, ref)
  }

  /** Box centred on x,z, bottom at y. */
  box(x, y, z, w, h, d, cell) {
    const p = []
    for (const sy of [0, 1]) for (const sz of [-1, 1]) for (const sx of [-1, 1]) p.push([x + (sx * w) / 2, y + sy * h, z + (sz * d) / 2])
    this.solid(p, [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]], cell)
  }

  /** Frustum standing on y with `seg` sides. r0 bottom radius, r1 top radius. */
  cyl(x, y, z, r0, r1, h, seg, cell) {
    const ring = (r, yy) => Array.from({ length: seg }, (_, i) => [x + Math.cos((i / seg) * Math.PI * 2) * r, yy, z + Math.sin((i / seg) * Math.PI * 2) * r])
    const lo = ring(r0, y)
    const hi = ring(r1, y + h)
    const ref = [x, y + h / 2, z]
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg
      this.face([lo[i], lo[j], hi[j], hi[i]], cell, ref)
    }
    this.face(hi, cell, ref)
    this.face(lo, cell, ref)
  }

  /** Hemisphere of radius r sitting on y. */
  dome(x, y, z, r, cell, seg = 10, rings = 4) {
    const at = (i, k) => {
      const a = (i / seg) * Math.PI * 2
      const e = (k / rings) * (Math.PI / 2)
      return [x + Math.cos(a) * Math.cos(e) * r, y + Math.sin(e) * r, z + Math.sin(a) * Math.cos(e) * r]
    }
    const ref = [x, y, z]
    for (let k = 0; k < rings; k++) {
      for (let i = 0; i < seg; i++) {
        const j = (i + 1) % seg
        const quad = k === rings - 1 ? [at(i, k), at(j, k), at(0, rings)] : [at(i, k), at(j, k), at(j, k + 1), at(i, k + 1)]
        this.face(quad, cell, ref)
      }
    }
  }

  /** A convex 2D outline (x,y) extruded along z from z0 to z1. */
  extrude(outline, z0, z1, cell) {
    const n = outline.length
    const pts = [...outline.map(([a, b]) => [a, b, z0]), ...outline.map(([a, b]) => [a, b, z1])]
    const faces = [Array.from({ length: n }, (_, i) => i), Array.from({ length: n }, (_, i) => n + i)]
    for (let i = 0; i < n; i++) faces.push([i, (i + 1) % n, n + ((i + 1) % n), n + i])
    this.solid(pts, faces, cell)
  }

  /** Semicircular arch band between two radii, springing at cy, extruded along z. */
  archBand(cx, cy, rin, rout, z0, z1, cell, seg = 10) {
    const arc = (r, i) => [cx + Math.cos(Math.PI - (i / seg) * Math.PI) * r, cy + Math.sin((i / seg) * Math.PI) * r]
    const mid = [cx, cy, (z0 + z1) / 2]
    for (let i = 0; i < seg; i++) {
      const [ax, ay] = arc(rout, i)
      const [bx, by] = arc(rout, i + 1)
      const [px, py] = arc(rin, i + 1)
      const [qx, qy] = arc(rin, i)
      this.face([[ax, ay, z1], [bx, by, z1], [px, py, z1], [qx, qy, z1]], cell, [cx, cy, z0])
      this.face([[ax, ay, z0], [bx, by, z0], [bx, by, z1], [ax, ay, z1]], cell, mid)
      this.face([[qx, qy, z0], [px, py, z0], [px, py, z1], [qx, qy, z1]], cell, mid, true)
    }
  }
}

/** A tombstone outline: width w, straight height s, semicircular head. */
function tomb(w, s, seg = 10) {
  const r = w / 2
  const out = [[-r, 0], [r, 0], [r, s]]
  for (let i = 1; i < seg; i++) out.push([Math.cos((i / seg) * Math.PI) * r, s + Math.sin((i / seg) * Math.PI) * r])
  out.push([-r, s])
  return out
}

// ── pieces ────────────────────────────────────────────────────────────────────────────
const PIECES = {}
const piece = (name, fn) => {
  const m = new Mesh()
  fn(m)
  PIECES[name] = m
}

/** A house block: walls, a limestone roof slab and a whitewashed parapet. */
function block(m, w, h, d, { band = false } = {}) {
  const t = 0.1
  const rimH = 0.12
  const W = w + 0.12
  const D = d + 0.12
  m.box(0, 0, 0, w, h, d, C.WHITE)
  m.box(0, h, 0, W, 0.08, D, C.LIME)
  m.box(0, h + 0.08, D / 2 - t / 2, W, rimH, t, C.WHITE)
  m.box(0, h + 0.08, -(D / 2 - t / 2), W, rimH, t, C.WHITE)
  m.box(W / 2 - t / 2, h + 0.08, 0, t, rimH, D - 2 * t, C.WHITE)
  m.box(-(W / 2 - t / 2), h + 0.08, 0, t, rimH, D - 2 * t, C.WHITE)
  if (band) {
    m.box(0, h * 0.5, 0, w + 0.06, 0.07, d + 0.06, C.LIME)
    m.box(0, 0, 0, w + 0.05, 0.14, d + 0.05, C.LIME)
  }
}
piece('block_s', (m) => block(m, 1.3, 1.0, 1.3))
piece('block_m', (m) => block(m, 2.0, 1.5, 2.0))
piece('block_l', (m) => block(m, 2.0, 2.5, 2.0, { band: true }))

piece('door_arch', (m) => {
  m.extrude(tomb(0.7, 0.5), -0.02, 0.03, C.BLUE)
  m.extrude(tomb(0.52, 0.5), 0.03, 0.045, C.BLUE_DARK)
  m.archBand(0, 0.5, 0.35, 0.46, -0.02, 0.07, C.LIME)
  m.box(-0.405, 0, 0.03, 0.11, 0.5, 0.18, C.LIME)
  m.box(0.405, 0, 0.03, 0.11, 0.5, 0.18, C.LIME)
  m.box(0, 0, 0.12, 1.0, 0.05, 0.3, C.LIME)
  for (const sx of [-0.2, 0.2]) for (const sy of [0.15, 0.4, 0.65]) m.box(sx, sy, 0.05, 0.06, 0.06, 0.04, C.COPPER)
})

piece('window', (m) => {
  m.box(0, 0.1, 0.0, 0.42, 0.5, 0.05, C.LIME)
  m.box(0, 0.14, 0.03, 0.3, 0.42, 0.03, C.TRIM)
  m.box(-0.2, 0.12, 0.05, 0.1, 0.46, 0.04, C.BLUE)
  m.box(0.2, 0.12, 0.05, 0.1, 0.46, 0.04, C.BLUE)
  m.box(0, 0.04, 0.05, 0.54, 0.06, 0.14, C.LIME)
})

piece('window_arch', (m) => {
  m.extrude(tomb(0.34, 0.3), -0.02, 0.03, C.TRIM)
  m.archBand(0, 0.3, 0.17, 0.24, -0.02, 0.06, C.LIME)
  m.box(-0.205, 0, 0.02, 0.07, 0.3, 0.1, C.LIME)
  m.box(0.205, 0, 0.02, 0.07, 0.3, 0.1, C.LIME)
  m.box(-0.29, 0, 0.04, 0.11, 0.56, 0.04, C.BLUE)
  m.box(0.29, 0, 0.04, 0.11, 0.56, 0.04, C.BLUE)
})

piece('awning', (m) => {
  const stripes = 6
  const w = 1.5
  const sw = w / stripes
  for (let i = 0; i < stripes; i++) {
    const x0 = -w / 2 + i * sw
    const x1 = x0 + sw
    const cell = i % 2 ? C.CREAM : C.RED
    const p = [[x0, 0.98, 0], [x1, 0.98, 0], [x1, 0.9, 0], [x0, 0.9, 0], [x0, 0.7, 0.95], [x1, 0.7, 0.95], [x1, 0.64, 0.95], [x0, 0.64, 0.95]]
    m.solid(p, [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [3, 2, 6, 7], [0, 3, 7, 4], [1, 2, 6, 5]], cell)
    m.box(x0 + sw / 2, 0.5, 0.95, sw, 0.14, 0.03, cell)
  }
  for (const sx of [-0.7, 0.7]) m.cyl(sx, 0, 0.9, 0.025, 0.025, 0.66, 5, C.WOOD)
})

piece('dome', (m) => {
  m.cyl(0, 0, 0, 0.58, 0.58, 0.3, 10, C.WHITE)
  m.cyl(0, 0.3, 0, 0.64, 0.64, 0.06, 10, C.LIME)
  m.dome(0, 0.36, 0, 0.58, C.MINT, 10, 4)
  m.cyl(0, 0.94, 0, 0.02, 0.02, 0.2, 4, C.COPPER)
  m.dome(0, 1.14, 0, 0.05, C.COPPER, 6, 2)
})
piece('dome_small', (m) => {
  m.cyl(0, 0, 0, 0.4, 0.4, 0.2, 8, C.WHITE)
  m.cyl(0, 0.2, 0, 0.44, 0.44, 0.05, 8, C.LIME)
  m.dome(0, 0.25, 0, 0.4, C.WHITE, 8, 3)
  m.cyl(0, 0.64, 0, 0.015, 0.015, 0.14, 4, C.COPPER)
})

piece('tower', (m) => {
  m.box(0, 0, 0, 0.8, 1.9, 0.8, C.WHITE)
  m.box(0, 0, 0, 0.88, 0.12, 0.88, C.LIME)
  m.box(0, 0.95, 0, 0.84, 0.06, 0.84, C.LIME)
  m.box(0, 1.9, 0, 1.05, 0.08, 1.05, C.LIME)
  m.box(0, 1.98, 0, 0.7, 0.55, 0.7, C.WHITE)
  m.box(0, 2.53, 0, 0.8, 0.06, 0.8, C.LIME)
  m.dome(0, 2.59, 0, 0.36, C.MINT, 8, 3)
  m.cyl(0, 2.93, 0, 0.018, 0.018, 0.3, 4, C.COPPER)
  m.dome(0, 3.23, 0, 0.06, C.COPPER, 6, 2)
  for (const [rx, rz, alongZ] of [[0, 1, false], [0, -1, false], [1, 0, true], [-1, 0, true]]) {
    m.box(rx * 0.41, 1.1, rz * 0.41, alongZ ? 0.04 : 0.14, 0.36, alongZ ? 0.14 : 0.04, C.DARK)
    m.box(rx * 0.36, 2.15, rz * 0.36, alongZ ? 0.04 : 0.24, 0.32, alongZ ? 0.24 : 0.04, C.TRIM)
  }
})

piece('stairs', (m) => {
  for (let i = 0; i < 4; i++) {
    const depth = 0.22 * (4 - i)
    m.box(0, 0, depth / 2, 0.9, 0.14 * (i + 1), depth, C.LIME)
  }
})

piece('wall_seg', (m) => {
  m.box(0, 0, 0, 1.8, 0.6, 0.26, C.WHITE)
  m.box(0, 0.6, 0, 1.9, 0.07, 0.34, C.LIME)
  m.box(0, 0.15, 0.1, 1.8, 0.07, 0.04, C.BLUE)
})

piece('pot_a', (m) => {
  m.cyl(0, 0, 0, 0.1, 0.17, 0.12, 8, C.TERRA)
  m.cyl(0, 0.12, 0, 0.17, 0.22, 0.2, 8, C.TERRA)
  m.cyl(0, 0.32, 0, 0.22, 0.16, 0.1, 8, C.TERRA)
  m.cyl(0, 0.42, 0, 0.19, 0.19, 0.04, 8, C.SHADE)
})
piece('pot_plant', (m) => {
  m.cyl(0, 0, 0, 0.12, 0.2, 0.3, 8, C.TERRA)
  m.cyl(0, 0.3, 0, 0.22, 0.22, 0.05, 8, C.TERRA)
  m.dome(0, 0.35, 0, 0.26, C.OLIVE, 8, 3)
})
piece('jar', (m) => {
  m.cyl(0, 0, 0, 0.08, 0.16, 0.1, 8, C.BLUE)
  m.cyl(0, 0.1, 0, 0.16, 0.22, 0.28, 8, C.CREAM)
  m.cyl(0, 0.38, 0, 0.22, 0.1, 0.22, 8, C.BLUE)
  m.cyl(0, 0.6, 0, 0.1, 0.12, 0.1, 8, C.CREAM)
  m.box(0.2, 0.35, 0, 0.05, 0.2, 0.06, C.BLUE_DARK)
  m.box(-0.2, 0.35, 0, 0.05, 0.2, 0.06, C.BLUE_DARK)
})
piece('rug', (m) => {
  m.box(0, 0, 0, 1.2, 0.025, 0.8, C.RED)
  m.box(0, 0, 0, 1.06, 0.03, 0.66, C.CREAM)
  m.box(0, 0, 0, 1.0, 0.035, 0.6, C.RED)
  m.box(0, 0, 0, 0.7, 0.04, 0.2, C.BLUE)
})
piece('basket', (m) => {
  m.cyl(0, 0, 0, 0.16, 0.22, 0.24, 8, C.STRAW)
  m.cyl(0, 0.24, 0, 0.22, 0.22, 0.03, 8, C.WOOD)
  m.dome(0, 0.27, 0, 0.17, C.OLIVE, 8, 2)
})
piece('crate', (m) => {
  m.box(0, 0, 0, 0.42, 0.34, 0.42, C.WOOD)
  m.box(0, 0.34, 0, 0.46, 0.04, 0.46, C.SHADE)
})
piece('stool', (m) => {
  m.cyl(0, 0.3, 0, 0.17, 0.17, 0.05, 8, C.WOOD)
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2
    m.cyl(Math.cos(a) * 0.1, 0, Math.sin(a) * 0.1, 0.025, 0.025, 0.3, 4, C.WOOD)
  }
  m.cyl(0, 0.35, 0, 0.12, 0.12, 0.01, 8, C.RED)
})
piece('anvil', (m) => {
  m.cyl(0, 0, 0, 0.26, 0.24, 0.3, 8, C.WOOD)
  m.box(0, 0.3, 0, 0.3, 0.1, 0.2, C.IRON)
  m.box(0, 0.4, 0, 0.18, 0.1, 0.14, C.IRON)
  m.box(0, 0.5, 0, 0.56, 0.1, 0.2, C.IRON)
  m.solid(
    [[0.28, 0.5, -0.1], [0.28, 0.5, 0.1], [0.28, 0.6, -0.1], [0.28, 0.6, 0.1], [0.5, 0.58, -0.02], [0.5, 0.58, 0.02], [0.5, 0.6, -0.02], [0.5, 0.6, 0.02]],
    [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]],
    C.IRON
  )
  m.box(0.4, 0.3, 0.3, 0.2, 0.05, 0.05, C.IRON)
})
piece('counter', (m) => {
  m.box(0, 0.5, 0, 1.3, 0.06, 0.5, C.WOOD)
  for (const sx of [-0.6, 0.6]) for (const sz of [-0.2, 0.2]) m.box(sx, 0, sz, 0.06, 0.5, 0.06, C.WOOD)
  m.box(0, 0.22, 0.26, 1.3, 0.32, 0.02, C.RED)
  m.box(0, 0.56, 0, 0.5, 0.03, 0.34, C.CREAM)
  m.cyl(-0.4, 0.59, 0.05, 0.08, 0.1, 0.1, 6, C.COPPER)
})
piece('lantern_pole', (m) => {
  m.cyl(0, 0, 0, 0.08, 0.05, 0.12, 6, C.IRON)
  m.cyl(0, 0.12, 0, 0.04, 0.035, 1.4, 6, C.IRON)
  m.box(0.12, 1.42, 0, 0.3, 0.03, 0.03, C.IRON)
  m.cyl(0.24, 1.2, 0, 0.1, 0.07, 0.04, 6, C.COPPER)
  m.cyl(0.24, 1.5, 0, 0.12, 0.02, 0.1, 6, C.COPPER)
  m.cyl(0.24, 1.6, 0, 0.02, 0.02, 0.05, 6, C.COPPER)
})
piece('lantern_lamp', (m) => {
  m.cyl(0.24, 1.24, 0, 0.085, 0.1, 0.26, 6, C.LAMP)
})
piece('lantern_wall', (m) => {
  m.box(0, 0.12, 0.08, 0.04, 0.04, 0.2, C.IRON)
  m.cyl(0, 0, 0.2, 0.08, 0.06, 0.04, 6, C.COPPER)
  m.cyl(0, 0.24, 0.2, 0.09, 0.02, 0.07, 6, C.COPPER)
})
piece('lantern_wall_lamp', (m) => {
  m.cyl(0, 0.04, 0.2, 0.065, 0.075, 0.2, 6, C.LAMP)
})

// ── write ─────────────────────────────────────────────────────────────────────────────
const doc = new Document()
const buffer = doc.createBuffer()
const scene = doc.createScene('medina')
const texture = doc.createTexture('atlas').setImage(atlasPng()).setMimeType('image/png')
const material = doc.createMaterial('medina').setBaseColorTexture(texture).setRoughnessFactor(1).setMetallicFactor(0)

for (const [name, m] of Object.entries(PIECES)) {
  const acc = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer)
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', acc('VEC3', new Float32Array(m.pos)))
    .setAttribute('NORMAL', acc('VEC3', new Float32Array(m.nrm)))
    .setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(m.uv)))
    .setIndices(acc('SCALAR', new Uint16Array(m.idx)))
    .setMaterial(material)
  const mesh = doc.createMesh(name).addPrimitive(prim)
  scene.addChild(doc.createNode(name).setMesh(mesh))
}
doc.getRoot().setDefaultScene(scene)

mkdirSync(dirname(OUT), { recursive: true })
await new NodeIO().write(OUT, doc)
console.log(`medina.glb: ${Object.keys(PIECES).length} pieces`)

import * as THREE from 'three'

/**
 * Procedurally drawn surfaces for the souk's own structures - the workshop paving and the
 * painted kerbs that edge them.
 *
 * These are drawn rather than shipped for the same reason the face atlas is: they have to
 * take each repo's accent colour, and a painted texture cannot. Everything here is authored
 * neutral grey so the material's own colour multiplies through cleanly, and the *pattern*
 * carries the detail instead.
 *
 * Each surface comes with a normal map derived from its own height field, which is what
 * makes the difference between a picture of a deck and a deck: panel seams catch a shadow
 * along one edge and a highlight along the other as the sun moves, and the bolt heads pick
 * out the light. On a surface this large and this flat, that relief is doing most of the
 * work — a flat albedo pattern under a single directional light reads as wallpaper.
 *
 * Both are generated once and shared by every plot in the colony.
 */

/** World units one tile of the deck texture covers. Two panels to a tile. */
export const DECK_TEXTURE_SCALE = 4

let deck = null
let kerb = null

/**
 * The workshop paving: limestone flagstones with a little zellige inlay.
 *
 * Authored to tile, so a plot of seven hex cells reads as one continuous apron rather than
 * seven repeats of a medallion.
 */
export function deckSurface(size = 512) {
  if (deck) return deck

  const albedo = canvas(size)
  const height = canvas(size)
  const a = albedo.ctx
  const h = height.ctx

  // Base: pale limestone, near-neutral so the workshop's accent tint multiplies cleanly.
  a.fillStyle = '#e4ded2'
  a.fillRect(0, 0, size, size)
  h.fillStyle = '#808080'
  h.fillRect(0, 0, size, size)

  const panels = 4
  const step = size / panels
  const joint = Math.max(2, Math.round(size / 200))
  const rand = mulberry(0x5eed)

  // Flagstones, each a shade off its neighbour, set in a running bond.
  for (let py = 0; py < panels; py++) {
    const offset = py % 2 ? step / 2 : 0
    for (let px = -1; px < panels; px++) {
      const shade = 226 + Math.round((rand() - 0.5) * 18)
      const x = px * step + offset
      a.fillStyle = `rgb(${shade},${shade - 4},${shade - 12})`
      a.fillRect(x + joint, py * step + joint, step - joint * 2, step - joint * 2)
      const v = 128 + Math.round((rand() - 0.5) * 10)
      h.fillStyle = `rgb(${v},${v},${v})`
      h.fillRect(x + joint, py * step + joint, step - joint * 2, step - joint * 2)
    }
  }

  // A zellige inlay: one small diamond per tile, so the paving has a hand-laid accent.
  const tile = size / 2
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      const cx = i * tile + tile / 2
      const cy = j * tile + tile / 2
      const r = tile * 0.09
      a.fillStyle = (i + j) % 2 ? 'rgba(31,95,168,0.55)' : 'rgba(184,115,51,0.5)'
      a.beginPath()
      a.moveTo(cx, cy - r)
      a.lineTo(cx + r, cy)
      a.lineTo(cx, cy + r)
      a.lineTo(cx - r, cy)
      a.closePath()
      a.fill()
      h.fillStyle = '#9a9a9a'
      dot(h, cx, cy, r * 0.7)
    }
  }

  // Joints: dark lime mortar, cut into the height field.
  a.strokeStyle = 'rgba(120,104,80,0.7)'
  a.lineWidth = joint
  h.strokeStyle = '#3a3a3a'
  h.lineWidth = joint
  for (let j = 0; j <= panels; j++) {
    for (const ctx of [a, h]) {
      ctx.beginPath()
      ctx.moveTo(0, j * step)
      ctx.lineTo(size, j * step)
      ctx.stroke()
    }
  }

  // Wear: a scatter of scuffs, so no two square metres of paving are identical.
  for (let i = 0; i < size / 5; i++) {
    const x = rand() * size
    const y = rand() * size
    const r = (0.6 + rand() * 2.4) * (size / 128)
    a.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.08)' : 'rgba(90,70,40,0.07)'
    dot(a, x, y, r)
  }

  const map = texture(albedo.el, THREE.SRGBColorSpace)
  deck = {
    map,
    normalMap: normalFrom(height, 1.7),
    // The albedo doubles as the roughness map: three reads the green channel, and a scuffed
    // panel being a little duller than a clean one is exactly the correlation wanted here.
    roughnessMap: texture(albedo.el, THREE.NoColorSpace),
  }
  return deck
}

/**
 * The kerb that edges a workshop: a Bou Said blue painted strip.
 *
 * A solid glowing bar is a solid glowing bar; the same bar dashed reads as runway edge
 * lighting, which is what a landing apron should have. The emissive mask is separate from
 * the albedo so the dark gaps stay dark after nightfall instead of glowing grey.
 */
export function kerbSurface(size = 128) {
  if (kerb) return kerb

  // Two bands. The top half is the lit strip; the bottom half is a plain patch that every
  // face except the kerb's upper surface points at.
  //
  // A box gives all six of its faces the same 0..1 UV square, so a strip drawn once gets
  // stretched across the ends and down the sides as well — and on a bar 14cm tall that
  // squashes the dark gaps between dashes into a solid black edge. Sending the other five
  // faces to a patch of flat colour is what keeps the sides reading as painted kerb.
  const h = size / 2
  const albedo = canvas(size, h)
  const glow = canvas(size, h)
  const height = canvas(size, h)
  const band = h / 2

  // The strip: Bou Said blue paint with a whitewashed line down the middle.
  albedo.ctx.fillStyle = '#1f5fa8'
  albedo.ctx.fillRect(0, 0, size, band)
  albedo.ctx.fillStyle = '#e9eef5'
  albedo.ctx.fillRect(0, band * 0.44, size, band * 0.12)
  glow.ctx.fillStyle = '#000000'
  glow.ctx.fillRect(0, 0, size, h)
  height.ctx.fillStyle = '#707070'
  height.ctx.fillRect(0, 0, size, band)

  // The plain patch: near-white so the material's accent comes through at full strength,
  // unlit so the sides stay dark after nightfall, and flat so the normal map leaves them be.
  albedo.ctx.fillStyle = '#e6e9ee'
  albedo.ctx.fillRect(0, band, size, h - band)
  height.ctx.fillStyle = '#808080'
  height.ctx.fillRect(0, band, size, h - band)

  kerb = {
    map: texture(albedo.el, THREE.SRGBColorSpace),
    emissiveMap: texture(glow.el, THREE.SRGBColorSpace),
    normalMap: normalFrom(height, 1.1),
  }
  return kerb
}

/**
 * Where on the kerb texture a face should look, given which way it points.
 *
 * `top` is the lit dash strip; everything else lands on the plain patch.
 */
export const KERB_UV = {
  top: { v0: 0.04, v1: 0.46 },
  side: { u: 0.5, v: 0.75 },
}

// ── drawing helpers ───────────────────────────────────────────────────────────────────

function canvas(w, h = w) {
  const el = document.createElement('canvas')
  el.width = w
  el.height = h
  return { el, ctx: el.getContext('2d', { willReadFrequently: true }) }
}

function dot(ctx, x, y, r) {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}

function texture(el, colorSpace) {
  const t = new THREE.CanvasTexture(el)
  t.wrapS = THREE.RepeatWrapping
  t.wrapT = THREE.RepeatWrapping
  t.colorSpace = colorSpace
  t.anisotropy = 8
  return t
}

/**
 * Sobel a height field into a tangent-space normal map.
 *
 * Sampling wraps at the edges, because a normal map whose borders do not agree puts a hard
 * seam down every tile boundary — which on a floor built out of tiles is every seam there
 * is.
 */
function normalFrom({ ctx, el }, strength) {
  const w = el.width
  const h = el.height
  const src = ctx.getImageData(0, 0, w, h).data
  const out = ctx.createImageData(w, h)
  const at = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx =
        at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1) - (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1))
      const dy =
        at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1) - (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1))
      const nx = dx * strength
      const ny = dy * strength
      const len = Math.hypot(nx, ny, 1)
      const i = (y * w + x) * 4
      out.data[i] = ((nx / len) * 0.5 + 0.5) * 255
      out.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255
      out.data[i + 2] = (1 / len) * 0.5 * 255 + 127.5
      out.data[i + 3] = 255
    }
  }

  const dest = canvas(w, h)
  dest.ctx.putImageData(out, 0, 0)
  return texture(dest.el, THREE.NoColorSpace)
}

/** The same small PRNG the rest of the world uses, kept local so this module stands alone. */
function mulberry(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

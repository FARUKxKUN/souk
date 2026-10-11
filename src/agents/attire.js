import * as THREE from 'three'
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js'

/**
 * What a Tunisian artisan wears and carries: the chechia, the face, the copper hammer, and
 * the paint job for the mannequin body (jebba robe, sash, babouches, copper-toned skin).
 *
 * Everything here is measured in the crew rig's own units (the mannequin is ~2.2 tall and the
 * root transform carries the scale), relative to the bone the part is pinned to. Worn parts
 * stay merged, vertex-coloured and instanced: no extra draw call per artisan.
 */

export const SKIN = 0xc48a5a
export const CHECHIA_RED = 0xa8322d
export const COPPER = 0xb87333
export const SASH_BLUE = 0x1f5fa8
const BABOUCHE = 0xd9a02e
const WOOD = 0x8a5a2b

/** Robe colours, weighted by repetition: whitewash and sand dominate, the rest are accents. */
export const ROBE_TONES = [
  0xf4f1ea, 0xf4f1ea, 0xf4f1ea, 0xe9e1cf, 0xd9c7a3, 0xd9c7a3,
  0x8a9650, 0x3a4f8f, 0xc4673f, 0xb8c4cc,
]

/** Geometry y (bind pose) below which a leg is a shoe, and the sash band on the torso. */
const SHOE_TOP = 0.13
export const SASH_BAND = [0.6, 0.74]
/** An arm past this |x| is a bare hand rather than a sleeve. */
const HAND_X = 0.8

/**
 * Colour and robe-tint for one body vertex. `tint` 1 means the per-artisan robe colour
 * multiplies in; 0 means the colour is fixed (skin, sash, shoes).
 */
export function paintBodyVertex(meshName, x, y) {
  void y
  const fixed = (hex) => ({ hex, tint: 0 })
  const robe = { hex: 0xffffff, tint: 1 }
  if (meshName.endsWith('Head')) return fixed(SKIN)
  if (meshName.includes('Arm')) return Math.abs(x) > HAND_X ? fixed(SKIN) : robe
  if (meshName.includes('Leg')) return y < SHOE_TOP ? fixed(BABOUCHE) : robe
  // The torso is robe, plus a sash that the body shader cuts per pixel (a vertex colour
  // would smear across the torso's sparse triangles). aTint 2 flags those vertices.
  return { hex: 0xffffff, tint: 2 }
}

/**
 * The mannequin's head carries sci-fi ear discs on both sides. An artisan has a plain round
 * head, so pull the discs flush with the cheek wall and point their normals straight out:
 * the grooves stop catching light.
 */
const EAR_BOX = { minX: 0.395, minY: 1.38, maxY: 1.95, maxAbsZ: 0.4 }
const EAR_WALL_X = 0.418

function flattenEars(meshName, geo) {
  if (!meshName.endsWith('Head')) return
  const pos = geo.attributes.position
  const nor = geo.attributes.normal
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    if (Math.abs(x) < EAR_BOX.minX || y < EAR_BOX.minY || y > EAR_BOX.maxY) continue
    if (Math.abs(pos.getZ(i)) > EAR_BOX.maxAbsZ) continue
    const side = Math.sign(x)
    pos.setX(i, side * Math.min(Math.abs(x), EAR_WALL_X))
    if (nor) nor.setXYZ(i, side, 0, 0)
  }
}

/** Add `color` (vec3) and `aTint` (float) attributes to a merged-body source geometry. */
export function paintBodyGeometry(meshName, geo) {
  flattenEars(meshName, geo)
  const pos = geo.attributes.position
  const colors = new Float32Array(pos.count * 3)
  const tints = new Float32Array(pos.count)
  const c = new THREE.Color()
  for (let i = 0; i < pos.count; i++) {
    const p = paintBodyVertex(meshName, pos.getX(i), pos.getY(i))
    c.setHex(p.hex).toArray(colors, i * 3)
    tints[i] = p.tint
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.setAttribute('aTint', new THREE.BufferAttribute(tints, 1))
}

/** Bake a flat colour into a geometry's vertex colours. */
export function paint(geo, hex) {
  const c = new THREE.Color(hex)
  const n = geo.attributes.position.count
  const colors = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) c.toArray(colors, i * 3)
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geo
}

function merge(parts) {
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g))
  for (const g of flat) {
    g.deleteAttribute('uv')
  }
  const merged = BufferGeometryUtils.mergeGeometries(flat, false)
  for (const g of new Set([...parts, ...flat])) g.dispose()
  return merged
}

/**
 * The chechia: a short, slightly tapered felt cylinder with a flat crown and a small black
 * tassel. Authored relative to the head bone (the crown of the mannequin head is ~0.98 up).
 */
export function chechiaGeometry() {
  const BASE = 0.7
  const H = 0.4
  const body = new THREE.CylinderGeometry(0.3, 0.37, H, 24)
  body.translate(0, BASE + H / 2, 0)
  paint(body, CHECHIA_RED)

  // A slightly darker band where the felt meets the brow.
  const band = new THREE.CylinderGeometry(0.378, 0.385, 0.05, 24)
  band.translate(0, BASE + 0.025, 0)
  paint(band, 0x7d2420)

  // The tassel: a button at the crown, a cord over the edge and a tuft hanging down the
  // slope of the felt (which flares outward towards the brow).
  const top = BASE + H
  const button = new THREE.SphereGeometry(0.035, 6, 4)
  button.translate(0, top + 0.01, 0)
  paint(button, 0x15110f)
  const lay = new THREE.CylinderGeometry(0.012, 0.012, 0.3, 5)
  lay.rotateZ(Math.PI / 2)
  lay.translate(0.15, top + 0.012, 0)
  paint(lay, 0x15110f)
  const cord = new THREE.CylinderGeometry(0.022, 0.022, 0.2, 5)
  cord.rotateZ(0.19)
  cord.translate(0.33, top - 0.1, 0)
  paint(cord, 0x15110f)
  const tuft = new THREE.SphereGeometry(0.065, 7, 5)
  tuft.scale(1, 1.7, 1)
  tuft.translate(0.355, top - 0.22, 0)
  paint(tuft, 0x15110f)
  return merge([body, band, button, lay, cord, tuft])
}

/** Eyes, brows, nose and moustache, a little proud of the mannequin head's face. */
export function faceGeometry() {
  const parts = []
  const eyeY = 0.52
  for (const s of [-1, 1]) {
    const eye = new THREE.SphereGeometry(0.052, 8, 6)
    eye.scale(1, 1.25, 0.6)
    eye.translate(s * 0.165, eyeY, 0.485)
    parts.push(paint(eye, 0x1b1410))

    const brow = new THREE.BoxGeometry(0.13, 0.03, 0.03)
    brow.rotateZ(-s * 0.1)
    brow.translate(s * 0.165, eyeY + 0.1, 0.49)
    parts.push(paint(brow, 0x2a1d16))

    const stache = new THREE.SphereGeometry(0.1, 8, 6)
    stache.scale(1.35, 0.5, 0.55)
    stache.rotateZ(-s * 0.25)
    stache.translate(s * 0.1, 0.28, 0.5)
    parts.push(paint(stache, 0x2a1d16))
  }
  const nose = new THREE.SphereGeometry(0.075, 8, 6)
  nose.scale(0.9, 1, 1)
  nose.translate(0, 0.4, 0.5)
  parts.push(paint(nose, 0xb07548))
  return merge(parts)
}

/**
 * A coppersmith's hammer, in the right hand's frame: wooden handle, copper head across it.
 * Sized so it reads at the colony's viewing distance, hence the oversized head.
 */
export function hammerGeometry() {
  const shaft = new THREE.CylinderGeometry(0.036, 0.042, 0.62, 6)
  shaft.translate(0, 0.12, 0)
  paint(shaft, WOOD)
  const head = new THREE.BoxGeometry(0.46, 0.21, 0.21, 2, 2, 2)
  head.translate(0, 0.46, 0)
  paint(head, COPPER)
  const face = new THREE.CylinderGeometry(0.12, 0.12, 0.03, 8)
  face.rotateZ(Math.PI / 2)
  face.translate(-0.245, 0.46, 0)
  paint(face, 0xd9954a)
  return merge([shaft, head, face])
}

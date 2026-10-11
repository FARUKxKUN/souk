import * as THREE from 'three'
import { withCurve } from '../core/curve.js'
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js'

/**
 * The medina gate (Bab). Every artisan walks out of its horseshoe arch when a thread appears
 * and back in through it when one is archived, so it is the quarter's one fixed piece of
 * narrative furniture. (The class keeps the name `Ship` and its whole API from the lander it
 * replaced: `shipDoor()` is the alley outside the gate, `shipAirlock()` the passage inside.)
 *
 * The walls are merged into a single geometry; only what moves or glows stays separate:
 * the two studded door leaves and the copper lanterns.
 */

const WHITE = 0xf4f1ea
const LIME = 0xd9c7a3
const BLUE = 0x1f5fa8
const COPPER = 0xb87333
const MINT = 0x3f8f86
const DARK = 0x24202f
const IRON = 0x3a3a42
const LANTERN_GLOW = [1.0, 0.58, 0.24]

/** Roughness / metalness per material colour. */
const SURFACE = new Map([
  [WHITE, [0.85, 0]],
  [LIME, [0.9, 0]],
  [BLUE, [0.55, 0]],
  [COPPER, [0.38, 0.6]],
  [MINT, [0.45, 0.05]],
  [DARK, [0.8, 0]],
  [IRON, [0.5, 0.45]],
])
const DEFAULT_SURFACE = [0.8, 0]

// Gate dimensions, in world units. The nav grid blocks a 3.4 radius circle around the gate,
// so everything solid stays inside it.
const HALF_WIDTH = 2.55
const HALF_DEPTH = 0.8
const WALL_TOP = 4.1
const OPENING = 1.05
const ARCH = { cy: 1.9, r: 1.25 }
const LEAF_OPEN_RAD = 1.7
const LEAF_RATE = 3.2

/** Outline of the horseshoe opening, left foot to right foot, as [x, y] points. */
function horseshoe(extra = 0, steps = 14) {
  const pts = [[-OPENING - extra, 0], [-OPENING - extra, 1.5]]
  const start = Math.PI + 0.2
  const end = -0.2
  for (let i = 0; i <= steps; i++) {
    const a = start + ((end - start) * i) / steps
    pts.push([Math.cos(a) * (ARCH.r + extra), ARCH.cy + Math.sin(a) * (ARCH.r + extra)])
  }
  pts.push([OPENING + extra, 1.5], [OPENING + extra, 0])
  return pts
}

/** The gate mass: one extruded outline with the horseshoe cut out of its foot. */
function wallGeometry() {
  const shape = new THREE.Shape()
  shape.moveTo(-HALF_WIDTH, 0)
  for (const [x, y] of horseshoe()) shape.lineTo(x, y)
  shape.lineTo(HALF_WIDTH, 0)
  shape.lineTo(HALF_WIDTH, WALL_TOP)
  shape.lineTo(-HALF_WIDTH, WALL_TOP)
  shape.closePath()
  const geo = new THREE.ExtrudeGeometry(shape, { depth: HALF_DEPTH * 2, bevelEnabled: false })
  geo.translate(0, 0, -HALF_DEPTH)
  return geo
}

/** A thin box laid along the segment a->b, to follow the arch without a custom ring mesh. */
function strut(a, b, thick, depth, z) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) * 1.08
  const geo = new THREE.BoxGeometry(len, thick, depth)
  geo.rotateZ(Math.atan2(b[1] - a[1], b[0] - a[0]))
  geo.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z)
  return geo
}

/** Blue frame hugging the arch, on both faces. */
function archFrame(parts, colors) {
  const outline = horseshoe(0.12)
  for (const z of [HALF_DEPTH + 0.03, -HALF_DEPTH - 0.03]) {
    for (let i = 0; i < outline.length - 1; i++) {
      parts.push(strut(outline[i], outline[i + 1], 0.24, 0.1, z))
      colors.push(new THREE.Color(BLUE))
    }
  }
}

/** Battlements and cap slab along the top of the wall. */
function crenellations(parts, colors) {
  const cap = new THREE.BoxGeometry(HALF_WIDTH * 2 + 0.2, 0.14, HALF_DEPTH * 2 + 0.2)
  cap.translate(0, WALL_TOP + 0.07, 0)
  parts.push(cap)
  colors.push(new THREE.Color(LIME))
  const count = 7
  for (const z of [HALF_DEPTH - 0.06, -HALF_DEPTH + 0.06]) {
    for (let i = 0; i < count; i++) {
      const x = -HALF_WIDTH + 0.2 + (i * (HALF_WIDTH * 2 - 0.4)) / (count - 1)
      const merlon = new THREE.BoxGeometry(0.46, 0.46, 0.2)
      merlon.translate(x, WALL_TOP + 0.37, z)
      parts.push(merlon)
      colors.push(new THREE.Color(WHITE))
    }
  }
}

/** A round turret with a tiled dome and a copper finial. */
function turret(parts, colors, x) {
  const push = (geo, color) => {
    parts.push(geo)
    colors.push(new THREE.Color(color))
  }
  const body = new THREE.CylinderGeometry(0.72, 0.78, 5.0, 14)
  body.translate(x, 2.5, 0)
  push(body, WHITE)
  const band = new THREE.CylinderGeometry(0.84, 0.84, 0.16, 14)
  band.translate(x, 4.9, 0)
  push(band, LIME)
  const dome = new THREE.SphereGeometry(0.76, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2)
  dome.translate(x, 4.98, 0)
  push(dome, MINT)
  const pole = new THREE.CylinderGeometry(0.025, 0.025, 0.5, 5)
  pole.translate(x, 5.95, 0)
  push(pole, COPPER)
  const ball = new THREE.SphereGeometry(0.07, 8, 6)
  ball.translate(x, 6.25, 0)
  push(ball, COPPER)
  for (const z of [0.76, -0.76]) {
    const slit = new THREE.BoxGeometry(0.14, 0.7, 0.06)
    slit.translate(x, 3.2, z)
    push(slit, DARK)
  }
}

/** Blue skirting and dark window niches on both faces of each pier. */
function pierDetail(parts, colors) {
  for (const sx of [-1, 1]) {
    for (const z of [HALF_DEPTH + 0.02, -HALF_DEPTH - 0.02]) {
      const skirt = new THREE.BoxGeometry(HALF_WIDTH - OPENING - 0.4, 0.4, 0.06)
      skirt.translate(sx * (OPENING + 0.4 + (HALF_WIDTH - OPENING - 0.4) / 2 - 0.1), 0.2, z)
      parts.push(skirt)
      colors.push(new THREE.Color(BLUE))
      const niche = new THREE.BoxGeometry(0.34, 0.6, 0.05)
      niche.translate(sx * 1.85, 2.6, z)
      parts.push(niche)
      colors.push(new THREE.Color(DARK))
    }
  }
}

export class Ship {
  constructor(scene, position) {
    this.group = new THREE.Group()
    this.group.position.copy(position)
    // Turned so the gate faces the middle of the quarter.
    this.group.rotation.y = Math.atan2(-position.x, -position.z)
    this.group.name = 'ship'
    scene.add(this.group)
    this.scene = scene

    this.open = 0
    this.traffic = 0 // doors and lanterns react while artisans are using the gate
    this._buildHull()
    this._buildDoors()
    this._buildLanterns()
    this._buildApron()

    // Artisans appear in the alley a few steps outside the arch, and on a first load walk out
    // of the passage under it.
    this.doorLocal = new THREE.Vector3(0, 0, 4.0)
    this.airlockLocal = new THREE.Vector3(0, 0.02, -0.1)
  }

  _buildHull() {
    const parts = []
    const colors = []
    parts.push(wallGeometry())
    colors.push(new THREE.Color(WHITE))
    archFrame(parts, colors)
    crenellations(parts, colors)
    pierDetail(parts, colors)
    turret(parts, colors, -HALF_WIDTH)
    turret(parts, colors, HALF_WIDTH)

    this.hull = new THREE.Mesh(mergeWithColors(parts, colors), hullMaterial())
    this.hull.castShadow = true
    this.hull.receiveShadow = true
    this.group.add(this.hull)
  }

  /** Two studded blue leaves, hinged at the jambs, swinging outward when the gate is busy. */
  _buildDoors() {
    this.leaves = [-1, 1].map((side) => {
      const pivot = new THREE.Group()
      pivot.position.set(side * (OPENING - 0.01), 0, HALF_DEPTH - 0.18)
      const leaf = new THREE.Mesh(leafGeometry(side), hullMaterial())
      leaf.castShadow = true
      pivot.add(leaf)
      this.group.add(pivot)
      return { pivot, side }
    })
  }

  _buildLanterns() {
    const parts = []
    const spots = [[-1.65, 2.5, HALF_DEPTH + 0.2], [1.65, 2.5, HALF_DEPTH + 0.2], [0, 3.25, 0]]
    for (const [x, y, z] of spots) {
      const lamp = new THREE.CylinderGeometry(0.1, 0.13, 0.3, 6)
      lamp.translate(x, y, z)
      parts.push(lamp)
    }
    this.lanternMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: true })
    this.lanterns = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(parts), this.lanternMaterial)
    this.group.add(this.lanterns)

    // Copper caps and the arm each lantern hangs from.
    const caps = []
    const capColors = []
    for (const [x, y, z] of spots) {
      const cap = new THREE.ConeGeometry(0.16, 0.14, 6)
      cap.translate(x, y + 0.22, z)
      caps.push(cap)
      capColors.push(new THREE.Color(COPPER))
      const chain = new THREE.CylinderGeometry(0.012, 0.012, 0.35, 4)
      chain.translate(x, y + 0.45, z)
      caps.push(chain)
      capColors.push(new THREE.Color(IRON))
    }
    const frame = new THREE.Mesh(mergeWithColors(caps, capColors), hullMaterial())
    this.group.add(frame)
  }

  /** Limestone paving in front of the gate, so it stands on something rather than on grass. */
  _buildApron() {
    const apron = new THREE.Mesh(
      new THREE.CircleGeometry(4.6, 32),
      new THREE.MeshStandardMaterial({ color: LIME, roughness: 1, transparent: true, opacity: 0.9 })
    )
    apron.rotation.x = -Math.PI / 2
    apron.position.y = 0.05
    apron.receiveShadow = true
    this.group.add(apron)
  }

  /** World position of the alley outside the gate, where artisans appear and vanish. */
  shipDoor(out = new THREE.Vector3()) {
    // The first roster can arrive before the first frame, when the group's world matrix
    // is still the identity — and the door would be at the world origin, in the middle of
    // the colony, which is where a whole crew once appeared from.
    this.group.updateWorldMatrix(true, false)
    return out.copy(this.doorLocal).applyMatrix4(this.group.matrixWorld)
  }

  /** World position inside the passage under the arch. */
  shipAirlock(out = new THREE.Vector3()) {
    this.group.updateWorldMatrix(true, false)
    return out.copy(this.airlockLocal).applyMatrix4(this.group.matrixWorld)
  }

  update(dt, elapsed, night) {
    // Lanterns flicker faintly and burn brighter after dark and while anyone is passing.
    this.traffic = Math.max(0, this.traffic - dt * 1.5)
    const busy = Math.min(1, this.traffic)
    const flicker = 1 + 0.06 * Math.sin(elapsed * 9.1) * Math.sin(elapsed * 5.3)
    const gain = (0.55 + night * 2.2) * flicker * (1 + busy * 0.6)
    this.lanternMaterial.color.setRGB(LANTERN_GLOW[0] * gain, LANTERN_GLOW[1] * gain, LANTERN_GLOW[2] * gain)

    // Leaves ease open while the gate is in use, and swing shut again after.
    const target = this.traffic > 0.05 ? 1 : 0
    this.open += (target - this.open) * Math.min(1, dt * LEAF_RATE)
    for (const { pivot, side } of this.leaves) pivot.rotation.y = side * this.open * LEAF_OPEN_RAD
  }

  /** Called when an artisan uses the gate, so the doors and lanterns react. */
  ping() {
    this.traffic = Math.min(2.5, this.traffic + 1)
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose()
        o.material.dispose()
      }
    })
    this.scene.remove(this.group)
  }
}

/** One door leaf in its hinge frame (hinge at x=0, leaf extends toward the middle). */
function leafGeometry(side) {
  const hingeX = side * OPENING
  const topAt = (gx) => ARCH.cy + Math.sqrt(Math.max(0, ARCH.r * ARCH.r - gx * gx)) - 0.06
  const steps = 8
  const width = OPENING - 0.01
  const shape = new THREE.Shape()
  shape.moveTo(0, 0)
  shape.lineTo(width, 0)
  for (let i = steps; i >= 0; i--) {
    const u = (width * i) / steps
    shape.lineTo(u, topAt(hingeX - side * u))
  }
  shape.closePath()
  const leaf = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false })
  const parts = [leaf]
  const colors = [new THREE.Color(BLUE)]
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 5; row++) {
      const stud = new THREE.SphereGeometry(0.05, 6, 4)
      stud.translate(0.2 + col * 0.3, 0.35 + row * 0.5, 0.14)
      parts.push(stud)
      colors.push(new THREE.Color(COPPER))
    }
  }
  const merged = mergeWithColors(parts, colors)
  // Built for the left hinge (leaf extends +x); mirror for the right one.
  if (side > 0) {
    merged.scale(-1, 1, 1)
    const index = merged.index
    if (index) merged.setIndex(Array.from(index.array).reverse())
  }
  return merged
}

/**
 * Merge a set of geometries, baking one flat colour per part into vertex colours — plus the
 * roughness and metalness that colour implies, so a single merged hull can hold limestone,
 * glazed tile and copper and have each behave correctly under the environment map.
 */
function mergeWithColors(parts, colors) {
  const flat = parts.map((geo, i) => {
    const g = geo.index ? geo.toNonIndexed() : geo
    if (g !== geo) geo.dispose()
    const count = g.attributes.position.count
    const arr = new Float32Array(count * 3)
    const surf = new Float32Array(count * 2)
    const c = colors[i]
    const s = SURFACE.get(c.getHex()) || DEFAULT_SURFACE
    for (let k = 0; k < count; k++) {
      arr.set([c.r, c.g, c.b], k * 3)
      surf.set(s, k * 2)
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
    g.setAttribute('aSurface', new THREE.BufferAttribute(surf, 2))
    g.deleteAttribute('uv')
    if (!g.attributes.normal) g.computeVertexNormals()
    return g
  })
  const merged = BufferGeometryUtils.mergeGeometries(flat, false)
  flat.forEach((g) => g.dispose())
  return merged
}

/** The hull material: per-vertex PBR, double-sided so open shells and the passage show
 *  their insides instead of vanishing. */
function hullMaterial() {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.8,
    metalness: 0,
    side: THREE.DoubleSide,
    shadowSide: THREE.BackSide,
  })
  mat.onBeforeCompile = (shader) => {
    withCurve(shader)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n attribute vec2 aSurface;\n varying vec2 vSurface;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n vSurface = aSurface;`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n varying vec2 vSurface;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vSurface.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vSurface.y;')
  }
  return mat
}

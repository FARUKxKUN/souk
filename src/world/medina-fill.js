import * as THREE from 'three'
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js'
import { atlasTexture, hasPart, kitReady, part } from './kit.js'
import { mulberry } from './planet.js'
import { buildingUniforms } from './buildings.js'
import { withCurve } from '../core/curve.js'

/**
 * The rest of the medina: whitewashed houses packed between the workshops and the rampart.
 *
 * Nothing here is interactive. It exists so the walled quarter reads as a dense town with
 * narrow alleys rather than a sand disc with a village in the middle - and it has to do that
 * for next to nothing. Every house is a few kit pieces merged into ONE geometry (one draw call,
 * no per-frame work, no shadow casting), and the courtyard palms are one instanced mesh.
 *
 * Houses stand on a jittered lattice. A lattice point is skipped when it is too close to any
 * plot cell or to the ship's, which keeps a walkway ring clear around every workshop and the
 * gate approach; every few rows and columns are skipped outright, which is what makes lanes.
 */

/** Distance between lattice points: a house is up to ~3.8 wide, so alleys are about a metre. */
const SPACING = 4.6
const JITTER = 0.3
/** Every Nth row and column is a lane, left empty. */
const LANE_EVERY = 6
/** Centre-to-centre distance from any plot cell. A hex corner is 7.6 out, a house is ~1.9 wide. */
const CELL_CLEARANCE = 10.6
/** How far inside the wall a house centre must stay. */
const WALL_CLEARANCE = 2.7
const SKIP_CHANCE = 0.1
const COURTYARD_CHANCE = 0.06
const MAX_PALMS = 14
/** Kit block sizes (w, h, d), picked by weight. */
const BLOCKS = [
  { name: 'block_s', w: 1.3, h: 1.0, d: 1.3, weight: 25 },
  { name: 'block_m', w: 2.0, h: 1.5, d: 2.0, weight: 45 },
  { name: 'block_l', w: 2.0, h: 2.5, d: 2.0, weight: 30 },
]
const NEEDED = ['block_s', 'block_m', 'block_l', 'door_arch', 'window', 'dome_small', 'dome']
/** The warm glass a window gives off once the sun is down, in linear light. */
const WINDOW_GLOW = [1.0, 0.66, 0.36]
/** How far a house's whitewash strays from the shared swatch: a few percent, never a second colour. */
const TINT_SPREAD = 0.05
/** A bucket of this size makes `blocked` a handful of comparisons. */
const BUCKET = 8

const _m = new THREE.Matrix4()
const _local = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _up = new THREE.Vector3(0, 1, 0)
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()

function pickBlock(rand) {
  let roll = rand() * 100
  for (const b of BLOCKS) {
    roll -= b.weight
    if (roll <= 0) return b
  }
  return BLOCKS[1]
}

/**
 * Every vertex of a piece carries its house's whitewash tint, and window pieces carry a flag so
 * the shader can light them after dark. Every piece gets both attributes, because the merge
 * needs one attribute set across the whole fill.
 */
function markPiece(geo, tint, lit) {
  const n = geo.attributes.position.count
  const colour = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    colour[i * 3] = tint[0]
    colour[i * 3 + 1] = tint[1]
    colour[i * 3 + 2] = tint[2]
  }
  geo.setAttribute('aTint', new THREE.BufferAttribute(colour, 3))
  geo.setAttribute('aWindow', new THREE.BufferAttribute(new Float32Array(n).fill(lit ? 1 : 0), 1))
  return geo
}

/** One kit piece, placed in the house's frame and then carried into the world by `house`. */
function piece(list, name, house, tint, x, y, z, yaw = 0, lit = false) {
  const geo = part(name, 'medina')
  _q.setFromAxisAngle(_up, yaw)
  _local.compose(_p.set(x, y, z), _q, _s.set(1, 1, 1))
  geo.applyMatrix4(_m.copy(house).multiply(_local))
  list.push(markPiece(geo, tint, lit))
}

function furnish(list, block, house, rand, tint) {
  const { name, w, h, d } = block
  piece(list, name, house, tint, 0, 0, 0)
  // The door faces +z, which the house has been turned to point at the nearest alley.
  if (rand() < 0.6) piece(list, 'door_arch', house, tint, 0, 0, d / 2)
  if (block.h > 1.2) {
    piece(list, 'window', house, tint, w * 0.3 * (rand() < 0.5 ? -1 : 1), h * 0.55, d / 2, 0, true)
    piece(list, 'window', house, tint, d / 2, h * 0.55, 0.2, Math.PI / 2, true)
  } else {
    piece(list, 'window', house, tint, d / 2, h * 0.5, 0, Math.PI / 2, true)
  }
  const roll = rand()
  if (block.h < 2 && roll < 0.28) piece(list, 'dome_small', house, tint, 0, h + 0.1, 0)
  else if (block.h > 2 && roll < 0.14) piece(list, 'dome', house, tint, 0, h + 0.1, 0)
}

/**
 * A small, stable tint per lattice point. A hash rather than the seeded stream, so the layout
 * (which consumes that stream) is unchanged by the tint, and a house keeps its colour as the
 * colony grows around it.
 */
function houseTint(ix, iz) {
  const wobble = (salt) => {
    const f = Math.sin(ix * 12.9898 + iz * 78.233 + salt * 37.719) * 43758.5453
    return (f - Math.floor(f)) * 2 - 1
  }
  const base = 1 + wobble(1) * TINT_SPREAD
  const warm = wobble(2) * TINT_SPREAD * 0.6
  return [base + warm, base, base - warm]
}

/**
 * The fill's material: the kit's atlas, lit like the workshops, with a per-house tint and warm
 * window glass that comes on with the night. One material, one draw call.
 */
function fillMaterial() {
  const material = new THREE.MeshStandardMaterial({ map: atlasTexture('medina'), roughness: 0.85, metalness: 0 })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = buildingUniforms.uNight
    withCurve(shader)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         attribute vec3 aTint;
         attribute float aWindow;
         varying vec3 vTint;
         varying float vWindow;`
      )
      .replace('#include <begin_vertex>', `#include <begin_vertex>
 vTint = aTint;
 vWindow = aWindow;`)
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uNight;
         varying vec3 vTint;
         varying float vWindow;`
      )
      .replace('#include <color_fragment>', `#include <color_fragment>
 diffuseColor.rgb *= vTint;`)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         // Only the window glass emits, and only once the sun has gone.
         totalEmissiveRadiance += vec3( ${WINDOW_GLOW.join(', ')} ) * vWindow * uNight * 1.4;`
      )
  }
  return material
}

/**
 * @param cells     world centres of every plot cell and the ship's, as `{x, z}`
 * @param radius    the wall's radius
 * @param heightAt  ground height at (x, z)
 * @returns `{ group, blocked(x, z, pad), dispose }`, or null if the medina kit is not loaded
 */
export function createMedinaFill({ cells, radius, heightAt, seed = 9011 }) {
  if (!kitReady('medina') || !NEEDED.every((n) => hasPart(n, 'medina'))) return null
  const rand = mulberry(seed)
  const geos = []
  const spots = []
  const palms = []
  const reach = Math.ceil(radius / SPACING)
  const clearance2 = CELL_CLEARANCE * CELL_CLEARANCE
  const limit = radius - WALL_CLEARANCE

  for (let ix = -reach; ix <= reach; ix++) {
    for (let iz = -reach; iz <= reach; iz++) {
      // Rolled before any test, so a lattice point's dice never depend on its neighbours: a
      // house survives the colony growing around it unchanged.
      const jx = (rand() - 0.5) * 2 * JITTER
      const jz = (rand() - 0.5) * 2 * JITTER
      const roll = rand()
      const block = pickBlock(rand)
      const scale = 1.45 + rand() * 0.4
      const tilt = rand()
      const x = ix * SPACING + jx
      const z = iz * SPACING + jz
      if (ix % LANE_EVERY === 0 || iz % LANE_EVERY === 0) continue
      if (Math.hypot(x, z) > limit) continue
      let near = null
      let nearD = Infinity
      for (const c of cells) {
        const dd = (c.x - x) ** 2 + (c.z - z) ** 2
        if (dd < nearD) {
          nearD = dd
          near = c
        }
      }
      if (nearD < clearance2 || roll < SKIP_CHANCE) continue
      if (roll < SKIP_CHANCE + COURTYARD_CHANCE) {
        if (palms.length < MAX_PALMS) palms.push({ x, z, s: 1.7 + tilt * 0.7, yaw: tilt * 6.28 })
        continue
      }
      // Door toward the nearest cell, snapped to the lattice's own axes so rows line up.
      const toward = near ? Math.atan2(near.x - x, near.z - z) : 0
      const yaw = Math.round(toward / (Math.PI / 2)) * (Math.PI / 2)
      _q.setFromAxisAngle(_up, yaw)
      _m.compose(_p.set(x, heightAt(x, z) - 0.05, z), _q, _s.set(scale, scale, scale))
      furnish(geos, block, _m.clone(), rand, houseTint(ix, iz))
      spots.push({ x, z, r: Math.max(block.w, block.d) * scale * 0.75 })
    }
  }

  const group = new THREE.Group()
  group.name = 'medina-fill'
  const disposers = []
  if (geos.length) {
    const merged = BufferGeometryUtils.mergeGeometries(geos, false)
    geos.forEach((g) => g.dispose())
    const material = fillMaterial()
    const mesh = new THREE.Mesh(merged, material)
    mesh.name = 'houses'
    // No shadow casting: a hundred and fifty small casters would be the priciest part of the
    // shadow pass for a darkening nobody can pick out at this distance.
    mesh.castShadow = false
    mesh.receiveShadow = true
    mesh.frustumCulled = false
    group.add(mesh)
    disposers.push(() => {
      merged.dispose()
      material.dispose()
    })
  }
  if (palms.length && kitReady('nature') && hasPart('tree_palmShort', 'nature')) {
    const geo = part('tree_palmShort', 'nature')
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 })
    const mesh = new THREE.InstancedMesh(geo, material, palms.length)
    mesh.name = 'courtyard-palms'
    palms.forEach((p, i) => {
      _q.setFromAxisAngle(_up, p.yaw)
      _m.compose(_p.set(p.x, heightAt(p.x, p.z) - 0.05, p.z), _q, _s.set(p.s, p.s, p.s))
      mesh.setMatrixAt(i, _m)
      spots.push({ x: p.x, z: p.z, r: 0.8 })
    })
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.frustumCulled = false
    group.add(mesh)
    disposers.push(() => {
      geo.dispose()
      material.dispose()
    })
  }

  const buckets = new Map()
  for (const s of spots) {
    const k = `${Math.floor(s.x / BUCKET)},${Math.floor(s.z / BUCKET)}`
    if (!buckets.has(k)) buckets.set(k, [])
    buckets.get(k).push(s)
  }

  return {
    group,
    count: spots.length,
    /** Whether a point is inside a house (plus `pad`), for anything that walks the alleys. */
    blocked(x, z, pad = 0) {
      const bx = Math.floor(x / BUCKET)
      const bz = Math.floor(z / BUCKET)
      for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
          const list = buckets.get(`${bx + i},${bz + j}`)
          if (!list) continue
          for (const s of list) if ((x - s.x) ** 2 + (z - s.z) ** 2 < (s.r + pad) ** 2) return true
        }
      }
      return false
    },
    dispose() {
      for (const d of disposers) d()
    },
  }
}

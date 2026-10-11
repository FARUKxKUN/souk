import * as THREE from 'three'
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js'
import { mulberry } from './planet.js'

/**
 * Street life for the souk: cats that sit, groom and wander, and pigeons that strut, peck
 * and make short flights. Low-poly, procedural, and cheap: each kind is three InstancedMeshes
 * (body, head, tail or wings) posed on the CPU by composing a handful of matrices, so a street
 * of twenty animals is six draws and no skinning.
 *
 * Built-in standard materials are used on purpose: three's own `project_vertex` carries the
 * world curve (see DECISIONS.md), so nothing here needs a hand-written shader.
 *
 * Everything is authored facing +Z, in metres, at the colony's scale (an artisan is ~1.2 tall).
 */

const _color = new THREE.Color()
const _pos = new THREE.Vector3()
const _quat = new THREE.Quaternion()
const _euler = new THREE.Euler()
const _scale = new THREE.Vector3()
const _base = new THREE.Matrix4()
const _local = new THREE.Matrix4()
const _out = new THREE.Matrix4()

const CAT_COLORS = [0xd9822b, 0x8d8d92, 0x2c2a2a, 0xeee4d0, 0xb8956a, 0x5a4a3a]
const PIGEON_TINTS = [0.9, 1.0, 1.1, 0.8, 1.0, 1.15]

const DEFAULT_RADIUS = [5, 34]
/** A step in ground height bigger than this is a wall or a roof edge: refuse it. */
const MAX_STEP = 0.5
const TURN_RATE = 7

const smooth = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt))
const wrap = (a) => {
  while (a > Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}

function paint(geo, hex) {
  const c = new THREE.Color(hex)
  const n = geo.attributes.position.count
  const colors = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) c.toArray(colors, i * 3)
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geo
}

function merge(parts) {
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g))
  for (const g of flat) g.deleteAttribute('uv')
  const geo = BufferGeometryUtils.mergeGeometries(flat, false)
  for (const g of new Set([...parts, ...flat])) g.dispose()
  return geo
}

function ellipsoid(rx, ry, rz, x, y, z, hex, seg = 8) {
  const g = new THREE.SphereGeometry(1, seg, Math.max(4, seg - 2))
  g.scale(rx, ry, rz)
  g.translate(x, y, z)
  return paint(g, hex)
}

function box(w, h, d, x, y, z, hex) {
  const g = new THREE.BoxGeometry(w, h, d)
  g.translate(x, y, z)
  return paint(g, hex)
}

// ── cat geometry ──────────────────────────────────────────────────────────────────────

function catBody() {
  const parts = [ellipsoid(0.075, 0.085, 0.19, 0, 0.17, 0, 0xffffff)]
  for (const [x, z] of [[-0.05, 0.12], [0.05, 0.12], [-0.05, -0.12], [0.05, -0.12]]) {
    parts.push(box(0.04, 0.12, 0.04, x, 0.06, z, 0xe8e8e8))
  }
  return merge(parts)
}

function catHead() {
  const parts = [ellipsoid(0.07, 0.065, 0.065, 0, 0, 0, 0xffffff)]
  for (const s of [-1, 1]) {
    const ear = new THREE.ConeGeometry(0.028, 0.06, 4)
    ear.translate(s * 0.042, 0.075, -0.005)
    parts.push(paint(ear, 0xffffff))
  }
  parts.push(box(0.03, 0.02, 0.02, 0, -0.012, 0.062, 0xe0a0a0))
  return merge(parts)
}

/** Tail along +Y, base at the origin. */
function catTail() {
  const g = new THREE.CylinderGeometry(0.014, 0.024, 0.26, 6)
  g.translate(0, 0.13, 0)
  return merge([paint(g, 0xffffff)])
}

// ── pigeon geometry ───────────────────────────────────────────────────────────────────

const GREY = 0x8a8f98
function pigeonBody() {
  const parts = [
    ellipsoid(0.06, 0.06, 0.115, 0, 0.1, 0, GREY, 8),
    box(0.012, 0.07, 0.012, -0.022, 0.035, 0, 0xc4767a),
    box(0.012, 0.07, 0.012, 0.022, 0.035, 0, 0xc4767a),
  ]
  const tail = box(0.05, 0.012, 0.07, 0, 0.1, -0.12, 0x5d626b)
  tail.rotateX(0.2)
  parts.push(tail)
  return merge(parts)
}

function pigeonHead() {
  const parts = [ellipsoid(0.04, 0.04, 0.045, 0, 0, 0, 0x5f8a86, 7)]
  const beak = new THREE.ConeGeometry(0.011, 0.04, 4)
  beak.rotateX(Math.PI / 2)
  beak.translate(0, -0.004, 0.058)
  parts.push(paint(beak, 0xe0cfa8))
  return merge(parts)
}

/** One wing out along +X from its root; mirrored by a negative scale for the other side. */
function pigeonWing() {
  const g = new THREE.BufferGeometry()
  const v = [0, 0, 0.06, 0, 0, -0.07, 0.2, 0, -0.1, 0.17, 0, 0.02]
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3))
  g.setIndex([0, 1, 2, 0, 2, 3])
  g.computeVertexNormals()
  return merge([paint(g, 0x6f747d)])
}

// ── shared crowd plumbing ─────────────────────────────────────────────────────────────

function instanced(geo, count, name, { shadow = false, side = THREE.FrontSide } = {}) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side })
  const mesh = new THREE.InstancedMesh(geo, mat, count)
  mesh.name = name
  mesh.frustumCulled = false
  mesh.castShadow = shadow
  mesh.receiveShadow = false
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  mesh.count = 0
  return mesh
}

function tint(mesh, i, hex) {
  _color.set(hex)
  mesh.setColorAt(i, _color)
}

/** base * local(position, euler, scale), into a shared scratch matrix. */
function pose(base, px, py, pz, rx, ry, rz, sx = 1, sy = 1, sz = 1) {
  _euler.set(rx, ry, rz)
  _quat.setFromEuler(_euler)
  _local.compose(_pos.set(px, py, pz), _quat, _scale.set(sx, sy, sz))
  return _out.multiplyMatrices(base, _local)
}

function setBase(x, y, z, heading) {
  _euler.set(0, heading, 0)
  _quat.setFromEuler(_euler)
  return _base.compose(_pos.set(x, y, z), _quat, _scale.set(1, 1, 1))
}

/** Pick a spot on the ring that is not a wall: a small heuristic against the ground step. */
function pickSpot(env, rand, from, maxDist, radius) {
  for (let tries = 0; tries < 6; tries++) {
    const a = rand() * Math.PI * 2
    const d = 1.5 + rand() * maxDist
    const x = from.x + Math.cos(a) * d
    const z = from.z + Math.sin(a) * d
    const r = Math.hypot(x, z)
    if (r < radius[0] || r > radius[1]) continue
    const y = env.heightAt(x, z)
    if (Math.abs(y - from.y) <= MAX_STEP) return { x, y, z }
  }
  return null
}

function spawnOnRing(env, rand, radius) {
  const a = rand() * Math.PI * 2
  const r = radius[0] + Math.sqrt(rand()) * (radius[1] - radius[0])
  const x = Math.cos(a) * r
  const z = Math.sin(a) * r
  return { x, y: env.heightAt(x, z), z }
}

function disposeMeshes(meshes) {
  for (const m of meshes) {
    m.removeFromParent()
    m.geometry.dispose()
    m.material.dispose()
  }
}

// ── cats ──────────────────────────────────────────────────────────────────────────────

const CAT_SPEED = 0.85
/** How far a sitting cat tips up, and the (y, z) of the haunches it tips about. */
const SIT_PITCH = 0.6
const CAT_PIVOT = [0.05, -0.12]

export class Cats {
  constructor(group, spec, env, seed, tier) {
    this.env = env
    this.rand = mulberry(seed)
    this.radius = spec.radius ?? DEFAULT_RADIUS
    this.count = Math.max(0, Math.round(spec.count ?? 5))
    this.body = instanced(catBody(), this.count, 'cats-body', { shadow: true })
    this.head = instanced(catHead(), this.count, 'cats-head')
    this.tail = instanced(catTail(), this.count, 'cats-tail')
    this.meshes = [this.body, this.head, this.tail]
    const colors = spec.colors?.length ? spec.colors : CAT_COLORS
    this.cats = []
    for (let i = 0; i < this.count; i++) {
      for (const m of this.meshes) tint(m, i, colors[i % colors.length])
      const p = spawnOnRing(env, this.rand, this.radius)
      this.cats.push({
        ...p, heading: this.rand() * Math.PI * 2, state: 'sit', timer: 2 + this.rand() * 6,
        sit: 1, tx: p.x, tz: p.z, phase: this.rand() * Math.PI * 2, clock: 0,
      })
    }
    for (const m of this.meshes) {
      m.instanceColor.needsUpdate = true
      group.add(m)
    }
    this.setTier(tier)
  }

  setTier(scale) {
    this.active = this.count ? Math.max(1, Math.round(this.count * scale)) : 0
    for (const m of this.meshes) m.count = this.active
  }

  _next(c) {
    const r = this.rand()
    if (c.state === 'walk' || r < 0.35) {
      c.state = r < 0.55 ? 'groom' : 'sit'
      c.timer = 4 + this.rand() * 9
      return
    }
    const spot = pickSpot(this.env, this.rand, c, 7, this.radius)
    if (!spot) {
      c.timer = 2
      return
    }
    c.state = 'walk'
    c.tx = spot.x
    c.tz = spot.z
    c.timer = 20
  }

  update(dt, elapsed, night, motion = 1) {
    const n = this.active
    for (let i = 0; i < n; i++) {
      const c = this.cats[i]
      c.clock += dt * motion
      c.timer -= dt
      if (c.state === 'walk') this._walk(c, dt)
      else if (c.timer <= 0) this._next(c)
      c.sit = smooth(c.sit, c.state === 'walk' ? 0 : 1, 5, dt)
      this._write(i, c, elapsed * motion)
    }
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true
  }

  _walk(c, dt) {
    const dx = c.tx - c.x
    const dz = c.tz - c.z
    if (Math.hypot(dx, dz) < 0.15 || c.timer <= 0) {
      this._next(c)
      return
    }
    c.heading += wrap(Math.atan2(dx, dz) - c.heading) * Math.min(1, TURN_RATE * dt)
    c.x += Math.sin(c.heading) * CAT_SPEED * dt
    c.z += Math.cos(c.heading) * CAT_SPEED * dt
    const gy = this.env.heightAt(c.x, c.z)
    if (Math.abs(gy - c.y) > MAX_STEP) {
      c.state = 'sit'
      c.timer = 2
      return
    }
    c.y = smooth(c.y, gy, 12, dt)
  }

  _write(i, c, t) {
    const s = c.sit
    const walking = 1 - s
    const stride = Math.sin(c.clock * 9 + c.phase)
    const bob = walking * Math.abs(stride) * 0.012
    setBase(c.x, c.y + bob, c.z, c.heading)
    // The torso tips up about its haunches (a pivot low at the rear) when sitting.
    const tip = -s * SIT_PITCH
    const py = CAT_PIVOT[0] - (CAT_PIVOT[0] * Math.cos(tip) - CAT_PIVOT[1] * Math.sin(tip))
    const pz = CAT_PIVOT[1] - (CAT_PIVOT[0] * Math.sin(tip) + CAT_PIVOT[1] * Math.cos(tip))
    this.body.setMatrixAt(i, pose(_base, 0, py, pz, tip, 0, walking * stride * 0.03))
    const grooming = c.state === 'groom'
    const groom = grooming ? Math.sin(t * 5 + c.phase) : 0
    const hy = 0.22 + s * 0.14
    const hz = 0.24 - s * 0.23
    this.head.setMatrixAt(i, pose(_base, 0, hy, hz, (grooming ? 0.25 : 0) + groom * 0.18, 0, groom * 0.3 + walking * stride * 0.05))
    const swish = Math.sin(t * (c.state === 'walk' ? 3 : 1.4) + c.phase) * (0.25 + walking * 0.15)
    const lift = 0.35 + walking * 0.35 - s * 0.35
    this.tail.setMatrixAt(i, pose(_base, 0, 0.1 + 0.05 * walking, -0.19 + 0.03 * s, -(Math.PI / 2 - lift), swish, 0))
  }

  dispose() {
    disposeMeshes(this.meshes)
  }
}

// ── pigeons ───────────────────────────────────────────────────────────────────────────

const PIGEON_WALK = 0.5
const PIGEON_FLY = 4.5

export class Pigeons {
  constructor(group, spec, env, seed, tier) {
    this.env = env
    this.rand = mulberry(seed)
    this.radius = spec.radius ?? DEFAULT_RADIUS
    this.count = Math.max(0, Math.round(spec.count ?? 8))
    this.body = instanced(pigeonBody(), this.count, 'pigeons-body', { shadow: true })
    this.head = instanced(pigeonHead(), this.count, 'pigeons-head')
    this.wings = instanced(pigeonWing(), this.count * 2, 'pigeons-wings', { side: THREE.DoubleSide })
    this.meshes = [this.body, this.head, this.wings]
    this.birds = []
    for (let i = 0; i < this.count; i++) {
      const k = PIGEON_TINTS[i % PIGEON_TINTS.length]
      const white = _color.setRGB(k, k, k)
      this.body.setColorAt(i, white)
      this.head.setColorAt(i, white)
      this.wings.setColorAt(i * 2, white)
      this.wings.setColorAt(i * 2 + 1, white)
      const p = spawnOnRing(env, this.rand, this.radius)
      this.birds.push({
        ...p, heading: this.rand() * Math.PI * 2, state: 'peck', timer: 1 + this.rand() * 3,
        tx: p.x, tz: p.z, ty: p.y, fx: p.x, fy: p.y, fz: p.z, flightT: 0, flightDur: 1, arc: 1,
        phase: this.rand() * Math.PI * 2, clock: 0, air: 0,
      })
    }
    for (const m of this.meshes) {
      m.instanceColor.needsUpdate = true
      group.add(m)
    }
    this.setTier(tier)
  }

  setTier(scale) {
    this.active = this.count ? Math.max(1, Math.round(this.count * scale)) : 0
    this.body.count = this.head.count = this.active
    this.wings.count = this.active * 2
  }

  _next(b) {
    const r = this.rand()
    if (r < 0.12) return this._takeoff(b)
    if (r < 0.5) {
      const spot = pickSpot(this.env, this.rand, b, 2.5, this.radius)
      if (spot) {
        b.state = 'walk'
        b.tx = spot.x
        b.tz = spot.z
        b.timer = 6
        return
      }
    }
    b.state = 'peck'
    b.timer = 1.5 + this.rand() * 3.5
  }

  _takeoff(b) {
    const spot = pickSpot(this.env, this.rand, b, 11, this.radius)
    if (!spot) {
      b.state = 'peck'
      b.timer = 2
      return
    }
    b.state = 'fly'
    b.fx = b.x
    b.fy = b.y
    b.fz = b.z
    b.tx = spot.x
    b.tz = spot.z
    b.ty = spot.y
    b.heading = Math.atan2(spot.x - b.x, spot.z - b.z)
    b.flightT = 0
    b.flightDur = 0.7 + Math.hypot(spot.x - b.x, spot.z - b.z) / PIGEON_FLY
    b.arc = 0.8 + this.rand() * 1.4
  }

  update(dt, elapsed, night, motion = 1) {
    // Pigeons roost after dark, the way the butterflies do.
    const visible = night < 0.6
    for (const m of this.meshes) m.visible = visible
    if (!visible) return
    const n = this.active
    for (let i = 0; i < n; i++) {
      const b = this.birds[i]
      b.clock += dt * motion
      this._step(b, dt)
      b.air = smooth(b.air, b.state === 'fly' ? 1 : 0, 14, dt)
      this._write(i, b)
    }
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true
  }

  _step(b, dt) {
    if (b.state === 'fly') {
      b.flightT += dt / b.flightDur
      const k = Math.min(1, b.flightT)
      b.x = b.fx + (b.tx - b.fx) * k
      b.z = b.fz + (b.tz - b.fz) * k
      b.y = b.fy + (b.ty - b.fy) * k + Math.sin(Math.PI * k) * b.arc
      if (b.flightT >= 1) {
        b.y = b.ty
        b.state = 'peck'
        b.timer = 1 + this.rand() * 2
      }
      return
    }
    b.timer -= dt
    if (b.state === 'walk') this._walk(b, dt)
    else if (b.timer <= 0) this._next(b)
  }

  _walk(b, dt) {
    const dx = b.tx - b.x
    const dz = b.tz - b.z
    if (Math.hypot(dx, dz) < 0.1 || b.timer <= 0) {
      this._next(b)
      return
    }
    b.heading += wrap(Math.atan2(dx, dz) - b.heading) * Math.min(1, TURN_RATE * dt)
    b.x += Math.sin(b.heading) * PIGEON_WALK * dt
    b.z += Math.cos(b.heading) * PIGEON_WALK * dt
    b.y = smooth(b.y, this.env.heightAt(b.x, b.z), 12, dt)
  }

  _write(i, b) {
    const flying = b.air
    const peck = b.state === 'peck' ? Math.max(0, Math.sin(b.clock * 7 + b.phase)) : 0
    const strut = b.state === 'walk' ? Math.sin(b.clock * 12 + b.phase) : 0
    setBase(b.x, b.y, b.z, b.heading)
    this.body.setMatrixAt(i, pose(_base, 0, 0, 0, peck * 0.55 - flying * 0.25, 0, strut * 0.04))
    this.head.setMatrixAt(i, pose(_base, 0, 0.17 - peck * 0.09, 0.1 + strut * 0.02 + peck * 0.05 + flying * 0.02, peck * 0.7, 0, 0))
    const flap = Math.sin(b.clock * 26 + b.phase) * 0.9 * flying
    const open = 0.3 + flying * 0.7
    for (const side of [-1, 1]) {
      const slot = i * 2 + (side > 0 ? 1 : 0)
      this.wings.setMatrixAt(slot, pose(_base, side * 0.055, 0.12, 0, 0, 0, side * (flap + 0.1 * (1 - flying)), side * open, 1, 1))
    }
  }

  dispose() {
    disposeMeshes(this.meshes)
  }
}

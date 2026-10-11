import * as THREE from 'three'
import { withCurve } from '../core/curve.js'

/**
 * Things a working astronaut pulls out to check on its work.
 *
 * Every so often a thread that is running stops hammering, gets something out, looks at it
 * for a few seconds and puts it away again — a beat that says "checking" rather than
 * "building", and one that the crowd does out of step so the site never freezes at once.
 * The props are instanced like everything else worn: each kind owns a few InstancedMeshes,
 * the astronauts hand over the chest bone's matrix and how far into the check they are,
 * and the prop places itself.
 *
 * One kind so far: a ledger (the old folding-phone geometry, re-skinned). More can be added here and cycled by `pickProp`.
 */

/** Seconds a check lasts, and the gap between one and the next, in seconds. */
export const CHECK_LEN = 7.4
export const CHECK_EVERY = [35, 85]

export const PROP_KINDS = ['phone']

/** Which prop a check uses. Uniform for now; weights can go here when there are more. */
export function pickProp() {
  return PROP_KINDS[Math.floor(Math.random() * PROP_KINDS.length)]
}

// ── the phone ───────────────────────────────────────────────────────────────────────────

/**
 * A book-style folding phone, in the rig's own units off the helmet radius. Closed it is a
 * 4:3 portrait slab; it opens along its long edge into two panels side by side, wider than
 * it is tall — a small tablet — which is the shape the folding iPhone is expected to take.
 * The half in the hand carries the back with the pear on it; the other half carries the
 * cover screen on its outside, and both have a screen on the inside.
 */
const PHONE = {
  // Oversized for the character, the way a cartoon phone is — a true-scale one is a
  // speck at the distance the colony is watched from.
  w: 0.64, // one panel, as a share of R
  h: 0.85, // 4:3 portrait
  t: 0.075, // one panel's thickness
  r: 0.04, // corner rounding
  // Where it sits in the left hand's own frame, in R: the half in the hand is centred here,
  // and the Euler turns the screens toward the visor.
  x: 0,
  y: 0.25, // up the forearm a touch, so the bottom corner sits in the fist rather than under it
  z: -0.1,
  rx: -0.6, // tipped up toward the visor
  ry: Math.PI,
  rz: 0,
  // Where along the phone the hand grips, as a share of its height from the middle: the
  // bottom edge sits in the palm and the body stands up out of the fist.
  grip: 0.45,
  // The check's timeline, seconds from its start.
  out: 0.5, // grows in the hand as the arm comes up
  open: [0.55, 1.35], // flips open
  close: [CHECK_LEN - 1.6, CHECK_LEN - 0.9], // folds shut
  away: CHECK_LEN - 0.55, // and shrinks away as the arm drops
}

export class Props {
  constructor(R, capacity) {
    this.R = R
    this.capacity = capacity
    this.uniforms = { uTime: { value: 0 } }
    this.meshes = []
    this._m = new THREE.Matrix4()
    this._m2 = new THREE.Matrix4()
    this._m3 = new THREE.Matrix4()
    this._v = new THREE.Vector3()
    this._q = new THREE.Quaternion()
    this._e = new THREE.Euler()
    this._s = new THREE.Vector3()
    this._n = 0
    /** The hold, exposed so it can be tuned live. */
    this.tune = PHONE
    this._buildPhone()
  }

  _buildPhone() {
    const R = this.R
    const w = PHONE.w * R
    const h = PHONE.h * R
    const t = PHONE.t * R

    const body = new THREE.MeshStandardMaterial({ color: 0x5a3320, roughness: 0.7, metalness: 0.05 })
    const back = new THREE.MeshStandardMaterial({ map: pearTexture(), roughness: 0.7, metalness: 0.05 })
    const screen = this._screenMaterial()

    // Box faces come grouped +X, -X, +Y, -Y, +Z, -Z, so each face can carry its own material:
    // the inside (+Z) is a screen on both halves; the outside (-Z) is the back on the half in
    // the hand and the cover screen on the other.
    const geoA = roundedBox(w, h, t, PHONE.r * R)
    geoA.translate(w / 2, 0, 0) // x in [0, w], hinge edge at x = 0
    const geoB = roundedBox(w, h, t, PHONE.r * R)
    geoB.translate(-w / 2, 0, 0) // x in [-w, 0]

    const halfA = new THREE.InstancedMesh(geoA, [body, body, body, body, screen, back], this.capacity)
    const halfB = new THREE.InstancedMesh(geoB, [body, body, body, body, screen, screen], this.capacity)
    for (const m of [halfA, halfB]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      m.count = 0
      m.frustumCulled = false
      m.castShadow = true
      m.receiveShadow = false
      m.name = 'prop-phone'
      this.meshes.push(m)
    }
    this.phone = { halfA, halfB, w, h, t }
  }

  /**
   * The screen: rows of glyph-shaped bars scrolling up, like a terminal or a diff going by,
   * with a little flicker on top so it reads as *doing something* rather than a picture of
   * text. Procedural, so it costs no texture and every phone runs its own feed.
   */
  _screenMaterial() {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: true })
    const uniforms = this.uniforms
    mat.onBeforeCompile = (shader) => {
      withCurve(shader)
      Object.assign(shader.uniforms, uniforms)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n varying float vSeed;\n varying vec2 vScreenUv;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           #ifdef USE_INSTANCING
             vSeed = float( gl_InstanceID ) * 0.731;
           #else
             vSeed = 0.0;
           #endif
           vScreenUv = uv;`
        )
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform float uTime;
           varying float vSeed;
           varying vec2 vScreenUv;
           float bcHash( float x ) { return fract( sin( x * 12.9898 ) * 43758.5453 ); }`
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
           {
             // A ledger page: leather cover edge, cream paper, ruled lines of ink scrolling
             // up as the artisan turns pages, and now and then a red stamp. Per instance.
             vec2 inner = ( vScreenUv - 0.05 ) / 0.9;
             if ( any( lessThan( inner, vec2( 0.0 ) ) ) || any( greaterThan( inner, vec2( 1.0 ) ) ) ) {
               diffuseColor.rgb = vec3( 0.12, 0.06, 0.03 );
             } else {
               vec3 col = mix( vec3( 0.86, 0.78, 0.6 ), vec3( 0.93, 0.87, 0.72 ), inner.y );
               float rows = 11.0;
               float y = inner.y * rows + uTime * 0.35 + vSeed * 7.0;
               float row = floor( y );
               float fy = fract( y );
               float w = 0.35 + bcHash( row * 3.7 + vSeed ) * 0.55;
               float cx = ( inner.x - 0.08 ) / 0.84;
               float line = step( 0.0, cx ) * step( cx, w ) * step( 0.4, fy ) * step( fy, 0.62 );
               float stamp = step( 0.9, bcHash( row * 5.1 + vSeed ) ) * step( 0.78, inner.x ) * step( inner.x, 0.94 ) * step( 0.2, fy ) * step( fy, 0.8 );
               col = mix( col, vec3( 0.2, 0.12, 0.08 ), line * 0.85 );
               col = mix( col, vec3( 0.66, 0.2, 0.18 ), stamp );
               // Faint ruled guide under every line.
               col *= 1.0 - 0.08 * step( 0.9, fy );
               diffuseColor.rgb = col;
             }
           }`
        )
    }
    mat.customProgramCacheKey = () => 'souk-prop-ledger'
    return mat
  }

  /** Start a frame: nothing placed yet. */
  begin() {
    this._n = 0
  }

  /**
   * Place a prop for one astronaut. `hand` is the holding hand's world matrix (root × bone),
   * `t` is seconds since the check began.
   */
  write(kind, hand, t) {
    if (this._n >= this.capacity) return
    if (kind === 'phone') this._writePhone(hand, t)
  }

  _writePhone(hand, t) {
    const R = this.R
    const { halfA, halfB, w, h, t: thick } = this.phone
    const i = this._n++

    // Grows in the hand as the arm comes up, shrinks away as it drops.
    let out = 1
    if (t < PHONE.out) out = smooth(t / PHONE.out)
    else if (t > PHONE.away) out = 1 - smooth((t - PHONE.away) / (CHECK_LEN - PHONE.away))
    const s = Math.max(0.001, out)
    // Closed is a half turn on the hinge; open is flat. Shut on the way out, shut again to go.
    let open = 0
    if (t >= PHONE.open[1] && t <= PHONE.close[0]) open = 1
    else if (t > PHONE.open[0] && t < PHONE.open[1]) open = smooth((t - PHONE.open[0]) / (PHONE.open[1] - PHONE.open[0]))
    else if (t > PHONE.close[0] && t < PHONE.close[1]) open = 1 - smooth((t - PHONE.close[0]) / (PHONE.close[1] - PHONE.close[0]))
    const hinge = Math.PI * (1 - open)

    // In the hand's own frame: the half held is centred on the hold point, the other half
    // swings out from its hinge edge.
    const e = this._e
    const q = this._q
    const v = this._v
    const root = this._m
    e.set(PHONE.rx, PHONE.ry, PHONE.rz)
    q.setFromEuler(e)
    v.set(PHONE.x * R, PHONE.y * R, PHONE.z * R)
    root.compose(v, q, this._s.setScalar(s))
    root.premultiply(hand)
    root.multiply(this._m2.makeTranslation(-w / 2, PHONE.grip * h, -thick / 2))
    halfA.setMatrixAt(i, root)

    // Half B rotates about the hinge: the inside edge of A, at the inner face's height, so
    // when shut it lies flat on A's screen rather than through it.
    const fold = this._m3
    fold.makeTranslation(0, 0, thick / 2)
    e.set(0, hinge, 0)
    q.setFromEuler(e)
    fold.multiply(this._m2.makeRotationFromQuaternion(q))
    fold.multiply(this._m2.makeTranslation(0, 0, -thick / 2))
    fold.premultiply(root)
    halfB.setMatrixAt(i, fold)
  }

  /** End the frame: the counts are what was placed. */
  end() {
    for (const m of this.meshes) {
      m.count = this._n
      m.instanceMatrix.needsUpdate = true
    }
  }

  update(elapsed) {
    this.uniforms.uTime.value = elapsed
  }

  setShadows(on) {
    for (const m of this.meshes) m.castShadow = on
  }
}

function smooth(x) {
  x = Math.min(1, Math.max(0, x))
  return x * x * (3 - 2 * x)
}

/** A rounded box that keeps BoxGeometry's per-face groups, so faces can carry materials. */
function roundedBox(w, h, d, r) {
  const geo = new THREE.BoxGeometry(w, h, d, 2, 2, 2)
  const pos = geo.attributes.position
  const v = new THREE.Vector3()
  const inner = new THREE.Vector3()
  const half = new THREE.Vector3(w / 2 - r, h / 2 - r, d / 2 - r)
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    inner.set(
      THREE.MathUtils.clamp(v.x, -half.x, half.x),
      THREE.MathUtils.clamp(v.y, -half.y, half.y),
      THREE.MathUtils.clamp(v.z, -half.z, half.z)
    )
    const out = v.sub(inner)
    if (out.lengthSq() > 0) out.setLength(r)
    pos.setXYZ(i, inner.x + out.x, inner.y + out.y, inner.z + out.z)
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()
  return geo
}

/**
 * The back of the ledger: leather with an eight-pointed copper star, the rub el hizb.
 * Drawn once into a small canvas.
 */
function pearTexture() {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const c = canvas.getContext('2d')
  c.fillStyle = '#5a3320'
  c.fillRect(0, 0, size, size)
  c.fillStyle = '#b87333'
  const cx = size / 2
  const cy = size / 2
  const r = size * 0.28
  for (const turn of [0, Math.PI / 4]) {
    c.save()
    c.translate(cx, cy)
    c.rotate(turn)
    c.fillRect(-r, -r, r * 2, r * 2)
    c.restore()
  }
  c.fillStyle = '#5a3320'
  c.beginPath()
  c.arc(cx, cy, r * 0.45, 0, Math.PI * 2)
  c.fill()

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

import * as THREE from 'three'

/**
 * The "waiting on you" beam: a tall column of warm lantern gold standing over every artisan
 * who needs a reply, so the one that wants you is visible from anywhere in the souk. It is
 * the only tall light on screen; the badge above the artisan uses the same gold.
 *
 * One instanced open cone for all of them. Built-in material, so the world curve patch
 * (core/curve.js) bends it with everything else.
 */

export const BEAM_GOLD = 0xffc864
const BEAM_HEIGHT = 18
const BEAM_BASE = 0.16
const BEAM_TOP = 0.05
const BEAM_OPACITY = 0.3
const FADE_STEPS = 64

/** A vertical alpha ramp: bright at the artisan's feet, gone at the top. */
function fadeTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = FADE_STEPS
  const ctx = canvas.getContext('2d')
  const grad = ctx.createLinearGradient(0, FADE_STEPS, 0, 0)
  grad.addColorStop(0, '#ffffff')
  grad.addColorStop(0.35, '#a0a0a0')
  grad.addColorStop(1, '#000000')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 1, FADE_STEPS)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.NoColorSpace
  return tex
}

export class WaitingBeams {
  constructor(scene, capacity = 24) {
    const geo = new THREE.CylinderGeometry(BEAM_TOP, BEAM_BASE, BEAM_HEIGHT, 12, 1, true)
    geo.translate(0, BEAM_HEIGHT / 2, 0)
    this.material = new THREE.MeshBasicMaterial({
      color: BEAM_GOLD,
      alphaMap: fadeTexture(),
      transparent: true,
      opacity: BEAM_OPACITY,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    })
    this.mesh = new THREE.InstancedMesh(geo, this.material, capacity)
    this.mesh.count = 0
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 5
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    scene.add(this.mesh)
    this.scene = scene
    this.capacity = capacity
    this._m = new THREE.Matrix4()
  }

  /** `agents` are the live crew; only those with status 'waiting' get a beam. */
  update(agents, elapsed) {
    let n = 0
    for (const a of agents) {
      if (a.status !== 'waiting' || n >= this.capacity) continue
      this._m.makeTranslation(a.pos.x, a.pos.y, a.pos.z)
      this.mesh.setMatrixAt(n++, this._m)
    }
    this.mesh.count = n
    this.mesh.instanceMatrix.needsUpdate = true
    this.material.opacity = BEAM_OPACITY * (0.85 + 0.15 * Math.sin(elapsed * 2.4))
  }

  dispose() {
    this.scene.remove(this.mesh)
    this.mesh.dispose()
    this.mesh.geometry.dispose()
    this.material.alphaMap?.dispose()
    this.material.dispose()
  }
}

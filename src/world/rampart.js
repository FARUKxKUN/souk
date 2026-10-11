import * as THREE from 'three'
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js'
import { atlasTexture, hasPart, kitReady, part } from './kit.js'

/**
 * The medina's perimeter wall: a ring of whitewashed rampart with a tower every few
 * segments, built out of the medina kit's own `wall_seg` and `tower` pieces.
 *
 * It exists to close the horizon. Without it the camera looks out over open ground to the
 * edge of the world, and everything out there - ground, scatter, haze - is drawn for nobody.
 * With it, the view ends at a wall, and the world only has to be as big as the wall.
 *
 * The whole ring is merged into one geometry, so it is a single draw call and no per-frame
 * cost. It never casts a shadow: it stands outside the shadow camera's reach in all but the
 * most zoomed-out pans, and a ring-wide shadow pass over it would cost more than it shows.
 */

/** Length of one wall segment along the ring, in metres. */
const SEGMENT = 10
/** wall_seg is 1.9 wide in the kit; this is the uniform scale that makes it SEGMENT long. */
const WALL_SCALE = SEGMENT / 1.9
/** A tower stands on every Nth joint between wall segments. */
const TOWER_EVERY = 5
const TOWER_SCALE = 2.0
/** wall_seg's height in the kit: the wall box plus its limestone cap. */
const WALL_HEIGHT = 0.67
/** How far the base reaches under the ground, so a slope never shows a gap beneath the wall. */
const SKIRT = 1.6
/** The ground the wall stands on is flat; this guards against the odd noise bump regardless. */
const BASE_LIFT = 0

/**
 * @param radius   ring radius in metres from the middle of the colony
 * @param heightAt ground height at (x, z)
 * @returns `{ mesh, dispose }`, or null when the medina kit has not loaded yet
 */
export function createRampart({ radius, heightAt }) {
  if (!kitReady('medina') || !hasPart('wall_seg', 'medina') || !hasPart('tower', 'medina')) return null

  const count = Math.max(12, Math.round((Math.PI * 2 * radius) / SEGMENT))
  const pieces = []
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const pos = new THREE.Vector3()
  const scale = new THREE.Vector3()

  // Segments are centred between ring stations and towers stand on the stations, so a tower
  // always sits at the joint of two walls.
  const place = (name, angle, sx, sy, sz, drop) => {
    const x = Math.cos(angle) * radius
    const z = Math.sin(angle) * radius
    // The piece's long axis is x, so it has to lie along the tangent of the ring: a rotation
    // about y of -angle - 90 degrees takes +x to (-sin, cos).
    q.setFromAxisAngle(up, -angle - Math.PI / 2)
    scale.set(sx, sy, sz)
    pos.set(x, heightAt(x, z) + BASE_LIFT - drop, z)
    m.compose(pos, q, scale)
    const geo = part(name, 'medina')
    geo.applyMatrix4(m)
    pieces.push(geo)
  }
  // The wall is stretched downward by the skirt rather than moved, so its top stays level.
  const wallY = WALL_SCALE + SKIRT / WALL_HEIGHT
  for (let i = 0; i < count; i++) {
    const step = (Math.PI * 2) / count
    place('wall_seg', (i + 0.5) * step, WALL_SCALE * 1.04, wallY, WALL_SCALE, SKIRT)
    if (i % TOWER_EVERY === 0) place('tower', i * step, TOWER_SCALE, TOWER_SCALE, TOWER_SCALE, 0)
  }

  const geo = BufferGeometryUtils.mergeGeometries(pieces, false)
  pieces.forEach((g) => g.dispose())
  const material = new THREE.MeshStandardMaterial({ map: atlasTexture('medina'), roughness: 0.85, metalness: 0 })
  const mesh = new THREE.Mesh(geo, material)
  mesh.name = 'rampart'
  mesh.castShadow = false
  mesh.receiveShadow = true
  // The ring is the size of the world, so one bounding sphere is as good as no culling; it is
  // one draw call either way, and skipping the test avoids it popping at a steep tilt.
  mesh.frustumCulled = false

  return {
    mesh,
    dispose() {
      geo.dispose()
      material.dispose()
    },
  }
}

import * as THREE from 'three'
import { Engine } from '../src/core/engine.js'
import { CameraRig } from '../src/core/camera.js'
import { DEFAULT_PRESET, Settings } from '../src/core/settings.js'
import { Colony } from '../src/game/colony.js'
import { loadKit } from '../src/world/kit.js'
import { loadCrew, crewRig } from '../src/agents/crew.js'
import { CURVE_FULL, installWorldCurve, setCurveView } from '../src/core/curve.js'
import { mulberry } from '../src/world/planet.js'

/**
 * Repeatable performance benchmark: `tools/bench.html?preset=balanced&t=0.34`, driven by
 * tools/bench-run.mjs.
 *
 * Boots the real engine, camera rig and colony against a fixed fixture population (12 artisans
 * across 5 workshops). The frame loop is stopped and driven by hand so a measurement is not
 * capped by vsync: every timed run ends in `gl.finish()`, which makes wall time GPU-inclusive.
 */

Math.random = mulberry(9342)
const q = new URLSearchParams(location.search)
const time = Number(q.get('t') ?? 0.34)
await Promise.all([loadKit(), loadCrew()])
installWorldCurve()
const settings = new Settings()
settings.applyPreset(q.get('preset') || DEFAULT_PRESET)
// `?set=ibl:false,bloom:false` overrides individual knobs on top of the preset.
for (const pair of (q.get('set') || '').split(',').filter(Boolean)) {
  const [k, v] = pair.split(':')
  settings.values[k] = JSON.parse(v)
}
Object.assign(settings.values, {
  planet: 'medina', autoQuality: q.get('governor') === '1', timeOfDay: time, autoTime: false, clockTime: false,
})
const engine = new Engine(settings).mount(document.querySelector('#scene'))
engine.stop()
const rig = new CameraRig(engine.camera, engine.canvas, settings)
const colony = new Colony(engine.scene, settings, engine.camera, engine.renderer)
colony.astronauts.setRig(crewRig())
colony.onAssetsReady()

const SIZES = [4, 3, 2, 2, 1]
const NOW = Date.now()
const threads = SIZES.flatMap((n, p) =>
  Array.from({ length: n }, (_, i) => {
    const k = p * 10 + i
    return {
      id: `bench-${k}`, project: `workshop-${p}`, title: `Thread ${k}`, createdAt: k, lastActivityAt: NOW,
      sizeBytes: 10 ** (4 + (k % 5)), unread: k % 4 === 0, running: k % 4 === 1,
    }
  })
)
colony.setThreads(threads, new Set(), new Set(), new Set(threads.map((t) => t.id)))

let elapsed = 0
function step(dt = 1 / 60) {
  elapsed += dt
  rig.setLimits?.(colony.world)
  engine.setFar?.(colony.world?.far ?? 900)
  rig.update(dt)
  setCurveView(rig.target, rig.azimuth, settings.get('worldCurve') * CURVE_FULL)
  colony.update(dt, elapsed, rig.target)
  engine.setFocusDistance(rig.distance)
}

const ISO = THREE.MathUtils.degToRad(56)
const VIEWS = {
  mid: { distance: 62, polar: ISO },
  default: { distance: 62, polar: ISO },
  // Farthest the camera is allowed out, at the resting angle, and at the flattest tilt.
  wide: { distance: 150, polar: ISO },
  low: { distance: 150, polar: THREE.MathUtils.degToRad(84) },
  close: { distance: 14, polar: ISO },
}
function setView(name, azimuth = Math.PI / 4) {
  const v = VIEWS[name] || VIEWS.mid
  rig.target.set(0, 0, 0)
  rig.desiredTarget.copy(rig.target)
  rig.setLimits?.(colony.world)
  // The same clamps the user's wheel and drag are held to.
  // 'wide' is the farthest the camera may go; 'default' is where the app opens.
  const dist = name === 'wide' ? (rig.maxDist ?? 150) : name === 'default' ? (rig.homeDist ?? 62) : v.distance
  rig.distance = rig.desiredDistance = Math.min(dist, rig.maxDist ?? 150)
  rig.polar = rig.desiredPolar = Math.min(v.polar, rig.maxPolar ?? 1.46)
  rig.azimuth = rig.desiredAzimuth = azimuth
  rig._sync()
  for (let i = 0; i < 6; i++) step()
}

for (let f = 0; f < 600; f++) step(1 / 30)
setView('mid')

const gl = engine.renderer.getContext()
const draw = () => {
  step()
  engine.renderer.info.reset()
  engine.renderFrame()
}

// GPU timers with pause/resume nesting, so shadow-map time is separated from the scene pass.
const tq = gl.getExtension('EXT_disjoint_timer_query_webgl2')
const pending = []
const totals = new Map()
const stack = []
let live = null
function startQuery(name) {
  const query = gl.createQuery()
  gl.beginQuery(tq.TIME_ELAPSED_EXT, query)
  live = { name, query }
}
function qBegin(name) {
  if (live) {
    gl.endQuery(tq.TIME_ELAPSED_EXT)
    pending.push(live)
    live = null
  }
  stack.push(name)
  startQuery(name)
}
function qEnd() {
  if (live) {
    gl.endQuery(tq.TIME_ELAPSED_EXT)
    pending.push(live)
    live = null
  }
  stack.pop()
  if (stack.length) startQuery(stack[stack.length - 1])
}
function wrap(obj, key, name) {
  const fn = obj[key]
  if (fn.__wrapped) return
  obj[key] = function (...a) {
    qBegin(name)
    try {
      return fn.apply(this, a)
    } finally {
      qEnd()
    }
  }
  obj[key].__wrapped = true
}
function instrument() {
  const passes = engine.composer?.passes || []
  passes.forEach((p, i) => wrap(p, 'render', `${String(i).padStart(2, '0')}:${p.constructor.name}`))
  wrap(engine.renderer.shadowMap, 'render', 'shadowmap')
}
async function collect() {
  for (let i = 0; i < 6; i++) await new Promise((r) => requestAnimationFrame(r))
  for (const p of pending.splice(0)) {
    if (!gl.getQueryParameter(p.query, gl.QUERY_RESULT_AVAILABLE)) continue
    if (gl.getParameter(tq.GPU_DISJOINT_EXT)) continue
    totals.set(p.name, (totals.get(p.name) || 0) + gl.getQueryParameter(p.query, gl.QUERY_RESULT) / 1e6)
  }
}

const toggleVis = (obj) => () => {
  if (!obj) return null
  const v = obj.visible
  obj.visible = false
  return () => { obj.visible = v }
}
const flip = (key, off) => () => {
  const v = settings.values[key]
  settings.values[key] = off
  return () => { settings.values[key] = v }
}
const ABLATIONS = {
  noScatter: () => toggleVis(colony.scatterGroup)(),
  noTerrain: () => toggleVis(colony.terrain)(),
  noGrass: () => toggleVis(colony.grass?.mesh)(),
  noPlots: () => toggleVis(colony.plotGroup)(),
  noAgents: () => toggleVis(colony.astronauts.group)(),
  noShadows: flip('shadows', 'off'),
  noTiltShift: flip('tiltShift', false),
  noAO: flip('ambientOcclusion', 0),
  noBloom: flip('bloom', false),
  noGrade: flip('colorGrade', false),
  noPost: () => {
    const o = { ...settings.values }
    Object.assign(settings.values, { bloom: false, tiltShift: false, ambientOcclusion: 0, colorGrade: false, antialias: false })
    return () => Object.assign(settings.values, o)
  },
  halfRes: () => {
    const v = settings.values.renderScale
    settings.values.renderScale = v / 2
    return () => { settings.values.renderScale = v }
  },
}

window.__bench = {
  gpu() {
    const e = gl.getExtension('WEBGL_debug_renderer_info')
    return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
  },
  hasTimer: !!tq,
  view: setView,
  frameMs(frames = 120, warm = 30) {
    for (let i = 0; i < warm; i++) draw()
    gl.finish()
    const t0 = performance.now()
    let cpu = 0
    for (let i = 0; i < frames; i++) {
      const c0 = performance.now()
      draw()
      cpu += performance.now() - c0
    }
    gl.finish()
    return { ms: +((performance.now() - t0) / frames).toFixed(2), cpuMs: +(cpu / frames).toFixed(2) }
  },
  /** CPU cost of the simulation alone (no draw), and of submitting a frame without waiting on the GPU. */
  cpuMs(frames = 120) {
    for (let i = 0; i < 20; i++) step()
    const t0 = performance.now()
    for (let i = 0; i < frames; i++) step()
    const update = (performance.now() - t0) / frames
    return { updateMs: +update.toFixed(2) }
  },
  async passMs(frames = 60) {
    if (!tq) return null
    instrument()
    for (let i = 0; i < 10; i++) draw()
    await collect()
    totals.clear()
    pending.length = 0
    for (let i = 0; i < frames; i++) {
      draw()
      if (i % 10 === 9) await collect()
    }
    await collect()
    return Object.fromEntries([...totals].map(([k, v]) => [k, +(v / frames).toFixed(3)]))
  },
  info() {
    draw()
    const i = engine.renderer.info
    return {
      calls: i.render.calls, triangles: i.render.triangles, textures: i.memory.textures,
      geometries: i.memory.geometries, buffer: [engine.canvas.width, engine.canvas.height],
      dpr: devicePixelRatio, scale: +engine.viewport.scale.toFixed(3),
    }
  },
  /** Triangle census of the scene graph, grouped by contributor. */
  census() {
    const groups = new Map()
    let total = 0
    let shadow = 0
    let meshes = 0
    engine.camera.updateMatrixWorld()
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(engine.camera.projectionMatrix, engine.camera.matrixWorldInverse)
    )
    const sphere = new THREE.Sphere()
    engine.scene.traverse((o) => {
      if (!o.isMesh) return
      for (let p = o; p; p = p.parent) if (!p.visible) return
      const g = o.geometry
      if (!g?.attributes?.position) return
      const per = (g.index ? g.index.count : g.attributes.position.count) / 3
      const n = per * (o.isInstancedMesh ? o.count : 1)
      meshes++
      let inView = true
      if (o.frustumCulled) {
        if (!g.boundingSphere) g.computeBoundingSphere()
        sphere.copy(g.boundingSphere).applyMatrix4(o.matrixWorld)
        inView = frustum.intersectsSphere(sphere)
      }
      let group = o.parent
      while (group && !group.name) group = group.parent
      const label = `${group?.name || 'root'}/${o.name || g.name || 'mesh'}${o.isInstancedMesh ? ` x${o.count}` : ''}`
      const e = groups.get(label) || { label, tris: 0, inView: 0, cast: 0, draws: 0 }
      e.tris += n
      e.draws++
      if (inView) e.inView += n
      if (o.castShadow) e.cast += n
      groups.set(label, e)
      total += n
      if (o.castShadow) shadow += n
    })
    const top = [...groups.values()].sort((a, b) => b.tris - a.tris).slice(0, 14)
    return { total, shadowCasterTris: shadow, meshes, top }
  },
  ablate(name, frames = 80) {
    const undo = ABLATIONS[name]()
    engine.applySettings()
    const r = this.frameMs(frames, 20)
    if (undo) undo()
    engine.applySettings()
    return r
  },
  names: () => Object.keys(ABLATIONS),
  set(k, v) { settings.set(k, v); engine.applySettings() },
  settings: () => ({ ...settings.values }),
  step,
  shot: () => {
    engine.renderFrame()
    return engine.canvas.toDataURL('image/png')
  },
  engine,
  colony,
  rig,
  settings,
}
window.__ready = true

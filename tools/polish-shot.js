import * as THREE from 'three'
import { Engine } from '../src/core/engine.js'
import { Settings, PRESETS } from '../src/core/settings.js'
import { Colony } from '../src/game/colony.js'
import { loadKit } from '../src/world/kit.js'
import { loadCrew, crewRig } from '../src/agents/crew.js'
import { installWorldCurve, setCurveView, CURVE_FULL } from '../src/core/curve.js'
import { mulberry } from '../src/world/planet.js'

Math.random = mulberry(9342)
const q = new URLSearchParams(location.search)
const time = Number(q.get('t') ?? 0.34)
const mode = q.get('view') || 'wide'
await Promise.all([loadKit(), loadCrew()])
installWorldCurve()
const settings = new Settings()
Object.assign(settings.values, PRESETS.balanced.values, {
  planet: q.get('planet') || 'medina', autoQuality: false, timeOfDay: time, autoTime: false, clockTime: false,
  renderScale: 1 / devicePixelRatio, worldCurve: 0.45, fov: 38,
})
const engine = new Engine(settings).mount(document.querySelector('#scene'))
const colony = new Colony(engine.scene, settings, engine.camera, engine.renderer)
colony.astronauts.setRig(crewRig())
const threads = Array.from({ length: 24 }, (_, i) => ({
  id: `p-${i}`, project: `fixture-${Math.floor(i / 8)}`, title: `Fixture ${i}`,
  createdAt: i, lastActivityAt: Date.now(), sizeBytes: 10 ** (4 + (i % 5)), unread: i % 3 === 0, running: i % 3 === 1,
}))
colony.setThreads(threads, new Set(), new Set(), new Set(threads.map((t) => t.id)))
const focus = new THREE.Vector3()
const view = (x, y, z, d = 1, ax = 30, az = 40) => {
  focus.set(x, y, z)
  engine.camera.position.set(x + ax * d, y + 30 * d, z + az * d)
  engine.camera.lookAt(focus)
  engine.setFocusDistance(engine.camera.position.distanceTo(focus))
  setCurveView(focus, Math.atan2(30, 40), CURVE_FULL * 0.45)
}
view(0, 0, 0, 1.0)
let elapsed = 0
for (let f = 0; f < 600; f++) { elapsed += 1 / 30; colony.update(1 / 30, elapsed, focus) }
window.__colony = colony
window.__view = (mode2, i = 0) => {
  const entries = [...colony.buildings.values()]
  if (mode2 === 'wide') return view(0, 0, 0, 1.0)
  if (mode2 === 'shop') { const p = entries[i].mesh.position; return view(p.x, p.y + 0.5, p.z, 0.2) }
  if (mode2 === 'wait') {
    const a = colony.astronauts.agents.find((x) => x.status === 'waiting') || colony.astronauts.agents[0]
    return view(a.pos.x, a.pos.y + 1, a.pos.z, 0.2)
  }
}
window.__view(mode)
engine.add({ update(dt) { elapsed += dt; colony.update(dt, elapsed, focus) } })
engine.start()
window.__ready = true

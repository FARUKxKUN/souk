import test from 'node:test'
import assert from 'node:assert/strict'
import { gpuTierFor, readGpuRenderer, TIER_PRESET } from '../src/core/gpu-tier.js'
import { PRESETS } from '../src/core/settings.js'

// A stand-in localStorage so Settings can be built and inspected in node.
function withStorage(initial, fn) {
  const store = new Map(Object.entries(initial))
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'localStorage')
  const prev = globalThis.localStorage
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  }
  return Promise.resolve().then(fn).finally(() => {
    if (had) globalThis.localStorage = prev
    else delete globalThis.localStorage
  })
}

const KEY = 'souk.settings.v1'
const { Settings } = await import('../src/core/settings.js')

test('a discrete NVIDIA or AMD card is classed discrete, integrated parts are not', () => {
  assert.equal(gpuTierFor('ANGLE (NVIDIA, NVIDIA GeForce RTX 2050 (0x000025A9) Direct3D11 vs_5_0 ps_5_0, D3D11)'), 'discrete')
  assert.equal(gpuTierFor('ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11)'), 'discrete')
  assert.equal(gpuTierFor('AMD Radeon RX 6600'), 'discrete')
  assert.equal(gpuTierFor('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x000046A6) Direct3D11, D3D11)'), 'integrated')
  assert.equal(gpuTierFor('AMD Radeon(TM) Graphics'), 'integrated')
  assert.equal(gpuTierFor('Apple M2'), 'integrated')
  assert.equal(gpuTierFor(''), 'unknown')
  assert.equal(gpuTierFor('Google SwiftShader'), 'unknown')
})

test('the starting preset follows the tier, and every tier names a real preset', () => {
  assert.equal(TIER_PRESET.discrete, 'high')
  assert.equal(TIER_PRESET.integrated, 'balanced')
  assert.equal(TIER_PRESET.unknown, 'balanced')
  for (const name of Object.values(TIER_PRESET)) assert.ok(PRESETS[name], name)
})

test('the renderer probe reads the unmasked name and releases its context', () => {
  let lost = false
  const gl = {
    RENDERER: 7,
    getExtension: (name) => {
      if (name === 'WEBGL_debug_renderer_info') return { UNMASKED_RENDERER_WEBGL: 1 }
      if (name === 'WEBGL_lose_context') return { loseContext: () => { lost = true } }
      return null
    },
    getParameter: (p) => (p === 1 ? 'ANGLE (NVIDIA, RTX 2050)' : 'generic'),
  }
  const name = readGpuRenderer(() => ({ getContext: () => gl }))
  assert.equal(name, 'ANGLE (NVIDIA, RTX 2050)')
  assert.equal(lost, true)
  assert.equal(readGpuRenderer(() => ({ getContext: () => { throw new Error('no gl') } })), '')
})

test('a fresh install takes the tier preset, and the choice is remembered', async () => {
  await withStorage({}, () => {
    const s = new Settings()
    s.setGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 2050)', 'discrete')
    assert.equal(s.get('preset'), 'high')
    assert.equal(s.get('maxPixelRatio'), PRESETS.high.values.maxPixelRatio)
    assert.equal(s.get('bloomRes'), 'half')
    assert.equal(s.gpu.tier, 'discrete')
  })
})

test('an existing install that never picked a preset moves to the tier default exactly once', async () => {
  const stored = { preset: 'balanced', renderScale: 0.9, perfTuned: 2 }
  await withStorage({ [KEY]: JSON.stringify(stored) }, async () => {
    const s = new Settings()
    s.setGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 2050)', 'discrete')
    assert.equal(s.get('preset'), 'high')
    assert.equal(s.get('tierDefaulted'), true)
    // Going back to Balanced by hand is a choice, and a later boot does not undo it.
    s.applyPreset('balanced')
    // Settings saves 400ms after a change; the next boot must see what was saved.
    await new Promise((resolve) => setTimeout(resolve, 450))
    const again = new Settings()
    again.setGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 2050)', 'discrete')
    assert.equal(again.get('preset'), 'balanced')
  })
})

test('a preset picked by hand is never overridden by the GPU, on any tier', async () => {
  const stored = { preset: 'low', presetPicked: true, renderScale: 0.7 }
  await withStorage({ [KEY]: JSON.stringify(stored) }, () => {
    const s = new Settings()
    s.setGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 2050)', 'discrete')
    assert.equal(s.get('preset'), 'low')
  })
  const handPicked = { preset: 'balanced', presetPicked: true }
  await withStorage({ [KEY]: JSON.stringify(handPicked) }, () => {
    const s = new Settings()
    s.setGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 2050)', 'discrete')
    assert.equal(s.get('preset'), 'balanced')
  })
})

test('a hand-tuned knob (custom preset) keeps its values', async () => {
  const stored = { preset: 'custom', renderScale: 0.6 }
  await withStorage({ [KEY]: JSON.stringify(stored) }, () => {
    const s = new Settings()
    s.setGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 2050)', 'discrete')
    assert.equal(s.get('preset'), 'custom')
    assert.equal(s.get('renderScale'), 0.6)
  })
})

test('sound is off for a new install, and a saved choice still wins', async () => {
  await withStorage({}, () => {
    assert.equal(new Settings().get('sound'), false)
  })
  await withStorage({ [KEY]: JSON.stringify({ sound: true }) }, () => {
    assert.equal(new Settings().get('sound'), true)
  })
})

test('the medina keeps its swallows and its gate hum silent, other planets keep theirs', async () => {
  const { PLANETS } = await import('../src/world/planet.js')
  assert.equal(PLANETS.medina.audio.calls, false)
  assert.equal(PLANETS.medina.audio.shipHum, false)
  assert.equal(PLANETS.moon.audio?.calls, undefined)
  assert.equal(PLANETS.moon.audio?.shipHum, undefined)
  const ev = Object.fromEntries(PLANETS.medina.audio.events.map((e) => [e.sound, e]))
  assert.deepEqual(ev.pigeon.every, [45, 120])
  assert.equal(ev.pigeon.gain, 1)
  assert.deepEqual(ev['cart-wheels'].every, [90, 240])
  assert.equal(ev['cart-wheels'].gain, 0.9)
  assert.deepEqual(ev['copper-tink'].every, [120, 300])
  assert.equal(ev['copper-tink'].gain, 0.8)
  assert.equal(ev['cat-mew'].gain, 0.8)
  assert.equal(PLANETS.medina.audio.beds.find((b) => b.sound === 'fountain').gain, 1.5)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createCardFace, paintCardFace } from '../src/ui/card-face.js'

// The card's face is drawn onto 2D canvases. A recording stub is enough: the regression is
// about who owns the atlas, not about pixels.
const ctxStub = () => new Proxy({}, {
  get: (t, k) => (k in t ? t[k] : () => undefined),
  set: (t, k, v) => { t[k] = v; return true },
})
const canvasStub = () => ({ width: 0, height: 0, getContext: () => ctxStub() })

const agentAt = (faceFrame) => ({ faceFrame, eye: { r: 0.2, g: 0.9, b: 1 } })
const makeAtlas = () => ({ image: { width: 512, height: 512 * 7 / 4 } })

test('the card draws its face from its own atlas, with no world atlas handed in', () => {
  const face = createCardFace(canvasStub(), canvasStub)
  let builds = 0
  const build = () => { builds++; return makeAtlas() }
  assert.doesNotThrow(() => paintCardFace(face, agentAt(0), build))
  assert.ok(face.atlas, 'the card keeps its own atlas')
  paintCardFace(face, agentAt(0), build)
  assert.equal(builds, 1, 'the atlas is built once, not per frame')
})

test('a blink re-draws the card, and an unchanged expression is skipped', () => {
  const face = createCardFace(canvasStub(), canvasStub)
  assert.equal(paintCardFace(face, agentAt(0), makeAtlas), true)
  assert.equal(paintCardFace(face, agentAt(0), makeAtlas), false, 'same frame and colour is skipped')
  assert.equal(paintCardFace(face, agentAt(3), makeAtlas), true)
  assert.equal(face.key.frame, 3)
})

test('the render loop never reads a world face atlas that no longer exists', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
  assert.doesNotMatch(main, /faceTexture/)
  const astronauts = readFileSync(new URL('../src/agents/astronauts.js', import.meta.url), 'utf8')
  assert.doesNotMatch(astronauts, /this\.faceTexture\s*=/)
})

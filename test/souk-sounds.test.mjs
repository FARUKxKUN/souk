import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SOUNDS, isSound } from '../src/audio/sounds.js'

const NEW_BEDS = ['souk-crowd', 'fountain']
const NEW_EVENTS = ['pigeon', 'cat-mew', 'cart-wheels', 'copper-tink']
const KEPT = ['select-1', 'select-2', 'select-3', 'select-4', 'select-5', 'select-6', 'chime-attention', 'ship-hum']

test('souk beds are registered as beds with a synth', () => {
  for (const name of NEW_BEDS) {
    assert.ok(isSound(name), name)
    assert.equal(SOUNDS[name].kind, 'bed')
    assert.equal(typeof SOUNDS[name].synth, 'function')
  }
})

test('souk events are registered as one-shots with a synth', () => {
  for (const name of NEW_EVENTS) {
    assert.ok(isSound(name), name)
    assert.equal(SOUNDS[name].kind, 'event')
    assert.equal(typeof SOUNDS[name].synth, 'function')
  }
})

test('existing sound names still resolve after the re-voicing', () => {
  for (const name of KEPT) assert.ok(isSound(name), name)
})

// The loop in a Karplus-Strong pluck is a delay of one period, and a feedback delay cannot be
// shorter than one 128-sample render quantum. Every reply note must clear that at 44.1 kHz,
// or the note is played flat and the six replies collapse onto one pitch.
test('every oud reply note has a feedback loop longer than one render quantum', async () => {
  const { PHRASE_FREQS } = await import('../src/audio/synth-souk.js')
  for (const f of PHRASE_FREQS) {
    assert.ok(44100 / f >= 128, `${f} Hz needs ${44100 / f} samples`)
  }
})

test('fountain drops are rare enough to be background, not a beat', async () => {
  const { FOUNTAIN_DROP } = await import('../src/audio/synth-souk.js')
  assert.ok(FOUNTAIN_DROP.min >= 3, 'drops closer than 3 seconds apart read as a pattern')
  assert.ok(FOUNTAIN_DROP.gain <= 0.2, 'drops stay well under the fountain bed')
})

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

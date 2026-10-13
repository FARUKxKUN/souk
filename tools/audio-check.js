/**
 * Offline analysis of the souk's sounds. Every synth in the registry is rendered into an
 * OfflineAudioContext with a seeded random source (so before and after runs are comparable),
 * then measured for level, DC, start/end silence, clipping, clicks and onset rate.
 *
 * Run it from a static server rooted at the repo, then call `window.runAudioCheck()`; it
 * returns a plain JSON report. tools/audio-check.html loads this file. A headless driver can
 * do the same through Playwright: open the page, `page.evaluate(() => window.runAudioCheck())`.
 */
import { SOUNDS } from '../src/audio/sounds.js'
import { createNoiseBuffers } from '../src/audio/synth.js'

const SR = 48000
const FRAME = 1 / 60
/** Medina preset gains, times the registry trim, so the report shows what actually reaches the mix. */
const PLAN = [
  { name: 'souk-crowd', seconds: 20, mix: 0.6, group: 'bed' },
  { name: 'fountain', seconds: 20, mix: 1, group: 'bed' },
  { name: 'fountain', label: 'fountain-drops', seconds: 40, mix: 1, group: 'bed-drops', silentBed: true },
  { name: 'pigeon', seconds: 4, mix: 1, group: 'event' },
  { name: 'cart-wheels', seconds: 9, mix: 1, group: 'event' },
  { name: 'copper-tink', seconds: 4, mix: 1, group: 'event' },
  { name: 'cat-mew', seconds: 2, mix: 0.8, group: 'event' },
  { name: 'select-1', seconds: 4, mix: 0.9, group: 'reply' },
  { name: 'select-2', seconds: 4, mix: 0.9, group: 'reply' },
  { name: 'select-3', seconds: 4, mix: 0.9, group: 'reply' },
  { name: 'select-4', seconds: 4, mix: 0.9, group: 'reply' },
  { name: 'select-5', seconds: 4, mix: 0.9, group: 'reply' },
  { name: 'select-6', seconds: 4, mix: 0.9, group: 'reply' },
  { name: 'chime-attention', seconds: 3, mix: 0.9, group: 'attention' },
  { name: 'bird-call', seconds: 3, mix: 0.8, group: 'leftover', opts: { kind: 'swallow' } },
  { name: 'ship-hum', seconds: 20, mix: 0.7, group: 'leftover-loop' },
  { name: 'work-hammer', seconds: 20, mix: 0.9, group: 'work-loop' },
]

/** Seeded PRNG so a render is repeatable. Math.random is swapped only while a render runs. */
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function withSeed(seed, fn) {
  const real = Math.random
  Math.random = mulberry32(seed)
  try {
    return fn()
  } finally {
    Math.random = real
  }
}

/** A voice is rendered with its own update loop, the way the mixer drives it each frame. */
async function render(name, seconds, opts = {}, silentBed = false) {
  const def = SOUNDS[name]
  const ctx = new OfflineAudioContext(1, Math.ceil(seconds * SR), SR)
  // silentBed swaps the noise for zeros, so only the events inside a bed (the drops) are measured.
  const noise = silentBed
    ? { white: ctx.createBuffer(1, SR, SR), pink: ctx.createBuffer(1, SR, SR), brown: ctx.createBuffer(1, SR, SR) }
    : withSeed(7, () => createNoiseBuffers(ctx))
  const voice = withSeed(hash(name), () => def.synth(ctx, ctx.destination, opts, noise))
  if (voice.update) {
    for (let t = 0; t < seconds; t += FRAME) {
      withSeed(hash(name) + Math.floor(t * 100), () => voice.update(FRAME, t))
    }
  }
  const buffer = await ctx.startRendering()
  return buffer.getChannelData(0)
}

function hash(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/** Clicks: sample-to-sample jumps that stand well clear of the local level, merged within 2 ms. */
function clicks(x) {
  const n = x.length
  const d = new Float32Array(n)
  for (let i = 1; i < n; i++) d[i] = x[i] - x[i - 1]
  const sq = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) sq[i + 1] = sq[i] + d[i] * d[i]
  const W = 256
  let count = 0
  let last = -1e9
  let maxJump = 0
  for (let i = 1; i < n; i++) {
    const a = Math.abs(d[i])
    if (a > maxJump) maxJump = a
    if (a < 0.02) continue
    const lo = Math.max(0, i - W), hi = Math.min(n, i + W)
    const rms = Math.sqrt((sq[hi] - sq[lo]) / (hi - lo))
    if (a > 6 * rms && i - last > 96) {
      count++
      last = i
    }
  }
  return { count, maxJump }
}

/** Onsets: 10 ms frames whose level jumps well above the previous few frames. Counts bloops, taps, starts. */
function onsets(x) {
  const F = Math.floor(SR * 0.01)
  const levels = []
  for (let i = 0; i + F <= x.length; i += F) {
    let s = 0
    for (let j = i; j < i + F; j++) s += x[j] * x[j]
    levels.push(Math.sqrt(s / F))
  }
  let count = 0
  for (let i = 4; i < levels.length; i++) {
    const prev = (levels[i - 1] + levels[i - 2] + levels[i - 3] + levels[i - 4]) / 4 + 1e-5
    if (levels[i] > 1.6 * prev && levels[i] > 0.003) count++
  }
  return count
}

function stats(x, seconds, group) {
  const n = x.length
  let peak = 0, sum = 0, sq = 0, clip = 0
  for (let i = 0; i < n; i++) {
    const v = x[i]
    const a = Math.abs(v)
    if (a > peak) peak = a
    if (a >= 0.99) clip++
    sum += v
    sq += v * v
  }
  const headN = Math.floor(SR * 0.01)
  let head = 0
  for (let i = 0; i < headN; i++) head = Math.max(head, Math.abs(x[i]))
  const tailN = Math.floor(SR * 0.02)
  let tail = 0
  for (let i = n - tailN; i < n; i++) tail = Math.max(tail, Math.abs(x[i]))
  const c = clicks(x)
  const db = (v) => (v > 0 ? +(20 * Math.log10(v)).toFixed(1) : -120)
  return {
    peakDb: db(peak),
    rmsDb: db(Math.sqrt(sq / n)),
    dc: +(sum / n).toFixed(5),
    startAbs: +head.toFixed(4),
    endAbs: group === 'bed' ? null : +tail.toFixed(4),
    clicks: c.count,
    maxJump: +c.maxJump.toFixed(3),
    clipped: clip,
    onsetsPerSec: +(onsets(x) / seconds).toFixed(2),
  }
}

/** Seam of the shared noise loops: the wrap sample against the local level, same test as clicks. */
function noiseSeams() {
  const ctx = new OfflineAudioContext(1, SR, SR)
  const bufs = withSeed(7, () => createNoiseBuffers(ctx))
  const out = {}
  for (const k of Object.keys(bufs)) {
    const x = bufs[k].getChannelData(0)
    const L = x.length
    const jump = Math.abs(x[0] - x[L - 1])
    let typical = 0
    for (let i = 1; i < 4800; i++) typical += Math.abs(x[i] - x[i - 1])
    typical /= 4799
    out[k] = { seamJump: +jump.toFixed(4), typicalStep: +typical.toFixed(4), seamRatio: +(jump / (typical + 1e-9)).toFixed(2) }
  }
  return out
}

export async function runAudioCheck() {
  const report = { sampleRate: SR, sounds: {}, noiseSeams: noiseSeams(), registryErrors: [] }
  for (const p of PLAN) {
    if (!SOUNDS[p.name]) {
      report.registryErrors.push(p.name)
      continue
    }
    const x = await render(p.name, p.seconds, p.opts, p.silentBed)
    const key = p.label || p.name
    report.sounds[key] = { group: p.group, kind: SOUNDS[p.name].kind, ...stats(x, p.seconds, p.group) }
  }
  return report
}

window.runAudioCheck = runAudioCheck

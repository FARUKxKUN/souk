/**
 * The souk's sounds: a crowd in the distance, a courtyard fountain, the birds and cats and carts
 * of a medina, copperwork far off, and plucked oud-like notes for the artisans' replies.
 *
 * Same contract as `synth.js`: every recipe is `(ctx, dest, opts, noise) → Voice`, built from
 * Web Audio nodes alone, and every level change goes through a ramp or `setTargetAtTime`.
 * Nothing here is a call to prayer or any religious audio; the only voices are wordless ones.
 */

import { Voice, burst, osc, filter, gain, envelope, chirp, looped, rand } from './synth.js'

// ---------------------------------------------------------------------------------------------
// Beds

/**
 * A market at a distance: three bands of pink noise, each a bandpass whose centre wanders
 * slowly within the speech region (roughly 300 to 1500 Hz). Everything above 2 kHz is cut so
 * the bed never gets the bright hiss that tires the ear over hours. The wandering is on
 * time constants of a second or more, so it reads as a crowd breathing, not as syllables.
 */
class CrowdVoice extends Voice {
  constructor(ctx, dest, noise, o) {
    super(ctx, dest)
    this.base = o.base
    this.acc = 0
    const tone = this.node(filter(ctx, 'lowpass', 2000, 0.5))
    tone.connect(this.out)
    this.bands = o.bands.map(([lo, hi, q, level]) => {
      const bp = this.node(filter(ctx, 'bandpass', (lo + hi) / 2, q))
      const g = this.node(gain(ctx, level, tone))
      bp.connect(g)
      this.source(looped(ctx, noise.pink, bp))
      return { bp, g, lo, hi, level }
    })
    this.out.gain.value = o.base
  }

  update(dt, now) {
    this.acc += dt
    if (this.acc < 0.5) return
    this.acc = 0
    for (const b of this.bands) {
      b.bp.frequency.setTargetAtTime(rand(b.lo, b.hi), now, 1.2)
      b.g.gain.setTargetAtTime(b.level * rand(0.35, 1), now, 1.5)
    }
  }
}

/**
 * A courtyard fountain: soft broadband water through a wide bandpass that barely moves, with
 * a small bubbling drop now and then. The drops are short upward-gliding sines, quiet enough
 * that they read as water, not as a bell tapping.
 */
class FountainVoice extends Voice {
  constructor(ctx, dest, noise, o) {
    super(ctx, dest)
    this.base = o.base
    this.drop = rand(0.1, 0.6)
    this.acc = 0
    const f = this.node(filter(ctx, 'bandpass', 1800, 0.4))
    f.connect(this.out)
    this.source(looped(ctx, noise.white, f))
    this.out.gain.value = o.base
  }

  update(dt, now) {
    this.drop -= dt
    if (this.drop <= 0) {
      this.drop = rand(0.12, 0.9)
      const f0 = rand(520, 820)
      chirp(this.ctx, this.out, now, { f0, f1: f0 * rand(1.8, 2.6), dur: 0.07, gain: this.base * 0.35, attack: 0.002, decay: 0.05 })
    }
    this.acc += dt
    if (this.acc < 0.6) return
    this.acc = 0
    this.out.gain.setTargetAtTime(this.base * rand(0.8, 1), now, 1)
  }
}

// ---------------------------------------------------------------------------------------------
// Scored one-shots: a Voice whose whole sound is scheduled up front by `score(voice, now, noise)`,
// which returns the time the sound ends. Every node it makes goes through `voice.node`, so the
// engine's dispose reaches them when the sound is over.

class ScoreVoice extends Voice {
  constructor(ctx, dest, noise, score) {
    super(ctx, dest)
    this.until = score(this, ctx.currentTime, noise) + 0.05
  }
}

/** A pigeon: a flutter of wings, then two soft coos with a little throat vibrato. */
function pigeon(v, now, noise) {
  const ctx = v.ctx
  const wings = v.node(filter(ctx, 'bandpass', 1900, 2))
  wings.connect(v.out)
  for (let i = 0; i < 6; i++) {
    const t = now + i * 0.025 + rand(0, 0.006)
    const g = v.node(gain(ctx, 0, wings))
    burst(ctx, noise.white, g, t, 0.03)
    envelope(g.gain, t, 0.1, 0.002, 0.02)
  }
  chirp(ctx, v.out, now + 0.12, { f0: 430, fMid: 390, f1: 320, dur: 0.5, gain: 0.2, attack: 0.09, decay: 0.2, modF: 7, modD: 14 })
  chirp(ctx, v.out, now + 0.85, { f0: 370, f1: 250, dur: 0.6, gain: 0.18, attack: 0.1, decay: 0.25, modF: 6, modD: 12 })
  return now + 1.6
}

/** A cat's mew: one short, soft rise and fall through a vowel-ish bandpass. */
function catMew(v, now) {
  const formant = v.node(filter(v.ctx, 'bandpass', 1100, 1.4))
  formant.connect(v.out)
  chirp(v.ctx, formant, now, { f0: 640, fMid: 880, f1: 470, dur: 0.32, gain: 0.16, attack: 0.05, decay: 0.12, modF: 9, modD: 25 })
  return now + 0.55
}

/**
 * A wooden cart passing on cobbles, far off: a low rumble that swells and recedes, pitched
 * down as it goes, over a ticking clatter of about nine rattles a second that follows the same
 * swell. The clatter is the wheels on stone; the rumble is the body of the cart.
 */
function cartWheels(v, now, noise) {
  const ctx = v.ctx
  const D = rand(5, 6.5)
  const rumble = v.node(filter(ctx, 'lowpass', 380, 0.7))
  const rumbleGain = v.node(gain(ctx, 0, v.out))
  rumble.connect(rumbleGain)
  burst(ctx, noise.brown, rumble, now, D + 0.5)
  rumble.frequency.setValueAtTime(260, now)
  rumble.frequency.linearRampToValueAtTime(480, now + D * 0.5)
  rumble.frequency.linearRampToValueAtTime(260, now + D)
  rumbleGain.gain.setValueAtTime(0, now)
  rumbleGain.gain.linearRampToValueAtTime(0.3, now + D * 0.5)
  rumbleGain.gain.linearRampToValueAtTime(0, now + D)

  const stones = v.node(filter(ctx, 'bandpass', 1300, 2.5))
  stones.connect(v.out)
  let t = now + rand(0.2, 0.4)
  while (t < now + D) {
    const swell = Math.pow(Math.sin((Math.PI * (t - now)) / D), 1.5)
    const g = v.node(gain(ctx, 0, stones))
    burst(ctx, noise.white, g, t, 0.025)
    envelope(g.gain, t, 0.22 * swell * rand(0.6, 1), 0.002, 0.02)
    t += rand(0.085, 0.13)
  }
  return now + D + 0.3
}

/** Partials of a small struck copper bowl: the inharmonic ratios are what make it metal. */
const TINK = [
  [1, 1, 0.9],
  [2.76, 0.22, 0.35],
  [5.4, 0.08, 0.18],
]

/** Light copperwork, far off: one or two tinks, low-passed so they sit at a distance. */
function copperTink(v, now) {
  const ctx = v.ctx
  const tone = v.node(filter(ctx, 'lowpass', 4200, 0.6))
  tone.connect(v.out)
  let end = now
  const strike = (t) => {
    const f = rand(2100, 2900)
    for (const [ratio, amp, decay] of TINK) {
      const g = v.node(gain(ctx, 0, tone))
      const o = v.source(osc(ctx, 'sine', f * ratio, g, t))
      const e = envelope(g.gain, t, 0.3 * amp, 0.001, decay)
      o.stop(e + 0.05)
      end = Math.max(end, e)
    }
  }
  strike(now)
  if (Math.random() < 0.6) strike(now + rand(0.3, 0.5))
  return end
}

// ---------------------------------------------------------------------------------------------
// Oud-like plucks. Karplus-Strong in Web Audio: a short noise burst excites a loop made of a
// delay of one period and a gentle lowpass, which decays at the feedback rate. The lowpass in
// the loop is what makes the string darken as it sustains, like a plucked gut string.

/** One pluck at `t`. Returns when it is effectively silent. */
function pluck(v, t, freq, level, noise) {
  const ctx = v.ctx
  const sum = v.node(gain(ctx, 1))
  const exc = v.node(filter(ctx, 'lowpass', 2600, 0.5))
  exc.connect(sum)
  burst(ctx, noise.white, exc, t, 0.012)

  const delay = v.node(ctx.createDelay(1))
  delay.delayTime.value = 1 / freq
  const damp = v.node(filter(ctx, 'lowpass', Math.min(7000, freq * 8), 0.5))
  const feedback = v.node(gain(ctx, 0.993))
  sum.connect(delay)
  delay.connect(damp)
  damp.connect(feedback)
  feedback.connect(sum)

  const out = v.node(gain(ctx, 0, v.out))
  damp.connect(out)
  envelope(out.gain, t, level, 0.004, 1.2, 0.1)
  return t + 2.8
}

/** Hijaz on D, the scale the artisans' replies are written in. */
const D4 = 293.66, EB4 = 311.13, FS4 = 369.99, G4 = 392.0, A4 = 440.0, BB4 = 466.16, C5 = 523.25, D5 = 587.33

/** A short melodic reply: [frequency, level] per note, `spacing` seconds apart. */
function phrase(notes, spacing) {
  return (v, now, noise) => {
    let end = now
    notes.forEach(([f, level], i) => {
      end = Math.max(end, pluck(v, now + i * spacing, f, level * 0.9, noise))
    })
    return end
  }
}

// ---------------------------------------------------------------------------------------------
// The warm bell: the attention chime. Sine partials at near-harmonic ratios, the fundamental
// ringing longest, the upper partials dying first. Warm, not sharp.

const BELL = [
  [1, 1, 2.6],
  [2.0, 0.3, 1.3],
  [3.0, 0.12, 0.7],
  [4.2, 0.04, 0.35],
]

function bell(v, t, f, level) {
  let end = t
  for (const [ratio, amp, decay] of BELL) {
    const g = v.node(gain(v.ctx, 0, v.out))
    const o = v.source(osc(v.ctx, 'sine', f * ratio, g, t))
    const e = envelope(g.gain, t, level * amp, 0.006, decay)
    o.stop(e + 0.05)
    end = Math.max(end, e)
  }
  return end
}

/** Two bell strikes a fifth apart: somebody needs you, gently. */
function attentionBell(v, now) {
  bell(v, now, C5, 0.5)
  return bell(v, now + 0.24, G4 * 2, 0.45)
}

// ---------------------------------------------------------------------------------------------

export const SOUK_GENERATORS = {
  // Beds
  'souk-crowd': (ctx, d, o, n) =>
    new CrowdVoice(ctx, d, n, {
      base: 0.6,
      bands: [
        [300, 650, 0.9, 1],
        [600, 1000, 0.9, 0.8],
        [950, 1500, 1, 0.45],
      ],
    }),
  'fountain': (ctx, d, o, n) => new FountainVoice(ctx, d, n, { base: 0.2 }),

  // Events
  'pigeon': (ctx, d, o, n) => new ScoreVoice(ctx, d, n, pigeon),
  'cat-mew': (ctx, d, o, n) => new ScoreVoice(ctx, d, n, catMew),
  'cart-wheels': (ctx, d, o, n) => new ScoreVoice(ctx, d, n, cartWheels),
  'copper-tink': (ctx, d, o, n) => new ScoreVoice(ctx, d, n, copperTink),

  // The artisans' replies, re-voiced as oud-like plucks (names unchanged).
  'select-1': (ctx, d, o, n) => new ScoreVoice(ctx, d, n, phrase([[D4, 0.5], [A4, 0.4]], 0.22)),
  'select-2': (ctx, d, o, n) => new ScoreVoice(ctx, d, n, phrase([[FS4, 0.45], [G4, 0.45], [A4, 0.5]], 0.2)),
  'select-3': (ctx, d, o, n) => new ScoreVoice(ctx, d, n, phrase([[A4, 0.45], [BB4, 0.4], [D5, 0.5]], 0.2)),
  'select-4': (ctx, d, o, n) => new ScoreVoice(ctx, d, n, phrase([[D4, 0.4], [EB4, 0.4], [FS4, 0.45], [G4, 0.5]], 0.2)),
  'select-5': (ctx, d, o, n) => new ScoreVoice(ctx, d, n, phrase([[G4, 0.45], [A4, 0.45], [G4, 0.5]], 0.26)),
  'select-6': (ctx, d, o, n) => new ScoreVoice(ctx, d, n, phrase([[D5, 0.45], [C5, 0.4], [A4, 0.5]], 0.24)),

  'chime-attention': (ctx, d, o, n) => new ScoreVoice(ctx, d, n, attentionBell),
}

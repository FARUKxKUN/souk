/**
 * The souk's sounds: a crowd in the distance, a courtyard fountain, the birds and cats and carts
 * of a medina, copperwork far off, and plucked oud-like notes for the artisans' replies.
 *
 * Same contract as `synth.js`: every recipe is `(ctx, dest, opts, noise) → Voice`, built from
 * Web Audio nodes alone, and every level change goes through a ramp or `setTargetAtTime`.
 * Nothing here is a call to prayer or any religious audio; the only voices are wordless ones.
 *
 * Two rules from the audio check (tools/audio-check.js): every transient starts and ends at
 * zero over 6 ms or more, and nothing sits in a feedback loop with a biquad (that diverges).
 */

import { Voice, burst, osc, filter, gain, envelope, chirp, looped, rand } from './synth.js'

/** The fountain's drops: how often, and how they sound. Exported so the tests can hold them. */
export const FOUNTAIN_DROP = Object.freeze({ min: 4, max: 11, f0: [420, 620], glide: [1.4, 1.8], gain: 0.12 })

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
 * A courtyard fountain: a steady, soft wash of pink noise through a wide, warm band, with a
 * small bubbling drop every few seconds. Before, the drops came twice a second and popped
 * like a clock; now they are rare, quiet, and rounded at the start.
 */
class FountainVoice extends Voice {
  constructor(ctx, dest, noise, o) {
    super(ctx, dest)
    this.base = o.base
    this.drop = rand(FOUNTAIN_DROP.min, FOUNTAIN_DROP.max)
    this.acc = 0
    const f = this.node(filter(ctx, 'bandpass', 1100, 0.45))
    f.connect(this.out)
    this.source(looped(ctx, noise.pink, f))
    this.out.gain.value = o.base
  }

  update(dt, now) {
    this.drop -= dt
    if (this.drop <= 0) {
      this.drop = rand(FOUNTAIN_DROP.min, FOUNTAIN_DROP.max)
      const f0 = rand(FOUNTAIN_DROP.f0[0], FOUNTAIN_DROP.f0[1])
      chirp(this.ctx, this.out, now, {
        f0,
        f1: f0 * rand(FOUNTAIN_DROP.glide[0], FOUNTAIN_DROP.glide[1]),
        dur: 0.09,
        gain: this.base * FOUNTAIN_DROP.gain,
        attack: 0.015,
        decay: 0.08,
      })
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

/** A pigeon: a soft flutter of wings, then two coos with a little throat vibrato. */
function pigeon(v, now, noise) {
  const ctx = v.ctx
  const wings = v.node(filter(ctx, 'bandpass', 1900, 1.2))
  wings.connect(v.out)
  for (let i = 0; i < 6; i++) {
    const t = now + i * 0.03 + rand(0, 0.006)
    const g = v.node(gain(ctx, 0, wings))
    burst(ctx, noise.white, g, t, 0.04)
    envelope(g.gain, t, 0.05, 0.008, 0.025)
  }
  chirp(ctx, v.out, now + 0.14, { f0: 430, fMid: 390, f1: 320, dur: 0.5, gain: 0.12, attack: 0.09, decay: 0.2, modF: 7, modD: 14 })
  chirp(ctx, v.out, now + 0.9, { f0: 370, f1: 250, dur: 0.6, gain: 0.11, attack: 0.1, decay: 0.25, modF: 6, modD: 12 })
  return now + 1.6
}

/** A cat's mew: one short, soft rise and fall through a vowel-ish bandpass. */
function catMew(v, now) {
  const formant = v.node(filter(v.ctx, 'bandpass', 1100, 1.4))
  formant.connect(v.out)
  chirp(v.ctx, formant, now, { f0: 640, fMid: 880, f1: 470, dur: 0.32, gain: 0.14, attack: 0.05, decay: 0.12, modF: 9, modD: 25 })
  return now + 0.55
}

/**
 * A wooden cart passing on cobbles, far off: a low rumble that swells and recedes, pitched
 * down as it goes, over a soft clatter of about seven rattles a second that follows the same
 * swell. Each rattle now rises over 6 ms, so the clatter reads as stone, not as clicks.
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
  rumbleGain.gain.linearRampToValueAtTime(0.22, now + 0.4)
  rumbleGain.gain.linearRampToValueAtTime(0.22, now + D * 0.5)
  rumbleGain.gain.linearRampToValueAtTime(0, now + D)

  const stones = v.node(filter(ctx, 'bandpass', 1100, 1.6))
  stones.connect(v.out)
  let t = now + rand(0.3, 0.5)
  while (t < now + D) {
    const swell = Math.pow(Math.sin((Math.PI * (t - now)) / D), 1.5)
    const g = v.node(gain(ctx, 0, stones))
    burst(ctx, noise.white, g, t, 0.04)
    envelope(g.gain, t, 0.07 * swell * rand(0.6, 1), 0.006, 0.03)
    t += rand(0.13, 0.2)
  }
  return now + D + 0.3
}

/** Partials of a small struck copper bowl: the inharmonic ratios are what make it metal. */
const TINK = [
  [1, 1, 0.9],
  [2.76, 0.22, 0.35],
  [5.4, 0.08, 0.18],
]

/**
 * Light copperwork, far off: one or two soft tinks. The strike is 12 ms rather than 1 ms and
 * the tone is low-passed well under the old 4.2 kHz, so it sits at a distance and does not
 * jump out of a quiet moment.
 */
function copperTink(v, now) {
  const ctx = v.ctx
  const tone = v.node(filter(ctx, 'lowpass', 2400, 0.6))
  tone.connect(v.out)
  let end = now
  const strike = (t) => {
    const f = rand(1300, 1700)
    for (const [ratio, amp, decay] of TINK) {
      const g = v.node(gain(ctx, 0, tone))
      const o = v.source(osc(ctx, 'sine', f * ratio, g, t))
      const e = envelope(g.gain, t, 0.11 * amp, 0.012, decay)
      o.stop(e + 0.05)
      end = Math.max(end, e)
    }
  }
  strike(now)
  if (Math.random() < 0.3) strike(now + rand(0.35, 0.6))
  return end
}

// ---------------------------------------------------------------------------------------------
// Oud-like plucks. Karplus-Strong in Web Audio: a short noise excitation feeds a loop made of
// a delay of one period and a feedback gain, and the loop's output is low-passed as it falls.
//
// Two constraints from the audio check, both fixed here:
//  - A biquad inside a feedback loop diverged to 1e22 in Chromium (the plucks were NaN). The
//    loop is now gain-only; the darkening happens on the output, outside the loop.
//  - A feedback delay cannot be shorter than one render quantum (128 samples), so a note above
//    about 350 Hz was played flat, all collapsed to the same pitch. The phrases now sit an
//    octave lower, where every period is at least 163 samples at 48 kHz (and 150 at 44.1 kHz).

/** The loop's feedback. Just under 1, so the string rings and dies away on its own. */
const STRING_FEEDBACK = 0.992

/** One pluck at `t`. Returns when it is effectively silent. */
function pluck(v, t, freq, level, noise) {
  const ctx = v.ctx
  const sum = v.node(gain(ctx, 1))
  const exc = v.node(filter(ctx, 'lowpass', 2000, 0.5))
  // Excitation: a 12 ms slice of noise shaped to start and end at zero. A bare slice clicks.
  const excGain = v.node(gain(ctx, 0, sum))
  exc.connect(excGain)
  burst(ctx, noise.white, exc, t, 0.012)
  excGain.gain.setValueAtTime(0, t)
  excGain.gain.linearRampToValueAtTime(0.6, t + 0.003)
  excGain.gain.linearRampToValueAtTime(0, t + 0.012)

  const delay = v.node(ctx.createDelay(1))
  delay.delayTime.value = 1 / freq
  const feedback = v.node(gain(ctx, STRING_FEEDBACK))
  sum.connect(delay)
  delay.connect(feedback)
  feedback.connect(sum)

  // Output: darkens from about 3 kHz to 1.1 kHz as the note falls, like a gut string.
  const tone = v.node(filter(ctx, 'lowpass', 3200, 0.7))
  tone.frequency.setValueAtTime(3200, t)
  tone.frequency.exponentialRampToValueAtTime(1100, t + 1.6)
  const out = v.node(gain(ctx, 0, tone))
  delay.connect(out)
  tone.connect(v.out)
  envelope(out.gain, t, level, 0.012, 1.1, 0.08)
  return t + 2.8
}

/** Hijaz on D, the scale the artisans' replies are written in, an octave below the old pitches. */
const D3 = 146.83, EB3 = 155.56, FS3 = 185.0, G3 = 196.0, A3 = 220.0, BB3 = 233.08, C4 = 261.63, D4 = 293.66

/** The six replies. Frequencies are exported so the tests can check the loop length of each. */
export const PHRASE_FREQS = Object.freeze([D3, EB3, FS3, G3, A3, BB3, C4, D4])

/**
 * A short melodic reply: [frequency, level] per note, `spacing` seconds apart. Each call is
 * detuned by a fraction of a percent, so six replies repeated over a session do not sound
 * identical.
 */
function phrase(notes, spacing) {
  return (v, now, noise) => {
    const detune = rand(0.996, 1.004)
    let end = now
    notes.forEach(([f, level], i) => {
      end = Math.max(end, pluck(v, now + i * spacing, f * detune, level * 0.9, noise))
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
    const e = envelope(g.gain, t, level * amp, 0.02, decay)
    o.stop(e + 0.05)
    end = Math.max(end, e)
  }
  return end
}

/**
 * Two bell strikes a fifth apart: somebody needs you, gently. Level was 0.5 (about -1 dBFS
 * peak, the loudest thing in the souk) with a 6 ms strike; it is now a quarter of that with
 * a 20 ms attack.
 */
function attentionBell(v, now) {
  bell(v, now, C4 * 2, 0.16)
  return bell(v, now + 0.26, G3 * 4, 0.14)
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
  'select-1': (ctx, d, o, n) => new ScoreVoice(ctx, d, n, phrase([[D3, 0.5], [A3, 0.4]], 0.22)),
  'select-2': (ctx, d, o, n) => new ScoreVoice(ctx, d, n, phrase([[FS3, 0.45], [G3, 0.45], [A3, 0.5]], 0.2)),
  'select-3': (ctx, d, o, n) => new ScoreVoice(ctx, d, n, phrase([[A3, 0.45], [BB3, 0.4], [D4, 0.5]], 0.2)),
  'select-4': (ctx, d, o, n) => new ScoreVoice(ctx, d, n, phrase([[D3, 0.4], [EB3, 0.4], [FS3, 0.45], [G3, 0.5]], 0.2)),
  'select-5': (ctx, d, o, n) => new ScoreVoice(ctx, d, n, phrase([[G3, 0.45], [A3, 0.45], [G3, 0.5]], 0.26)),
  'select-6': (ctx, d, o, n) => new ScoreVoice(ctx, d, n, phrase([[D4, 0.45], [C4, 0.4], [A3, 0.5]], 0.24)),

  'chime-attention': (ctx, d, o, n) => new ScoreVoice(ctx, d, n, attentionBell),
}

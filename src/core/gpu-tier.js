/**
 * Which quality preset a machine starts on, decided from the GPU the browser actually renders on.
 *
 * A discrete card (NVIDIA GeForce / RTX / GTX, Radeon RX or Pro) has the fill rate and memory for
 * the High preset at full scale. Integrated graphics (Intel, Radeon Graphics on an APU, Apple's
 * unified GPUs and phone GPUs) and anything unrecognised start on Balanced, which is tuned for
 * them. This only ever picks a *starting* preset; a preset the person chose stays chosen.
 */

export const GPU_TIERS = /** @type {const} */ (['discrete', 'integrated', 'unknown'])

/** The preset each tier starts on. */
export const TIER_PRESET = { discrete: 'high', integrated: 'balanced', unknown: 'balanced' }

const DISCRETE = /nvidia|geforce|\brtx\b|\bgtx\b|quadro|radeon (rx|pro)\b|\brx \d{3,4}/i
const INTEGRATED = /intel|apple|radeon graphics|radeon\(tm\) graphics|adreno|mali|powervr|vega \d+ graphics/i

/** Classify a WebGL renderer string such as "ANGLE (NVIDIA, NVIDIA GeForce RTX 2050 ...)". */
export function gpuTierFor(rendererName) {
  const name = String(rendererName || '')
  if (!name) return 'unknown'
  if (DISCRETE.test(name)) return 'discrete'
  if (INTEGRATED.test(name)) return 'integrated'
  return 'unknown'
}

/**
 * Read the renderer name from a throwaway WebGL context, then release it. Returns '' when WebGL
 * is unavailable. `makeCanvas` is injectable so the probe can run without a DOM.
 */
export function readGpuRenderer(makeCanvas = () => document.createElement('canvas')) {
  try {
    const canvas = makeCanvas()
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
    if (!gl) return ''
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) || '')
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return name
  } catch {
    return ''
  }
}

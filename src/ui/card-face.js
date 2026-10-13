import { FACE, FRAME_COLS, FRAME_ROWS, buildFaceAtlas } from '../agents/faces.js'

/**
 * The little face on the thread card, drawn from the same mask atlas the world's visors
 * used to show. It is the card's own: the world has no atlas any more (its visor is real
 * geometry), so reaching into the astronaut module for one crashed the render loop on every
 * frame a card was open.
 */

export const CARD_FACE_SIZE = 108
/** Resolution of the card's atlas; each cell is drawn down to 108px anyway. */
const ATLAS_SIZE = 512

/** Wrap a card canvas. `makeCanvas` is injectable so the painter runs without a DOM. */
export function createCardFace(canvas, makeCanvas = () => document.createElement('canvas')) {
  canvas.width = CARD_FACE_SIZE
  canvas.height = CARD_FACE_SIZE
  const tmp = makeCanvas()
  tmp.width = CARD_FACE_SIZE
  tmp.height = CARD_FACE_SIZE
  return {
    ctx: canvas.getContext('2d'),
    tmp,
    tmpCtx: tmp.getContext('2d'),
    atlas: null,
    key: { frame: -1, color: '' },
  }
}

/**
 * Eye colours are authored above 1.0 so the bloom pass catches them in the scene. For the
 * card they are normalised by the brightest channel, which keeps the astronaut's own hue
 * rather than clipping a 3.0-red down to the same white as a 3.0-blue.
 */
export function cssFromGlow(color) {
  const peak = Math.max(color.r, color.g, color.b, 1)
  const enc = (v) => Math.round(Math.pow(Math.min(1, v / peak), 1 / 2.2) * 255)
  return `rgb(${enc(color.r)},${enc(color.g)},${enc(color.b)})`
}

/**
 * Paint the agent's current expression onto the card. Skips the redraw when the frame and
 * colour are unchanged. Returns true when pixels were written.
 */
export function paintCardFace(face, agent, makeAtlas = buildFaceAtlas) {
  const frame = agent.faceFrame ?? FACE.idle
  if (!agent.eye) return false
  const css = cssFromGlow(agent.eye)
  if (face.key.frame === frame && face.key.color === css) return false
  face.key = { frame, color: css }

  // buildFaceAtlas returns the CanvasTexture the world uses; the 2D canvas is its image.
  face.atlas ??= makeAtlas(ATLAS_SIZE).image
  const atlas = face.atlas
  const size = CARD_FACE_SIZE
  const cell = atlas.width / FRAME_COLS
  const sx = (frame % FRAME_COLS) * cell
  const sy = Math.floor(frame / FRAME_COLS) * (atlas.height / FRAME_ROWS)

  // The atlas is an opaque white-on-black mask, so the tint is a `multiply`, not a
  // `source-in`: black stays black and the white features take the eye colour. Keying on
  // alpha instead would flood the whole cell, because every pixel in it is opaque.
  const t = face.tmpCtx
  t.globalCompositeOperation = 'source-over'
  t.clearRect(0, 0, size, size)
  t.drawImage(atlas, sx, sy, cell, cell, 0, 0, size, size)
  t.globalCompositeOperation = 'multiply'
  t.fillStyle = css
  t.fillRect(0, 0, size, size)
  t.globalCompositeOperation = 'source-over'

  const c = face.ctx
  c.fillStyle = '#06070c'
  c.fillRect(0, 0, size, size)
  c.drawImage(face.tmp, 0, 0)
  // Scanlines, so the card's face reads as the same little screen as the one in the world.
  c.globalAlpha = 0.2
  c.fillStyle = '#000'
  for (let y = 0; y < size; y += 3) c.fillRect(0, y, size, 1)
  c.globalAlpha = 1
  return true
}

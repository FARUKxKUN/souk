import { Vector2 } from 'three'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'

/**
 * Three's Unreal-style bloom, one size down.
 *
 * Stock, the chain starts at half the frame and halves from there, and the first two mips are
 * the expensive ones: a 6 and a 10 tap kernel, twice each, over a quarter and a sixteenth of the
 * frame. Starting at a *quarter* of the frame makes every mip a quarter of what it was, which is
 * roughly a third of the pass's time on an integrated GPU. The glow it makes is wide and soft
 * and sits under a threshold that only lamps, eyes and sparks clear - nothing in it needs the
 * resolution - so the saving costs nothing anybody can point at.
 *
 * The one thing that does need care is the first step. A single bilinear tap at a quarter of the
 * resolution skips three pixels in four, so a lamp three pixels wide would flicker in and out as
 * the camera moved. The high-pass therefore takes four taps (which, being bilinear and landing on
 * pixel corners, together cover the whole 4x4 block it stands for), thresholds each, and averages.
 */
const HIGH_PASS_TAPS = /* glsl */ `
  uniform vec2 uTexel;
  vec4 brightTap( vec2 uv ) {
    vec4 t = texture2D( tDiffuse, uv );
    return mix( vec4( defaultColor.rgb, defaultOpacity ), t, smoothstep( luminosityThreshold, luminosityThreshold + smoothWidth, luminance( t.xyz ) ) );
  }
`

export class LiteBloomPass extends UnrealBloomPass {
  constructor(resolution, strength, radius, threshold) {
    // The parent sizes its chain at half of what it is told, so telling it half gives a quarter.
    super(new Vector2(resolution.x / 2, resolution.y / 2), strength, radius, threshold)
    const material = this.materialHighPassFilter
    material.uniforms.uTexel = this.highPassUniforms.uTexel = { value: new Vector2(1 / resolution.x, 1 / resolution.y) }
    material.fragmentShader = material.fragmentShader
      .replace('varying vec2 vUv;', `varying vec2 vUv;\n${HIGH_PASS_TAPS}`)
      .replace(
        /vec4 texel = texture2D\( tDiffuse, vUv \);[\s\S]*gl_FragColor = mix\( outputColor, texel, alpha \);/,
        `gl_FragColor = 0.25 * (
          brightTap( vUv + uTexel * vec2( -1.0, -1.0 ) ) + brightTap( vUv + uTexel * vec2( 1.0, -1.0 ) ) +
          brightTap( vUv + uTexel * vec2( -1.0, 1.0 ) ) + brightTap( vUv + uTexel * vec2( 1.0, 1.0 ) ) );`
      )
    material.needsUpdate = true
  }

  setSize(width, height) {
    super.setSize(width / 2, height / 2)
    this.highPassUniforms.uTexel.value.set(1 / Math.max(1, width), 1 / Math.max(1, height))
  }
}

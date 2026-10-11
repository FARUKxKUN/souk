import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'

/**
 * Tone mapping, the sRGB transfer and the colour grade, in one full-screen pass.
 *
 * They used to be two: three's `OutputPass`, then a grade pass reading what it wrote. The grade
 * only ever works on the finished, display-referred picture, so it can run on the same pixel in
 * the same shader straight after the transfer - and a full-frame pass is the unit of cost on a
 * small GPU, so one fewer is worth having. Switching the grade off is a uniform, not a pass, so
 * tone mapping itself can never be turned off by accident.
 *
 * The grade is a lifted, tinted black, a saturation pull around luminance, a warm cast, a gentle
 * S-curve for the mids and a wide soft vignette. Lifting the shadows is what makes shade read
 * as shade rather than as a hole.
 */
const GRADE_PARS = /* glsl */ `
  uniform float uGrade;
  uniform float uSaturation;
  uniform float uWarmth;
  uniform float uVignette;
`

const GRADE_BODY = /* glsl */ `
  if ( uGrade > 0.5 ) {
    vec3 col = gl_FragColor.rgb;
    col += ( 1.0 - col ) * vec3( 0.035, 0.045, 0.075 ) * ( 1.0 - smoothstep( 0.0, 0.5, dot( col, vec3( 0.333 ) ) ) );
    float l = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
    col = mix( vec3( l ), col, uSaturation );
    col *= vec3( 1.0 + uWarmth * 0.9, 1.0 + uWarmth * 0.25, 1.0 - uWarmth * 0.9 );
    col = mix( col, col * col * ( 3.0 - 2.0 * col ), 0.16 );
    vec2 d = vUv - 0.5;
    col *= 1.0 - dot( d, d ) * uVignette * 1.15;
    gl_FragColor = vec4( clamp( col, 0.0, 1.0 ), gl_FragColor.a );
  }
`

export class GradedOutputPass extends OutputPass {
  constructor() {
    super()
    Object.assign(this.uniforms, {
      uGrade: { value: 1 },
      uSaturation: { value: 1 },
      uWarmth: { value: 0 },
      uVignette: { value: 0.3 },
    })
    const source = this.material.fragmentShader
    const end = source.lastIndexOf('}')
    this.material.fragmentShader = `${source.slice(0, end)}${GRADE_BODY}}`.replace('varying vec2 vUv;', `varying vec2 vUv;\n${GRADE_PARS}`)
    this.material.needsUpdate = true
  }

  /** Whether the grade is applied. Tone mapping and the colour-space transfer always are. */
  setGrade(on) {
    this.uniforms.uGrade.value = on ? 1 : 0
  }
}

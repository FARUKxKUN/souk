// Driver for tools/bench.html. Needs a dev server: `npx vite --port 5185 --strictPort`.
//   node tools/bench-run.mjs [--port 5185] [--preset balanced] [--dpr 1] [--size 1920x1080]
//        [--ablate] [--shots prefix]
// Runs Chromium headless on the real GPU through ANGLE/D3D11 (headless:false picks the iGPU
// on Optimus laptops, so it is deliberately not used) and prints a JSON report.
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const PW = process.env.PLAYWRIGHT_PATH || 'C:/Users/batti/.claude/skills/playwright-skill/node_modules/playwright'
const { chromium } = require(PW)

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  if (i < 0) return fallback
  const next = process.argv[i + 1]
  return next && !next.startsWith('--') ? next : true
}
const port = arg('port', '5185')
const preset = arg('preset', 'balanced')
const dpr = Number(arg('dpr', '1'))
const [w, h] = String(arg('size', '1920x1080')).split('x').map(Number)
const shots = arg('shots', '')
const ablate = arg('ablate', false)
const times = String(arg('times', '0.34')).split(',')
const quick = arg('quick', false)
const set = arg('set', '')
const views = quick ? ['default', 'wide'] : ['default', 'mid', 'wide', 'low']

const browser = await chromium.launch({
  headless: true,
  args: [...(process.env.BENCH_LOWPOWER ? ['--force_low_power_gpu'] : []), '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl-developer-extensions', '--enable-gpu-benchmarking'],
})
const ctx = await browser.newContext({ viewport: { width: Math.round(w / dpr), height: Math.round(h / dpr) }, deviceScaleFactor: dpr })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.error('pageerror', e.message))
page.on('console', (m) => { if (m.type() === 'error') console.error('console.error', m.text()) })

const report = { preset, dpr, size: [w, h] }
for (const t of times) {
  await page.goto(`http://localhost:${port}/tools/bench.html?preset=${preset}&t=${t}&set=${set}`)
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 })
  const r = {}
  report.gpu = await page.evaluate(() => window.__bench.gpu())
  report.timerQuery = await page.evaluate(() => window.__bench.hasTimer)
  for (const view of views) {
    await page.evaluate((v) => window.__bench.view(v), view)
    const entry = {}
    entry.frame = await page.evaluate(() => window.__bench.frameMs(150, 40))
    entry.info = await page.evaluate(() => window.__bench.info())
    entry.cpu = await page.evaluate(() => window.__bench.cpuMs(120))
    if (view !== 'low' && !quick) entry.passes = await page.evaluate(() => window.__bench.passMs(60))
    if (view === 'default' && t === times[0]) entry.census = await page.evaluate(() => window.__bench.census())
    if (ablate && view === 'wide' && t === times[0]) {
      entry.ablate = {}
      for (const name of await page.evaluate(() => window.__bench.names())) {
        entry.ablate[name] = (await page.evaluate((n) => window.__bench.ablate(n, 80), name)).ms
      }
    }
    r[view] = entry
  }
  if (shots) {
    for (const view of ['wide', 'default', 'low']) {
      await page.evaluate((v) => window.__bench.view(v), view)
      await page.evaluate(() => { for (let i = 0; i < 20; i++) window.__bench.step() })
      const data = await page.evaluate(() => window.__bench.shot())
      writeFileSync(`${shots}-${t === '0.34' ? 'day' : t === '0.94' ? 'night' : t}-${view}.png`, Buffer.from(data.split(',')[1], 'base64'))
    }
  }
  report[`t${t}`] = r
}
console.log(JSON.stringify(report, null, 1))
await browser.close()

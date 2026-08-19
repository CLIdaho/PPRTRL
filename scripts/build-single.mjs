// Folds the built JS and CSS into dist-single/index.html so the result is one
// portable file. Run after `vite build --config vite.config.single.ts`.
import { readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const dir = new URL('../dist-single/', import.meta.url).pathname
let html = readFileSync(join(dir, 'index.html'), 'utf8')

const assets = readdirSync(join(dir, 'assets'))
const js = assets.find((f) => f.endsWith('.js'))
const css = assets.find((f) => f.endsWith('.css'))

// The bundle embeds an HTML report template as a string, so it can legitimately
// contain `</script>`. Left as-is that would close the inline tag early and take
// the whole app down, so escape it — the sequence is equivalent inside JS.
const bundle = readFileSync(join(dir, 'assets', js), 'utf8').replaceAll('</script>', '<\\/script>')

html = html.replace(
  new RegExp(`<script type="module"[^>]*src="\\./assets/${js}"[^>]*></script>`),
  () => `<script type="module">\n${bundle}\n</script>`,
)
if (css) {
  html = html.replace(
    new RegExp(`<link rel="stylesheet"[^>]*href="\\./assets/${css}"[^>]*>`),
    () => `<style>\n${readFileSync(join(dir, 'assets', css), 'utf8')}\n</style>`,
  )
}

// The favicon is a separate request the single file should not depend on.
const favicon = readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8')
html = html.replace(
  /<link rel="icon"[^>]*>/,
  `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${Buffer.from(favicon).toString('base64')}">`,
)

writeFileSync(join(dir, 'papertrail.html'), html)
rmSync(join(dir, 'assets'), { recursive: true, force: true })
rmSync(join(dir, 'index.html'), { force: true })

const kb = (Buffer.byteLength(html) / 1024).toFixed(0)
console.log(`wrote dist-single/papertrail.html (${kb} KB, no external requests)`)

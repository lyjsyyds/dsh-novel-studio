import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const relative = (path) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  root: relative('./'),
  base: './',
  build: { outDir: 'web-dist', target: 'chrome109' },
  resolve: { alias: [
    { find: 'node:fs/promises', replacement: relative('./src/files.js') },
    { find: 'node:fs', replacement: relative('./src/files.js') },
    { find: 'node:path', replacement: 'path-browserify' },
    { find: 'node:os', replacement: relative('./src/node-compat.js') },
    { find: 'node:crypto', replacement: relative('./src/node-compat.js') },
    { find: 'node:url', replacement: relative('./src/node-compat.js') },
  ] },
  plugins: [{
    name: 'novel-studio-guaji-csp',
    transformIndexHtml(html) {
      const source = readFileSync(relative('./src/divination/vendor/view.js'), 'utf8')
        .replace(/\r\n/g, '\n').replace(/<\/script/ig, '<\\/script')
      const hash = createHash('sha256').update(source).digest('base64')
      return html.replace("script-src 'self' file:;", `script-src 'self' file: 'sha256-${hash}'; frame-src 'self' file: about:;`)
    },
  }, {
    name: 'novel-studio-shared-core',
    enforce: 'pre',
    transform(code, id) {
      if (!/[/\\]lib[/\\][\w-]+\.js$/.test(id) || id.endsWith('client.js')) return null
      // The plugin's cache-busting URLs are for DSH. Keep the same modules in
      // the standalone bundle with static import targets for the bundler.
      return code
        .replace(/import\(`(\.\/[^`]+)\?v=\$\{V\}`\)/g, "import('$1')")
        .replace(/\bprocess\./g, 'studioProcess.')
        .replace('async function importExtensions() {', 'async function importExtensions() {\n  if (studioProcess.platform === "standalone") return []\n')
        .replace(/^/, 'import { Buffer } from "buffer";\nimport { studioProcess } from "' + relative('./src/node-compat.js').replaceAll('\\', '/') + '";\n')
    },
  }],
})

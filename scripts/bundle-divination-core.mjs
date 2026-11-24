import { build } from 'esbuild'
import { cp } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const output = new URL('standalone/src/divination/compiled-engine.js', root)
await build({
  entryPoints: [fileURLToPath(new URL('standalone/.build-cache/divination-core/__target__/entry.js', root))],
  outfile: fileURLToPath(output), bundle: true, format: 'esm', target: 'es2020', minify: true, legalComments: 'inline',
  banner: { js: '/*! Generated from Guaji offline rules by scripts/import-divination-core.py. Transcrypt 3.9.5 runtime © 2014–2023 Jacques de Hooge, GEATEC engineering. Apache-2.0, see LICENSE-TRANSCRYPT.txt. */' },
})
await cp(new URL('standalone/.build-cache/divination-core/oracle.json', root),
  new URL('standalone/.build-cache/divination-oracle.json', root))

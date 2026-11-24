import { cp, mkdir, readdir, unlink } from 'node:fs/promises'

const source = new URL('../standalone/web-dist/', import.meta.url)
const target = new URL('../lib/studio/', import.meta.url)
const assets = new URL('assets/', target)
await mkdir(assets, { recursive: true })
for (const entry of await readdir(assets, { withFileTypes: true })) {
  if (entry.isFile() && /^[\w-]+\.(?:js|css|svg)$/.test(entry.name)) await unlink(new URL(entry.name, assets))
}
await cp(new URL('index.html', source), new URL('index.html', target))
await cp(new URL('assets/', source), assets, { recursive: true })

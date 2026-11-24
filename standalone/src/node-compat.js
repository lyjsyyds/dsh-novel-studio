import { sha1 } from '@noble/hashes/legacy.js'
import { Buffer } from 'buffer'

export const studioProcess = {
  env: { DSH_NOVEL_ROOT: '/library', DSH_NOVEL_CONFIG: '/settings/novel-studio.yaml' },
  platform: 'standalone',
  pid: 1,
}

export const homedir = () => '/'
export const fileURLToPath = (url) => decodeURIComponent(new URL(url).pathname)
export const pathToFileURL = (path) => new URL(path, 'file:///')

export function createHash(algorithm) {
  if (algorithm !== 'sha1') throw new Error(`Unsupported digest: ${algorithm}`)
  const hash = sha1.create()
  return {
    update(data) {
      hash.update(typeof data === 'string' ? Buffer.from(data) : data)
      return this
    },
    digest: (encoding) => Buffer.from(hash.digest()).toString(encoding),
  }
}

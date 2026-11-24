import { Buffer } from 'buffer'
import { native, platform } from './platform.js'

const request = async (op, path, options = {}) => {
  if (platform === 'dsh' && /^\/settings\/(?:appearance|recent-book)\.json$/.test(path)) {
    const key = 'dsh-novel-studio:' + path
    if (op === 'write') { localStorage.setItem(key, options.base64); return {} }
    const base64 = localStorage.getItem(key)
    if (op === 'read' && base64 !== null) return { base64 }
    throw Object.assign(new Error('文件不存在。'), { code: 'ENOENT' })
  }
  const result = await native('files', { op, path, ...options })
  if (result.code) throw Object.assign(new Error(result.message || result.code), { code: result.code })
  return result
}

function info(entry) {
  return { ...entry, isDirectory: () => entry.directory, isFile: () => !entry.directory, isSymbolicLink: () => false }
}

export async function readdir(path, options) {
  const { entries } = await request('list', path)
  return options?.withFileTypes ? entries.map(info) : entries.map((entry) => entry.name)
}

export async function readFile(path, encoding) {
  const { base64 } = await request('read', path)
  const bytes = Buffer.from(base64, 'base64')
  return encoding ? bytes.toString(encoding) : bytes
}

export const writeFile = (path, contents) => request('write', path, { base64: Buffer.from(contents).toString('base64') })
export const mkdir = (path, options) => request('mkdir', path, { recursive: Boolean(options?.recursive) })
export const rename = (path, to) => request('rename', path, { to })
export const copyFile = (path, to) => request('copy', path, { to })
export const rm = (path, options) => request('remove', path, { recursive: Boolean(options?.recursive), force: Boolean(options?.force) })
export const unlink = (path) => rm(path)
export const stat = async (path) => info(await request('stat', path))

// The standalone root is pinned. DSH's synchronous root override is unused.
export function statSync() { throw Object.assign(new Error('No synchronous filesystem'), { code: 'ENOENT' }) }
export const readFileSync = statSync

import { Buffer } from 'buffer'
import { zipSync, unzipSync } from 'fflate'
import { join } from 'path-browserify'
import { diffArrays } from 'diff'
import { readBook } from '../../lib/library.js'
import { getSchema } from '../../lib/schema.js'
import { readUnit, writeUnit } from '../../lib/records.js'
import { saveDraft } from '../../lib/chapters.js'
import { mkdir, readdir, readFile, rename, rm, writeFile } from './files.js'
import { native, platform } from './platform.js'
import { api, exclusive } from './transport.js'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const maxBytes = 64 * 1024 * 1024
const manifestName = 'novel-studio.json'
const format = 'novel-studio-library'
const prefix = 'library/'
const journal = '/transfer/pending-restore.json'

function checkEntry(name) {
  if (typeof name !== 'string' || /[\\:*?"<>|\x00-\x1f]/.test(name)
    || name.split('/').some((part) => !part || part === '.' || part === '..'
      || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new Error('书库包含无法跨平台还原的路径。')
  }
}

function verify(entries) {
  const paths = new Set()
  let total = 0
  for (const [name, content] of entries) {
    checkEntry(name)
    const folded = name.normalize('NFC').toLowerCase()
    if (paths.has(folded)) throw new Error('书库包含重名文件。')
    paths.add(folded)
    total += content.byteLength
    if (total > maxBytes || paths.size > 20000) throw new Error('书库超过 64 MB 或 20,000 个文件。')
  }
  for (const name of paths) {
    const parts = name.split('/')
    for (let i = 1; i < parts.length; i++) {
      if (paths.has(parts.slice(0, i).join('/'))) throw new Error('备份中有重名的文件和文件夹。')
    }
  }
}

function describe(entries, name, exportedAt) {
  verify(entries)
  const books = entries.filter(([key]) => /^[^./][^/]*\/book\.yaml$/u.test(key))
    .map(([key]) => key.split('/')[0])
  return { entries, name, books, exportedAt }
}

export async function legacyPreview() {
  const data = await native('legacyPick')
  if (data.canceled) return null
  if (!data.entries.length) throw new Error('没有找到 DSH 作品目录。')
  return describe(data.entries.map(([name, base64]) => [name, Buffer.from(base64, 'base64')]), data.source)
}

export function importPreview({ name, base64 }) {
  const bytes = Buffer.from(base64, 'base64')
  let total = 0
  let count = 0
  const files = unzipSync(bytes, { filter(file) {
    if (file.name.endsWith('/')) return false
    if (file.name !== manifestName && !file.name.startsWith(prefix)) throw new Error('这不是 Novel Studio 整库备份。')
    checkEntry(file.name)
    total += file.originalSize
    count++
    if (total > maxBytes || count > 20001) throw new Error('备份超过 64 MB 或 20,000 个文件。')
    return true
  } })
  const manifest = JSON.parse(decoder.decode(files[manifestName]))
  if (manifest.format !== format || manifest.version !== 1) throw new Error('此备份版本无法读取。')
  const entries = Object.entries(files).flatMap(([key, content]) => key === manifestName
    ? [] : [[key.slice(prefix.length), content]])
  if (manifest.files !== entries.length) throw new Error('备份的文件数与清单不一致。')
  return describe(entries, name, manifest.exportedAt)
}

async function collect(dir, root, entries, state) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (/^(?:\.pending-)|\.tmp-\d+-/.test(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      await collect(full, root, entries, state)
      continue
    }
    const bytes = await readFile(full)
    state.total += bytes.byteLength
    if (state.total > maxBytes || entries.length >= 20000) throw new Error('书库超过 64 MB 或 20,000 个文件。')
    entries.push([full.slice(root.length + 1), bytes])
  }
}

export async function exportLibrary() {
  const { zip, date } = await exclusive(async () => {
    const entries = []
    await collect('/library', '/library', entries, { total: 0 })
    verify(entries)
    const date = new Date().toISOString()
    const manifest = { format, version: 1, exportedAt: date, files: entries.length }
    const files = Object.fromEntries(entries.map(([key, value]) => [prefix + key, value]))
    files[manifestName] = encoder.encode(JSON.stringify(manifest))
    return { zip: zipSync(files, { level: 3 }), date }
  })
  return native('saveFile', {
    name: 'Novel-Studio-' + date.slice(0, 10) + '.zip',
    base64: Buffer.from(zip).toString('base64'),
  })
}

export const saveText = (name, text) => native('saveFile', { name, base64: Buffer.from(text).toString('base64') })

export function replaceLibrary(backup) {
  return exclusive(async () => {
    const id = crypto.randomUUID()
    const staging = '/transfer/staging-' + id
    const recovery = '/transfer/recovery-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + id.slice(0, 8)
    await mkdir(staging)
    try {
      for (const [key, content] of backup.entries) {
        const file = join(staging, key)
        await mkdir(file.slice(0, file.lastIndexOf('/')), { recursive: true })
        await writeFile(file, content)
      }
      await writeFile(journal, JSON.stringify({ staging, recovery }))
      await rename('/library', recovery)
      try {
        await rename(staging, '/library')
      } catch (error) {
        await rename(recovery, '/library')
        throw error
      }
      await rm(journal, { force: true })
    } finally {
      await rm(staging, { force: true, recursive: true }).catch(() => {})
    }
    return recovery
  })
}

export async function recoverInterruptedRestore() {
  if (platform === 'dsh') return
  const pending = await readFile(journal, 'utf8').then(JSON.parse).catch(() => null)
  if (!pending || !/^\/transfer\/staging-[a-f0-9-]+$/.test(pending.staging)
    || !/^\/transfer\/recovery-[\dTZ-]+-[a-f0-9]{8}$/.test(pending.recovery)) return
  const entries = await readdir('/library')
  if (entries.length === 0 && await readdir(pending.recovery).then(() => true, () => false)) {
    const empty = '/transfer/empty-' + crypto.randomUUID()
    await rename('/library', empty)
    try {
      await rename(pending.recovery, '/library')
    } catch (error) {
      await rename(empty, '/library')
      throw error
    }
    await rm(empty, { recursive: true, force: true })
  }
  await rm(pending.staging, { recursive: true, force: true })
  await rm(journal, { force: true })
}

export async function recoveries() {
  return (await readdir('/transfer')).filter((name) => /^recovery-[\dTZ-]+-[a-f0-9]{8}$/.test(name)).sort().reverse()
}

export async function restoreRecovery(name) {
  if (!(await recoveries()).includes(name)) throw new Error('没有找到该恢复副本。')
  const entries = []
  const dir = '/transfer/' + name
  await collect(dir, dir, entries, { total: 0 })
  return replaceLibrary(describe(entries, name))
}

export async function loadSession(bookId) {
  if (platform === 'dsh') return (await api('GET', '/studio/session/' + encodeURIComponent(bookId))).value
  const book = await readBook('/library', bookId)
  return readFile(join(book.dir, '.studio-session.json'), 'utf8').then(JSON.parse).catch(() => ({}))
}

export function saveSession(bookId, session) {
  if (platform === 'dsh') return exclusive(() => api('PUT', '/studio/session/' + encodeURIComponent(bookId), session))
  return exclusive(async () => {
    const book = await readBook('/library', bookId)
    await writeFile(join(book.dir, '.studio-session.json'), JSON.stringify(session))
  })
}

export function compareParagraphs(previous, proposed) {
  const lines = (text) => text.match(/[^\n]*\n|[^\n]+$/g) || []
  const chunks = []
  for (const part of diffArrays(lines(previous), lines(proposed))) {
    if (!part.added && !part.removed) {
      chunks.push({ kind: 'same', body: part.value.join('') })
      continue
    }
    const last = chunks.at(-1)
    const change = last?.kind === 'change' ? last : { kind: 'change', before: '', after: '' }
    if (change !== last) chunks.push(change)
    change[part.added ? 'after' : 'before'] += part.value.join('')
  }
  return chunks
}

function writeChapterText(bookId, chapter, original, proposed, takeSnapshot) {
  if (platform === 'dsh') return exclusive(async () => (await api('PUT', '/studio/chapter',
    { bookId, chapter, original, proposed, takeSnapshot })).value)
  return exclusive(async () => {
    const book = await readBook('/library', bookId)
    const { unit } = (await getSchema()).unitOf('chapters', 'chapters')
    const { data } = await readUnit(book.dir, unit, chapter)
    if (data.body !== original) throw new Error('原稿已经变化。请重新打开对照。')
    if (original === proposed) return data
    if (takeSnapshot) await saveDraft(book.dir, chapter, { note: '应用修订前' })
    await writeUnit(book.dir, unit, chapter, { body: proposed })
    return (await readUnit(book.dir, unit, chapter)).data
  })
}

export const commitChapter = (bookId, chapter, original, proposed) => writeChapterText(bookId, chapter, original, proposed, true)
export const saveChapterText = (bookId, chapter, original, proposed) => writeChapterText(bookId, chapter, original, proposed, false)

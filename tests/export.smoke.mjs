// dsh-novel-studio — export & publish smoke test.
//
// Exercises lib/export.js against a throwaway novel root: the four built-in
// formats render the same book four ways, publishing writes only into the
// book's publish/ folder, and an extension can add a fifth format without a
// code change.
//
//   node tests/export.smoke.mjs

import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = await mkdtemp(join(tmpdir(), 'novel-export-'))
process.env.DSH_NOVEL_ROOT = ROOT

const LIB = join(fileURLToPath(new URL('../lib/', import.meta.url)))
const EXT_DIR = join(LIB, 'extensions')

let pass = 0
let fail = 0
const failures = []

function check(name, cond, extra) {
  if (cond) {
    pass += 1
    console.log(`  ok   ${name}`)
  } else {
    fail += 1
    failures.push(name)
    console.log(`  FAIL ${name}${extra === undefined ? '' : ` — ${JSON.stringify(extra)}`}`)
  }
}

const fresh = (mod, tag) => import(`${new URL(`file://${join(LIB, mod).replace(/\\/g, '/')}`).href}?v=${tag}`)

const EXT_NAME = 'test-format.js'
let createdExt = false

try {
  const ops = await fresh('ops.js', 'e1')
  const exporter = await fresh('export.js', 'e1')

  const made = await ops.invoke('books', {
    action: 'create',
    title: '星海拾遗',
    meta: { author: '测试作者', genre: '科幻' },
  })
  check('book created', made.ok === true, made)
  const bookId = made.book.id
  const got = await ops.invoke('books', { action: 'get', book: bookId })
  const dir = got.dir
  check('book directory resolved', typeof dir === 'string' && dir.length > 0, got)

  await ops.invoke('books', {
    action: 'update',
    book: bookId,
    meta: { logline: '一个在轨道垃圾带捡废品的少年捡到了一段还在运行的记忆。' },
  })

  // ── two chapters ────────────────────────────────────────────────────────
  console.log('\nchapters')
  {
    const a = await ops.invoke('records', {
      action: 'write', book: bookId, section: 'chapters',
      data: { title: '第一章 拾荒', body: '夜里，船离港了。\n\n林望把手伸进垃圾带的缝隙里。' },
    })
    check('chapter 1 written', a.ok === true && a.created === true, a)
    const b = await ops.invoke('records', {
      action: 'write', book: bookId, section: 'chapters',
      data: { title: '第二章 记忆', body: '那段记忆在掌心亮了一下，又灭了。' },
    })
    check('chapter 2 written', b.ok === true && b.created === true, b)

    const chapters = await ops.invoke('records', { action: 'list', book: bookId, section: 'chapters' })
    check('two chapters listed', chapters.items.length === 2, chapters.items?.length)
    check('countWords matches prose', Number(chapters.items[0].words) > 5, chapters.items?.[0])
  }

  // ── rendering ───────────────────────────────────────────────────────────
  console.log('\nrender')
  const book = (await ops.invoke('books', { action: 'get', book: bookId })).book

  {
    const md = await exporter.exportBook(dir, book, { format: 'md' })
    check('md starts with front matter', md.text.startsWith('---\n'), md.text.slice(0, 20))
    check('md names the book', md.text.includes('# 星海拾遗'), null)
    check('md has the author', md.text.includes('author: 测试作者'), null)
    check('md has chapter headings', md.text.includes('## 第一章 拾荒') && md.text.includes('## 第二章 记忆'), null)
    // Pinyin collation alone would put 第二章 first and export the book backwards.
    check('md reads in chapter order', md.text.indexOf('## 第一章') < md.text.indexOf('## 第二章') && md.text.indexOf('## 第一章') > 0, null)
    check('md keeps the prose', md.text.includes('林望把手伸进垃圾带的缝隙里。'), null)
    check('md reports two chapters', md.chapters === 2 && md.words > 20, { c: md.chapters, w: md.words })
    check('md suggested filename', md.filename.endsWith('.md') && md.bytes === Buffer.byteLength(md.text, 'utf8'), md.filename)

    // The blank line inside the chapter is the author's — it must survive.
    check('md preserves blank lines in prose', md.text.includes('夜里，船离港了。\n\n林望'), null)
    check('md round-trips through front matter', md.text.split('---\n')[2].includes('## 第一章'), null)
  }

  {
    const txt = await exporter.exportBook(dir, book, { format: 'txt' })
    check('txt has no front matter', !txt.text.includes('---'), null)
    check('txt has the title first', txt.text.startsWith('星海拾遗\n'), txt.text.slice(0, 12))
    check('txt has both chapters', txt.text.includes('第一章 拾荒') && txt.text.includes('第二章 记忆'), null)
    check('txt mime', txt.mime.startsWith('text/plain'), txt.mime)
  }

  {
    const html = await exporter.exportBook(dir, book, { format: 'html' })
    check('html is a document', html.text.startsWith('<!doctype html>'), html.text.slice(0, 20))
    check('html sets lang', html.text.includes('<html lang="zh">'), null)
    check('html titles the page', html.text.includes('<title>星海拾遗</title>'), null)
    check('html wraps prose in paragraphs', html.text.includes('<p>夜里，船离港了。</p>'), null)
    check('html breaks on blank lines', html.text.includes('<p>林望把手伸进垃圾带的缝隙里。</p>'), null)
    check('html ends the document', html.text.trimEnd().endsWith('</html>'), null)
    check('html mime', html.mime.startsWith('text/html'), html.mime)
  }

  {
    const json = await exporter.exportBook(dir, book, { format: 'json' })
    const parsed = JSON.parse(json.text)
    check('json parses', typeof parsed === 'object' && parsed !== null, null)
    check('json is versioned', parsed.format === 'novel-studio/book' && parsed.version === 1, parsed.format)
    check('json carries the book meta', parsed.book.title === '星海拾遗' && parsed.book.author === '测试作者', parsed.book)
    check('json drops the local dir', !('dir' in parsed.book), Object.keys(parsed.book))
    check('json carries the prose', parsed.chapters.length === 2 && parsed.chapters[0].body.includes('林望'), null)
    check('json backs up the records', Array.isArray(parsed.data.characters) && Array.isArray(parsed.data['world/rules']) && Array.isArray(parsed.data.materials), Object.keys(parsed.data))
    check('json back-up walks chapters too', parsed.data.chapters.length === 2, parsed.data.chapters?.length)
    check('json lists chapters in reading order', parsed.chapters[0].title === '第一章 拾荒', parsed.chapters.map((c) => c.title))
    check('json needsData only for json', json.bytes > 200, json.bytes)
  }

  // ── refusals ────────────────────────────────────────────────────────────
  console.log('\nrefusals')
  {
    const bad = await ops.invoke('export', { book: bookId, format: 'epub' })
    check('unknown format refused', bad.ok === false && /unknown export format/.test(bad.message), bad)

    const noBook = await ops.invoke('export', { format: 'md' })
    check('missing book refused', noBook.ok === false && noBook.code === 'missing-argument', noBook)

    const evil = await ops.invoke('export', { book: bookId, format: 'md', filename: '../escape.md' })
    check('path traversal in filename refused', evil.ok === false, evil)

    const ghost = await ops.invoke('export', { book: 'no-such-book', format: 'md' })
    check('unknown book refused', ghost.ok === false, ghost)
  }

  // ── publishing ──────────────────────────────────────────────────────────
  console.log('\npublish')
  {
    const snapshot = async () => {
      const out = {}
      for (const name of (await readdir(join(dir, 'chapters'))).sort()) {
        out[name] = await readFile(join(dir, 'chapters', name), 'utf8')
      }
      return out
    }
    const before = await snapshot()

    const menu = await ops.invoke('publish', { action: 'formats' })
    check('format menu lists four built-ins', menu.ok === true && menu.formats.length === 4, menu.formats?.map((f) => f.key))
    check('format menu carries mime types', menu.formats.every((f) => typeof f.mime === 'string'), null)

    const empty = await ops.invoke('publish', { action: 'list', book: bookId })
    check('nothing published yet', empty.ok === true && empty.artifacts.length === 0, empty)

    const wrote = await ops.invoke('publish', { action: 'write', book: bookId, format: 'md' })
    check('md published', wrote.ok === true && wrote.artifact.file.endsWith('.md'), wrote)
    check('publish reports byte size', Number(wrote.artifact.bytes) > 0, wrote.artifact)
    check('publish reports word count', Number(wrote.artifact.words) > 20, wrote.artifact)

    const onDisk = await readFile(join(dir, 'publish', wrote.artifact.file), 'utf8')
    check('artifact is on disk', onDisk.startsWith('---\n') && onDisk.includes('## 第二章'), onDisk.slice(0, 12))

    const { readYamlFile } = await fresh('library.js', 'e1')
    const manifest = await readYamlFile(join(dir, 'publish', 'manifest.yaml'), {})
    check('manifest is versioned', manifest.schemaVersion === 1, manifest)
    check('manifest records the artifact', manifest.artifacts.length === 1 && manifest.artifacts[0].file === wrote.artifact.file, manifest)

    const html = await ops.invoke('publish', { action: 'write', book: bookId, format: 'html' })
    check('html published too', html.ok === true, html)

    const listed = await ops.invoke('publish', { action: 'list', book: bookId })
    check('both artifacts listed', listed.artifacts.length === 2, listed.artifacts)
    check('listing reports the folder', listed.path === join(dir, 'publish'), listed.path)

    // A file dropped in by hand must not be hidden from the list.
    await mkdir(join(dir, 'publish'), { recursive: true })
    await writeFile(join(dir, 'publish', 'notes.txt'), '手写的\n', 'utf8')
    const withStray = await ops.invoke('publish', { action: 'list', book: bookId })
    check('untracked file surfaces', withStray.artifacts.length === 3, withStray.artifacts?.length)
    check('untracked file is flagged', withStray.artifacts.some((a) => a.untracked === true && a.file === 'notes.txt'), null)

    // Re-publishing the same format replaces the row instead of duplicating it.
    await ops.invoke('publish', { action: 'write', book: bookId, format: 'md' })
    const again = await ops.invoke('publish', { action: 'list', book: bookId })
    check('re-publish does not duplicate the row', again.artifacts.length === 3, again.artifacts?.length)

    const dropped = await ops.invoke('publish', { action: 'delete', book: bookId, name: wrote.artifact.file })
    check('artifact deleted', dropped.ok === true && dropped.removed === true, dropped)
    const after = await ops.invoke('publish', { action: 'list', book: bookId })
    check('deleted artifact is gone from the row list', !after.artifacts.some((a) => a.file === wrote.artifact.file), after.artifacts)

    const guard = await ops.invoke('publish', { action: 'delete', book: bookId, name: 'manifest.yaml' })
    check('manifest is not deletable', guard.ok === false, guard)

    const escape = await ops.invoke('publish', { action: 'delete', book: bookId, name: '../book.yaml' })
    check('traversal refused on delete', escape.ok === false, escape)

    const unknownAction = await ops.invoke('publish', { action: 'explode', book: bookId })
    check('unknown publish action refused', unknownAction.ok === false && unknownAction.code === 'unknown-action', unknownAction)

    const afterFiles = await snapshot()
    check('publishing never touched the source', JSON.stringify(afterFiles) === JSON.stringify(before), Object.keys(afterFiles))
  }

  // ── the extension seam ──────────────────────────────────────────────────
  console.log('\nextension format')
  {
    const src = [
      `export const id = 'test-format'`,
      `export const zh = '测试格式'`,
      `export const formats = [`,
      `  {`,
      `    key: 'csv', zh: '章节清单 CSV', en: 'Chapter list (CSV)', ext: 'csv',`,
      `    mime: 'text/csv; charset=utf-8',`,
      `    render: ({ chapters }) => ['title,words', ...chapters.map((c) => \`"\${c.title}",\${c.words}\`)].join('\\n') + '\\n',`,
      `  },`,
      `  { key: 'md', zh: '影子格式', ext: 'md', mime: 'text/plain', render: () => 'shadow' },`,
      `]`,
      ``,
    ].join('\n')
    await writeFile(join(EXT_DIR, EXT_NAME), src, 'utf8')
    createdExt = true

    const ops2 = await fresh('ops.js', 'e2')
    const exporter2 = await fresh('export.js', 'e2')

    const menu = await ops2.invoke('publish', { action: 'formats' })
    const keys = menu.formats.map((f) => f.key)
    check('extension format appears', keys.includes('csv'), keys)
    check('extension format is listed last', keys[keys.length - 1] === 'csv', keys)
    check('shadowing format is dropped', keys.filter((k) => k === 'md').length === 1, keys)
    check('built-in md still wins', menu.formats.find((f) => f.key === 'md').zh === '手稿 Markdown', menu.formats.find((f) => f.key === 'md'))

    const csv = await exporter2.exportBook(dir, book, { format: 'csv' })
    check('extension format renders', csv.text.startsWith('title,words\n'), csv.text.slice(0, 16))
    check('extension renderer sees the chapters', csv.text.includes('第一章 拾荒'), null)
    check('extension format keeps its ext', csv.filename.endsWith('.csv') && csv.mime.startsWith('text/csv'), csv.filename)

    const published = await ops2.invoke('publish', { action: 'write', book: bookId, format: 'csv' })
    check('extension format publishes', published.ok === true && published.artifact.file.endsWith('.csv'), published)

    const report = await ops2.invoke('schema', {})
    const ext = report.extensions.find((e) => e.file === EXT_NAME)
    check('extension report counts formats', ext?.formats === 2, ext)
  }
} finally {
  if (createdExt) await rm(join(EXT_DIR, EXT_NAME), { force: true })
  await rm(ROOT, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
if (failures.length) console.log(`failed: ${failures.join(', ')}`)
process.exit(fail === 0 ? 0 : 1)

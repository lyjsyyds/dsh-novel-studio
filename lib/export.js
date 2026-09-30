// dsh-novel-studio — export & publish.
//
// Rendering is pure: a book directory in, a string out. Publishing is the only
// part that writes, and it only ever writes inside that book's own `publish/`.
//
// A format is `{ key, zh, en, ext, mime, render(ctx) }`, so an extension can add
// one — see EXTENSIONS.md. `render` may be async and may return any string; the
// built-ins render Markdown, plain text, a standalone HTML page, and a complete
// JSON backup of the book.

const V = new URL(import.meta.url).searchParams.get('v') ?? '0'

const { atomicWrite, readYamlFile, writeYamlFile } = await import(`./library.js?v=${V}`)
const { countWords, listUnit, parseFrontMatter, readUnit, compareChapters } = await import(`./records.js?v=${V}`)
const { getSchema } = await import(`./schema.js?v=${V}`)

const { readdir, readFile, rm } = await import('node:fs/promises')
const { join } = await import('node:path')
const { stringify: stringifyYaml } = await import('yaml')

export const PUBLISH_DIR = 'publish'
export const MANIFEST = 'manifest.yaml'
export const MANIFEST_VERSION = 1

/** Section kinds that hold addressable entries — what a backup can walk. */
const LISTABLE = new Set(['records', 'doc', 'chapters', 'files', 'raw'])

function bad(message, status = 400) {
  const err = new Error(message)
  err.status = status
  return err
}

/** Artifacts live directly in publish/ — one filename, no directories. */
function safeArtifactName(name) {
  const s = String(name ?? '').trim().replace(/\\/g, '/')
  if (!s || s.includes('/') || s.includes('..') || s.startsWith('.')) {
    throw bad('invalid artifact file name')
  }
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(s)) throw bad('invalid artifact file name')
  if (s.length > 120) throw bad('artifact file name too long')
  return s
}

// ── reading the prose ─────────────────────────────────────────────────────

/** Every chapter of a book, in reading order. */
export async function readChapters(bookDir) {
  const dir = join(bookDir, 'chapters')
  let names = []
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith('.md'))
  } catch {
    return []
  }
  const chapters = []
  for (const name of names.slice().sort((a, b) => compareChapters(a.replace(/\.md$/, ''), b.replace(/\.md$/, '')))) {
    const id = name.replace(/\.md$/, '')
    let meta = {}
    let body = ''
    try {
      const parsed = parseFrontMatter(await readFile(join(dir, name), 'utf8'))
      meta = parsed.meta
      body = parsed.body
    } catch {
      /* an unreadable chapter exports empty rather than sinking the whole book */
    }
    chapters.push({
      id,
      title: String(meta.title ?? '').trim() || id,
      body,
      words: countWords(body),
      meta,
    })
  }
  return chapters
}

export function chapterStats(chapters) {
  return {
    chapters: chapters.length,
    words: chapters.reduce((n, c) => n + c.words, 0),
    empty: chapters.filter((c) => !String(c.body).trim()).length,
  }
}

// ── renderers ─────────────────────────────────────────────────────────────

function yamlHead(pairs) {
  const clean = {}
  for (const [k, v] of Object.entries(pairs)) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue
    clean[k] = v
  }
  return stringifyYaml(clean, { lineWidth: 0 }).trimEnd()
}

function renderMarkdown({ book, chapters, stats, stamp }) {
  const head = yamlHead({
    title: book.title || book.id,
    author: book.author,
    genre: book.genre,
    tags: book.tags,
    exported: stamp,
    chapters: stats.chapters,
    words: stats.words,
  })
  const parts = [`---\n${head}\n---`, `# ${book.title || book.id}`]
  if (book.logline) parts.push(`> ${book.logline}`)
  for (const c of chapters) {
    parts.push(`## ${c.title}`)
    const body = String(c.body).trim()
    if (body) parts.push(body)
  }
  // Joined, not collapsed: blank lines inside a chapter's prose are the author's.
  return `${parts.join('\n\n')}\n`
}

function renderText({ book, chapters }) {
  const parts = [book.title || book.id]
  if (book.author) parts.push(book.author)
  if (book.logline) parts.push(book.logline)
  for (const c of chapters) {
    parts.push(c.title)
    const body = String(c.body).trim()
    if (body) parts.push(body)
  }
  return `${parts.filter(Boolean).join('\n\n')}\n`
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ))
}

function paragraphs(text) {
  return String(text ?? '')
    .split(/\n[ \t]*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n')
}

// The colour literals below belong to the *exported document*, which is opened
// in a browser or printed to PDF on its own — not to the DSH shell. The studio's
// own UI keeps to --dsw-alias-* tokens; a detached manuscript has no theme.
function renderHtml({ book, chapters, stats, stamp, options = {} }) {
  const title = book.title || book.id
  const lang = options.lang || 'zh'
  const sections = chapters.map((c) => [
    '<section>',
    `<h2>${escapeHtml(c.title)}</h2>`,
    paragraphs(c.body),
    '</section>',
  ].filter(Boolean).join('\n')).join('\n')

  return `<!doctype html>
<html lang="${escapeHtml(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:light dark}
body{margin:0;padding:3rem 1.25rem 6rem;background:#fbfaf7;color:#1b1b1b;
 font:16px/1.85 "Iowan Old Style","Source Han Serif SC","Songti SC",Georgia,serif}
main{max-width:36em;margin:0 auto}
h1{font-size:1.9em;line-height:1.3;margin:0 0 .2em}
.byline{color:#6b6b6b;margin:0 0 2.5em}
.logline{font-style:italic;color:#444;border-left:2px solid #d8d3c8;padding-left:1em;margin:0 0 3em}
section{margin:0 0 3.5em}
h2{font-size:1.15em;font-weight:600;margin:0 0 1.2em;letter-spacing:.02em}
p{margin:0 0 1em;text-indent:2em}
footer{margin-top:4em;color:#8a8a8a;font-size:.85em;text-align:center}
@media print{
 body{background:#fff;padding:0;font-size:11.5pt}
 section{page-break-before:always}
 section:first-of-type{page-break-before:avoid}
}
</style>
</head>
<body>
<main>
<h1>${escapeHtml(title)}</h1>
${book.author ? `<p class="byline">${escapeHtml(book.author)}</p>` : ''}
${book.logline ? `<p class="logline">${escapeHtml(book.logline)}</p>` : ''}
${sections}
<footer>${escapeHtml(String(stats.words))} 字 · ${escapeHtml(String(stats.chapters))} 章 · ${escapeHtml(stamp)}</footer>
</main>
</body>
</html>
`
}

/** A complete, re-readable dump of the book — prose plus every record. */
function renderJson({ book, chapters, stats, stamp, data }) {
  const { dir, ...meta } = book
  return `${JSON.stringify({
    format: 'novel-studio/book',
    version: 1,
    exportedAt: stamp,
    book: meta,
    stats,
    chapters: chapters.map((c) => ({ id: c.id, title: c.title, words: c.words, meta: c.meta, body: c.body })),
    ...(data ? { data } : {}),
  }, null, 2)}\n`
}

const FORMATS = [
  { key: 'md', zh: '手稿 Markdown', en: 'Manuscript (Markdown)', ext: 'md', mime: 'text/markdown; charset=utf-8', render: renderMarkdown },
  { key: 'txt', zh: '纯文本', en: 'Plain text', ext: 'txt', mime: 'text/plain; charset=utf-8', render: renderText },
  { key: 'html', zh: '单页 HTML', en: 'Standalone HTML', ext: 'html', mime: 'text/html; charset=utf-8', render: renderHtml },
  { key: 'json', zh: '整书备份', en: 'Whole-book backup', ext: 'json', mime: 'application/json; charset=utf-8', needsData: true, render: renderJson },
]

/** Built-in formats first, then whatever extensions contributed. */
export async function formatList() {
  const schema = await getSchema().catch(() => ({ extraFormats: [] }))
  const extras = []
  for (const f of schema.extraFormats || []) {
    // A built-in key wins; shadowing it would silently change what `md` means.
    if (FORMATS.some((b) => b.key === f.key)) {
      console.error(`[novel-studio] extension format "${f.key}" skipped (shadows a built-in format)`)
      continue
    }
    extras.push(f)
  }
  return [...FORMATS, ...extras]
}

export async function formatMenu() {
  const formats = await formatList()
  return formats.map((f) => ({ key: f.key, zh: f.zh || f.key, en: f.en || f.key, ext: f.ext, mime: f.mime }))
}

// ── the whole book as data (JSON backup only) ─────────────────────────────

async function collectData(bookDir) {
  const schema = await getSchema()
  const out = {}
  for (const section of schema.sections) {
    const units = section.kind === 'groups' ? (section.groups || []) : [section]
    for (const unit of units) {
      if (!unit || !LISTABLE.has(unit.kind)) continue
      const key = section.kind === 'groups' ? `${section.key}/${unit.key}` : section.key
      try {
        const { items, extra } = await listUnit(bookDir, unit)
        if (extra && extra.text !== undefined) {
          out[key] = extra.text
        } else if (unit.kind === 'files') {
          // A file listing alone ({ id, size, mtime }) cannot be restored, so the
          // backup carries the text too. Binary or oversized files are recorded
          // by name only, and importBackup skips those with a warning.
          const files = []
          for (const item of items) {
            try {
              const got = await readUnit(bookDir, unit, item.id)
              const text = got?.data?.text
              files.push(typeof text === 'string' ? { id: item.id, text } : { id: item.id, size: item.size, binary: true })
            } catch {
              files.push({ id: item.id, size: item.size })
            }
          }
          out[key] = files
        } else {
          out[key] = items
        }
      } catch (err) {
        out[key] = { error: String((err && err.message) || err) }
      }
    }
  }
  return out
}

// ── rendering one book ────────────────────────────────────────────────────

/**
 * Render a book without writing anything.
 * @returns {Promise<{format,label,ext,mime,filename,text,bytes,chapters,words,empty}>}
 */
export async function exportBook(bookDir, book, options = {}) {
  const key = String(options.format || 'md')
  const format = (await formatList()).find((f) => f.key === key)
  if (!format) throw bad(`unknown export format "${key}"`)

  const chapters = await readChapters(bookDir)
  const stats = chapterStats(chapters)
  const stamp = new Date().toISOString()
  const data = format.needsData ? await collectData(bookDir) : null

  const text = String(await format.render({
    book, chapters, stats, stamp,
    dir: bookDir, data, options,
  }))

  return {
    format: format.key,
    label: format.zh || format.key,
    ext: format.ext || 'txt',
    mime: format.mime || 'text/plain; charset=utf-8',
    filename: safeArtifactName(options.filename || `${book.id || book.title || 'book'}.${format.ext || 'txt'}`),
    text,
    bytes: Buffer.byteLength(text, 'utf8'),
    ...stats,
  }
}

// ── the publish/ folder ───────────────────────────────────────────────────

export function publishPath(bookDir) {
  return join(bookDir, PUBLISH_DIR)
}

/** Manifest rows plus any file that was dropped into publish/ by hand. */
export async function listArtifacts(bookDir) {
  const dir = publishPath(bookDir)
  const doc = await readYamlFile(join(dir, MANIFEST), {})
  const rows = Array.isArray(doc?.artifacts) ? doc.artifacts : []

  let names = []
  try {
    names = (await readdir(dir)).filter((n) => !n.startsWith('.') && n !== MANIFEST)
  } catch {
    /* no publish/ yet */
  }
  const known = new Set(rows.map((r) => r?.file).filter(Boolean))
  const untracked = names.filter((n) => !known.has(n)).map((n) => ({ file: n, format: null, untracked: true }))

  return { path: dir, artifacts: [...rows.filter(Boolean), ...untracked] }
}

/** Render and write one artifact into publish/, updating the manifest. */
export async function publishBook(bookDir, book, options = {}) {
  const rendered = await exportBook(bookDir, book, options)
  const dir = publishPath(bookDir)
  await atomicWrite(join(dir, rendered.filename), rendered.text)

  const manifestFile = join(dir, MANIFEST)
  const doc = await readYamlFile(manifestFile, {})
  const list = Array.isArray(doc?.artifacts) ? doc.artifacts.slice() : []
  const row = {
    file: rendered.filename,
    format: rendered.format,
    bytes: rendered.bytes,
    chapters: rendered.chapters,
    words: rendered.words,
    createdAt: new Date().toISOString(),
  }
  const at = list.findIndex((r) => r?.file === rendered.filename)
  if (at === -1) list.push(row)
  else list[at] = { ...list[at], ...row }
  await writeYamlFile(manifestFile, { schemaVersion: MANIFEST_VERSION, artifacts: list })

  return {
    artifact: row,
    path: join(dir, rendered.filename),
    format: rendered.format,
    label: rendered.label,
    bytes: rendered.bytes,
    chapters: rendered.chapters,
    words: rendered.words,
  }
}

export async function deleteArtifact(bookDir, name) {
  const file = safeArtifactName(name)
  if (file === MANIFEST) throw bad('cannot delete the manifest')
  const dir = publishPath(bookDir)
  await rm(join(dir, file), { force: true })

  const manifestFile = join(dir, MANIFEST)
  const doc = await readYamlFile(manifestFile, {})
  const list = Array.isArray(doc?.artifacts) ? doc.artifacts : []
  const kept = list.filter((r) => r?.file !== file)
  if (kept.length !== list.length) {
    await writeYamlFile(manifestFile, { schemaVersion: MANIFEST_VERSION, artifacts: kept })
  }
  return { file, removed: true }
}

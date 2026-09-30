// dsh-novel-studio — shared operation layer.
//
// One implementation of every read/write the plugin offers. The agent tools
// (lib/tools.js) call `invoke(...)` directly; extension routes get the same
// helpers. `lib/api.js` is the browser's HTTP adapter over the same modules.
//
// Contract: `invoke(operation, payload)` NEVER throws. Business refusals come
// back as `{ ok: false, code, message }` so a model can read the reason and
// correct itself instead of losing the turn to a stack trace.
//
// Operations
//   guide          { topic? }                       how to use and extend the studio
//   schema         {}                               resolved section tree
//   books          { action, ... }                  list | create | get | update | delete
//   records        { action, ... }                  schema | list | read | write | delete
//   extensions     { action, ... }                  list | scaffold | write | delete
//   graph          { book, kinds? }                 relationship web of one book
//   edges          { action, ... }                  create | update | delete one relation
//   validate       { book }                         consistency report for one book
//   export         { book, format?, filename? }      render one book, write nothing
//   publish        { action, ... }                  formats | list | write | delete
//   path           { book, section, group? }        absolute file path of one unit
//   search         { book, q, limit?, section? }    where a word appears, prose included
//   chapters       { action, ... }                  plan | reorder | renumber
//   drafts         { action, ... }                  list | read | save | restore | delete
//   progress       { book, action? , ... }          get | set (word goal, deadline, pace)
//   settings       { book, action?, patch? }        get | set per-book preferences
//   import         { action, ... }                  list | backup | markdown (dry-run first)

const V = new URL(import.meta.url).searchParams.get('v') ?? '0'

const { getSchema, EXT_DIR } = await import(`./schema.js?v=${V}`)
const { buildGraph, graphKinds } = await import(`./graph.js?v=${V}`)
const { createEdge, deleteEdge, updateEdge } = await import(`./edges.js?v=${V}`)
const { ruleList, validateBook } = await import(`./validate.js?v=${V}`)
const {
  deleteArtifact,
  listArtifacts,
  exportBook,
  formatMenu,
  publishBook,
  publishPath,
} = await import(`./export.js?v=${V}`)
const {
  atomicWrite,
  bookCounts,
  createBook,
  deleteBook,
  listBooks,
  moveRoot,
  readBook,
  resolveRoot,
  rootInfo,
  updateBook,
  writeRoot,
} = await import(`./library.js?v=${V}`)
const {
  deleteUnit,
  idForNew,
  inferFields,
  listUnit,
  readUnit,
  writeUnit,
} = await import(`./records.js?v=${V}`)
const { searchBook } = await import(`./search.js?v=${V}`)
const {
  chapterPlan,
  deleteDraft,
  listDrafts,
  readDraft,
  renumberChapters,
  reorderChapters,
  restoreDraft,
  saveDraft,
} = await import(`./chapters.js?v=${V}`)
const { progressFor, setGoal } = await import(`./progress.js?v=${V}`)
const {
  describeBackup,
  importBackup,
  importMarkdown,
  importableFiles,
} = await import(`./import.js?v=${V}`)
const { readSettings, SETTING_DEFAULTS, updateSettings } = await import(`./library.js?v=${V}`)
const { readUsage, resetUsage } = await import(`./usage.js?v=${V}`)
const { applyExtract, recognizeExtract } = await import(`./extract.js?v=${V}`)
const { getServices } = await import(`./api.js?v=${V}`)

const { mkdir, readdir, rm } = await import('node:fs/promises')
const { join } = await import('node:path')
const { pathToFileURL } = await import('node:url')

// ── refusals ──────────────────────────────────────────────────────────────

function refuse(code, message) {
  const err = new Error(message)
  err.code = code
  return err
}

function need(value, name) {
  if (value === undefined || value === null || value === '') {
    throw refuse('missing-argument', `"${name}" is required`)
  }
  return value
}

// ── unit resolution ───────────────────────────────────────────────────────

/**
 * Resolve (section, group) to one declared unit. This is the allow-list: any
 * path a caller names must resolve here first, so an unknown section can never
 * reach the filesystem.
 */
async function resolveUnit(sectionKey, groupKey) {
  const schema = await getSchema()
  const section = schema.byKey.get(sectionKey)
  if (!section) throw refuse('unknown-section', `no section "${sectionKey}"`)
  if (section.kind === 'groups') {
    const key = groupKey || section.groups?.[0]?.key
    const resolved = schema.unitOf(sectionKey, key)
    if (!resolved) throw refuse('unknown-group', `section "${sectionKey}" has no group "${groupKey}"`)
    return { schema, section, unit: resolved.unit, group: key }
  }
  if (groupKey && groupKey !== sectionKey) {
    throw refuse('unknown-group', `section "${sectionKey}" is not grouped; drop "group"`)
  }
  return { schema, section, unit: section, group: sectionKey }
}

async function openBook(payload) {
  const root = resolveRoot()
  const id = need(payload.book ?? payload.id, 'book')
  const book = await readBook(root, id)
  return { root, book, dir: book.dir, id }
}

// ── guide text ────────────────────────────────────────────────────────────

const GUIDE = {
  overview: [
    'dsh-novel-studio is a novel-writing workspace inside DeepSeek Harness.',
    'It lives in its own sidebar panel ("小说"); it is independent of tasks and chat sessions.',
    'Data is plain files under the novel root — one fully isolated directory per book.',
    '',
    'Layout per book: characters/ world/{locations,factions,items,races,cultures} world/*.yaml',
    'outline/{scenes,*.yaml} panels/*.yaml chapters/ materials/ drafts/ meta/',
    '',
    'Read `guide` with topic "data" for the record model, or "extend" to add new',
    'sections and features. Use the `novel_records` tool to read and write entries,',
    '`novel_validate` to check a book for inconsistencies before and after writing,',
    '`novel_graph` to see how the characters and factions connect, `novel_link` to',
    'add, rewire or remove one of those relations, and `novel_export` to turn the',
    'finished book into Markdown, plain text, a printable HTML page, or a full JSON',
    'backup — and `novel_import` to bring one back (or to split a pasted manuscript',
    'into chapters). `novel_search` finds a word anywhere in the book, prose included;',
    '`novel_chapters` reads and rewrites the chapter order and numbering;',
    '`novel_drafts` keeps chapter snapshots; `novel_progress` reads the daily word',
    'count, the goal and the pace; `novel_extract` reads a passage and files the new',
    'people, places and items it introduces into the matching regions.',
    '',
    'A relation lives in one of two places, and `novel_link` edits the right one:',
    'a hand-written row in relationships.yaml, or a field on a record (item.owner,',
    'faction.leader, location.region). Rewiring the latter rewrites that field, so',
    'the character sheet and the graph never disagree.',
  ].join('\n'),
  data: [
    'Sections come in six kinds:',
    '  records   one YAML file per entry, in `dir` (.yaml) — characters, locations …',
    '  doc       one YAML file holding an array under `listKey` — panels, outline beats …',
    '            entries are addressed by their 0-based list index.',
    '  chapters  Markdown with YAML front matter, in `dir` (.md)',
    '  files     raw files under `dir`',
    '  raw       the whole YAML document as editable text',
    '  groups    a section that nests other units',
    '',
    'Every container YAML keeps `schemaVersion` plus any sibling keys it already had;',
    'writers merge rather than replace, so extra keys survive a round trip.',
    'Entry fields are declared per unit, but `fields` may be omitted — the client then',
    'infers a form from the data, which is how a brand-new panel works before anyone',
    'has declared its shape.',
  ].join('\n'),
  extend: [
    'Add a section or a feature by dropping a file into lib/extensions/.',
    'The loader imports every `*.js` there except files whose name starts with `_`',
    '(use `_` for templates you keep but do not enable).',
    '',
    'An extension module may export any of:',
    '  export const id = "wordcount"',
    '  export const sections = [{ key, zh, en, kind, ...unit }]   // new tabs',
    '  export const routes   = [{ method, pattern, handler }]     // under /ext/...',
    '  export const tools    = [{ name, description, parameters, run }]',
    '  export const graphs   = [{ key, zh, en, section, group?, label, role, links }]',
    '  export const rules    = [{ id, zh, en, level, run(ctx) }]  // consistency checks',
    '  export const formats  = [{ key, zh, en, ext, mime, render(ctx) }]  // export targets',
    '  export const ai       = [{ key, zh, en, needs, maxTokens, system, frame(request, ctx) }]',
    '',
    'A `graphs` entry adds a node kind to the relationship web; a `rules` entry',
    'adds a check that `novel_validate` runs; a `formats` entry adds a target that',
    '`novel_export` and `novel_publish` can write. An `ai` entry adds a task to the',
    'AI pane — `needs` is "chapter" | "text" | "input" | "none" and `frame` returns',
    'this request\'s ask, appending to the same book context a built-in task gets.',
    'A key that collides with a built-in task is skipped: built-ins win. `run(ctx)` gets',
    '  ctx = { book, dir, schema, units, graph, known, texts, add(rule, level, msg, extra) }',
    'and must only read — a rule never writes. A format renderer gets',
    '  ctx = { book, dir, chapters, stats, stamp, data?, options }',
    'and returns the file body as a string (it may be async). `data` is only',
    'collected when the format sets `needsData: true`.',
    '',
    'A section key that collides with a built-in or another extension is skipped',
    'with a log line. Extension route handlers receive',
    '  ctx = { json, fail, readJsonBody, resolveRoot, listBooks, readBook, getSchema,',
    '          listUnit, readUnit, writeUnit, deleteUnit, inferFields, bookDirOf,',
    '          params, segments }',
    '',
    'Writes into lib/extensions/ are picked up on the next request — no app restart.',
    'Use the `novel_extension` tool (action "scaffold" then "write") to install one:',
    'the file is syntax- and shape-checked by importing it, and removed again if it fails.',
    'Only lib/index.js itself needs a restart, because DSH loads the host half once.',
  ].join('\n'),
}

// ── extensions ────────────────────────────────────────────────────────────

const EXT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.js$/

function scaffoldSource({ name, id, sectionKey, zh, en, kind, path, listKey }) {
  const sid = id || name.replace(/\.js$/, '')
  const key = sectionKey || sid
  const label = zh || key
  const body =
    kind === 'doc'
      ? `{ key: '${key}', zh: '${label}', en: '${en || key}', kind: 'doc', path: '${path || `meta/${key}.yaml`}', listKey: '${listKey || 'items'}', titleField: 'title' }`
      : kind === 'chapters'
        ? `{ key: '${key}', zh: '${label}', en: '${en || key}', kind: 'chapters', dir: '${path || 'chapters'}' }`
        : kind === 'raw'
          ? `{ key: '${key}', zh: '${label}', en: '${en || key}', kind: 'raw', path: '${path || `meta/${key}.yaml`}' }`
          : `{ key: '${key}', zh: '${label}', en: '${en || key}', kind: 'records', dir: '${path || key}', titleField: 'name' }`
  return `// dsh-novel-studio extension — ${sid}
// Loaded from lib/extensions/ on the next request. See \`novel_guide\` topic "extend".

export const id = '${sid}'

/** New top-level tabs contributed by this file. */
export const sections = [${body}]

/** Optional HTTP routes, served under /novel-studio/api/ext/${sid}/... */
// export const routes = [
//   { method: 'GET', pattern: '/ext/${sid}/summary', handler: async (req, res, ctx) => ctx.json(res, { ok: true }) },
// ]

/** Optional model-facing tools. */
// export const tools = [
//   { name: 'novel_${sid}_summary', description: '…', parameters: { type: 'object', properties: {} }, run: async (args, ctx) => ({ ok: true }) },
// ]
`
}

async function listExtensions() {
  let names = []
  try {
    names = (await readdir(EXT_DIR)).filter((n) => n.endsWith('.js'))
  } catch {
    // no extensions directory yet
  }
  const schema = await getSchema()
  return names.sort().map((file) => {
    const report = schema.extensions.find((e) => e.file === file)
    return {
      file,
      id: report?.id ?? file.replace(/\.js$/, ''),
      enabled: !file.startsWith('_'),
      sections: report?.sections ?? 0,
      routes: report?.routes ?? 0,
      tools: report?.tools ?? 0,
      error: report?.error ?? null,
    }
  })
}

async function writeExtension(payload) {
  const name = String(need(payload.name, 'name'))
  if (!EXT_NAME.test(name)) {
    throw refuse('bad-name', 'name must look like "my-section.js" (letters, digits, dot, dash, underscore)')
  }
  const source = need(payload.source, 'source')
  if (typeof source !== 'string') throw refuse('bad-source', 'source must be a string of JavaScript')

  const target = join(EXT_DIR, name)
  await mkdir(EXT_DIR, { recursive: true })
  await atomicWrite(target, source)

  // Validate by actually importing it: a syntax error, a bad export shape, or a
  // top-level throw all roll the file back instead of poisoning the schema.
  let mod
  try {
    mod = await import(`${pathToFileURL(target).href}?validate=${Date.now()}`)
  } catch (err) {
    await rm(target, { force: true })
    throw refuse('invalid-extension', `extension rejected and removed — ${err?.message || err}`)
  }
  if (mod.sections !== undefined && !Array.isArray(mod.sections)) {
    await rm(target, { force: true })
    throw refuse('invalid-extension', 'extension rejected and removed — `sections` must be an array')
  }
  if (mod.routes !== undefined && !Array.isArray(mod.routes)) {
    await rm(target, { force: true })
    throw refuse('invalid-extension', 'extension rejected and removed — `routes` must be an array')
  }

  return {
    ok: true,
    file: name,
    id: mod.id ?? name.replace(/\.js$/, ''),
    sections: mod.sections?.length ?? 0,
    routes: mod.routes?.length ?? 0,
    tools: mod.tools?.length ?? 0,
    enabled: !name.startsWith('_'),
    note: name.startsWith('_')
      ? 'Filename starts with "_", so the loader skips it — rename to enable.'
      : 'The extension is live from the next request.',
  }
}

// ── operations ────────────────────────────────────────────────────────────

async function runBooks(payload) {
  const root = resolveRoot()
  switch (payload.action || 'list') {
    case 'list':
      return { ok: true, root, books: await listBooks(root) }
    case 'create': {
      // `meta` carries the optional book.yaml fields; `title` is stated
      // separately because it is what the directory id derives from.
      const input = { ...(payload.meta || {}) }
      if (payload.title !== undefined) input.title = payload.title
      if (!input.title) throw refuse('missing-argument', '"title" is required to create a book')
      const book = await createBook(root, input)
      return { ok: true, root, book }
    }
    case 'get': {
      const { book, dir } = await openBook(payload)
      return { ok: true, book, dir, counts: await bookCounts(dir) }
    }
    case 'update': {
      const id = need(payload.book, 'book')
      const patch = payload.patch || payload.meta
      if (!patch || typeof patch !== 'object') throw refuse('missing-argument', '"patch" object is required')
      return { ok: true, book: await updateBook(root, id, patch) }
    }
    case 'delete': {
      const id = need(payload.book, 'book')
      return { ok: true, ...(await deleteBook(root, id)) }
    }
    default:
      throw refuse('unknown-action', `books: unknown action "${payload.action}"`)
  }
}

async function runRecords(payload) {
  if ((payload.action || 'list') === 'schema') {
    const schema = await getSchema()
    return {
      ok: true,
      sections: schema.sections.map((s) => ({
        key: s.key,
        zh: s.zh,
        en: s.en,
        kind: s.kind,
        ...(s.kind === 'groups' ? { groups: (s.groups || []).map((g) => ({ key: g.key, zh: g.zh, kind: g.kind })) } : {}),
      })),
      extensions: schema.extensions,
    }
  }

  const { book, dir } = await openBook(payload)
  const { unit, section, group } = await resolveUnit(need(payload.section, 'section'), payload.group)
  const action = payload.action || 'list'

  if (action === 'list') {
    const { items, extra } = await listUnit(dir, unit)
    return {
      ok: true,
      book: book.id,
      section: section.key,
      group,
      kind: unit.kind,
      titleField: unit.titleField ?? 'name',
      fields: unit.fields || inferFields(items),
      count: items.length,
      items,
      ...(extra || {}),
    }
  }

  if (action === 'read') {
    const got = await readUnit(dir, unit, need(payload.entry ?? payload.entryId ?? payload.entry_id, 'entry'))
    return {
      ok: true,
      book: book.id,
      section: section.key,
      group,
      kind: unit.kind,
      fields: unit.fields || inferFields([got.data]),
      id: got.id,
      data: got.data,
      meta: got.meta,
      ...(got.items ? { items: got.items, extra: got.extra } : {}),
    }
  }

  if (action === 'write') {
    const data = payload.data
    if (!data || typeof data !== 'object') throw refuse('missing-argument', '"data" object is required')
    const flat = unit.kind === 'records' || unit.kind === 'chapters'
    let id = payload.entry ?? payload.entryId
    if (flat) {
      const existing = new Set((await listUnit(dir, unit)).items.map((x) => x.id))
      let created = false
      if (id === undefined || id === null || id === '') {
        const base = data.id ? String(data.id) : idForNew(unit, data) || 'item'
        id = base
        for (let n = 2; existing.has(id); n += 1) id = `${base}-${n}`
        created = true
      }
      const saved = await writeUnit(dir, unit, String(id), data)
      return {
        ok: true,
        book: book.id,
        section: section.key,
        group,
        id: saved.id,
        created: created || !existing.has(String(id)),
        data: saved.data,
      }
    }
    const saved = await writeUnit(dir, unit, id === undefined ? 'new' : String(id), data)
    const index = saved.items ? saved.items.length - 1 : undefined
    return {
      ok: true,
      book: book.id,
      section: section.key,
      group,
      id: id === undefined ? index : id,
      count: saved.items?.length,
      items: saved.items,
    }
  }

  if (action === 'delete') {
    const gone = await deleteUnit(dir, unit, need(payload.entry ?? payload.entryId ?? payload.entry_id, 'entry'))
    return { ok: true, book: book.id, section: section.key, group, ...gone }
  }

  throw refuse('unknown-action', `records: unknown action "${action}"`)
}

async function runExtensions(payload) {
  switch (payload.action || 'list') {
    case 'list':
      return { ok: true, dir: EXT_DIR, extensions: await listExtensions() }
    case 'scaffold':
      return { ok: true, name: payload.name || `${payload.id || payload.sectionKey || 'my-section'}.js`, source: scaffoldSource(payload) }
    case 'write':
      return await writeExtension(payload)
    case 'delete': {
      const name = String(need(payload.name, 'name'))
      if (!EXT_NAME.test(name)) throw refuse('bad-name', 'name must look like "my-section.js"')
      await rm(join(EXT_DIR, name), { force: true })
      return { ok: true, file: name, note: 'Removed; the schema drops it on the next request.' }
    }
    default:
      throw refuse('unknown-action', `extensions: unknown action "${payload.action}"`)
  }
}

async function run(operation, payload) {
  switch (operation) {
    case 'guide':
      return { ok: true, topic: payload.topic || 'overview', text: GUIDE[payload.topic] || GUIDE.overview, topics: Object.keys(GUIDE) }
    case 'schema': {
      const schema = await getSchema()
      return { ok: true, sections: schema.sections, extensions: schema.extensions }
    }
    case 'books':
      return await runBooks(payload)
    case 'records':
      return await runRecords(payload)
    case 'extensions':
      return await runExtensions(payload)

    case 'graph': {
      const { dir, book } = await openBook(payload)
      const kinds = await graphKinds()
      // No `kinds` filter means "the whole web"; asking for none returns the menu.
      if (payload.kinds === 'list') {
        return { ok: true, kinds: kinds.map((k) => ({ key: k.key, zh: k.zh, en: k.en })) }
      }
      const wanted = Array.isArray(payload.kinds) ? payload.kinds.map(String) : []
      const unknown = wanted.filter((k) => !kinds.some((x) => x.key === k))
      if (unknown.length) throw refuse('unknown-kind', `unknown graph kind: ${unknown.join(', ')}`)
      const graph = await buildGraph(dir, { kinds: wanted })
      return { ok: true, book: book.id, ...graph }
    }

    case 'edges': {
      const { dir, book } = await openBook(payload)
      const action = payload.action || 'create'
      // A derived edge is edited through the record it comes from, so the reply
      // names the field that moved — that is what "synchronised to every
      // section" means in practice.
      if (action === 'create') return { ok: true, book: book.id, ...(await createEdge(dir, payload)) }
      if (action === 'update') return { ok: true, book: book.id, ...(await updateEdge(dir, payload)) }
      if (action === 'delete') return { ok: true, book: book.id, ...(await deleteEdge(dir, payload)) }
      throw refuse('unknown-action', `unknown edges action "${action}"`)
    }

    case 'validate': {
      const { dir, book } = await openBook(payload)
      if (payload.rules === 'list') return { ok: true, rules: await ruleList() }
      const report = await validateBook(dir, book)
      return { ok: true, book: book.id, ...report }
    }

    case 'export': {
      const { dir, book } = await openBook(payload)
      const rendered = await exportBook(dir, book, {
        format: payload.format || 'md',
        filename: payload.filename,
        lang: payload.lang,
      })
      // The text is the point of `export`; publish writes it to disk instead.
      return { ok: true, book: book.id, ...rendered }
    }

    case 'publish': {
      const action = payload.action || 'write'
      if (action === 'formats') return { ok: true, formats: await formatMenu() }

      const { dir, book } = await openBook(payload)
      if (action === 'list') {
        const { artifacts, path } = await listArtifacts(dir)
        return { ok: true, book: book.id, path, artifacts }
      }
      if (action === 'write') {
        const artifact = await publishBook(dir, book, {
          format: payload.format || 'md',
          filename: payload.filename,
          lang: payload.lang,
        })
        return { ok: true, book: book.id, dir: publishPath(dir), ...artifact }
      }
      if (action === 'delete') {
        const removed = await deleteArtifact(dir, need(payload.name, 'name'))
        return { ok: true, book: book.id, ...removed }
      }
      throw refuse('unknown-action', `unknown publish action "${action}"`)
    }

    case 'path': {
      const { dir } = await openBook(payload)
      const { unit, group } = await resolveUnit(need(payload.section, 'section'), payload.group)
      const base = unit.kind === 'doc' || unit.kind === 'raw' ? join(dir, unit.path) :
        unit.kind === 'records' ? join(dir, unit.dir) :
          unit.kind === 'chapters' ? join(dir, unit.dir) : join(dir, unit.dir)
      return { ok: true, group, kind: unit.kind, path: base }
    }

    case 'search': {
      const { dir, book } = await openBook(payload)
      const found = await searchBook(dir, need(payload.q ?? payload.query, 'q'), {
        limit: payload.limit,
        section: payload.section,
      })
      return { ok: true, book: book.id, ...found }
    }

    case 'chapters': {
      const { dir, book } = await openBook(payload)
      const action = payload.action || 'plan'
      if (action === 'plan') return { ok: true, book: book.id, ...(await chapterPlan(dir)) }
      if (action === 'reorder') return { ok: true, book: book.id, ...(await reorderChapters(dir, payload.ids)) }
      if (action === 'renumber') {
        const report = await renumberChapters(dir, {
          style: payload.style,
          start: payload.start,
          dryRun: payload.dryRun === true,
        })
        return { ok: true, book: book.id, ...report }
      }
      throw refuse('unknown-action', `chapters: unknown action "${action}"`)
    }

    case 'drafts': {
      const { dir, book } = await openBook(payload)
      const action = payload.action || 'list'
      if (action === 'list') return { ok: true, book: book.id, ...(await listDrafts(dir)) }
      if (action === 'read') return { ok: true, book: book.id, ...(await readDraft(dir, need(payload.name, 'name'))) }
      if (action === 'save') {
        if (!payload.chapter && !payload.name && !payload.body) {
          throw refuse('missing-argument', '"chapter" (and optionally "body"/"note") is required to take a snapshot')
        }
        return { ok: true, book: book.id, ...(await saveDraft(dir, payload.chapter ?? payload.name, payload)) }
      }
      if (action === 'restore') {
        const report = await restoreDraft(dir, need(payload.name, 'name'), { force: payload.force === true })
        return { ok: true, book: book.id, ...report }
      }
      if (action === 'delete') return { ok: true, book: book.id, ...(await deleteDraft(dir, need(payload.name, 'name'))) }
      throw refuse('unknown-action', `drafts: unknown action "${action}"`)
    }

    case 'progress': {
      const { dir, book } = await openBook(payload)
      const action = payload.action || 'get'
      if (action === 'set') {
        await setGoal(dir, payload)
        return { ok: true, book: book.id, ...(await progressFor(dir)) }
      }
      if (action === 'get') return { ok: true, book: book.id, ...(await progressFor(dir)) }
      throw refuse('unknown-action', `progress: unknown action "${action}"`)
    }

    case 'settings': {
      const { dir, book } = await openBook(payload)
      if ((payload.action || 'get') === 'set') {
        const patch = payload.patch ?? payload.settings
        if (!patch || typeof patch !== 'object') throw refuse('missing-argument', '"patch" object is required')
        return { ok: true, book: book.id, settings: await updateSettings(dir, patch), defaults: SETTING_DEFAULTS }
      }
      return { ok: true, book: book.id, settings: await readSettings(dir), defaults: SETTING_DEFAULTS }
    }

    // Where the whole library lives — the one setting that is not per book.
    // `get` also says *why* it is there (env / saved / default), and `set` with
    // `move: true` takes the existing books along to the new folder.
    case 'root': {
      const action = payload.action || 'get'
      if (action === 'get') return { ok: true, ...rootInfo() }
      if (action === 'set') {
        if (rootInfo().locked) throw refuse('root-locked', '位置由环境变量 DSH_NOVEL_ROOT 指定，面板改不了')
        const value = payload.root ?? payload.path
        if (typeof value !== 'string' || !value.trim()) throw refuse('missing-argument', '"root" is required')
        const from = resolveRoot()
        const info = await writeRoot(value)
        const move = payload.move === true ? await moveRoot(from, info.root) : null
        return { ok: true, ...info, move }
      }
      if (action === 'reset') return { ok: true, ...(await writeRoot(null)) }
      throw refuse('unknown-action', `root: unknown action "${action}"`)
    }

    // How much this book has spent. Written by every AI round the host runs, so
    // it is readable without the panel and identical to what the panel shows.
    case 'usage': {
      const { dir, book } = await openBook(payload)
      const action = payload.action || 'get'
      if (action === 'reset') return { ok: true, book: book.id, usage: await resetUsage(dir) }
      if (action === 'get') return { ok: true, book: book.id, usage: await readUsage(dir) }
      throw refuse('unknown-action', `usage: unknown action "${action}"`)
    }

    // Read a passage and file what is new in it. `recognize` proposes — one
    // model call, billed to this book's ledger exactly like any other round —
    // and `apply` writes back only the entries that were kept.
    case 'extract': {
      const { dir, book } = await openBook(payload)
      const action = payload.action || 'recognize'
      if (action === 'apply') {
        const report = await applyExtract({ bookDir: dir, entries: payload.entries })
        return { ok: true, book: book.id, ...report }
      }
      if (action === 'recognize') {
        const services = getServices()
        const result = await recognizeExtract({
          llm: services.llm,
          selection: services.selection,
          bookDir: dir,
          book,
          chapter: payload.chapter,
          passage: payload.passage ?? payload.text,
        })
        return { ok: true, book: book.id, route: result.route, usage: result.usage, plan: result.plan }
      }
      throw refuse('unknown-action', `extract: unknown action "${action}"`)
    }

    // Two-step by default: without `dryRun:false` an import only reports what it
    // would write, so a whole-manuscript paste cannot overwrite chapters by accident.
    case 'import': {
      const { dir, book } = await openBook(payload)
      const action = payload.action || 'backup'
      if (action === 'list') return { ok: true, book: book.id, ...(await importableFiles(dir)) }
      if (action === 'backup') {
        const text = need(payload.text, 'text')
        if (payload.describe === true) return { ok: true, book: book.id, ...(await describeBackup(text)) }
        const report = await importBackup(dir, text, {
          mode: payload.mode,
          dryRun: payload.dryRun !== false,
          sections: payload.sections,
        })
        return { ok: true, book: book.id, ...report }
      }
      if (action === 'markdown') {
        const text = need(payload.text, 'text')
        const report = await importMarkdown(dir, text, {
          mode: payload.mode,
          start: payload.start,
          style: payload.style,
          dryRun: payload.dryRun !== false,
          confirm: payload.confirm === true,
          skipTitle: payload.skipTitle,
        })
        return { ok: true, book: book.id, ...report }
      }
      throw refuse('unknown-action', `import: unknown action "${action}"`)
    }
    default:
      throw refuse('unknown-operation', `unknown operation "${operation}"`)
  }
}

/** Never throws: refusals become `{ ok:false, code, message }`. */
export async function invoke(operation, payload = {}) {
  try {
    return await run(operation, payload)
  } catch (err) {
    return {
      ok: false,
      code: err?.code || 'error',
      message: String(err?.message || err),
    }
  }
}

export { GUIDE }

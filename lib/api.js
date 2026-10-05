// dsh-novel-studio — HTTP dispatcher.
//
// Owns routing only; the HTTP carrier (prefix stripping, reloading) lives in
// index.js. This module is imported with an mtime-based cache-busting query, so
// an edit here or in any reloadable module takes effect on the next request
// instead of requiring a DSH restart.
//
// Route map (all under BASE):
//   GET    /ping
//   GET    /bootstrap
//   GET    /schema                       resolved section tree + extension report
//   GET    /root                         where the library lives (and why)
//   POST   /root                         { root, move? } change it; { reset: true } back to default
//   GET    /folders                      ?path=  browse folders (the library-location picker)
//   GET    /websites                     saved website shortcuts (publishing backends)
//   POST   /websites                     { items: [...] } replace the whole list
//   GET    /shared                       the cross-book shared library: units + entries
//   GET    /shared/impact?key=           which books reference one shared entry
//   GET    /shared/links?book=           this book's shared references (stale/drift/pin)
//   POST   /shared/promote               { book, unit, id, status? } publish into the store
//   POST   /shared/import                { book, unit, id, mode: link|fork } bring it in
//   POST   /shared/sync                  { book, unit, id } pull the source over the copy
//   POST   /shared/pin                   { book, unit, id, pin } lock a link against updates
//   GET    /library
//   POST   /library
//   GET    /library/:book
//   PATCH  /library/:book   PUT /library/:book
//   DELETE /library/:book            into the recycle bin (renamed, not destroyed)
//   GET    /trash                    the recycle bin: deleted books, newest first
//   DELETE /trash/:entry             remove one for good
//   POST   /trash/:entry/restore     put one back on the shelf
//   GET    /library/:book/unit/:section[/:group]
//   POST   /library/:book/unit/:section[/:group]
//   GET    /library/:book/unit/:section[/:group]/:id
//   PUT    /library/:book/unit/:section[/:group]/:id
//   DELETE /library/:book/unit/:section[/:group]/:id
//   GET    /library/:book/graph          ?kinds=a,b  relationship web
//   POST   /library/:book/graph/edges    { action: create|update|delete, ... }
//   GET    /library/:book/validate       consistency report
//   GET    /library/:book/model          this book's model route + catalogue
//   POST   /library/:book/model          { provider, model, reasoningEffort? } or { clear: true }
//   GET    /library/:book/efforts        ?provider=&model=  thinking levels for a model
//   GET    /library/:book/usage          this book's cumulative token ledger
//   POST   /library/:book/usage          { reset: true } zero the ledger
//   GET    /library/:book/ai/tasks       the AI task menu
//   GET    /library/:book/ai/context     what the model would be shown
//   POST   /library/:book/ai             { task, ... } → SSE token stream
//   GET    /library/:book/export         ?format=md  render, write nothing
//   GET    /library/:book/export/formats list the export targets
//   GET    /library/:book/publish        artifacts already in publish/
//   POST   /library/:book/publish        { format } render and write one
//   DELETE /library/:book/publish/:name  remove one artifact
//   GET    /library/:book/search         ?q=… where a word/name appears at all
//   GET    /library/:book/chapters       reading order, numbering style, gaps
//   POST   /library/:book/chapters/reorder    { ids: [...] }
//   POST   /library/:book/chapters/renumber   { start, style, width, dryRun }
//   GET    /library/:book/drafts         the snapshot box, newest first
//   POST   /library/:book/drafts         { chapter, body?, note? }
//   POST   /library/:book/drafts/restore { name, force? }
//   DELETE /library/:book/drafts/:name   drop one snapshot
//   GET    /library/:book/progress       goal, totals, 30-day history, pace
//   POST   /library/:book/progress       { words, deadline }
//   GET    /library/:book/settings       per-book preferences
//   POST   /library/:book/settings       { theme, autosave, fontSize, wordGoal }
//   GET    /library/:book/import         files already in the book that qualify
//   POST   /library/:book/import         { kind:'backup'|'markdown'|'file', … }
//   POST   /library/:book/extract        { chapter?, passage } → what is new in it
//   POST   /library/:book/extract/apply  { entries: [...] } file the kept ones
//   *      /ext/...                      routes contributed by lib/extensions/*.js

// The reload token threads through every reloadable module so that editing any
// one of them re-imports the whole set instead of leaving a stale sibling cached.
const V = new URL(import.meta.url).searchParams.get('v') ?? '0'

const { getSchema, STAGE } = await import(`./schema.js?v=${V}`)
const { buildGraph, graphKinds } = await import(`./graph.js?v=${V}`)
const { createEdge, deleteEdge, updateEdge } = await import(`./edges.js?v=${V}`)
const { ruleList, validateBook } = await import(`./validate.js?v=${V}`)
const {
  deleteArtifact,
  exportBook,
  formatMenu,
  listArtifacts,
  publishBook,
  publishPath,
} = await import(`./export.js?v=${V}`)
const {
  bookCounts,
  createBook,
  deleteBook,
  listBooks,
  listFolders,
  listTrash,
  listWebsites,
  purgeTrash,
  readBook,
  readSettings,
  moveRoot,
  resolveRoot,
  restoreTrash,
  rootInfo,
  saveWebsites,
  SETTING_DEFAULTS,
  updateBook,
  updateSettings,
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
  bookLinks: sharedLinks,
  importToBook: importShared,
  impact: sharedImpact,
  listShared,
  promote: promoteShared,
  setPin: setSharedPin,
  sync: syncShared,
} = await import(`./shared.js?v=${V}`)
const { chapterPlan, deleteDraft, listDrafts, readDraft, renumberChapters, reorderChapters, restoreDraft, saveDraft } = await import(`./chapters.js?v=${V}`)
const { progressFor, setGoal } = await import(`./progress.js?v=${V}`)
const { BACKUP_FORMAT, MAX_IMPORT_BYTES, describeBackup, importBackup, importFile, importMarkdown, importableFiles } = await import(`./import.js?v=${V}`)
const { aiTasks, contextPreview, normalizeModel, prepareTask, streamPrepared } = await import(`./ai.js?v=${V}`)
const { applyExtract, recognizeChapters, recognizeExtract } = await import(`./extract.js?v=${V}`)
const { readUsage, resetUsage } = await import(`./usage.js?v=${V}`)

const PLUGIN_ID = 'novel-studio'

// Injected by index.js — the only file that holds a Cordis context. This is the
// same object index.js mutates, so an llm handle that appears later is visible
// here without a re-import. It stays null in a deployment with no llm service;
// the AI pane then says so instead of failing at request time.
let services = { llm: null, selection: () => null }

export function setServices(next) {
  if (next && typeof next === 'object') services = next
}

/** The live llm/selection handles — read at call time so a later wiring shows
 *  up without a re-import. lib/tools.js reads this for the `novel_ai` tool. */
export function getServices() {
  return services
}

export function json(res, body, status = 200) {
  const buf = Buffer.from(JSON.stringify(body), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': buf.length,
    'cache-control': 'no-store',
  })
  res.end(buf)
}

export function fail(res, err) {
  const status = (err && err.status) || 500
  if (status >= 500) console.error(`[${PLUGIN_ID}]`, err)
  // Keep the machine-readable code when the writer supplied one: a refused edit
  // ("duplicate-edge", "locked-field-link") is a 400 the panel wants to explain,
  // not an anonymous server error.
  const code = err && err.code
  return json(res, { ok: false, error: String((err && err.message) || err), ...(code ? { code } : {}) }, status)
}

/** Parse a JSON request body. Capped — these are book records, not uploads. */
export async function readJsonBody(req, limit = 512 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) {
      const err = new Error('request body too large')
      err.status = 413
      throw err
    }
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    const err = new Error('invalid JSON body')
    err.status = 400
    throw err
  }
}

/** Query string of the current request, as a URLSearchParams. */
function queryParams(req) {
  try {
    return new URL(req.url ?? '/', 'http://localhost').searchParams
  } catch {
    return new URLSearchParams()
  }
}

// The thinking-strength menu for one model, read from the same call the
// harness's own model picker uses (`llm.resolveModelInfo`), so the panel offers
// exactly the levels this deployment supports — an effort id belongs to one
// model, and inventing one would be a guess the provider then refuses.
//
// Cached for a minute: opening the model panel again should not repeat the
// lookup, but picking another model must re-ask. A host without the call, or a
// model it cannot describe, degrades to an empty menu — the select then simply
// is not offered, which is better than an error in the middle of a form.
const EFFORT_TTL = 60 * 1000
const effortCache = new Map()

async function readEfforts(llm, provider, model) {
  if (!llm || typeof llm.resolveModelInfo !== 'function' || !provider || !model) {
    return { efforts: [], defaultEffort: '' }
  }
  const key = `${provider}/${model}`
  const hit = effortCache.get(key)
  if (hit && Date.now() - hit.at < EFFORT_TTL) return hit.value

  let value = { efforts: [], defaultEffort: '' }
  try {
    const info = await llm.resolveModelInfo(provider, model)
    const reasoning = info?.reasoning || null
    const list = Array.isArray(reasoning?.efforts) ? reasoning.efforts : []
    value = {
      efforts: list
        .map((e) => {
          if (typeof e === 'string') return { id: e, name: e }
          if (!e || typeof e !== 'object' || e.id === undefined) return null
          const entry = { id: String(e.id), name: String(e.name || e.id) }
          if (e.description) entry.description = String(e.description)
          return entry
        })
        .filter((e) => e && e.id),
      defaultEffort: reasoning?.defaultEffort === undefined ? '' : String(reasoning.defaultEffort),
    }
  } catch {
    /* a model this host cannot describe offers no menu */
  }
  effortCache.set(key, { at: Date.now(), value })
  return value
}

// ── extension route matching ──────────────────────────────────────────────

/** Match "/ext/foo/:id" against ["ext","foo","42"] → { id: "42" } or null. */
function matchPattern(pattern, segments) {
  const want = pattern.split('/').filter(Boolean)
  if (want.length !== segments.length) return null
  const params = {}
  for (let i = 0; i < want.length; i += 1) {
    const w = want[i]
    if (w.startsWith(':')) {
      params[w.slice(1)] = segments[i]
    } else if (w !== segments[i]) {
      return null
    }
  }
  return params
}

/** Path params for a unit route: segments after the section/group pair. */
function unitIdFrom(segments, startIndex) {
  const rest = segments.slice(startIndex)
  if (!rest.length) return { id: undefined }
  return { id: rest.join('/') }
}

// ── dispatcher ────────────────────────────────────────────────────────────

/**
 * @param req  node IncomingMessage
 * @param res  node ServerResponse
 * @param route { method: string, rest: string } — path with the plugin prefix already stripped
 */
export async function dispatch(req, res, route) {
  const { method, rest } = route
  let segments
  try {
    segments = rest.split('/').filter(Boolean).map(decodeURIComponent)
  } catch {
    return json(res, { ok: false, error: 'malformed path encoding' }, 400)
  }

  try {
    const schema = await getSchema()

    // ── carrier probes ─────────────────────────────────────────────────
    if (method === 'GET' && segments.length === 1 && segments[0] === 'ping') {
      return json(res, { ok: true, plugin: PLUGIN_ID, stage: STAGE, half: 'host', time: new Date().toISOString() })
    }

    const root = resolveRoot()

    if (method === 'GET' && segments.length === 1 && segments[0] === 'bootstrap') {
      return json(res, {
        ok: true,
        plugin: PLUGIN_ID,
        stage: STAGE,
        root,
        rootInfo: rootInfo(),
        books: await listBooks(root),
        sections: schema.sections.map((s) => ({ key: s.key, zh: s.zh, en: s.en })),
        settings: SETTING_DEFAULTS,
      })
    }

    // /root — where the library lives, and how to move it.
    //   GET  /root → { root, source, locked, envRoot, configuredRoot, defaultRoot, configPath }
    //   POST /root { root, move? } → save a location (and optionally take the books along)
    //
    // The environment variable wins over anything saved here, so a deployment can
    // pin the library; when it is set the panel is told the field is locked
    // instead of silently ignoring what the writer typed.
    if (segments.length === 1 && segments[0] === 'root') {
      if (method === 'GET') return json(res, { ok: true, ...rootInfo() })
      if (method !== 'POST') return json(res, { ok: false, error: 'method-not-allowed', method }, 405)
      const body = (await readJsonBody(req)) || {}
      try {
        if (body.reset === true) return json(res, { ok: true, ...(await writeRoot(null)) })
        if (rootInfo().locked) {
          return json(res, { ok: false, error: '位置由环境变量 DSH_NOVEL_ROOT 指定，面板改不了', code: 'root-locked' }, 409)
        }
        if (typeof body.root !== 'string' || !body.root.trim()) {
          return json(res, { ok: false, error: 'missing-argument', code: 'missing-argument' }, 400)
        }
        const from = root
        const info = await writeRoot(body.root)
        const move = body.move === true
          ? await moveRoot(from, info.root)
          : { moved: [], skipped: [], from, to: info.root }
        return json(res, { ok: true, ...info, move })
      } catch (err) {
        return fail(res, err)
      }
    }

    // /folders?path= — the folder browser behind the library-location field.
    //   GET   the drives (no path) or the sub-folders of one folder
    //
    // A browser cannot hand a native path back to the host, so the panel walks
    // the filesystem through this instead of an `<input type="file">`. It only
    // reads: nothing here creates, moves or writes anything.
    if (segments.length === 1 && segments[0] === 'folders') {
      if (method !== 'GET') return json(res, { ok: false, error: 'method-not-allowed', method }, 405)
      try {
        return json(res, { ok: true, ...(await listFolders(queryParams(req).get('path'))) })
      } catch (err) {
        return fail(res, err)
      }
    }

    // /websites — the panel's saved website shortcuts: a writer's publishing
    // backends across platforms, shown in the empty pane as one-click links.
    // Stored beside `root` in the config file, so they outlive a browser-data
    // clear; the panel always sends the whole list (it is small), which keeps
    // one save from racing a partial copy of its own.
    //   GET    → { ok, items: [{ name, url }] }
    //   POST   { items } → validate and replace the list
    if (segments[0] === 'websites') {
      if (segments.length !== 1) return json(res, { ok: false, error: 'not-found', route: rest }, 404)
      if (method === 'GET') return json(res, { ok: true, items: await listWebsites() })
      if (method !== 'POST') return json(res, { ok: false, error: 'method-not-allowed', method }, 405)
      try {
        const body = (await readJsonBody(req)) || {}
        return json(res, { ok: true, items: await saveWebsites(body.items) })
      } catch (err) {
        return fail(res, err)
      }
    }

    // /shared — the cross-book shared library. Books keep their own records
    // untouched; this store lives beside them at `<root>/.novel-shared/` and
    // only ever gains or copies files the writer asked for. 引入 (link) stays
    // in sync with the source and may be locked; 派生 (fork) is a private
    // copy; 提升 (promote) publishes one of this book's own entries after the
    // panel has shown who an overwrite would affect.
    //   GET    /shared              → { ok, root, units, entries }
    //   GET    /shared/impact?key=  → { ok, key, books: [{ id, title, mode }] }
    //   GET    /shared/links?book=  → { ok, links: [...] } with stale/drift/pin
    //   POST   /shared/promote      { book, unit, id, status }
    //   POST   /shared/import       { book, unit, id, mode: 'link'|'fork' }
    //   POST   /shared/sync         { book, unit, id }
    //   POST   /shared/pin          { book, unit, id, pin }
    if (segments[0] === 'shared') {
      if (method === 'GET' && segments.length === 1) {
        try {
          return json(res, { ok: true, ...(await listShared(root)) })
        } catch (err) {
          return fail(res, err)
        }
      }
      if (method === 'GET' && segments.length === 2 && segments[1] === 'impact') {
        try {
          return json(res, { ok: true, ...(await sharedImpact(root, queryParams(req).get('key') ?? '')) })
        } catch (err) {
          return fail(res, err)
        }
      }
      if (method === 'GET' && segments.length === 2 && segments[1] === 'links') {
        try {
          const book = await readBook(root, queryParams(req).get('book') ?? '')
          return json(res, { ok: true, ...(await sharedLinks(root, book.dir)) })
        } catch (err) {
          return fail(res, err)
        }
      }
      if (method === 'POST' && segments.length === 2 && segments[1] === 'promote') {
        try {
          const body = (await readJsonBody(req)) || {}
          const book = await readBook(root, body.book)
          return json(res, { ok: true, ...(await promoteShared(root, book.dir, book.id ?? body.book, body.unit, body.id, body.status)) })
        } catch (err) {
          return fail(res, err)
        }
      }
      if (method === 'POST' && segments.length === 2 && segments[1] === 'import') {
        try {
          const body = (await readJsonBody(req)) || {}
          const book = await readBook(root, body.book)
          return json(res, { ok: true, ...(await importShared(root, book.dir, body.unit, body.id, body.mode)) })
        } catch (err) {
          return fail(res, err)
        }
      }
      if (method === 'POST' && segments.length === 2 && segments[1] === 'sync') {
        try {
          const body = (await readJsonBody(req)) || {}
          const book = await readBook(root, body.book)
          return json(res, { ok: true, ...(await syncShared(root, book.dir, body.unit, body.id)) })
        } catch (err) {
          return fail(res, err)
        }
      }
      if (method === 'POST' && segments.length === 2 && segments[1] === 'pin') {
        try {
          const body = (await readJsonBody(req)) || {}
          const book = await readBook(root, body.book)
          return json(res, { ok: true, ...(await setSharedPin(book.dir, body.unit, body.id, body.pin)) })
        } catch (err) {
          return fail(res, err)
        }
      }
      if (segments.length === 1) return json(res, { ok: false, error: 'method-not-allowed', method }, 405)
      return json(res, { ok: false, error: 'not-found', route: rest }, 404)
    }

    if (method === 'GET' && segments.length === 1 && segments[0] === 'schema') {
      return json(res, {
        ok: true,
        sections: schema.sections,
        extensions: schema.extensions,
      })
    }

    // /trash — the recycle bin. Deleting a book renames it into `<root>/.trash`;
    // this is where it waits until someone restores it or purges it. The bin
    // lives at the top level on purpose: `trash` may well be a book's own id, and
    // a book route must never be shadowed by a feature name.
    //   GET    the entries, newest deletion first
    //   DELETE /trash/:entry            destroy one for good
    //   POST   /trash/:entry/restore    put one back on the shelf
    if (segments[0] === 'trash') {
      if (segments.length === 1 && method === 'GET') {
        return json(res, { ok: true, entries: await listTrash(root) })
      }
      if (segments.length === 2 && method === 'DELETE') {
        return json(res, { ok: true, ...(await purgeTrash(root, segments[1])) })
      }
      if (segments.length === 3 && method === 'POST' && segments[2] === 'restore') {
        return json(res, { ok: true, ...(await restoreTrash(root, segments[1])) })
      }
      return json(res, { ok: false, error: 'not-found', route: rest }, 404)
    }

    // ── extension routes ───────────────────────────────────────────────
    if (segments[0] === 'ext' && schema.extraRoutes.length) {
      const helpers = {
        json,
        fail,
        readJsonBody,
        resolveRoot,
        listBooks,
        readBook,
        getSchema,
        listUnit,
        readUnit,
        writeUnit,
        deleteUnit,
        inferFields,
        bookDirOf: async (id) => (await readBook(root, id)).dir,
      }
      for (const r of schema.extraRoutes) {
        if (r.method !== method) continue
        const params = matchPattern(r.pattern, segments)
        if (!params) continue
        return await r.handler(req, res, { ...helpers, params, segments })
      }
    }

    // ── library ────────────────────────────────────────────────────────
    if (segments[0] !== 'library') {
      return json(res, { ok: false, error: 'not-found', method, route: rest }, 404)
    }

    if (segments.length === 1) {
      if (method === 'GET') return json(res, { ok: true, root, books: await listBooks(root) })
      if (method === 'POST') {
        const book = await createBook(root, await readJsonBody(req))
        return json(res, { ok: true, book }, 201)
      }
      return json(res, { ok: false, error: 'method-not-allowed', method }, 405)
    }

    const id = segments[1]

    // /library/:book/graph[?kinds=a,b] — the relationship web. No `kinds` means
    // every kind; `/graph/kinds` returns the menu of kinds that exist.
    if (segments[2] === 'graph') {
      // /library/:book/graph/edges — the write side of the graph. A relation may
      // live in relationships.yaml or in a field on a record, and the writer
      // picks the right home; either way every panel reads the same files after.
      if (segments.length === 4 && segments[3] === 'edges') {
        if (method !== 'POST') return json(res, { ok: false, error: 'method-not-allowed', method }, 405)
        const body = (await readJsonBody(req)) || {}
        const action = body.action || 'create'
        const write = action === 'create'
          ? createEdge
          : action === 'update'
            ? updateEdge
            : action === 'delete'
              ? deleteEdge
              : null
        if (!write) return json(res, { ok: false, error: 'unknown-action', action }, 400)
        const dir = (await readBook(root, id)).dir
        return json(res, { ok: true, book: id, ...(await write(dir, body)) }, action === 'create' ? 201 : 200)
      }
      if (method !== 'GET') return json(res, { ok: false, error: 'method-not-allowed', method }, 405)
      const dir = (await readBook(root, id)).dir
      const kinds = await graphKinds()
      const menu = kinds.map((k) => ({ key: k.key, zh: k.zh, en: k.en }))
      if (segments.length === 4 && segments[3] === 'kinds') return json(res, { ok: true, kinds: menu })
      if (segments.length > 3) return json(res, { ok: false, error: 'not-found', route: rest }, 404)
      let wanted = []
      try {
        const q = new URL(req.url ?? '/', 'http://localhost').searchParams.get('kinds')
        if (q) wanted = q.split(',').map((s) => s.trim()).filter(Boolean)
      } catch {
        /* keep the default */
      }
      const unknown = wanted.filter((k) => !kinds.some((x) => x.key === k))
      if (unknown.length) return json(res, { ok: false, error: 'unknown-kind', unknown, kinds: menu }, 400)
      const graph = await buildGraph(dir, { kinds: wanted })
      return json(res, { ok: true, book: id, kinds: menu, ...graph })
    }

    // /library/:book/validate — read-only consistency report.
    if (segments[2] === 'validate') {
      if (method !== 'GET') return json(res, { ok: false, error: 'method-not-allowed', method }, 405)
      if (segments.length === 4 && segments[3] === 'rules') return json(res, { ok: true, rules: await ruleList() })
      if (segments.length > 3) return json(res, { ok: false, error: 'not-found', route: rest }, 404)
      const book = await readBook(root, id)
      return json(res, { ok: true, book: id, ...(await validateBook(book.dir, book)) })
    }

    // /library/:book/export[?format=md] — render the book, write nothing.
    // `/export/formats` lists the targets (built-ins plus extension ones).
    if (segments[2] === 'export') {
      if (method !== 'GET') return json(res, { ok: false, error: 'method-not-allowed', method }, 405)
      if (segments.length === 4 && segments[3] === 'formats') {
        return json(res, { ok: true, formats: await formatMenu() })
      }
      if (segments.length > 3) return json(res, { ok: false, error: 'not-found', route: rest }, 404)
      let format = 'md'
      let lang
      try {
        const q = new URL(req.url ?? '/', 'http://localhost').searchParams
        format = q.get('format') || 'md'
        lang = q.get('lang') || undefined
      } catch {
        /* keep the default */
      }
      const book = await readBook(root, id)
      const rendered = await exportBook(book.dir, book, { format, lang })
      return json(res, { ok: true, book: id, ...rendered })
    }

    // /library/:book/ai — one model call, grounded in the book's own files.
    //   GET  /ai/tasks     the task menu
    //   GET  /ai/context   what the prompt would include, counted
    //   POST /ai           { task, chapter?, text?, input?, instruction? } → SSE
    if (segments[2] === 'ai') {
      const book = await readBook(root, id)

      if (segments.length === 4 && segments[3] === 'tasks') {
        if (method !== 'GET') return json(res, { ok: false, error: 'method-not-allowed', method }, 405)
        return json(res, { ok: true, tasks: await aiTasks() })
      }

      if (segments.length === 4 && segments[3] === 'context') {
        if (method !== 'GET') return json(res, { ok: false, error: 'method-not-allowed', method }, 405)
        let query = {}
        try {
          const q = new URL(req.url ?? '/', 'http://localhost').searchParams
          query = { task: q.get('task') || undefined, chapter: q.get('chapter') || undefined }
          // ?pick=<json> narrows the preview exactly like the POST body would.
          const raw = q.get('pick')
          if (raw) {
            try {
              query.pick = JSON.parse(raw)
            } catch {
              return json(res, { ok: false, error: 'pick 参数不是合法的 JSON。', code: 'bad-pick' }, 400)
            }
          }
        } catch {
          /* keep the defaults */
        }
        return json(res, { ok: true, book: id, context: await contextPreview(book.dir, book, query) })
      }

      if (segments.length !== 3) return json(res, { ok: false, error: 'not-found', route: rest }, 404)
      if (method !== 'POST') return json(res, { ok: false, error: 'method-not-allowed', method }, 405)

      const body = (await readJsonBody(req)) || {}

      // Everything that can fail is resolved before the stream opens, so a bad
      // request still gets a JSON error the panel can show as a form message.
      // prepareTask judges the request (400) before the deployment (503).
      let prepared
      try {
        prepared = await prepareTask({
          llm: services.llm,
          selection: services.selection,
          bookDir: book.dir,
          book,
          request: body,
        })
      } catch (err) {
        return fail(res, err)
      }

      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      })

      const send = (event) => {
        if (res.writableEnded) return
        res.write(`data: ${JSON.stringify(event)}\n\n`)
      }

      // A closed tab must stop the provider call, not merely stop the writing.
      const controller = new AbortController()
      const onClose = () => controller.abort()
      req.on('close', onClose)

      try {
        for await (const event of streamPrepared({ prepared, llm: services.llm, signal: controller.signal })) {
          send(event)
        }
      } catch (err) {
        send({ type: 'error', error: String((err && err.message) || err), code: (err && err.code) || 'ai-error' })
      } finally {
        try {
          req.off('close', onClose)
        } catch {
          /* older stream object */
        }
      }
      send({ type: 'end' })
      if (!res.writableEnded) res.end()
      return undefined
    }

    // /library/:book/extract — read a passage and file what is new in it.
    //   POST /extract        { chapters: [{ id, passage }] } → one call each, then merged
    //   POST /extract        { chapter?, passage } → { plan, usage, route }
    //   POST /extract/apply  { entries: [...] }   → { written, updated, skipped }
    //
    // Two steps on purpose: the model proposes, the author keeps. Recognition
    // never touches the book, and applying only fills the fields that are still
    // empty, so a paragraph already written by hand is never replaced.
    if (segments[2] === 'extract') {
      const book = await readBook(root, id)
      if (method !== 'POST') return json(res, { ok: false, error: 'method-not-allowed', method }, 405)
      const body = (await readJsonBody(req)) || {}

      if (segments.length === 4 && segments[3] === 'apply') {
        try {
          const report = await applyExtract({ bookDir: book.dir, entries: body.entries })
          return json(res, { ok: true, book: id, ...report })
        } catch (err) {
          return fail(res, err)
        }
      }

      if (segments.length !== 3) return json(res, { ok: false, error: 'not-found', route: rest }, 404)

      let result
      try {
        // Several chapters are one call each, merged into a single review list:
        // the author chooses the scope instead of one pass over the whole book.
        result = Array.isArray(body.chapters)
          ? await recognizeChapters({
              llm: services.llm,
              selection: services.selection,
              bookDir: book.dir,
              book,
              chapters: body.chapters,
            })
          : await recognizeExtract({
              llm: services.llm,
              selection: services.selection,
              bookDir: book.dir,
              book,
              chapter: body.chapter,
              passage: body.passage ?? body.text,
            })
      } catch (err) {
        return fail(res, err)
      }
      return json(res, { ok: true, book: id, route: result.route, usage: result.usage, plan: result.plan, calls: result.calls })
    }

    // /library/:book/model — the model route this book runs on.
    //   GET                     the book's own route + the deployment default
    //   POST { provider, model } save it  |  POST { clear: true } follow the default
    //
    // Per-book and independent by design: saving here never writes into the
    // harness-wide selection, and one book's choice stays out of every other
    // book's run. The catalogue is read from the host llm service, so the panel
    // offers what this deployment can actually run.
    if (segments[2] === 'model') {
      if (segments.length !== 3) return json(res, { ok: false, error: 'not-found', route: rest }, 404)
      const svc = getServices()
      const fallback = () => normalizeModel(typeof svc.selection === 'function' ? svc.selection() : null)

      if (method === 'GET') {
        const book = await readBook(root, id)
        let catalog = { providers: [] }
        if (typeof svc.catalog === 'function') {
          try {
            catalog = (await svc.catalog()) || catalog
          } catch {
            /* a host that cannot list models still keeps the saved route */
          }
        }
        return json(res, { ok: true, book: id, model: normalizeModel(book.aiModel), fallback: fallback(), catalog })
      }

      if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
        const body = (await readJsonBody(req)) || {}
        // Two ways to say the same thing: the panel sends { clear: true }, a
        // script may send the null it just read back.
        if (body.clear === true || body.model === null) {
          await updateBook(root, id, { aiModel: null })
          return json(res, { ok: true, book: id, model: null, fallback: fallback() })
        }
        const next = normalizeModel(body.model && typeof body.model === 'object' ? body.model : body)
        if (!next) return json(res, { ok: false, error: 'provider 和 model 都不能为空。', code: 'bad-model' }, 400)
        await updateBook(root, id, { aiModel: next })
        return json(res, { ok: true, book: id, model: next, fallback: fallback() })
      }

      return json(res, { ok: false, error: 'method-not-allowed', method }, 405)
    }

    // /library/:book/efforts — the thinking levels the chosen model can run at.
    //   GET ?provider=&model=   the effort menu for that model
    //
    // With no query it describes the route the book runs on right now. The query
    // overrides matter while the writer is still choosing, before anything is
    // saved: the menu has to follow the picker, not the book.
    if (segments[2] === 'efforts') {
      if (segments.length !== 3) return json(res, { ok: false, error: 'not-found', route: rest }, 404)
      if (method !== 'GET') return json(res, { ok: false, error: 'method-not-allowed', method }, 405)
      const svc = getServices()
      const book = await readBook(root, id)
      const q = queryParams(req)
      const asked = normalizeModel({ provider: q.get('provider'), model: q.get('model') })
      const route =
        asked ||
        normalizeModel(book.aiModel) ||
        (typeof svc.selection === 'function' ? normalizeModel(svc.selection()) : null)
      if (!route) {
        return json(res, { ok: true, book: id, provider: null, model: null, efforts: [], defaultEffort: '' })
      }
      const menu = await readEfforts(svc.llm, route.provider, route.model)
      return json(res, { ok: true, book: id, provider: route.provider, model: route.model, ...menu })
    }

    // /library/:book/usage — how many tokens this book has spent in total.
    //   GET                the running ledger, all counters cumulative
    //   POST { reset: true } forget everything counted so far
    //
    // The ledger is written by every AI round the host runs (the panel, the
    // `novel_ai` tool, an extension), so it is a property of the book rather
    // than of whichever window happened to be open. A book with no ledger reads
    // as zeros instead of 404: "nothing spent yet" is a valid answer.
    if (segments[2] === 'usage') {
      if (segments.length !== 3) return json(res, { ok: false, error: 'not-found', route: rest }, 404)
      const bookDir = (await readBook(root, id)).dir

      if (method === 'GET') {
        return json(res, { ok: true, book: id, usage: await readUsage(bookDir) })
      }

      if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
        const body = (await readJsonBody(req)) || {}
        if (body.reset === true) return json(res, { ok: true, book: id, usage: await resetUsage(bookDir) })
        return json(res, { ok: false, error: 'body must be { reset: true }', code: 'bad-request' }, 400)
      }

      return json(res, { ok: false, error: 'method-not-allowed', method }, 405)
    }

    // /library/:book/search — where does this word appear at all?
    //   GET ?q=…&limit=&section=   prose, every record field, file names
    if (segments[2] === 'search') {
      if (segments.length !== 3) return json(res, { ok: false, error: 'not-found', route: rest }, 404)
      if (method !== 'GET') return json(res, { ok: false, error: 'method-not-allowed', method }, 405)
      const book = await readBook(root, id)
      const params = queryParams(req)
      const found = await searchBook(book.dir, params.get('q') ?? '', {
        limit: params.get('limit'),
        section: params.get('section'),
      })
      return json(res, { ok: true, book: id, ...found })
    }

    // /library/:book/chapters — the reading order itself.
    //   GET                        order, numbering style, gaps and duplicates
    //   POST /reorder { ids }      put the chapters in exactly this order
    //   POST /renumber { … }       reassign the numbers (dryRun supported)
    if (segments[2] === 'chapters') {
      const book = await readBook(root, id)
      if (method === 'GET' && segments.length === 3) {
        return json(res, { ok: true, book: id, ...(await chapterPlan(book.dir)) })
      }
      if (method === 'POST' && segments[3] === 'reorder') {
        const body = (await readJsonBody(req)) || {}
        return json(res, { ok: true, book: id, ...(await reorderChapters(book.dir, body.ids)) })
      }
      if (method === 'POST' && segments[3] === 'renumber') {
        const body = (await readJsonBody(req)) || {}
        return json(res, { ok: true, book: id, ...(await renumberChapters(book.dir, body)) })
      }
      return json(res, { ok: false, error: 'not-found', route: rest }, 404)
    }

    // /library/:book/drafts — snapshots taken from the chapter editor.
    //   GET                              the box, newest first
    //   GET /:name                       one snapshot's text
    //   POST { chapter, body?, note? }   take one
    //   POST /restore { name, force? }   put one back
    //   DELETE /:name                    drop one
    if (segments[2] === 'drafts') {
      const book = await readBook(root, id)
      if (method === 'GET' && segments.length === 3) {
        return json(res, { ok: true, book: id, ...(await listDrafts(book.dir)) })
      }
      if (method === 'GET' && segments.length === 4) {
        return json(res, { ok: true, book: id, ...(await readDraft(book.dir, segments[3])) })
      }
      if (method === 'POST' && segments.length === 3) {
        const body = (await readJsonBody(req)) || {}
        return json(res, { ok: true, book: id, ...(await saveDraft(book.dir, body.chapter, body)) }, 201)
      }
      if (method === 'POST' && segments[3] === 'restore') {
        const body = (await readJsonBody(req)) || {}
        return json(res, { ok: true, book: id, ...(await restoreDraft(book.dir, body.name, { force: body.force === true })) })
      }
      if (method === 'DELETE' && segments.length === 4) {
        return json(res, { ok: true, book: id, ...(await deleteDraft(book.dir, segments[3])) })
      }
      return json(res, { ok: false, error: 'not-found', route: rest }, 404)
    }

    // /library/:book/progress — how much has been written, and how fast.
    //   GET                       goal, totals, 30 days of history, pace
    //   POST { words, deadline }  set the goal
    if (segments[2] === 'progress') {
      const book = await readBook(root, id)
      if (method === 'GET') return json(res, { ok: true, book: id, ...(await progressFor(book.dir)) })
      if (method === 'POST' || method === 'PATCH') {
        const body = (await readJsonBody(req)) || {}
        await setGoal(book.dir, body)
        return json(res, { ok: true, book: id, ...(await progressFor(book.dir)) })
      }
      return json(res, { ok: false, error: 'method-not-allowed', method }, 405)
    }

    // /library/:book/settings — per-book preferences (theme, autosave, …).
    if (segments[2] === 'settings') {
      const book = await readBook(root, id)
      if (method === 'GET') {
        return json(res, { ok: true, book: id, settings: await readSettings(book.dir), defaults: SETTING_DEFAULTS })
      }
      if (method === 'POST' || method === 'PATCH') {
        const patch = (await readJsonBody(req)) || {}
        return json(res, { ok: true, book: id, settings: await updateSettings(book.dir, patch), defaults: SETTING_DEFAULTS })
      }
      return json(res, { ok: false, error: 'method-not-allowed', method }, 405)
    }

    // /library/:book/import — bringing an existing manuscript in.
    //   GET                        files already in the book that could be read
    //   POST { kind:'backup'|'markdown'|'file', text?, dir?, name?, … }
    //
    // `dryRun` defaults to TRUE: a POST previews what it would write, and the
    // panel sends dryRun:false on the second, confirmed call.
    if (segments[2] === 'import') {
      const book = await readBook(root, id)
      if (method === 'GET') return json(res, { ok: true, book: id, format: BACKUP_FORMAT, ...(await importableFiles(book.dir)) })
      if (method === 'POST') {
        const body = (await readJsonBody(req, MAX_IMPORT_BYTES + 64 * 1024)) || {}
        const kind = String(body.kind || 'backup')
        if (kind === 'backup') {
          if (body.describe === true) return json(res, { ok: true, book: id, ...(await describeBackup(body.text)) })
          const report = await importBackup(book.dir, body.text, {
            mode: body.mode,
            dryRun: body.dryRun !== false,
            sections: body.sections,
          })
          return json(res, { ok: true, book: id, ...report })
        }
        if (kind === 'markdown') {
          const report = await importMarkdown(book.dir, body.text, {
            mode: body.mode,
            start: body.start,
            style: body.style,
            dryRun: body.dryRun !== false,
            confirm: body.confirm === true,
            skipTitle: body.skipTitle,
          })
          return json(res, { ok: true, book: id, ...report })
        }
        if (kind === 'file') {
          const report = await importFile(book.dir, { dir: body.dir, name: body.name }, {
            mode: body.mode,
            style: body.style,
            dryRun: body.dryRun !== false,
            confirm: body.confirm === true,
            skipTitle: body.skipTitle,
            describe: body.describe === true,
          })
          return json(res, { ok: true, book: id, ...report })
        }
        return json(res, { ok: false, error: `unknown import kind: ${kind}`, code: 'bad-kind' }, 400)
      }
      return json(res, { ok: false, error: 'method-not-allowed', method }, 405)
    }

    // /library/:book/publish — artifacts that live in the book's publish/ folder.
    //   GET              list what is already there
    //   POST {format}    render and write one more
    //   DELETE /:name    remove one
    if (segments[2] === 'publish') {
      const book = await readBook(root, id)

      if (method === 'GET') {
        if (segments.length > 3) return json(res, { ok: false, error: 'not-found', route: rest }, 404)
        const { artifacts, path } = await listArtifacts(book.dir)
        return json(res, { ok: true, book: id, path, artifacts })
      }

      if (method === 'POST') {
        if (segments.length > 3) return json(res, { ok: false, error: 'not-found', route: rest }, 404)
        const body = await readJsonBody(req)
        const artifact = await publishBook(book.dir, book, {
          format: body?.format || 'md',
          filename: body?.filename,
          lang: body?.lang,
        })
        return json(res, { ok: true, book: id, dir: publishPath(book.dir), ...artifact }, 201)
      }

      if (method === 'DELETE') {
        if (segments.length !== 4) return json(res, { ok: false, error: 'missing-name' }, 400)
        const removed = await deleteArtifact(book.dir, segments[3])
        return json(res, { ok: true, book: id, ...removed })
      }

      return json(res, { ok: false, error: 'method-not-allowed', method }, 405)
    }

    // /library/:book/unit/:section[/:group][/:id]
    if (segments[2] === 'unit') {
      if (segments.length < 4) return json(res, { ok: false, error: 'missing-section' }, 400)
      const sectionKey = segments[3]
      // A 5th segment is a group only when the section actually declares one;
      // otherwise it is the entry id of a flat section.
      const section = schema.byKey.get(sectionKey)
      const grouped = section?.kind === 'groups'
      const groupKey = grouped ? segments[4] : sectionKey
      if (grouped && groupKey === undefined) {
        return json(res, { ok: false, error: 'missing-group', section: sectionKey }, 400)
      }
      const resolved = schema.unitOf(sectionKey, groupKey)
      if (!resolved) {
        return json(res, { ok: false, error: 'unknown-section', section: sectionKey, group: groupKey }, 404)
      }
      const { unit } = resolved
      const book = await readBook(root, id)
      const { id: entryId } = unitIdFrom(segments, grouped ? 5 : 4)

      if (method === 'GET' && entryId === undefined) {
        const { items, extra } = await listUnit(book.dir, unit)
        return json(res, {
          ok: true,
          section: sectionKey,
          group: groupKey,
          kind: unit.kind,
          titleField: unit.titleField ?? 'name',
          fields: unit.fields || inferFields(items),
          items,
          ...(extra || {}),
        })
      }

      if (method === 'POST' && entryId === undefined) {
        const body = await readJsonBody(req)
        if (unit.kind === 'chapters') {
          const base = idForNew(unit, body) || 'chapter'
          const existing = new Set((await listUnit(book.dir, unit)).items.map((x) => x.id))
          let candidate = base
          for (let n = 2; existing.has(candidate); n += 1) candidate = `${base}-${n}`
          const saved = await writeUnit(book.dir, unit, candidate, body)
          return json(res, { ok: true, entry: saved.id, id: saved.id }, 201)
        }
        if (unit.kind === 'records') {
          const base = body.id ? String(body.id) : idForNew(unit, body) || 'item'
          const existing = new Set((await listUnit(book.dir, unit)).items.map((x) => x.id))
          let candidate = base
          for (let n = 2; existing.has(candidate); n += 1) candidate = `${base}-${n}`
          const saved = await writeUnit(book.dir, unit, candidate, body)
          return json(res, { ok: true, entry: saved.id, id: saved.id, data: saved.data }, 201)
        }
        const saved = await writeUnit(book.dir, unit, 'new', body)
        const idx = saved.items ? saved.items.length - 1 : undefined
        return json(res, { ok: true, entry: idx, id: idx, items: saved.items }, 201)
      }

      if (method === 'GET' && entryId !== undefined) {
        const got = await readUnit(book.dir, unit, entryId)
        return json(res, {
          ok: true,
          id: got.id,
          data: got.data,
          meta: got.meta,
          fields: unit.fields || inferFields([got.data]),
          ...(got.items ? { items: got.items, extra: got.extra } : {}),
        })
      }

      if ((method === 'PUT' || method === 'PATCH') && entryId !== undefined) {
        const saved = await writeUnit(book.dir, unit, entryId, await readJsonBody(req))
        return json(res, { ok: true, ...saved })
      }

      if (method === 'DELETE' && entryId !== undefined) {
        const gone = await deleteUnit(book.dir, unit, entryId)
        return json(res, { ok: true, ...gone })
      }

      return json(res, { ok: false, error: 'method-not-allowed', method }, 405)
    }

    if (segments.length !== 2) return json(res, { ok: false, error: 'not-found', route: rest }, 404)

    if (method === 'GET') {
      const book = await readBook(root, id)
      return json(res, { ok: true, book, counts: await bookCounts(book.dir) })
    }
    if (method === 'PATCH' || method === 'PUT') {
      return json(res, { ok: true, book: await updateBook(root, id, await readJsonBody(req)) })
    }
    if (method === 'DELETE') {
      return json(res, { ok: true, ...(await deleteBook(root, id)) })
    }
    return json(res, { ok: false, error: 'method-not-allowed', method }, 405)
  } catch (err) {
    return fail(res, err)
  }
}

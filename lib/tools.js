// dsh-novel-studio — model-facing tools.
//
// Registered on the DSH `tools` Service by lib/index.js. The definitions here
// are the *interface* the assistant uses to read and write a novel, and — via
// `novel_extension` — to add new sections and routes to the studio itself.
//
// Every definition is a plain literal (no builder), matching the shape the
// service documents:
//   { name, description, parameters, output: { schema, render }, execute(args, exec) }
// Business refusals are returned as values (`{ ok:false, code, message }`) so the
// model sees the reason instead of an exception.

const V = new URL(import.meta.url).searchParams.get('v') ?? '0'

const { invoke } = await import(`./ops.js?v=${V}`)
const { getSchema } = await import(`./schema.js?v=${V}`)
const { aiTasks, contextPreview, runTask } = await import(`./ai.js?v=${V}`)
const { getServices } = await import(`./api.js?v=${V}`)

function plain(name, description, parameters, handler, timeoutMs = 30_000) {
  return {
    name,
    description,
    parameters,
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    timeoutMs,
    async execute(args) {
      const input = typeof args === 'object' && args !== null ? args : {}
      try {
        return await handler(input)
      } catch (err) {
        return { ok: false, code: 'error', message: String((err && err.message) || err) }
      }
    },
  }
}

/** Context handed to extension-contributed tools, mirroring an extension route. */
async function extensionContext() {
  const schema = await getSchema()
  const ops = await import(`./ops.js?v=${V}`)
  return {
    invoke: ops.invoke,
    getSchema,
    guide: ops.GUIDE,
    schema,
  }
}

const BUILTIN = [
  plain(
    'novel_guide',
    [
      'Read the dsh-novel-studio handbook before working on a novel.',
      'Topics: "overview" (what the panel is and where the files live),',
      '"data" (the six section kinds and how records are addressed),',
      '"extend" (how to add a new section, route, or tool without restarting DSH).',
      'Call this first when asked to add a feature or a new area to the studio.',
    ].join(' '),
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        topic: { type: 'string', enum: ['overview', 'data', 'extend'], description: 'Which part of the handbook to read.' },
      },
    },
    (args) => invoke('guide', args),
  ),

  plain(
    'novel_library',
    [
      'Manage the novel library: the set of separate books, each with its own isolated directory.',
      'list returns every book; create makes one from a title (and optional meta such as',
      'author/genre/logline) together with its full folder scaffolding; get returns one book',
      'plus its counts; update merges a metadata patch; delete removes the book directory.',
    ].join(' '),
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['list', 'create', 'get', 'update', 'delete'], description: 'The library operation.' },
        book: { type: 'string', description: 'Book id (its directory name). Required for get/update/delete.' },
        title: { type: 'string', description: 'create: the book title; the id is derived from it.' },
        meta: { type: 'object', additionalProperties: true, description: 'create: extra book.yaml fields (author, genre, logline, tags …). update: the patch to merge.' },
      },
      required: ['action'],
    },
    (args) => invoke('books', args),
  ),

  plain(
    'novel_records',
    [
      'Read and write the entries inside one book: characters, world lore, outline beats,',
      'panels, chapters and materials.',
      'action "schema" lists every section, its kind, and its groups — call it first when you',
      'do not know where something belongs.',
      'list/read/write/delete address one section (plus a group for grouped sections such as',
      'world or panels). For "records" and "chapters" the entry id is a slug; for "doc" sections',
      'it is the 0-based list index, and omitting it on write appends a new entry.',
      'Fields are free-form: you may write keys nobody declared, and the panel will render them.',
    ].join(' '),
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['schema', 'list', 'read', 'write', 'delete'], description: 'The record operation.' },
        book: { type: 'string', description: 'Book id. Not needed for action "schema".' },
        section: { type: 'string', description: 'Section key, e.g. characters / world / outline / panels / chapters / materials.' },
        group: { type: 'string', description: 'Group key for grouped sections, e.g. locations under world.' },
        entry: { type: 'string', description: 'Entry id (slug) or list index as a string. Omit on write to create.' },
        data: { type: 'object', additionalProperties: true, description: 'write: the entry object to store or merge.' },
      },
      required: ['action'],
    },
    (args) => invoke('records', args),
  ),

  plain(
    'novel_graph',
    [
      'The relationship web of one book: who knows whom, who leads what, who is where.',
      'Nodes come from characters plus the world groups factions/locations/items; edges come',
      'from the `edges` array of relationships.yaml and from link fields such as a faction',
      'leader or an item owner.',
      'Omit "kinds" for the whole web, or pass the kinds to focus on — any edge touching a',
      'visible node is kept, and the far end becomes a context node rather than being dropped,',
      'so a character graph still shows the factions they belong to.',
      'Pass kinds:["list"] to see the available kinds instead of the graph.',
      'Read "problems" for dangling or self-referential edges; it is a read-only view.',
    ].join(' '),
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        book: { type: 'string', description: 'Book id.' },
        kinds: {
          description: 'Optional list of node kinds to include (e.g. ["characters","factions"]), or the string "list" to get the menu of kinds.',
        },
      },
      required: ['book'],
    },
    (args) => invoke('graph', args),
  ),

  plain(
    'novel_validate',
    [
      'Check one book for inconsistencies: the relationship graph, [[wiki links]] in the text,',
      'untitled entries, empty chapters, chapter numbering, unresolved foreshadowing and open',
      'threads. Read-only — it never writes.',
      'Returns counts by level (error/warn/info) plus a sorted list of issues, each naming the',
      'rule that fired and what to fix. `ok` is false only when an error was found.',
      'Pass rules:"list" to see every available rule, including those added by extensions.',
      'Run it after a batch of writes, and mention the findings rather than silently ignoring them.',
    ].join(' '),
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        book: { type: 'string', description: 'Book id.' },
        rules: { type: 'string', enum: ['list'], description: 'Pass "list" to return the rule catalogue instead of a report.' },
      },
      required: ['book'],
    },
    (args) => invoke('validate', args),
  ),

  plain(
    'novel_export',
    [
      'Render one book for a reader and return the text. Nothing is written to disk —',
      'use this to inspect the finished manuscript, or to hand the whole thing back to the',
      'user. Formats: "md" (Markdown with front matter), "txt" (plain text), "html" (a',
      'standalone printable page), "json" (a complete backup of the prose plus every record).',
      'Defaults to "md". Results carry `filename`, `bytes`, `chapters` and `words`.',
      'Call novel_publish when the file should actually land in the book\'s publish/ folder.',
    ].join(' '),
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        book: { type: 'string', description: 'Book id.' },
        format: { type: 'string', description: 'Export format key. Defaults to "md".' },
        filename: { type: 'string', description: 'Override the suggested file name (no directories).' },
        lang: { type: 'string', description: 'HTML only: the lang attribute. Defaults to "zh".' },
      },
      required: ['book'],
    },
    (args) => invoke('export', args),
    60_000,
  ),

  plain(
    'novel_publish',
    [
      'Write a finished book into its own publish/ folder as a file the user can open.',
      'action "formats" lists the available targets, "list" shows what has already been',
      'published (including files dropped in by hand), "write" renders and saves one, and',
      '"delete" removes one by name. Writing never touches chapters/ or any other source',
      'folder — publish/ is a separate output area, so re-publishing is always safe.',
    ].join(' '),
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['formats', 'list', 'write', 'delete'], description: 'The publish operation. Defaults to "write".' },
        book: { type: 'string', description: 'Book id. Required except for action "formats".' },
        format: { type: 'string', description: 'write: export format key. Defaults to "md".' },
        filename: { type: 'string', description: 'write: override the file name (no directories).' },
        lang: { type: 'string', description: 'write: HTML lang attribute. Defaults to "zh".' },
        name: { type: 'string', description: 'delete: the artifact file name.' },
      },
      required: ['action'],
    },
    (args) => invoke('publish', args),
    60_000,
  ),

  plain(
    'novel_link',
    [
      'Add, rewire or remove one relationship in a book\'s graph.',
      'A relationship has two possible homes and this tool edits the right one for you:',
      'a hand-written row in relationships.yaml, or a field on a record (an item\'s owner,',
      'a faction\'s leader, a location\'s region). Rewiring a field-derived relation rewrites',
      'that field, so the character sheet and the graph never drift apart.',
      'action "create" needs { from, to } and optionally type/note/strength.',
      'action "update" needs the current edge plus a `patch` object with the fields to change;',
      'for a field-derived edge only `patch.from` is accepted — its type comes from the graph',
      'kind, and the reply names the unit, owner and field that changed.',
      'action "delete" removes a hand-written row, or clears the field behind a derived one.',
      'Identify the edge with from/to (node ids or display names) plus type and source when',
      'more than one relation runs between the same two nodes.',
      'Call novel_graph first to see ids, types and which edges are source "auto" or "manual".',
    ].join(' '),
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['create', 'update', 'delete'], description: 'The relation operation. Defaults to "create".' },
        book: { type: 'string', description: 'Book id.' },
        from: { type: 'string', description: 'Source node id or display name. For a derived edge, update uses this as the new target of the field.' },
        to: { type: 'string', description: 'Target node id or display name.' },
        type: { type: 'string', description: 'Relation label, free text (e.g. 师徒, 首领). Manual edges only.' },
        note: { type: 'string', description: 'Free-text note. Manual edges only.' },
        strength: { type: 'number', description: 'Manual edges only, 1..5. Defaults to 2.' },
        source: { type: 'string', enum: ['manual', 'auto'], description: 'Disambiguate when both a stored row and a derived edge match.' },
        patch: {
          type: 'object',
          additionalProperties: true,
          description: 'update only: the fields to change (from, to, type, note, strength).',
        },
      },
      required: ['book'],
    },
    (args) => invoke('edges', args),
    60_000,
  ),

  plain(
    'novel_extension',
    [
      'Extend the studio itself. Extensions are JavaScript modules in lib/extensions/ that',
      'contribute new sections (tabs), HTTP routes and tools; they are picked up on the next',
      'request with no DSH restart.',
      'action "list" shows what is installed and whether it loaded.',
      'Scaffold first ("scaffold", with name and optionally sectionKey/zh/kind/path) to get a',
      'template, then edit it and call "write" with { name, source }. Writing imports the module',
      'as a check: a syntax error, a top-level throw, or a wrong export shape rolls the file back',
      'and reports why. "delete" removes one. Files whose name starts with "_" are kept but not',
      'enabled — use that for templates.',
    ].join(' '),
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['list', 'scaffold', 'write', 'delete'], description: 'The extension operation.' },
        name: { type: 'string', description: 'File name, e.g. "wordcount.js". Required for write/delete and optional for scaffold.' },
        source: { type: 'string', description: 'write: the complete JavaScript module source.' },
        id: { type: 'string', description: 'scaffold: extension id; defaults to the file name without .js.' },
        sectionKey: { type: 'string', description: 'scaffold: key of the new section; defaults to the id.' },
        zh: { type: 'string', description: 'scaffold: Chinese label for the new section.' },
        en: { type: 'string', description: 'scaffold: English label for the new section.' },
        kind: { type: 'string', enum: ['records', 'doc', 'chapters', 'raw'], description: 'scaffold: the section kind. Defaults to "records".' },
        path: { type: 'string', description: 'scaffold: directory (records/chapters) or file path (doc/raw) relative to the book.' },
        listKey: { type: 'string', description: 'scaffold: for kind "doc", the array key inside the YAML file.' },
      },
      required: ['action'],
    },
    (args) => invoke('extensions', args),
    60_000,
  ),

  plain(
    'novel_ai',
    [
      'Run one AI writing task against a book — list the menu, preview the context, or execute.',
      'action "list": the task menu (key / zh / hint / needs / maxTokens), including extension',
      'tasks; needs no other argument.',
      'action "context": what one request would read — counts plus the pickable entry catalog —',
      'without calling any model (cheap way to discover pool keys and entry ids for "pick").',
      'action "run": execute the task and return its full text with usage; this calls the model.',
      'Shared request fields for context/run: "book" (id) is required; "task" defaults to',
      '"continue"; "chapter" / "text" / "input" are what the task\'s "needs" demands;',
      '"instruction" is the author\'s extra requirement for this round; "maxTokens" caps the reply',
      '(<= 8000); "provider" / "model" override the route for this round.',
      '"pick" feeds only chosen existing entries: { "<section/group key>": [entryId, ...] };',
      'omit it to feed everything. "history" replays prior turns, oldest first:',
      '[{ role: "user" | "assistant", content }], so a follow-up round can build on the previous',
      'answer (max 12 turns, 4000 chars each).',
      'Returns { ok: true, ... } or { ok: false, code, message } — bad-pick, bad-history,',
      'unknown-task, no-model, no-llm … — it never throws.',
    ].join(' '),
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['list', 'context', 'run'], description: 'list: the task menu. context: preview what would be read (no model call). run: execute one task.' },
        book: { type: 'string', description: 'Book id. Required for context/run.' },
        task: { type: 'string', description: 'Task key from action "list", e.g. "continue". Defaults to "continue".' },
        chapter: { type: 'string', description: 'Chapter id for tasks whose needs is "chapter"; "continue" defaults to the last chapter.' },
        text: { type: 'string', description: 'The text to work on for tasks whose needs is "text".' },
        input: { type: 'string', description: 'The idea / outline for tasks whose needs is "input".' },
        instruction: { type: 'string', description: "The author's extra requirement for this round, appended to the task's prompt." },
        words: { type: 'number', description: 'Ask for an answer of about this many words (1–20000). Omit for the task\'s own length.' },
        maxTokens: { type: 'number', description: "Upper bound for this round's reply (capped at 8000)." },
        provider: { type: 'string', description: 'Override the route provider for this round.' },
        model: { type: 'string', description: 'Override the route model for this round.' },
        pick: { type: 'object', additionalProperties: true, description: 'Feed only chosen entries: { "<section/group key>": [entryId, ...] }. Omit to feed everything.' },
        history: { type: 'array', items: { type: 'object', additionalProperties: true }, description: 'Prior turns, oldest first: [{ role: "user" | "assistant", content: "..." }]. Max 12 turns.' },
      },
      required: ['action'],
    },
    async (args) => {
      const action = String(args.action || '').trim()
      if (action === 'list') return { ok: true, tasks: await aiTasks() }
      if (action !== 'context' && action !== 'run') {
        return { ok: false, code: 'unknown-action', message: `novel_ai: action must be "list", "context" or "run" (got ${JSON.stringify(args.action ?? null)})` }
      }
      const request = {
        // Default the task here, not just in prompt.js: collectContext decides
        // "which chapter to default to" from `request.task === 'continue'`, so
        // an omitted task must already read as "continue".
        task: args.task || 'continue',
        chapter: args.chapter,
        text: args.text,
        input: args.input,
        instruction: args.instruction,
        words: args.words,
        pick: args.pick,
        history: args.history,
        provider: args.provider,
        model: args.model,
        maxTokens: args.maxTokens,
      }
      const opened = await invoke('books', { action: 'get', book: args.book })
      if (!opened?.ok) return opened
      try {
        if (action === 'context') return { ok: true, context: await contextPreview(opened.dir, opened.book, request) }
        const services = getServices()
        const out = await runTask({ llm: services.llm, selection: services.selection, bookDir: opened.dir, book: opened.book, request })
        return { ok: true, ...out }
      } catch (err) {
        return { ok: false, code: (err && err.code) || 'error', message: String((err && err.message) || err) }
      }
    },
    120_000,
  ),

  plain(
    'novel_search',
    [
      'Find where a word appears in one book: chapter prose (with line numbers), every record',
      'field, material file names and raw files. Case-insensitive, all terms must match, and each',
      'field is reported once with a snippet around the hit.',
      'Use it before writing a new scene — "did I already name this place?" — and after renaming',
      'something, to find the places that still say the old name.',
      'Returns { query, terms, hits, total, truncated, scanned } where each hit names section,',
      'id, field and snippet. `section` narrows the scan to one section key (e.g. "chapters").',
    ].join(' '),
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        book: { type: 'string', description: 'Book id.' },
        q: { type: 'string', description: 'Search terms, whitespace separated. All must match.' },
        limit: { type: 'number', description: 'Max hits. Defaults to 60, capped at 200.' },
        section: { type: 'string', description: 'Restrict to one section key (chapters, characters, world …).' },
      },
      required: ['book', 'q'],
    },
    (args) => invoke('search', args),
    30_000,
  ),

  plain(
    'novel_chapters',
    [
      'The reading order of a book, and the tools to change it.',
      'action "plan": the current order plus what is wrong with it — missing numbers, duplicates,',
      'files that carry no number — and the numbering style the book already uses.',
      'action "reorder": { ids: [...] } puts the chapters in exactly that order (every existing',
      'chapter id must appear once), renaming numbered files so the order survives a rebuild.',
      'action "renumber": reassign the numbers; pass dryRun:true to see the renames first, and',
      '"style" ("cn" 第一章 / "arabic" 第1章 / "prefix" 01-) only when the book has none yet.',
      'Chapter ids are file names without ".md"; both id and title are accepted in "ids".',
    ].join(' '),
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        book: { type: 'string', description: 'Book id.' },
        action: { type: 'string', enum: ['plan', 'reorder', 'renumber'], description: 'Defaults to "plan".' },
        ids: { type: 'array', items: { type: 'string' }, description: 'reorder: the complete chapter list, in the wanted order.' },
        style: { type: 'string', enum: ['cn', 'arabic', 'prefix'], description: 'renumber: numbering style. Omit to keep the book\'s own style.' },
        start: { type: 'number', description: 'renumber: first number. Defaults to 1.' },
        dryRun: { type: 'boolean', description: 'renumber: report the renames without performing them.' },
      },
      required: ['book'],
    },
    (args) => invoke('chapters', args),
    60_000,
  ),

  plain(
    'novel_drafts',
    [
      'The draft box: timestamped snapshots of a chapter, taken before a risky rewrite.',
      'action "list" shows the snapshots (newest first) with chapter, words and note;',
      '"read" returns one; "save" takes one ({ chapter, body?, note? } — the body as it stands',
      'now); "restore" puts one back into the chapter ({ name, force? } — force overwrites a',
      'chapter that has changed since the snapshot); "delete" drops one.',
      'Snapshots live in drafts/ so nothing is lost when a rewrite goes wrong.',
    ].join(' '),
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        book: { type: 'string', description: 'Book id.' },
        action: { type: 'string', enum: ['list', 'read', 'save', 'restore', 'delete'], description: 'Defaults to "list".' },
        chapter: { type: 'string', description: 'save: chapter id to snapshot.' },
        body: { type: 'string', description: 'save: the text to keep. Omitted means "read the chapter as it is now".' },
        note: { type: 'string', description: 'save: why this snapshot was taken.' },
        name: { type: 'string', description: 'read / restore / delete: the snapshot name from "list".' },
        force: { type: 'boolean', description: 'restore: overwrite even if the chapter changed since the snapshot.' },
      },
      required: ['book'],
    },
    (args) => invoke('drafts', args),
    30_000,
  ),

  plain(
    'novel_progress',
    [
      'How much of the book exists: total words, chapters, empty chapters, a day-by-day history',
      'of the last 30 days, and the pace needed to hit a goal.',
      'action "get" (the default) returns totals plus { goal: { words, deadline }, pace:',
      '{ perDay, remaining, daysLeft, onTrack } , history: [{ date, words }] }.',
      'action "set" stores a goal: { words, deadline } (deadline "YYYY-MM-DD"); omit a field to',
      'keep its current value, pass null to clear it. Words are counted from the prose as it is',
      'on disk, so the panel and these numbers always agree.',
    ].join(' '),
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        book: { type: 'string', description: 'Book id.' },
        action: { type: 'string', enum: ['get', 'set'], description: 'Defaults to "get".' },
        words: { type: 'number', description: 'set: target word count. null clears it.' },
        deadline: { type: 'string', description: 'set: target date, YYYY-MM-DD. null clears it.' },
      },
      required: ['book'],
    },
    (args) => invoke('progress', args),
    30_000,
  ),

  plain(
    'novel_import',
    [
      'Bring an existing manuscript into a book.',
      'action "list": files already inside the book (materials/, publish/, import/) that could be',
      'read, each marked "backup" (JSON) or "markdown".',
      'action "backup": read a novel_export format:"json" document. Pass describe:true first to',
      'see what it holds (book meta, counts, sections) without touching anything.',
      'action "markdown": split a manuscript into chapters by its own headings ("# 第一章 …").',
      'Every write action defaults to dryRun:true and only reports what it would create or',
      'overwrite; send dryRun:false to perform it, and confirm:true to allow overwriting',
      'existing chapters. Modes: "merge" (default, adds new chapters) or "replace".',
      'Pass "start" to number new chapters after the book\'s last one.',
    ].join(' '),
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        book: { type: 'string', description: 'Book id.' },
        action: { type: 'string', enum: ['list', 'backup', 'markdown'], description: 'Defaults to "backup".' },
        text: { type: 'string', description: 'backup / markdown: the document to import.' },
        describe: { type: 'boolean', description: 'backup: parse and report only — never writes.' },
        mode: { type: 'string', enum: ['merge', 'replace'], description: 'markdown: "merge" adds, "replace" overwrites the whole chapter list.' },
        start: { type: 'number', description: 'markdown: first chapter number for new chapters.' },
        style: { type: 'string', description: 'markdown: numbering style for new chapter titles.' },
        skipTitle: { type: 'boolean', description: 'markdown: drop a leading "# Title" or book title line instead of making it a chapter.' },
        dryRun: { type: 'boolean', description: 'Defaults to true. false performs the import.' },
        confirm: { type: 'boolean', description: 'markdown: allow overwriting existing chapters.' },
        sections: { type: 'array', items: { type: 'string' }, description: 'backup: only restore these section keys.' },
      },
      required: ['book'],
    },
    (args) => invoke('import', args),
    120_000,
  ),

  plain(
    'novel_extract',
    [
      'Read a passage of prose and file what is new in it — the people, places, items and rules it',
      'introduces — into the matching record regions.',
      'action "recognize" (default): one model call reads the passage and returns an unapplied plan;',
      'each entry names its target region (e.g. "world/items"), the fields it would fill, and whether',
      'that entry already exists. Nothing is written, so this is safe to call on any text.',
      'action "apply": write back the entries you pass in "entries" (normally a subset of the plan);',
      'only fields that are still empty are filled and an existing line is never overwritten.',
      'Always recognize first and show the plan before applying it.',
      'Returns { ok: true, plan } for recognize — plan.entries plus plan.counts — or',
      '{ ok: true, written, updated, skipped } for apply. Never throws.',
    ].join(' '),
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        book: { type: 'string', description: 'Book id.' },
        action: { type: 'string', enum: ['recognize', 'apply'], description: 'Defaults to "recognize".' },
        chapter: { type: 'string', description: 'recognize: the chapter the passage belongs to, used for context.' },
        passage: { type: 'string', description: 'recognize: the prose to read.' },
        entries: { type: 'array', items: { type: 'object', additionalProperties: true }, description: 'apply: the entries to write, as returned by recognize (a subset is fine).' },
      },
      required: ['book'],
    },
    (args) => invoke('extract', args),
    120_000,
  ),
]

/**
 * The complete tool set: built-ins plus whatever the loaded extensions export.
 * Extension tools use `{ name, description, parameters, run(args, ctx) }`.
 */
export async function buildTools() {
  const defs = [...BUILTIN]
  let extra = []
  try {
    extra = (await getSchema()).extraTools || []
  } catch (err) {
    console.error('[novel-studio] extension tools unavailable:', err)
  }
  for (const t of extra) {
    if (!t?.name || typeof t.run !== 'function') {
      console.error(`[novel-studio] extension tool "${t?.name}" skipped (needs name + run)`)
      continue
    }
    if (defs.some((d) => d.name === t.name)) {
      console.error(`[novel-studio] extension tool "${t.name}" skipped (duplicate name)`)
      continue
    }
    defs.push(
      plain(
        t.name,
        t.description || `Tool contributed by a novel-studio extension (${t.name}).`,
        t.parameters || { type: 'object', additionalProperties: true },
        async (args) => t.run(args, await extensionContext()),
        t.timeoutMs ?? 30_000,
      ),
    )
  }
  return defs
}

export const TOOL_NAMES = BUILTIN.map((d) => d.name)

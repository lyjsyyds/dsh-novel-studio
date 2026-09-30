// dsh-novel-studio extension — EXAMPLE / TEMPLATE (disabled).
//
// The loader imports every *.js in this directory whose name does NOT start
// with "_". This file is therefore documentation, not live code: rename it to
// `sparks.js` (or copy it) to enable it.
//
// An extension may export any subset of:
//   id        string                      identifier used in reports
//   sections  unit[]                      new top-level tabs in the panel
//   routes    { method, pattern, handler }[]   HTTP routes under /ext/<id>/…
//   tools     { name, description, parameters, run }[]   model-facing tools
//   graphs    { key, zh, section, links }[]    new node kinds in the relationship map
//   rules     { id, zh, level, run }[]         new consistency checks
//   formats   { key, zh, ext, mime, render }[] new export formats
//   ai        { key, zh, frame }[]              new tasks in the AI pane
//
// Everything is picked up on the next request. Only lib/index.js itself needs a
// DSH restart, because the host half is loaded once at process start.

export const id = 'sparks'

// A `doc` section stores every entry in one YAML array. `listKey` is the array
// key inside the file, which the writer preserves alongside `schemaVersion`.
// Omitting `fields` is allowed: the panel infers a form from whatever you store,
// which is the intended path for a section whose shape is still moving.
export const sections = [
  {
    key: 'sparks',
    zh: '灵感',
    en: 'Sparks',
    kind: 'doc',
    path: 'meta/sparks.yaml',
    listKey: 'sparks',
    titleField: 'text',
    fields: [
      { k: 'text', zh: '内容', en: 'Text', type: 'textarea' },
      { k: 'tags', zh: '标签', en: 'Tags', type: 'tags' },
      { k: 'used', zh: '已用', en: 'Used', type: 'boolean' },
      { k: 'where', zh: '落点', en: 'Where', type: 'text' },
    ],
  },
]

// Route handlers run with the same helpers the built-in HTTP layer uses.
// `pattern` is matched segment-by-segment; ":name" captures into ctx.params.
export const routes = [
  {
    method: 'GET',
    pattern: '/ext/sparks/unused',
    handler: async (req, res, ctx) => {
      const book = String(ctx.segments[2] ?? '')
      if (!book) return ctx.json(res, { ok: false, error: 'usage: /ext/sparks/unused/<book>' }, 400)
      const schema = await ctx.getSchema()
      const unit = schema.unitByPath('meta/sparks.yaml')?.unit
      if (!unit) return ctx.json(res, { ok: false, error: 'sparks section missing' }, 500)
      const { items } = await ctx.listUnit((await ctx.bookDirOf(book)), unit)
      const unused = items.filter((s) => !s.used)
      return ctx.json(res, { ok: true, book, total: items.length, unused: unused.length, items: unused })
    },
  },
]

// Tool `run(args, ctx)` receives `{ invoke, getSchema, guide, schema }`.
export const tools = [
  {
    name: 'novel_sparks_unused',
    description: 'List the writing sparks that have not been used yet in a book.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { book: { type: 'string', description: 'Book id.' } },
      required: ['book'],
    },
    run: async (args, ctx) => ctx.invoke('records', { action: 'list', book: args.book, section: 'sparks' }),
  },
]

// An export format is a pure function from the whole book to one string, so it
// shows up in the panel's format chips AND in `novel_publish` as soon as the
// file lands. `needsData: true` additionally collects every readable section
// into ctx.data (expensive — only ask for it if you really need it).
//
// export const formats = [
//   {
//     key: 'sparks',
//     zh: '灵感清单',
//     en: 'Sparks',
//     ext: 'md',
//     mime: 'text/markdown',
//     render({ book, chapters }) {
//       const lines = [`# ${book.title} — 灵感`, '']
//       for (const c of chapters) lines.push(`- ${c.title}（${c.words} 字）`)
//       return lines.join('\n')
//     },
//   },
// ]

// ── ai ───────────────────────────────────────────────────────────────────────
// An `ai` entry adds a task to the panel's AI tab. `frame(request, context)`
// returns this request's ask; it is appended to the same book context and the
// same persona a built-in task receives, so an extension task is grounded in
// the book for free. `needs` picks which input the panel shows ('chapter' |
// 'text' | 'input' | 'none'). A key colliding with a built-in is skipped.
//
// export const ai = [
//   {
//     key: 'timeline',
//     zh: '年表推演',
//     en: 'Timeline',
//     hint: '把已写的情节按时间排一遍',
//     needs: 'none',
//     maxTokens: 900,
//     system: '你是年表编辑。只输出年表本身。',
//     frame(request, context) {
//       const beats = context.beats.map((b) => `- ${b.title || b.name}`).join('\n')
//       return ['按时间排一遍这些情节：', beats, request.instruction || ''].filter(Boolean).join('\n')
//     },
//   },
// ]

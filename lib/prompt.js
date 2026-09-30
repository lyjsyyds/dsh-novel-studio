// dsh-novel-studio — prompt assembly for the AI pane.
//
// This module is deliberately pure: it never touches the disk, never imports
// another lib module, and never calls a model. `lib/ai.js` gathers the book's
// real data and hands it here as a plain context bundle, which means the part
// that actually decides what the model is told can be tested without a network,
// a provider, or a book on disk — and a writer can read one file to see exactly
// what their setting contributes to the prompt.

/**
 * Character budgets, per section.
 *
 * A world file can be any length the writer wants; a prompt cannot. Every
 * section is clipped, and the clip announces itself, so the model knows the
 * setting it received is partial rather than complete — a silent truncation is
 * how a model ends up confidently inventing a character who was cut off.
 */
export const LIMITS = {
  chapterBody: 6000,
  chapterCount: 10,
  chapterExcerpt: 160,
  characters: 24,
  rules: 24,
  glossary: 30,
  arcs: 10,
  beats: 24,
  edges: 40,
  issues: 40,
  input: 4000,
  // One selectable pool beyond the five dedicated sections above (地点/势力/
  // 年表事件/线索/面板…): each is clipped on its own so one long pool cannot
  // crowd the rest of the setting out.
  pool: 12,
}

/**
 * Base persona. The grounding rule is the point: the model is told that the
 * book's own setting outranks anything it would rather write.
 */
const PERSONA = [
  '你是一位中文小说写作助手，与作者的创作工具直接协作。',
  '你能看到这本书的真实设定：人物、世界观、大纲、章节正文与人物关系。',
  '设定高于即兴发挥：凡是设定里已经写明的名字、称呼、能力与规则，一律沿用；不要另起名字，不要改写已有设定。',
  '直接给出结果。不要解释你的思路，不要复述任务，不要以「好的」「当然」开头，不要用 Markdown 代码块包裹正文。',
].join('\n')

/** Clip to the head, marking what was dropped. */
function clip(text, limit) {
  const value = String(text ?? '')
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}\n…（已截断，原文还有 ${value.length - limit} 字）`
}

/**
 * Clip to the tail. Continuation needs the *end* of the chapter: the opening
 * paragraph is the least useful thing to spend budget on when the task is
 * "write what comes next".
 */
function clipTail(text, limit) {
  const value = String(text ?? '')
  if (value.length <= limit) return value
  return `…（已截断，前面还有 ${value.length - limit} 字）\n${value.slice(-limit)}`
}

function oneLine(text, limit) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim()
  return clip(value, limit)
}

/**
 * Render one record as labelled lines.
 *
 * `keys` and `labels` come from the live section schema, so a character reads as
 * `姓名：林望 / 定位：主角` rather than `name: 林望`. Empty fields are dropped:
 * a wall of blank keys teaches the model nothing and costs tokens.
 */
function renderRecord(item, keys, labels, extra = []) {
  const lines = []
  for (const key of [...extra, ...(keys ?? [])]) {
    const value = item?.[key]
    if (value === undefined || value === null) continue
    const text = Array.isArray(value) ? value.filter(Boolean).join('、') : String(value).trim()
    if (!text) continue
    lines.push(`  ${(labels && labels[key]) || key}：${oneLine(text, 200)}`)
  }
  return lines
}

function section(title, body) {
  const text = Array.isArray(body) ? body.join('\n') : String(body ?? '')
  return text.trim() ? `### ${title}\n${text}` : ''
}

/** The book's own identity — title, author, genre, logline. */
function renderBook(context) {
  const book = context.book ?? {}
  const bits = []
  if (book.title) bits.push(`《${book.title}》`)
  if (book.genre) bits.push(`类型：${book.genre}`)
  if (book.author) bits.push(`作者：${book.author}`)
  const logline = book.logline ? `简介：${oneLine(book.logline, 300)}` : ''
  // A book with nothing at all says nothing here, so the caller's "no setting
  // data yet" line is the one the model reads instead of a hollow header.
  if (!bits.length && !logline) return ''
  const head = bits.length ? bits.join('　') : '（这本书还没有填写书名）'
  return section('这本书', [head, logline].filter(Boolean))
}

function renderWorld(context) {
  const labels = context.labels ?? {}
  const keys = context.keys ?? {}
  const parts = []

  const rules = (context.rules ?? []).slice(0, LIMITS.rules)
  if (rules.length) {
    parts.push(section(`世界规则（${rules.length} 条）`, rules.map((r) => `- ${oneLine(r?.rule ?? r?.title ?? r?.text ?? r, 200)}`)))
  }

  const glossary = (context.glossary ?? []).slice(0, LIMITS.glossary)
  if (glossary.length) {
    parts.push(
      section(
        `术语表（${glossary.length} 条）`,
        glossary.map((t) => `- ${oneLine(t?.term ?? t?.name ?? '', 60)}：${oneLine(t?.definition ?? t?.desc ?? t?.text ?? '', 160)}`),
      ),
    )
  }

  const characters = (context.characters ?? []).slice(0, LIMITS.characters)
  if (characters.length) {
    parts.push(
      section(
        `人物（${characters.length} 位）`,
        characters.map((c) => {
          const id = c?.id ?? c?.name ?? ''
          const lines = renderRecord(c, keys.characters, labels.characters)
          return [`- ${id}`, ...lines].join('\n')
        }),
      ),
    )
  }
  return parts.filter(Boolean).join('\n\n')
}

function renderOutline(context) {
  const parts = []
  const arcs = (context.arcs ?? []).slice(0, LIMITS.arcs)
  if (arcs.length) {
    parts.push(section(`故事线（${arcs.length} 条）`, arcs.map((a) => `- ${oneLine(a?.title ?? a?.name ?? a?.id ?? '', 80)}${a?.summary ? `：${oneLine(a.summary, 200)}` : ''}`)))
  }
  const beats = (context.beats ?? []).slice(0, LIMITS.beats)
  if (beats.length) {
    parts.push(
      section(
        `情节节点（${beats.length} 条）`,
        beats.map((b) => `- ${oneLine(b?.title ?? b?.name ?? '', 80)}${b?.summary ? `：${oneLine(b.summary, 200)}` : ''}${b?.arc ? `（${oneLine(b.arc, 40)}）` : ''}`),
      ),
    )
  }
  return parts.filter(Boolean).join('\n\n')
}

/**
 * The chapter index. Bodies are omitted on purpose — this is the map, and the
 * task-specific frame decides which body (if any) is worth its budget.
 */
function renderChapters(context) {
  const chapters = context.chapters ?? []
  if (!chapters.length) return ''
  const shown = chapters.slice(0, LIMITS.chapterCount)
  const lines = shown.map((c) => `- ${c?.id ?? ''}　${c?.words ? `（${c.words} 字）` : '（空）'}`)
  if (chapters.length > shown.length) lines.push(`- …另有 ${chapters.length - shown.length} 章未列出`)
  return section(`章节一览（共 ${chapters.length} 章）`, lines)
}

function renderRelations(context) {
  const edges = context.edges ?? []
  if (!edges.length) return ''
  const shown = edges.slice(0, LIMITS.edges)
  const lines = shown.map((e) => {
    const type = e?.type ? ` —${e.type}→ ` : ' —→ '
    const strength = e?.strength ? `（强度 ${e.strength}）` : ''
    const source = e?.source === 'auto' ? '［来自字段］' : ''
    return `- ${e?.fromLabel ?? e?.from ?? ''}${type}${e?.toLabel ?? e?.to ?? ''}${strength}${source}`
  })
  if (edges.length > shown.length) lines.push(`- …另有 ${edges.length - shown.length} 条关系未列出`)
  return section(`人物关系（共 ${edges.length} 条）`, lines)
}

function renderIssues(context) {
  const issues = (context.issues ?? []).slice(0, LIMITS.issues)
  if (!issues.length) return ''
  const lines = issues.map((i) => `- [${i?.level ?? 'info'}] ${i?.rule ?? ''}　${oneLine(i?.message ?? '', 240)}${i?.file ? `（${i.file}）` : ''}`)
  return section(`校验器报告的问题（${context.issues.length} 条）`, lines)
}

// The pools with a dedicated renderer above. renderPools must not repeat them —
// a location rendered twice teaches the model nothing and burns the budget.
const RENDERED_POOLS = new Set(['characters', 'world/rules', 'world/glossary', 'outline/tree', 'outline/beats'])

/**
 * The writer's other selectable pools: 地点、势力、物品、年表事件、线索、面板…
 *
 * Generic on purpose — the pool list comes from lib/ai.js's schema walk, so a
 * section added later (or contributed by an extension) reaches the prompt with
 * no change here. Each pool gets its own heading and its own clip, and every
 * truncation announces itself, same as every other section of the setting.
 */
function renderPools(context) {
  const pools = (context.pools ?? []).filter((p) => p && !RENDERED_POOLS.has(p.key) && (p.items ?? []).some((i) => i?.on))
  const parts = []
  for (const pool of pools) {
    const items = pool.items.filter((i) => i?.on).slice(0, LIMITS.pool)
    const lines = items.map((it) => {
      const record = renderRecord(it.data, pool.keys, pool.labels)
      const head = `- ${oneLine(it.label ?? it.id ?? '', 120)}`
      return record.length ? [head, ...record].join('\n') : head
    })
    const rest = pool.items.filter((i) => i?.on).length - items.length
    if (rest > 0) lines.push(`- …（已截断，还有 ${rest} 条未列出）`)
    parts.push(section(`${pool.zh ?? pool.key}（${items.length} 条）`, lines))
  }
  return parts.filter(Boolean).join('\n\n')
}

/**
 * The task menu. `needs` drives validation and the client's form; `maxTokens`
 * is a task-shaped default because a polish reply and a chapter continuation
 * are not the same size of answer.
 */
export const TASKS = [
  {
    key: 'continue',
    zh: '本章续写',
    en: 'Continue this chapter',
    hint: '从当前章节的正文末尾接着往下写。',
    needs: 'chapter',
    maxTokens: 1600,
    system: '你是续写者。只输出继续往下写的新正文；不要重写已有段落，不要总结，不要另起一章。',
    frame(request, context) {
      const chapter = context.chapter ?? {}
      const body = clipTail(chapter.body, LIMITS.chapterBody)
      const heading = chapter.id ? `「${chapter.id}」` : '当前章节'
      const lines = [`## 本次任务`, `续写${context.book?.title ? `《${context.book.title}》` : ''}的${heading}，从下面正文的结尾接着写。`]
      lines.push('', `### 已有正文${body ? '' : '（这一章还是空的，请从这一章的开头写起，并交代清楚场景与在场人物。）'}`)
      if (body) lines.push(body)
      if (request.instruction) lines.push('', '### 作者本次的额外要求', oneLine(request.instruction, 600))
      return lines.join('\n')
    },
  },
  {
    key: 'continue-new',
    zh: '新章节续写',
    en: 'Start the next chapter',
    hint: '从这一章的结尾往后，另起写新的一章。',
    needs: 'chapter',
    maxTokens: 2400,
    system:
      '你是续写者。从上一章的结尾往后另起新的一章，只输出这一章的正文：不要重写或复述上一章的段落，不要总结，不要解释你在做什么，也不要写章节标题。开头交代清楚时间、场景与在场人物。',
    frame(request, context) {
      const chapter = context.chapter ?? {}
      const body = clipTail(chapter.body, LIMITS.chapterBody)
      const heading = chapter.id ? `「${chapter.id}」` : '当前章节'
      const lines = [
        '## 本次任务',
        `从${context.book?.title ? `《${context.book.title}》` : ''}${heading}的结尾往后，另起新的一章，只写这一章的正文（不要写章节标题）。`,
      ]
      lines.push('', `### 上一章的正文${body ? '' : '（这一章还是空的：仍然按上面的要求另起一章，接着往下写。）'}`)
      if (body) lines.push(body)
      if (request.instruction) lines.push('', '### 作者本次的额外要求', oneLine(request.instruction, 600))
      return lines.join('\n')
    },
  },
  {
    key: 'polish',
    zh: '润色',
    en: 'Polish',
    hint: '改写一段文字，保持原意与信息量。',
    needs: 'text',
    maxTokens: 1200,
    system: '你是润色者。保持原意、视角与人称不变，只改语言：删冗词、修语病、让句子更有节奏。不要增删情节。只输出改写后的文字。',
    frame(request, context) {
      const lines = ['## 本次任务', '润色下面这段文字。原意、信息量与叙述视角都不能变。', '', '### 原文', clip(request.text, LIMITS.input)]
      if (request.instruction) lines.push('', '### 作者本次的额外要求', oneLine(request.instruction, 600))
      return lines.join('\n')
    },
  },
  {
    key: 'outline',
    zh: '大纲推演',
    en: 'Outline',
    hint: '把一句想法展开成可写的章节大纲。',
    needs: 'input',
    maxTokens: 1600,
    system: '你是结构编辑。把作者的想法展开成章节大纲，每一章给出：章名、这一章发生什么、推进了哪条故事线、结尾留了什么钩子。用简洁的列表，不要写正文。',
    frame(request, context) {
      const lines = ['## 本次任务', '把下面这个想法展开成章节大纲。', '', '### 作者的想法', clip(request.input, LIMITS.input)]
      if ((context.beats ?? []).length) lines.push('', '请与已有的大纲衔接，不要重复已经写过的情节节点。')
      if (request.instruction) lines.push('', '### 作者本次的额外要求', oneLine(request.instruction, 600))
      return lines.join('\n')
    },
  },
  {
    key: 'review',
    zh: '一致性审稿',
    en: 'Review',
    hint: '读校验器报出的问题，判断哪些是真问题、该怎么改。',
    needs: 'none',
    maxTokens: 1400,
    system: '你是审稿人。只依据给出的设定与正文判断，不要臆测书中没有的内容。对每个问题给出：是不是真问题、依据在哪里、具体怎么改。最后列出你没把握的地方。',
    frame(request, context) {
      const issues = context.issues ?? []
      const lines = ['## 本次任务', '下面是校验器在这本书里报出的问题。请判断哪些是真问题、哪些是误报，并给出具体的修改建议。']
      if (request.text) {
        lines.push('', '### 作者圈出的段落', clip(request.text, LIMITS.input))
      }
      const chapter = context.chapter
      if (chapter?.body) {
        lines.push('', `### 相关正文（${chapter.id ?? '当前章'}）`, clip(chapter.body, Math.floor(LIMITS.chapterBody / 2)))
      }
      if (request.instruction) lines.push('', '### 作者本次的额外要求', oneLine(request.instruction, 600))
      return lines.join('\n')
    },
  },
]

/**
 * Built-ins first, then whatever extensions contributed. An extension may not
 * shadow a built-in key — schema.js already refused those — but this keeps the
 * ordering guarantee even if someone hands us a list directly.
 */
function allTasks(extra) {
  const list = [...TASKS]
  for (const t of Array.isArray(extra) ? extra : []) {
    if (t?.key && !list.some((x) => x.key === t.key)) list.push(t)
  }
  return list
}

/** Look up a task by key. Unknown keys are a caller error, not a silent default. */
export function taskOf(key, extra) {
  const wanted = String(key ?? '').trim() || 'continue'
  const found = allTasks(extra).find((t) => t.key === wanted)
  if (!found) {
    const err = new Error(`unknown ai task: ${wanted}`)
    err.code = 'unknown-task'
    err.status = 400
    throw err
  }
  return found
}

/** Serializable task menu for the panel and the HTTP layer. */
export function listTasks(extra) {
  return allTasks(extra).map((t) => ({
    key: t.key,
    zh: t.zh,
    en: t.en,
    hint: t.hint,
    needs: t.needs || 'none',
    maxTokens: t.maxTokens,
    ...(t.extension ? { extension: t.extension } : {}),
  }))
}

// Every refusal here is something the caller can fix by changing the request,
// so the HTTP layer must answer 400 rather than blame itself with a 500.
function refuse(message) {
  const err = new Error(message)
  err.code = 'missing-argument'
  err.status = 400
  throw err
}

const WORDS_MAX = 20000

/**
 * A requested answer length, or 0 for "no opinion".
 *
 * Absent, empty and null all mean the same thing, but a value that is *there*
 * and wrong is the caller's mistake and says so — silently ignoring "很多字"
 * would leave the writer staring at a prompt with no length in it.
 */
function normalizeWords(value) {
  if (value === undefined || value === null || value === '') return 0
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0 || Math.round(n) !== n || n > WORDS_MAX) {
    refuse(`字数要求需要是 1–${WORDS_MAX} 的整数。`)
  }
  return n
}

/**
 * The token budget for one call.
 *
 * An explicit `maxTokens` always wins. Otherwise a requested length lifts the
 * task's own default: two tokens per wanted word is generous for prose and the
 * floor keeps a short ask from being cut off mid-sentence by a lower budget.
 */
function resolveMaxTokens(explicit, fallback, words) {
  if (Number.isFinite(explicit) && explicit > 0) return Math.min(Math.round(explicit), 8000)
  if (words) return Math.min(8000, Math.max(fallback, words * 2))
  return fallback
}

/**
 * Assemble one call's `system` and `user` text.
 *
 * Pure: same request and context in, same strings out. The returned `stats`
 * records how much of each section survived clipping, which is what a writer
 * needs to see when the model's answer suggests it never saw their world file.
 */
export function buildPrompt(request = {}, context = {}, extra) {
  const task = taskOf(request.task, extra)

  if (task.needs === 'chapter' && !(context.chapter && context.chapter.id)) refuse('this task needs a chapter — pass "chapter"')
  if (task.needs === 'text' && !String(request.text ?? '').trim()) refuse('this task needs text — pass "text"')
  if (task.needs === 'input' && !String(request.input ?? '').trim()) refuse('this task needs an idea — pass "input"')

  // A requested length is a hard-ish ask rather than a cap: it is voiced in the
  // prompt (the model can only honour what it is told) and it also raises the
  // token budget, because the task's own default would truncate a long request.
  const asked = normalizeWords(request.words)

  const setting = [renderBook(context), renderWorld(context), renderPools(context), renderOutline(context), renderChapters(context), renderRelations(context), renderIssues(context)]
    .filter(Boolean)
    .join('\n\n')

  const system = [PERSONA, task.system].filter(Boolean).join('\n\n')
  const user = [
    setting ? `# 这本书的设定\n\n${setting}` : '# 这本书的设定\n\n（这本书还没有设定数据。）',
    task.frame(request, context),
    asked ? `### 篇幅要求\n这一轮回答请控制在 ${asked} 字左右。不要为了凑字数注水，也不要大幅超出。` : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  return {
    task: task.key,
    system,
    user,
    words: asked,
    maxTokens: resolveMaxTokens(request.maxTokens, task.maxTokens, asked),
    stats: {
      system: system.length,
      user: user.length,
      setting: setting.length,
      characters: (context.characters ?? []).length,
      chapters: (context.chapters ?? []).length,
      edges: (context.edges ?? []).length,
      issues: (context.issues ?? []).length,
      pools: (context.pools ?? []).filter((p) => p && !RENDERED_POOLS.has(p.key) && (p.items ?? []).some((i) => i?.on)).length,
    },
  }
}

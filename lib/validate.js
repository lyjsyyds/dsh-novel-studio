// dsh-novel-studio — consistency checks.
//
// A novel outgrows one person's memory: a character gets renamed, a faction
// leader stops existing, a foreshadowing never pays off. This module reads the
// whole book and reports what no longer lines up.
//
// It never writes. Every rule is a pure function of the files, so running it is
// always safe, and the assistant can call it to check its own work.
//
// Rules are declarative and extensible: an extension may export
// `rules: [{ id, zh, en, level, run(ctx) }]` and they run alongside the built-ins.
//
// Levels
//   error  the book is broken (a file the panel cannot render)
//   warn   something is inconsistent (a link to nobody)
//   info   worth knowing, not wrong (a thread still open)

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const V = new URL(import.meta.url).searchParams.get('v') ?? '0'
const { getSchema } = await import(`./schema.js?v=${V}`)
const { listUnit } = await import(`./records.js?v=${V}`)
const { buildGraph } = await import(`./graph.js?v=${V}`)

const LEVEL_ORDER = { error: 0, warn: 1, info: 2 }

/** Kinds that hold addressable entries and can therefore be checked. */
const SCANNED = new Set(['records', 'doc', 'chapters'])

// ── scanning ──────────────────────────────────────────────────────────────

/** Every declared unit that holds data, with its entries already materialised. */
async function scanUnits(bookDir, schema) {
  const units = []
  for (const section of schema.sections) {
    const list = section.kind === 'groups' ? section.groups || [] : [section]
    for (const unit of list) {
      if (!SCANNED.has(unit.kind)) continue
      const { items } = await listUnit(bookDir, unit)
      units.push({ section, unit, items })
    }
  }
  return units
}

/** Every string value reachable in an entry, for `[[ref]]` scanning. */
function stringsOf(value, out = [], depth = 0) {
  if (depth > 4 || out.length > 400) return out
  if (typeof value === 'string') {
    if (value) out.push(value)
  } else if (Array.isArray(value)) {
    for (const v of value) stringsOf(v, out, depth + 1)
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) stringsOf(v, out, depth + 1)
  }
  return out
}

/** Chapter files carry prose in their body, so read them straight off disk. */
async function chapterTexts(bookDir) {
  const dir = join(bookDir, 'chapters')
  let names
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith('.md'))
  } catch {
    return []
  }
  const out = []
  for (const name of names) {
    try {
      out.push({ id: name.replace(/\.md$/, ''), text: await readFile(join(dir, name), 'utf8') })
    } catch {
      /* unreadable chapter is reported by its own rule */
    }
  }
  return out
}

/** `[[名]]` / `[[名|显示文本]]` wiki-links. */
const REF = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g

// ── timeline helpers (used by the foreshadowing / character rules) ────────

/**
 * Chapter order plus each chapter's prose. Chapter bodies only ever reach a
 * rule through `ctx.texts` (the `章节 · <id>` entries), so this assembles them
 * once from there instead of re-reading the disk per rule.
 */
function timeline(ctx) {
  const bodies = new Map()
  for (const t of ctx.texts) {
    const m = /^章节 · (.+)$/.exec(String(t.where || ''))
    if (m) bodies.set(m[1], `${bodies.get(m[1]) || ''}${t.text}`)
  }
  const chapters = []
  for (const { unit, items } of ctx.units.filter((u) => u.unit.kind === 'chapters')) {
    for (const item of items) {
      const id = String(item.id ?? '')
      const n = Number(/^(\d+)/.exec(id)?.[1])
      chapters.push({ id, n: Number.isFinite(n) ? n : null, title: String(item.title || id), text: bodies.get(id) || '' })
    }
  }
  const numbered = chapters.filter((c) => c.n !== null).sort((a, b) => a.n - b.n)
  return { chapters, numbered, latest: numbered.length ? numbered[numbered.length - 1].n : 0 }
}

/** First and last numbered chapter whose prose mentions any of `needles`. */
function spanOf(tl, needles) {
  let first = null
  let last = null
  for (const c of tl.numbered) {
    if (!needles.some((n) => n && c.text.includes(n))) continue
    if (first === null) first = c
    last = c
  }
  return { first, last }
}

/** The first chapter number mentioned in free text such as "第 12 章" or "12". */
function chapterNo(value) {
  const m = /(\d+)/.exec(String(value ?? ''))
  return m ? Number(m[1]) : null
}

/** A token the prose might plausibly contain: 中文 can be a single character. */
function usable(token) {
  const s = String(token ?? '').trim()
  if (!s || /^\d+$/.test(s)) return false
  return s.length >= 2 || /[\u3400-\u9fff]/.test(s)
}

/** The names a record may be mentioned by in prose. */
function aliases(item) {
  const out = [item?.name, item?.title, item?.id].map((v) => String(v ?? '').trim()).filter(usable)
  return [...new Set(out)]
}

/** Split a free-text field into keyword candidates (秘密 / 已知信息). */
function keywordsOf(value) {
  return [...new Set(String(value ?? '')
    .split(/[、，,;；/／|｜\s\n]+/)
    .map((s) => s.trim())
    .filter(usable))]
}


// ── rules ─────────────────────────────────────────────────────────────────

const RULES = [
  {
    id: 'book-title',
    zh: '书名',
    en: 'Book title',
    level: 'error',
    run: (ctx) => {
      if (!String(ctx.book.title ?? '').trim()) ctx.add('book-title', 'error', 'book.yaml 里没有书名')
    },
  },

  {
    id: 'dangling-edge',
    zh: '关系指向空条目',
    en: 'Dangling edge',
    level: 'warn',
    run: (ctx) => {
      for (const p of ctx.graph.problems.filter((x) => x.code === 'dangling-edge')) {
        ctx.add('dangling-edge', 'warn', `关系「${p.from} → ${p.to}」有一端没有对应条目`, { ref: `${p.from}→${p.to}` })
      }
    },
  },

  {
    id: 'self-edge',
    zh: '自己连自己',
    en: 'Self edge',
    level: 'warn',
    run: (ctx) => {
      for (const p of ctx.graph.problems.filter((x) => x.code === 'self-edge')) {
        ctx.add('self-edge', 'warn', `「${p.id}」有一条指向自己的关系`, { id: p.id })
      }
    },
  },

  {
    id: 'duplicate-edge',
    zh: '重复关系',
    en: 'Duplicate edge',
    level: 'warn',
    run: (ctx) => {
      const seen = new Set()
      for (const p of ctx.graph.problems.filter((x) => x.code === 'duplicate-edge')) {
        if (seen.has(p.message)) continue
        seen.add(p.message)
        ctx.add('duplicate-edge', 'warn', `「${p.from} → ${p.to}」被写了不止一次`, { from: p.from, to: p.to })
      }
    },
  },

  {
    id: 'broken-link-field',
    zh: '字段指向空条目',
    en: 'Broken link field',
    level: 'warn',
    run: (ctx) => {
      for (const p of ctx.graph.problems.filter((x) => x.code === 'broken-link-field')) {
        ctx.add('broken-link-field', 'warn', `「${p.id}」的「${p.field}」指向不存在的条目`, { id: p.id, field: p.field })
      }
    },
  },

  {
    id: 'broken-ref',
    zh: '正文引用不存在',
    en: 'Broken reference',
    level: 'warn',
    run: (ctx) => {
      const rows = []
      for (const { where, text } of ctx.texts) {
        REF.lastIndex = 0
        let m
        while ((m = REF.exec(text))) {
          const target = m[1].trim()
          if (!target || ctx.known.has(target)) continue
          rows.push({ where, target })
        }
      }
      const unique = [...new Map(rows.map((r) => [`${r.where}\u0000${r.target}`, r])).values()]
      for (const r of unique.slice(0, 20)) {
        ctx.add('broken-ref', 'warn', `[[${r.target}]] 指向不存在的条目（${r.where}）`, { ref: r.target, where: r.where })
      }
      if (unique.length > 20) ctx.add('broken-ref', 'warn', `另有 ${unique.length - 20} 处引用不存在`)
    },
  },

  {
    id: 'untitled-entry',
    zh: '条目没有标题',
    en: 'Untitled entry',
    level: 'warn',
    run: (ctx) => {
      for (const { section, unit, items } of ctx.units) {
        // No declared title field means the section has no notion of a title
        // (chapters name themselves after their file, `files` entries are raw
        // bytes). Guessing `unit.key` here only ever produced nonsense such as
        // `没有填「chapters」`, so skip instead.
        const key = unit.titleField
        if (!key) continue
        const where = section.zh === unit.zh ? section.zh : `${section.zh}/${unit.zh}`
        for (const item of items) {
          const id = String(item.id ?? '')
          if (!id) continue
          if (String(item[key] ?? '').trim()) continue
          ctx.add('untitled-entry', 'warn', `${where} 的「${id}」没有填「${key}」`, {
            section: section.key, group: unit.key, id,
          })
        }
      }
    },
  },

  {
    id: 'empty-chapter',
    zh: '空章节',
    en: 'Empty chapter',
    level: 'warn',
    run: (ctx) => {
      for (const { unit, items } of ctx.units.filter((u) => u.unit.kind === 'chapters')) {
        for (const item of items) {
          if (Number(item.words ?? 0) > 0) continue
          ctx.add('empty-chapter', 'warn', `章节「${item.title || item.id}」还没有正文`, { id: String(item.id) })
        }
      }
      void ctx
    },
  },

  {
    id: 'chapter-sequence',
    zh: '章节编号',
    en: 'Chapter numbering',
    level: 'info',
    run: (ctx) => {
      const nums = []
      for (const { unit, items } of ctx.units.filter((u) => u.unit.kind === 'chapters')) {
        for (const item of items) {
          const id = String(item.id ?? '')
          const m = /^(\d+)/.exec(id)
          if (!m) continue
          nums.push({ n: Number(m[1]), id })
        }
      }
      if (nums.length < 2) return
      nums.sort((a, b) => a.n - b.n)
      const dup = nums.filter((x, i) => i > 0 && nums[i - 1].n === x.n)
      const gaps = []
      for (let i = 1; i < nums.length; i += 1) {
        if (nums[i].n - nums[i - 1].n > 1) gaps.push(`${nums[i - 1].n} → ${nums[i].n}`)
      }
      if (dup.length) ctx.add('chapter-sequence', 'warn', `章节编号重复：${dup.map((d) => d.id).join('、')}`)
      if (gaps.length) ctx.add('chapter-sequence', 'info', `章节编号不连续：${gaps.join('、')}`)
    },
  },

  {
    id: 'unresolved-foreshadowing',
    zh: '伏笔未回收',
    en: 'Unresolved foreshadowing',
    level: 'info',
    run: (ctx) => {
      for (const { unit, items } of ctx.units.filter((u) => u.unit.listKey === 'items' || u.unit.key === 'foreshadowing')) {
        for (const item of items) {
          const paid = String(item.payoff ?? item.resolved ?? item.status ?? '').trim()
          if (paid) continue
          const label = item.name || item.title || item.text || `#${items.indexOf(item)}`
          ctx.add('unresolved-foreshadowing', 'info', `伏笔「${label}」还没有回收`, { id: String(item.id ?? label) })
        }
      }
      void ctx
    },
  },

  {
    id: 'open-thread',
    zh: '线索未收束',
    en: 'Open thread',
    level: 'info',
    run: (ctx) => {
      for (const { unit, items } of ctx.units.filter((u) => u.key === 'threads')) {
        for (const item of items) {
          const done = String(item.status ?? item.resolution ?? '').trim()
          if (done) continue
          const label = item.name || item.title || `#${items.indexOf(item)}`
          ctx.add('open-thread', 'info', `线索「${label}」还没有标注状态`, { id: String(item.id ?? label) })
        }
      }
      void ctx
    },
  },

  {
    id: 'isolated-node',
    zh: '孤立节点',
    en: 'Isolated node',
    level: 'info',
    run: (ctx) => {
      const orphans = ctx.graph.stats.orphans || []
      if (!orphans.length) return
      const shown = orphans.slice(0, 10).join('、')
      const more = orphans.length > 10 ? `（还有 ${orphans.length - 10} 个）` : ''
      ctx.add('isolated-node', 'info', `${orphans.length} 个条目还没有任何关系：${shown}${more}`, { count: orphans.length })
    },
  },

  {
    id: 'empty-sections',
    zh: '空分区',
    en: 'Empty sections',
    level: 'info',
    run: (ctx) => {
      const empty = ctx.units.filter((u) => u.items.length === 0).map((u) => u.unit.zh || u.unit.key)
      if (!empty.length) return
      ctx.add('empty-sections', 'info', `${empty.length} 个分区还是空的：${empty.join('、')}`, { count: empty.length })
    },
  },

  // ── 伏笔因果网络 (foreshadowing: planted → due → paid) ───────────────────

  {
    id: 'foreshadowing-overdue',
    zh: '伏笔超期未回收',
    en: 'Foreshadowing overdue',
    level: 'warn',
    run: (ctx) => {
      const tl = timeline(ctx)
      if (!tl.latest) return
      for (const { unit, items } of ctx.units.filter((u) => u.unit.key === 'foreshadowing' || u.unit.listKey === 'items')) {
        for (const item of items) {
          const state = String(item.status ?? '').trim()
          if (state === '已回收' || state === 'Resolved' || state === '已废弃' || state === 'Dropped') continue
          const due = chapterNo(item.due)
          if (due === null || due > tl.latest) continue
          const label = item.name || item.title || item.text || `#${items.indexOf(item)}`
          ctx.add('foreshadowing-overdue', 'warn',
            `伏笔「${label}」约定第 ${due} 章回收，正文已经写到第 ${tl.latest} 章还挂着`,
            { id: String(item.id ?? label), due, latest: tl.latest })
        }
      }
    },
  },

  {
    id: 'foreshadowing-stale',
    zh: '伏笔放太久',
    en: 'Foreshadowing left too long',
    level: 'info',
    run: (ctx) => {
      const tl = timeline(ctx)
      if (!tl.latest) return
      for (const { unit, items } of ctx.units.filter((u) => u.unit.key === 'foreshadowing' || u.unit.listKey === 'items')) {
        for (const item of items) {
          const state = String(item.status ?? '').trim()
          if (state === '已回收' || state === 'Resolved' || state === '已废弃' || state === 'Dropped') continue
          const planted = chapterNo(item.plantedChapter) ?? chapterNo(item.planted)
          if (planted === null) continue
          const age = tl.latest - planted
          if (age < 20) continue
          const label = item.name || item.title || item.text || `#${items.indexOf(item)}`
          ctx.add('foreshadowing-stale', 'info',
            `伏笔「${label}」第 ${planted} 章埋下，已经过了 ${age} 章还没回收`,
            { id: String(item.id ?? label), planted, age })
        }
      }
    },
  },

  {
    id: 'foreshadowing-rushed',
    zh: '伏笔回收太急',
    en: 'Foreshadowing paid off too soon',
    level: 'info',
    run: (ctx) => {
      for (const { unit, items } of ctx.units.filter((u) => u.unit.key === 'foreshadowing' || u.unit.listKey === 'items')) {
        for (const item of items) {
          const planted = chapterNo(item.plantedChapter) ?? chapterNo(item.planted)
          const paid = chapterNo(item.payoff)
          if (planted === null || paid === null) continue
          const span = paid - planted
          if (span > 1 || span < 0) continue
          const label = item.name || item.title || item.text || `#${items.indexOf(item)}`
          ctx.add('foreshadowing-rushed', 'info',
            `伏笔「${label}」第 ${planted} 章埋、第 ${paid} 章就收，跨度只有 ${span} 章，可能收得太急`,
            { id: String(item.id ?? label), planted, payoff: paid })
        }
      }
    },
  },

  // ── 主动副驾驶 (data-driven nudges: who vanished, who came back) ─────────

  {
    id: 'absent-character',
    zh: '配角长期未出场',
    en: 'Character absent for a long stretch',
    level: 'info',
    run: (ctx) => {
      const tl = timeline(ctx)
      if (tl.latest < 12) return
      for (const { unit, items } of ctx.units.filter((u) => u.unit.key === 'characters')) {
        for (const item of items) {
          const role = String(item.role ?? '').trim()
          if (role === '路人' || role === 'Minor' || role === '其他' || role === 'Other') continue
          const span = spanOf(tl, aliases(item))
          if (!span.last) continue
          const away = tl.latest - span.last.n
          if (away < 10) continue
          const label = item.name || item.title || item.id
          ctx.add('absent-character', 'info',
            `人物「${label}」从第 ${span.last.n} 章之后就没再出场，已经过了 ${away} 章`,
            { id: String(item.id ?? label), last: span.last.n, away })
        }
      }
    },
  },

  {
    id: 'exit-then-appear',
    zh: '退场后又出场',
    en: 'Back after exiting',
    level: 'warn',
    run: (ctx) => {
      const tl = timeline(ctx)
      if (!tl.latest) return
      for (const { unit, items } of ctx.units.filter((u) => u.unit.key === 'characters')) {
        for (const item of items) {
          const exit = chapterNo(item.exitChapter)
          if (exit === null) continue
          const later = tl.numbered.find((c) => c.n > exit && aliases(item).some((n) => c.text.includes(n)))
          if (!later) continue
          const label = item.name || item.title || item.id
          ctx.add('exit-then-appear', 'warn',
            `人物「${label}」标注在第 ${exit} 章退场，却出现在第 ${later.n} 章「${later.title}」`,
            { id: String(item.id ?? label), exit, chapter: later.id })
        }
      }
    },
  },

  // ── 信息不对称 (asymmetric information: who may know what) ──────────────

  {
    id: 'secret-leak',
    zh: '秘密可能提前泄露',
    en: 'Secret may leak early',
    level: 'warn',
    run: (ctx) => {
      const tl = timeline(ctx)
      if (!tl.latest) return
      for (const { unit, items } of ctx.units.filter((u) => u.unit.key === 'characters')) {
        for (const item of items) {
          const learns = chapterNo(item.learns)
          if (learns === null) continue
          const names = aliases(item)
          if (!names.length) continue
          const label = item.name || item.title || item.id
          let hits = 0
          for (const token of keywordsOf(item.secret)) {
            const early = tl.numbered.find((c) => c.n < learns
              && c.text.includes(token)
              && names.some((n) => c.text.includes(n)))
            if (!early) continue
            ctx.add('secret-leak', 'warn',
              `第 ${early.n} 章里「${label}」与「${token}」同场出现，但设定里他到第 ${learns} 章才知道`,
              { id: String(item.id ?? label), chapter: early.id, token })
            hits += 1
            if (hits >= 5) break
          }
        }
      }
    },
  },

  {
    id: 'info-boundary',
    zh: '信息边界没记',
    en: 'No information boundary recorded',
    level: 'info',
    run: (ctx) => {
      const tl = timeline(ctx)
      if (!tl.latest) return
      for (const { unit, items } of ctx.units.filter((u) => u.unit.key === 'characters')) {
        for (const item of items) {
          if (String(item.knows ?? '').trim() || String(item.secret ?? '').trim()) continue
          const span = spanOf(tl, aliases(item))
          if (!span.first) continue
          const label = item.name || item.title || item.id
          ctx.add('info-boundary', 'info',
            `人物「${label}」已经在正文里出场，但「已知信息 / 秘密」还是空的：审稿时无从判断他该知道什么`,
            { id: String(item.id ?? label) })
        }
      }
    },
  },
]

/** Rule catalogue for the panel and the guide. */
export async function ruleList() {
  const schema = await getSchema()
  return [
    ...RULES,
    ...(schema.extraRules || []),
  ].map((r) => ({ id: r.id, zh: r.zh, en: r.en, level: r.level }))
}

/**
 * Check one book. Never throws on a broken book — a rule that blows up becomes
 * an error issue instead, so one bad file cannot hide the rest of the report.
 *
 * @param {string} bookDir
 * @param {object} book   the book.yaml contents (for its title)
 */
export async function validateBook(bookDir, book = {}) {
  const schema = await getSchema()
  const units = await scanUnits(bookDir, schema)
  const graph = await buildGraph(bookDir)

  // Known ids and labels, so `[[林望]]` and `[[林望.yaml]]` both resolve.
  const known = new Set()
  for (const { unit, items } of units) {
    const key = unit.titleField || unit.key
    for (const item of items) {
      if (item.id) known.add(String(item.id))
      if (item[key]) known.add(String(item[key]).trim())
      if (item.name) known.add(String(item.name).trim())
    }
  }
  for (const n of graph.nodes) {
    known.add(n.id)
    known.add(n.label)
  }
  known.delete('')

  const texts = []
  for (const { unit, items } of units) {
    for (const item of items) {
      for (const s of stringsOf(item)) texts.push({ where: `${unit.zh || unit.key}${item.id ? ' · ' + item.id : ''}`, text: s })
    }
  }
  for (const c of await chapterTexts(bookDir)) texts.push({ where: `章节 · ${c.id}`, text: c.text })

  const issues = []
  const ctx = {
    book,
    dir: bookDir,
    schema,
    units,
    graph,
    known,
    texts,
    add: (rule, level, message, extra = null) => {
      issues.push({ rule, level, message, ...(extra || {}) })
    },
  }

  const rules = [...RULES, ...(schema.extraRules || [])]
  for (const rule of rules) {
    try {
      await rule.run(ctx)
    } catch (err) {
      issues.push({
        rule: rule.id,
        level: 'error',
        message: `规则「${rule.zh || rule.id}」执行失败：${String(err?.message || err)}`,
      })
    }
  }

  issues.sort((a, b) => (LEVEL_ORDER[a.level] ?? 3) - (LEVEL_ORDER[b.level] ?? 3) || String(a.rule).localeCompare(String(b.rule)))

  const counts = { error: 0, warn: 0, info: 0 }
  for (const i of issues) if (i.level in counts) counts[i.level] += 1

  return {
    ok: counts.error === 0,
    clean: issues.length === 0,
    counts,
    issues,
    scanned: {
      units: units.length,
      entries: units.reduce((n, u) => n + u.items.length, 0),
      nodes: graph.stats.nodes,
      edges: graph.stats.edges,
    },
  }
}

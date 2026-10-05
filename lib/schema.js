// dsh-novel-studio — declarative description of a book's structure.
//
// This is the single source of truth for both halves: the host uses it to decide
// which paths may be read/written (client-supplied paths are never trusted), and
// the client fetches it from GET /schema to render lists and forms. Adding a new
// field or a whole new group here is enough — no client change required.
//
// Shapes
//   records   one YAML file per entry, under `dir`
//   doc       one YAML file holding an array under `listKey`
//   chapters  one Markdown file per entry, with YAML front matter
//   files     raw files in a directory (text ones are editable)
//   overview  the read-only landing panel

// The studio's stage number, reported by GET /ping and /bootstrap so the panel
// can print it without carrying its own copy. Bump it when a stage lands.
export const STAGE = 9

/** Field shorthand: key, zh label, en label, type, extra options. */
const f = (k, zh, en, type = 'text', extra = null) => ({ k, zh, en, type, ...(extra || {}) })

/** Select options as [value, zh, en] triples. */
const opts = (...rows) => rows.map(([v, zh, en]) => ({ v, zh, en }))

// ── shared vocabularies ───────────────────────────────────────────────────

const CHARACTER_FIELDS = [
  f('name', '姓名', 'Name'),
  f('aliases', '别名', 'Aliases', 'tags'),
  f('role', '定位', 'Role', 'select', {
    options: opts(['主角', '主角', 'Protagonist'], ['配角', '配角', 'Supporting'], ['反派', '反派', 'Antagonist'], ['路人', '路人', 'Minor'], ['其他', '其他', 'Other']),
  }),
  f('age', '年龄', 'Age'),
  f('gender', '性别', 'Gender'),
  f('appearance', '外貌', 'Appearance', 'textarea'),
  f('personality', '性格', 'Personality', 'textarea'),
  f('habits', '习惯', 'Habits', 'textarea'),
  f('background', '背景', 'Background', 'textarea'),
  f('goal', '目标', 'Goal', 'textarea'),
  f('arc', '人物弧光', 'Character arc', 'textarea'),
  f('relations', '人际关系', 'Relationships', 'textarea'),
  f('knows', '已知信息', 'Knows', 'textarea'),
  f('secret', '秘密 / 未知', 'Secrets', 'textarea'),
  f('learns', '得知章', 'Learns by'),
  f('exitChapter', '退场章', 'Exits at'),
  f('notes', '备注', 'Notes', 'textarea'),
]

const OVERVIEW_FIELDS = [
  f('title', '标题', 'Title'),
  f('summary', '梗概', 'Summary', 'textarea'),
]

// ── sections ──────────────────────────────────────────────────────────────

export const SECTIONS = [
  { key: 'overview', zh: '总览', en: 'Overview', kind: 'overview' },

  {
    key: 'characters', zh: '人物', en: 'Characters',
    kind: 'records', dir: 'characters', titleField: 'name',
    fields: CHARACTER_FIELDS,
  },

  {
    key: 'world', zh: '世界观', en: 'World', kind: 'groups',
    groups: [
      { key: 'locations', zh: '地点', en: 'Locations', kind: 'records', dir: 'world/locations', titleField: 'name', fields: [
        f('name', '名称', 'Name'),
        f('type', '类型', 'Type', 'select', { options: opts(['城市', '城市', 'City'], ['地区', '地区', 'Region'], ['建筑', '建筑', 'Building'], ['自然', '自然', 'Nature'], ['遗迹', '遗迹', 'Ruin'], ['其他', '其他', 'Other']) }),
        f('region', '所属区域', 'Region'),
        f('summary', '一句话', 'One-liner'),
        f('description', '详述', 'Description', 'textarea'),
        f('notes', '备注', 'Notes', 'textarea'),
      ] },
      { key: 'factions', zh: '势力', en: 'Factions', kind: 'records', dir: 'world/factions', titleField: 'name', fields: [
        f('name', '名称', 'Name'),
        f('type', '类型', 'Type', 'select', { options: opts(['国家', '国家', 'Nation'], ['组织', '组织', 'Organization'], ['家族', '家族', 'House'], ['教会', '教会', 'Church'], ['商会', '商会', 'Guild'], ['其他', '其他', 'Other']) }),
        f('leader', '首领', 'Leader'),
        f('members', '成员', 'Members', 'tags'),
        f('base', '驻地', 'Base'),
        f('goal', '目标', 'Goal', 'textarea'),
        f('description', '详述', 'Description', 'textarea'),
        f('notes', '备注', 'Notes', 'textarea'),
      ] },
      { key: 'items', zh: '物品', en: 'Items', kind: 'records', dir: 'world/items', titleField: 'name', fields: [
        f('name', '名称', 'Name'),
        f('type', '类型', 'Type', 'select', { options: opts(['武器', '武器', 'Weapon'], ['防具', '防具', 'Armor'], ['道具', '道具', 'Tool'], ['材料', '材料', 'Material'], ['法宝', '法宝', 'Artifact'], ['其他', '其他', 'Other']) }),
        f('rarity', '稀有度', 'Rarity', 'select', { options: opts(['普通', '普通', 'Common'], ['精良', '精良', 'Fine'], ['稀有', '稀有', 'Rare'], ['史诗', '史诗', 'Epic'], ['传说', '传说', 'Legendary']) }),
        f('owner', '持有者', 'Holder', 'tags'),
        f('description', '详述', 'Description', 'textarea'),
        f('notes', '备注', 'Notes', 'textarea'),
      ] },
      { key: 'races', zh: '种族', en: 'Races', kind: 'records', dir: 'world/races', titleField: 'name', fields: [
        f('name', '名称', 'Name'),
        f('traits', '特征', 'Traits', 'textarea'),
        f('homeland', '聚居地', 'Homeland'),
        f('description', '详述', 'Description', 'textarea'),
      ] },
      { key: 'cultures', zh: '文化', en: 'Cultures', kind: 'records', dir: 'world/cultures', titleField: 'name', fields: [
        f('name', '名称', 'Name'),
        f('customs', '习俗', 'Customs', 'textarea'),
        f('language', '语言', 'Language'),
        f('taboos', '禁忌', 'Taboos', 'textarea'),
        f('description', '详述', 'Description', 'textarea'),
      ] },
      { key: 'rules', zh: '规则', en: 'Rules', kind: 'doc', path: 'world/rules.yaml', listKey: 'rules', titleField: 'name', fields: [
        f('name', '规则名', 'Name'),
        f('scope', '适用范围', 'Scope'),
        f('description', '说明', 'Description', 'textarea'),
      ] },
      { key: 'glossary', zh: '术语', en: 'Glossary', kind: 'doc', path: 'world/glossary.yaml', listKey: 'terms', titleField: 'term', fields: [
        f('term', '术语', 'Term'),
        f('definition', '释义', 'Definition', 'textarea'),
      ] },
      { key: 'economy', zh: '经济', en: 'Economy', kind: 'doc', path: 'world/economy.yaml', listKey: 'currencies', titleField: 'name', fields: [
        f('name', '名称', 'Name'),
        f('unit', '单位', 'Unit'),
        f('rate', '兑换', 'Exchange'),
        f('description', '说明', 'Description', 'textarea'),
      ] },
      { key: 'timeline', zh: '年表', en: 'Timeline', kind: 'doc', path: 'world/timeline.yaml', listKey: 'events', titleField: 'event', fields: [
        f('when', '时间', 'When'),
        f('event', '事件', 'Event'),
        f('description', '说明', 'Description', 'textarea'),
      ] },
    ],
  },

  {
    key: 'outline', zh: '大纲', en: 'Outline', kind: 'groups',
    groups: [
      { key: 'tree', zh: '卷章结构', en: 'Arcs', kind: 'doc', path: 'outline/tree.yaml', listKey: 'arcs', titleField: 'title', fields: [
        f('title', '标题', 'Title'),
        f('from', '起', 'From'),
        f('to', '止', 'To'),
        f('summary', '梗概', 'Summary', 'textarea'),
      ] },
      { key: 'threads', zh: '线索', en: 'Threads', kind: 'doc', path: 'outline/threads.yaml', listKey: 'threads', titleField: 'title', fields: [
        f('title', '线索', 'Thread'),
        f('kind', '类型', 'Kind', 'select', { options: opts(['主线', '主线', 'Main'], ['支线', '支线', 'Side'], ['感情', '感情', 'Romance'], ['悬念', '悬念', 'Mystery']) }),
        f('status', '状态', 'Status', 'select', { options: opts(['未开始', '未开始', 'Planned'], ['进行中', '进行中', 'Active'], ['已收束', '已收束', 'Closed']) }),
        f('summary', '摘要', 'Summary', 'textarea'),
      ] },
      { key: 'foreshadowing', zh: '伏笔', en: 'Foreshadowing', kind: 'doc', path: 'outline/foreshadowing.yaml', listKey: 'items', titleField: 'title', fields: [
        f('title', '伏笔', 'Setup'),
        f('planted', '埋设处', 'Planted in'),
        f('plantedChapter', '埋设章', 'Setup chapter'),
        f('payoff', '回收处', 'Paid off in'),
        f('due', '预期回收章', 'Due chapter'),
        f('status', '状态', 'Status', 'select', { options: opts(['未回收', '未回收', 'Open'], ['已回收', '已回收', 'Resolved'], ['已废弃', '已废弃', 'Dropped']) }),
        f('notes', '备注', 'Notes', 'textarea'),
      ] },
      { key: 'beats', zh: '节拍', en: 'Beats', kind: 'doc', path: 'outline/beats.yaml', listKey: 'beats', titleField: 'beat', fields: [
        f('chapter', '章节', 'Chapter'),
        f('beat', '节拍', 'Beat'),
        f('purpose', '作用', 'Purpose', 'textarea'),
      ] },
      { key: 'hooks', zh: '钩子', en: 'Hooks', kind: 'doc', path: 'outline/hooks.yaml', listKey: 'hooks', titleField: 'title', fields: [
        f('title', '钩子', 'Hook'),
        f('kind', '类型', 'Kind', 'select', { options: opts(['开篇', '开篇', 'Opening'], ['章节末', '章节末', 'Chapter end'], ['卷末', '卷末', 'Volume end']) }),
        f('description', '说明', 'Description', 'textarea'),
      ] },
      { key: 'scenes', zh: '场景', en: 'Scenes', kind: 'records', dir: 'outline/scenes', titleField: 'title', fields: [
        f('title', '标题', 'Title'),
        f('chapter', '所属章节', 'Chapter'),
        f('location', '地点', 'Location'),
        f('characters', '出场人物', 'Characters', 'tags'),
        f('goal', '目标', 'Goal', 'textarea'),
        f('conflict', '冲突', 'Conflict', 'textarea'),
        f('outcome', '结果', 'Outcome', 'textarea'),
      ] },
    ],
  },

  {
    key: 'panels', zh: '面板', en: 'Panels', kind: 'groups',
    groups: [
      { key: 'status', zh: '人物属性', en: 'Attributes', kind: 'doc', path: 'panels/status.yaml', listKey: 'fields', titleField: 'name', fields: [
        f('name', '属性', 'Attribute'),
        f('owners', '所属人物', 'Owners', 'tags'),
        f('value', '当前值', 'Value'),
        f('max', '上限', 'Max'),
        f('note', '说明', 'Note', 'textarea'),
      ] },
      { key: 'skills', zh: '技能', en: 'Skills', kind: 'doc', path: 'panels/skills.yaml', listKey: 'skills', titleField: 'name', fields: [
        f('name', '技能', 'Skill'),
        f('owners', '所属人物', 'Owners', 'tags'),
        f('level', '等级', 'Level'),
        f('type', '类型', 'Type'),
        f('description', '说明', 'Description', 'textarea'),
      ] },
      { key: 'equipment', zh: '装备', en: 'Equipment', kind: 'doc', path: 'panels/equipment.yaml', listKey: 'slots', titleField: 'name', fields: [
        f('name', '装备', 'Item'),
        f('owners', '所属人物', 'Owners', 'tags'),
        f('type', '部位', 'Slot'),
        f('equipped', '已装备', 'Equipped', 'boolean'),
        f('description', '说明', 'Description', 'textarea'),
      ] },
      { key: 'tasks', zh: '任务', en: 'Tasks', kind: 'doc', path: 'panels/tasks.yaml', listKey: 'tasks', titleField: 'title', fields: [
        f('title', '任务', 'Task'),
        f('owners', '所属人物', 'Owners', 'tags'),
        f('status', '状态', 'Status', 'select', { options: opts(['未接', '未接', 'Available'], ['进行中', '进行中', 'Active'], ['已完成', '已完成', 'Done'], ['已失败', '已失败', 'Failed']) }),
        f('reward', '奖励', 'Reward'),
        f('description', '说明', 'Description', 'textarea'),
      ] },
      { key: 'reputation', zh: '声望', en: 'Reputation', kind: 'doc', path: 'panels/reputation.yaml', listKey: 'factions', titleField: 'faction', fields: [
        f('faction', '势力', 'Faction'),
        f('owners', '所属人物', 'Owners', 'tags'),
        f('value', '声望值', 'Value', 'number'),
        f('note', '说明', 'Note', 'textarea'),
      ] },
    ],
  },

  {
    key: 'chapters', zh: '正文', en: 'Chapters', kind: 'chapters', dir: 'chapters', titleField: 'title',
    fields: [
      f('title', '标题', 'Title'),
      f('status', '状态', 'Status', 'select', { options: opts(['草稿', '草稿', 'Draft'], ['写作中', '写作中', 'In progress'], ['已完成', '已完成', 'Done']) }),
      f('summary', '摘要', 'Summary', 'textarea'),
    ],
  },

  { key: 'materials', zh: '素材', en: 'Materials', kind: 'files', dir: 'materials' },

  // Draft snapshots written by the chapter editor ("存为草稿"). A plain files
  // unit: the file name carries the chapter and the timestamp, the body is the
  // prose, and nothing else reads it — restoring is an explicit action.
  { key: 'drafts', zh: '草稿', en: 'Drafts', kind: 'files', dir: 'drafts' },
]

// ── extension points ──────────────────────────────────────────────────────
//
// Anything under lib/extensions/*.js is discovered at runtime and merged into
// the schema. That is the intended way to add a feature or a whole new panel
// later — by a human or by an AI — without touching this file or the client:
//
//   // lib/extensions/timeline-vis.js
//   export const id = 'timeline-vis'
//   export const zh = '时间线可视化'
//   export const sections = [{ key:'visual', zh:'可视化', en:'Visual', kind:'raw',
//                              path:'meta/visual.yaml', titleField:'title' }]
//   export const routes = [{ method:'GET', pattern:'/ext/timeline-vis/summary',
//                            handler: async (req,res,ctx) => ctx.json(res,{ok:true}) }]
//   export const tools  = [{ name:'novel_timeline_summary', description:'…',
//                            parameters:{type:'object',properties:{}}, run: async (a,ctx)=>… }]
//   export const graphs = [{ key:'orders', zh:'门派', section:'characters',
//                            label:'name', role:'role',
//                            links:[{ field:'order', type:'隶属' }] }]
//   export const rules  = [{ id:'no-dead-narrator', zh:'主角不能死', level:'warn',
//                            run: (ctx)=>… }]
//   export const formats = [{ key:'epub', zh:'电子书', ext:'epub',
//                             mime:'application/epub+zip',
//                             render: (ctx)=>… }]
//   export const ai     = [{ key:'timeline', zh:'年表推演', needs:'none',
//                            maxTokens: 900, system:'你是年表编辑。',
//                            frame: (request, context)=>… }]
//
// `sections` may use any `kind` below. `fields` is optional everywhere: omit it
// and the client derives the form from the keys actually present in the data,
// which is what lets an AI invent a new panel without declaring a shape first.
//
// `graphs` adds a node kind to the relationship web; `rules` adds a consistency
// check; `formats` adds an export target; `ai` adds a task to the AI pane. All
// four appear in the panel the moment the file lands — see EXTENSIONS.md.
// An `ai` entry needs a unique `key`, a `zh` label and a `frame(request,
// context)`; it is handed the same context and the same persona as a built-in
// task. A key that collides with a built-in is ignored — built-ins win, and
// prompt.js (which owns TASKS) is the only place that knows their names.
//
// Kinds
//   records   one YAML file per entry under `dir`
//   doc       one YAML file holding an array under `listKey`
//   chapters  Markdown files with YAML front matter under `dir`
//   files     raw files in `dir`; text ones are editable
//   raw       a single YAML file edited as raw text — the escape hatch for a
//             structure the client does not understand
//   groups    a section that contains other units

import { readdir } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
export const EXT_DIR = join(HERE, 'extensions')

/** The seven built-in top-level keys, in shelf order. */
export const BUILTIN_KEYS = SECTIONS.map((s) => s.key)

/** Extensions discovered by the last getSchema() call, for diagnostics. */
let loadedExtensions = []

async function importExtensions() {
  let names
  try {
    names = await readdir(EXT_DIR)
  } catch {
    return [] // no extensions directory yet
  }
  const files = names.filter((n) => n.endsWith('.js') && !n.startsWith('_')).sort()
  const out = []
  for (const name of files) {
    // Token from our own URL so an extension edit is picked up together with the
    // rest of the reloadable layer.
    const token = new URL(import.meta.url).searchParams.get('v') ?? '0'
    const url = pathToFileURL(join(EXT_DIR, name)).href + `?v=${token}`
    try {
      const mod = await import(url)
      out.push({ file: name, mod })
    } catch (err) {
      console.error(`[novel-studio] extension ${name} failed to load:`, err)
      out.push({ file: name, mod: null, error: String(err?.message || err) })
    }
  }
  return out
}

let cache = null

/**
 * The resolved schema: built-ins plus every extension, flattened into lookup
 * helpers. Cached per module instance — the import token refresh invalidates it.
 */
export async function getSchema() {
  if (cache) return cache

  const extensions = await importExtensions()
  loadedExtensions = extensions.map(({ file, mod, error }) => ({
    file,
    id: mod?.id || file.replace(/\.js$/, ''),
    sections: mod?.sections?.length || 0,
    routes: mod?.routes?.length || 0,
    tools: mod?.tools?.length || 0,
    graphs: mod?.graphs?.length || 0,
    rules: mod?.rules?.length || 0,
    formats: mod?.formats?.length || 0,
    ai: mod?.ai?.length || 0,
    error: error || null,
  }))

  const sections = [...SECTIONS]
  const extraRoutes = []
  const extraTools = []
  const extraGraphKinds = []
  const extraRules = []
  const extraFormats = []
  const extraAiTasks = []
  for (const { file, mod } of extensions) {
    if (!mod) continue
    const id = mod.id || file.replace(/\.js$/, '')
    for (const s of mod.sections || []) {
      if (!s?.key || sections.some((x) => x.key === s.key)) {
        console.error(`[novel-studio] extension section "${s?.key}" skipped (missing or duplicate key)`)
        continue
      }
      sections.push(s)
    }
    for (const r of mod.routes || []) extraRoutes.push(r)
    for (const t of mod.tools || []) extraTools.push(t)
    for (const g of mod.graphs || []) {
      if (!g?.key || extraGraphKinds.some((x) => x.key === g.key)) {
        console.error(`[novel-studio] extension graph kind "${g?.key}" skipped (missing or duplicate key)`)
        continue
      }
      extraGraphKinds.push(g)
    }
    for (const r of mod.rules || []) {
      if (!r?.id || typeof r.run !== 'function') {
        console.error(`[novel-studio] extension rule "${r?.id}" skipped (needs an id and a run(ctx))`)
        continue
      }
      extraRules.push(r)
    }
    for (const f of mod.formats || []) {
      if (!f?.key || typeof f.render !== 'function' || extraFormats.some((x) => x.key === f.key)) {
        console.error(`[novel-studio] extension format "${f?.key}" skipped (needs a unique key and a render(ctx))`)
        continue
      }
      extraFormats.push(f)
    }
    for (const a of mod.ai || []) {
      // Same contract as a built-in task, plus the label the menu renders and the
      // frame() that turns one request into the ask. Collisions with a built-in
      // key are not checked here — prompt.js owns TASKS and built-ins win there,
      // so this module never has to hold a second copy of that list.
      if (!a?.key || typeof a.frame !== 'function' || !a.zh) {
        console.error(`[novel-studio] extension ai task "${a?.key}" skipped (needs a key, a zh label and a frame(request, context))`)
        continue
      }
      if (extraAiTasks.some((x) => x.key === a.key)) {
        console.error(`[novel-studio] extension ai task "${a.key}" skipped (duplicate key)`)
        continue
      }
      extraAiTasks.push({ needs: 'none', maxTokens: 1400, extension: id, ...a })
    }
  }

  const byKey = new Map(sections.map((s) => [s.key, s]))

  /**
   * Resolve a (sectionKey, groupKey) pair to its definition. For a section that
   * is itself a single unit the group is the section. Returns null for anything
   * not declared — callers use that as the allow-list for client-supplied paths.
   */
  const unitOf = (sectionKey, groupKey) => {
    const section = byKey.get(sectionKey)
    if (!section) return null
    if (section.kind === 'groups') {
      const group = (section.groups || []).find((g) => g.key === groupKey)
      return group ? { section, unit: group } : null
    }
    if (groupKey && groupKey !== sectionKey) return null
    return { section, unit: section }
  }

  /** Resolve a raw workspace-relative path to its owning unit, or null. */
  const unitByPath = (relPath) => {
    for (const section of sections) {
      const units = section.kind === 'groups' ? section.groups || [] : [section]
      for (const unit of units) {
        if (unit.path && unit.path === relPath) return { section, unit }
      }
    }
    return null
  }

  cache = { sections, byKey, unitOf, unitByPath, extraRoutes, extraTools, extraGraphKinds, extraRules, extraFormats, extraAiTasks, extensions: loadedExtensions }
  return cache
}

/** Diagnostic view of what got loaded — surfaced by GET /schema. */
export function extensionReport() {
  return loadedExtensions
}

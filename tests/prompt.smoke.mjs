// Prompt assembly is the part of the AI pane that decides what the model is
// told, so it is tested directly — no model, no network, no book on disk.
//
// Run: node tests/prompt.smoke.mjs

import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = resolve(HERE, '..', 'lib')

let passed = 0
const failures = []

function check(name, condition, extra) {
  if (condition) {
    passed += 1
    return
  }
  failures.push(extra === undefined ? name : `${name} — ${JSON.stringify(extra)}`)
}

function throwsWith(name, fn, code) {
  try {
    fn()
    check(name, false, 'did not throw')
  } catch (err) {
    check(name, err && err.code === code, { code: err && err.code, message: String(err && err.message) })
  }
}

const fresh = (mod, tag) => import(`${pathToFileURL(resolve(LIB, mod)).href}?v=${tag}`)

const tag = `p${Date.now()}`
const { LIMITS, TASKS, buildPrompt, listTasks, taskOf } = await fresh('prompt.js', tag)

// ── the menu ──────────────────────────────────────────────────────────────
{
  const tasks = listTasks()
  check('four tasks are on the menu', tasks.length === 4, tasks.map((t) => t.key))
  check(
    'the menu names the tasks the panel shows',
    tasks.map((t) => t.key).join() === 'continue,polish,outline,review',
    tasks.map((t) => t.key),
  )
  check('every task carries a hint', tasks.every((t) => typeof t.hint === 'string' && t.hint.length > 0))
  check('the menu is serializable', JSON.stringify(tasks).length > 0)
  check('taskOf defaults to continue', taskOf().key === 'continue')
  check('taskOf reads a key', taskOf('polish').key === 'polish')
  throwsWith('an unknown task is refused', () => taskOf('nope'), 'unknown-task')
  check('TASKS is the same menu', TASKS.length === 4)
}

// ── required inputs ───────────────────────────────────────────────────────
{
  throwsWith('continue without a chapter is refused', () => buildPrompt({ task: 'continue' }, {}), 'missing-argument')
  throwsWith('polish without text is refused', () => buildPrompt({ task: 'polish' }, {}), 'missing-argument')
  throwsWith('outline without an idea is refused', () => buildPrompt({ task: 'outline' }, {}), 'missing-argument')
  throwsWith('an unknown task never builds a prompt', () => buildPrompt({ task: 'nope' }, {}), 'unknown-task')
  // review has nothing to require: it reads whatever the book already reported.
  const built = buildPrompt({ task: 'review' }, { issues: [] })
  check('review builds with an empty book', typeof built.user === 'string' && built.user.length > 0)
}

// ── grounding: the book's own data reaches the prompt ─────────────────────
const book = { id: '星海拾遗', title: '星海拾遗', author: '测试作者', genre: '科幻', logline: '一个捡废品的少年捡到了一段记忆。' }

const context = {
  book,
  labels: { characters: { name: '姓名', role: '定位', personality: '性格', habits: '习惯' } },
  keys: { characters: ['name', 'role', 'personality', 'habits'] },
  characters: [
    { id: '林望', name: '林望', role: '主角', personality: '沉默但固执', habits: '咬笔帽' },
    { id: '老周', name: '老周', role: '配角', personality: '话多' },
    { id: '空壳', name: '空壳', role: '', personality: null },
  ],
  rules: [{ rule: '记忆一旦读取就无法复制。' }, { rule: '轨道垃圾带没有重力。' }],
  glossary: [{ term: '拾荒者', definition: '在轨道垃圾带收集残骸的人。' }],
  arcs: [{ title: '第一卷 坠落', summary: '林望捡到记忆芯片。' }],
  beats: [{ title: '开场', summary: '垃圾带里的发现', arc: '第一卷 坠落' }],
  chapters: [
    { id: '第一章-拾荒', title: '拾荒', words: 167 },
    { id: '第二章-记忆', title: '记忆', words: 84 },
  ],
  chapter: { id: '第二章-记忆', title: '记忆', body: '夜里，船离港了。' },
  edges: [
    { from: '老周', to: '拾荒帮', fromLabel: '老周', toLabel: '拾荒帮', type: '首领', strength: 1, source: 'auto' },
    { from: '林望', to: '老周', fromLabel: '林望', toLabel: '老周', type: '师徒', strength: 4, source: 'manual' },
  ],
  issues: [
    { level: 'warn', rule: 'dangling-edge', message: '「幽灵商会」没有对应条目', file: 'relationships.yaml' },
  ],
}

{
  const built = buildPrompt({ task: 'continue' }, context)
  check('the persona curses improvisation', built.system.includes('设定高于即兴发挥'))
  check('the task adds its own system line', built.system.includes('续写者'))
  check('the book title reaches the prompt', built.user.includes('《星海拾遗》'))
  check('the logline reaches the prompt', built.user.includes('捡到了一段记忆'))
  check('the chapter body reaches the prompt', built.user.includes('夜里，船离港了。'))
  check('the chapter is named', built.user.includes('「第二章-记忆」'))
  check('a character is rendered with its Chinese label', built.user.includes('姓名：林望'), built.user.slice(0, 400))
  check('a declared field the section happens to have is rendered', built.user.includes('习惯：咬笔帽'))
  check('an empty field is dropped rather than shown blank', !built.user.includes('定位：\n'))
  check('world rules reach the prompt', built.user.includes('记忆一旦读取就无法复制'))
  check('the glossary reaches the prompt', built.user.includes('拾荒者：在轨道垃圾带收集残骸的人'))
  check('outline arcs reach the prompt', built.user.includes('第一卷 坠落'))
  check('outline beats reach the prompt', built.user.includes('垃圾带里的发现'))
  check('the chapter index is a map, not the bodies', built.user.includes('共 2 章') && !built.user.includes('（167字）'))
  check('the word count is carried', built.user.includes('167 字'))
  check('a manual relation renders with its type', built.user.includes('林望 —师徒→ 老周（强度 4）'))
  check('a field-derived relation is marked as such', built.user.includes('［来自字段］'))
  check('the author instruction appears last', built.user.includes('### 作者本次的额外要求') === false)
  check('stats count what was supplied', built.stats.characters === 3 && built.stats.chapters === 2 && built.stats.edges === 2)
  check('the default maxTokens comes from the task', built.maxTokens === taskOf('continue').maxTokens)
}

{
  const built = buildPrompt({ task: 'continue', instruction: '让老周出场' }, context)
  check('an author instruction is rendered', built.user.includes('### 作者本次的额外要求') && built.user.includes('让老周出场'))
}

{
  const built = buildPrompt({ task: 'polish', text: '他走了过去，然后他就把那个东西拿起来了。' }, context)
  check('polish quotes the source text', built.user.includes('他走了过去'))
  check('polish asks for the same meaning', built.system.includes('原意'))
  check('polish does not need a chapter', built.user.includes('夜里，船离港了。') === false)
}

{
  const built = buildPrompt({ task: 'outline', input: '让林望发现芯片其实是活的' }, context)
  check('outline quotes the idea', built.user.includes('芯片其实是活的'))
  check('outline notices existing beats', built.user.includes('不要重复已经写过的情节节点'))
}

{
  const built = buildPrompt({ task: 'review' }, context)
  check('review carries the validator findings', built.user.includes('dangling-edge') && built.user.includes('幽灵商会'))
  check('review adds no persona beyond the reviewer', built.system.includes('审稿人'))
}

// ── budgets ───────────────────────────────────────────────────────────────
{
  const long = `${'开'.repeat(1000)}${'尾'.repeat(6000)}`
  const built = buildPrompt({ task: 'continue' }, { ...context, chapter: { id: '长章', body: long } })
  check('an over-long chapter is clipped', built.user.includes('已截断，前面还有 1000 字'), built.user.length)
  check('continuation keeps the END of the chapter', built.user.includes('尾尾尾尾尾'))
  check('continuation drops the head', !built.user.includes('开开开开开'))
}

{
  const many = Array.from({ length: 30 }, (_, i) => ({ id: `人${i}`, name: `人${i}`, role: '配角' }))
  const built = buildPrompt({ task: 'continue' }, { ...context, characters: many })
  check('the character list is capped', (built.user.match(/姓名：人/g) ?? []).length === LIMITS.characters, (built.user.match(/姓名：人/g) ?? []).length)
  check('the cap is announced', built.user.includes(`人物（${LIMITS.characters} 位）`))
}

{
  const many = Array.from({ length: 50 }, (_, i) => ({ from: `a${i}`, to: `b${i}`, fromLabel: `a${i}`, toLabel: `b${i}`, type: '认识' }))
  const built = buildPrompt({ task: 'continue' }, { ...context, edges: many })
  check('the relation list is capped and says so', built.user.includes(`另有 ${50 - LIMITS.edges} 条关系未列出`))
}

{
  const built = buildPrompt({ task: 'continue', maxTokens: 99999 }, context)
  check('maxTokens is clamped to a ceiling', built.maxTokens === 8000)
  const small = buildPrompt({ task: 'continue', maxTokens: 42.6 }, context)
  check('maxTokens is rounded', small.maxTokens === 43)
  const bad = buildPrompt({ task: 'continue', maxTokens: -1 }, context)
  check('a nonsense maxTokens falls back to the task default', bad.maxTokens === taskOf('continue').maxTokens)
}

// ── the writer's other pools (选择要喂给 AI 的条目) ────────────────────────
{
  const pools = [
    { key: 'characters', zh: '人物', keys: ['name'], labels: { name: '姓名' }, items: [{ id: '林望', label: '林望', on: true, data: { name: '林望' } }] },
    {
      key: 'world/locations', zh: '地点', keys: ['name', 'summary'], labels: { name: '名称', summary: '一句话' },
      items: [{ id: '拾荒港', label: '拾荒港', on: true, data: { name: '拾荒港', summary: '轨道垃圾带的中转站' } }],
    },
    {
      key: 'world/timeline', zh: '年表', keys: ['when', 'event', 'description'], labels: { when: '时间', event: '事件', description: '说明' },
      items: [{ id: '记忆潮', label: '记忆潮', on: true, data: { when: '开篇前', event: '记忆潮', description: '一场灾变。' } }],
    },
    { key: 'world/factions', zh: '势力', keys: ['name'], labels: { name: '名称' }, items: [{ id: '拾荒帮', label: '拾荒帮', on: false, data: { name: '拾荒帮' } }] },
  ]
  const built = buildPrompt({ task: 'review' }, { ...context, pools })
  check('a selected pool becomes its own section', built.user.includes('### 地点（1 条）') && built.user.includes('- 拾荒港'), built.user.slice(0, 300))
  check('a pool entry renders its declared fields', built.user.includes('一句话：轨道垃圾带的中转站'))
  check('a doc-shaped pool renders too', built.user.includes('### 年表（1 条）') && built.user.includes('事件：记忆潮'))
  check('a pool with a dedicated renderer is not repeated', (built.user.match(/### 人物（/g) ?? []).length === 1, (built.user.match(/### .*/g) ?? []))
  check('an unchecked pool is skipped entirely', !built.user.includes('### 势力'))
  check('the rendered pool count reaches the stats', built.stats.pools === 2, built.stats)

  const many = Array.from({ length: LIMITS.pool + 3 }, (_, i) => ({ id: `城${i}`, label: `城${i}`, on: true, data: { name: `城${i}` } }))
  const capped = buildPrompt({ task: 'review' }, { ...context, pools: [{ key: 'world/locations', zh: '地点', keys: ['name'], labels: { name: '名称' }, items: many }] })
  check('a pool is capped', (capped.user.match(/- 城/g) ?? []).length === LIMITS.pool, (capped.user.match(/- 城/g) ?? []).length)
  check('a pool cap announces itself', capped.user.includes(`还有 ${3} 条未列出`), capped.user.match(/- …（.*?）/)?.[0])
}

// ── an empty book still produces a usable prompt ──────────────────────────
{
  const built = buildPrompt({ task: 'review' }, { book: {} })
  check('an empty book is announced, not hidden', built.user.includes('这本书还没有设定数据'))
  check('an empty book still builds', built.user.length > 0 && built.system.length > 0)
}

// ── report ────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\n${failures.length} FAILED:`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  console.error(`\nprompt.smoke: ${passed} passed, ${failures.length} failed`)
  process.exit(1)
}
console.log(`prompt.smoke: ${passed} passed, 0 failed`)

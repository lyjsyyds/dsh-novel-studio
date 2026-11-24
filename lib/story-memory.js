import { createHash } from 'node:crypto'
import { getSchema } from './schema.js'
import { readChapters } from './export.js'
import { listUnit, readUnit, writeUnit } from './records.js'
import { chapterLookup } from './story.js'

export const memoryCategories = ['人物', '关系', '物品', '时间地点', '伏笔']
const recentChapters = 5
const memoryBudget = 6000
const chunkSize = 8000
const chapterTasks = new Set(['continue', 'continue-new', 'polish', 'review', 'reader', 'board'])
const digest = (data) => createHash('sha1').update(JSON.stringify(data)).digest('hex')

function invalid(message, status = 400, code = 'bad-memory') {
  return Object.assign(new Error(message), { status, code })
}

export async function readStory(bookDir) {
  const schema = await getSchema()
  const units = [
    ['scenes', 'outline', 'scenes'], ['volumes', 'outline', 'tree'], ['foreshadowing', 'outline', 'foreshadowing'],
    ['timeline', 'world', 'timeline'], ['months', 'world', 'calendar'], ['characters', 'characters', 'characters'],
  ]
  const [chapters, ...items] = await Promise.all([
    readChapters(bookDir),
    ...units.map(([, section, group]) => listUnit(bookDir, schema.unitOf(section, group).unit)),
  ])
  return { chapters, ...Object.fromEntries(units.map(([key], index) => [key, items[index].items || []])) }
}

function sceneSource(scene) {
  return ['title', 'when', 'location', 'characters', 'goal', 'conflict', 'outcome']
    .map((field) => scene[field] || '')
}

function getSource(row, mode) {
  if (row.kind === 'chapter') return { mode: 'chapter', revision: digest(row.body) }
  return {
    mode: mode === 'excerpt' ? 'excerpt' : 'scene',
    revision: digest([sceneSource(row.scene), mode === 'excerpt' ? row.chapter?.body || '' : null]),
  }
}

function makeEntry(row) {
  const saved = row.record.continuity || {}
  const summary = String(row.kind === 'chapter' ? row.record.summary ?? '' : saved.summary ?? '')
  const changes = Array.isArray(saved.changes) ? saved.changes.filter((change) => typeof change?.text === 'string') : []
  const sourceMode = saved.source?.mode || (row.kind === 'chapter' ? 'chapter' : 'scene')
  const source = getSource(row, sourceMode)
  const state = !summary && !changes.length ? 'empty'
    : saved.source?.revision === source.revision && saved.content === digest([summary, changes]) ? 'ready' : 'stale'
  return {
    key: row.kind + ':' + row.id,
    kind: row.kind, id: row.id, title: row.title, chapter: row.chapter?.id || null,
    summary, changes, pinned: saved.pinned === true, state,
    sources: { [source.mode]: source.revision, ...(row.kind === 'scene' ? {
      scene: getSource(row, 'scene').revision,
      excerpt: getSource(row, 'excerpt').revision,
    } : {}) },
    sourceMode, version: digest([summary, saved]),
  }
}

function targets(story) {
  const resolve = chapterLookup(story.chapters)
  return [
    ...story.chapters.map((chapter) => ({
      ...chapter, kind: 'chapter', record: chapter.meta, chapter,
    })),
    ...story.scenes.map((scene) => ({
      kind: 'scene', id: scene.id, title: scene.title || scene.id,
      chapter: resolve(scene.chapter), record: scene, scene,
    })),
  ]
}

export function memoryEntries(story) {
  return targets(story).map(makeEntry)
}

export async function describeMemories(bookDir) {
  const story = await readStory(bookDir)
  return memoryEntries(story)
}

export function normalizeMemory(value) {
  const summary = typeof value?.summary === 'string' ? value.summary.trim().slice(0, 1800) : ''
  const changes = Array.isArray(value?.changes) ? value.changes.slice(0, 24).flatMap((change) => {
    if (!change || !memoryCategories.includes(change.category) || typeof change.text !== 'string' || !change.text.trim()) return []
    return [{
      category: change.category,
      text: change.text.trim().slice(0, 420),
      ...(Array.isArray(change.people) ? { people: [...new Set(change.people.map(String))].slice(0, 12) } : {}),
    }]
  }) : []
  return { summary, changes }
}

export async function saveMemory(bookDir, key, draft) {
  const story = await readStory(bookDir)
  const row = targets(story).find((item) => key === item.kind + ':' + item.id)
  if (!row) throw invalid('该前情条目已移动或删除。', 404)
  const entry = makeEntry(row)
  if (draft.version !== entry.version) throw invalid('前情已被编辑，请重新读取。', 409, 'memory-changed')
  const mode = row.kind === 'chapter' ? 'chapter' : draft.sourceMode === 'excerpt' ? 'excerpt' : 'scene'
  const source = getSource(row, mode)
  if (source.revision !== draft.sourceRevision) throw invalid('摘要来源已变化，请重新核对。', 409, 'memory-source-changed')
  const { summary, changes } = normalizeMemory(draft)
  const continuity = {
    ...(row.kind === 'scene' ? { summary } : {}), changes, pinned: draft.pinned === true,
    source, content: digest([summary, changes]),
  }
  const schema = await getSchema()
  const unit = row.kind === 'chapter' ? schema.unitOf('chapters', 'chapters').unit : schema.unitOf('outline', 'scenes').unit
  const patch = row.kind === 'chapter' ? { summary, continuity } : { continuity }
  await writeUnit(bookDir, unit, row.id, patch)
  const { data } = await readUnit(bookDir, unit, row.id)
  return makeEntry({ ...row, record: data, ...(row.kind === 'chapter' ? { body: data.body } : {}) })
}

export function memoryChunks(text) {
  const chunks = []
  let rest = String(text).trim()
  while (rest.length > chunkSize) {
    let next = rest.lastIndexOf('\n\n', chunkSize)
    if (next < chunkSize / 2) next = rest.lastIndexOf('\n', chunkSize)
    if (next < chunkSize / 2) next = chunkSize - (/[\uD800-\uDBFF]/.test(rest[chunkSize - 1]) ? 1 : 0)
    chunks.push(rest.slice(0, next))
    rest = rest.slice(next).trimStart()
  }
  if (rest) chunks.push(rest)
  return chunks
}

export async function memorySources(bookDir, requests) {
  if (!Array.isArray(requests) || !requests.length || requests.length > 10) throw invalid('每批请选择 1 到 10 个条目。')
  const story = await readStory(bookDir)
  const rows = new Map(targets(story).map((row) => [row.kind + ':' + row.id, row]))
  return requests.map(({ key, selection }) => {
    const row = rows.get(key)
    if (!row) throw invalid('该前情条目已移动或删除。', 404)
    let text = row.kind === 'chapter' ? row.body : sceneSource(row.scene).flat().filter(Boolean).join('\n')
    let mode = row.kind === 'chapter' ? 'chapter' : 'scene'
    if (row.kind === 'scene' && selection) {
      const chapter = row.chapter
      if (!chapter || chapter.id !== selection.chapter || chapter.body !== selection.original
        || !Number.isInteger(selection.start) || !Number.isInteger(selection.end)
        || selection.start < 0 || selection.end <= selection.start || selection.end > chapter.body.length) {
        throw invalid('所选片段已变化，请从所属章节重新选择。', 409)
      }
      text = chapter.body.slice(selection.start, selection.end)
      mode = 'excerpt'
    }
    const chunks = memoryChunks(text)
    return { entry: makeEntry(row), key, mode, text, chunks, calls: chunks.length + Number(chunks.length > 1) }
  })
}

function memoryText(entry) {
  const heading = entry.kind === 'scene' ? entry.chapter + ' · 场景 · ' + entry.title : entry.title
  return ['### ' + heading, entry.summary, ...entry.changes.map(({ category, text }) => '- ' + category + ' · ' + text)]
    .filter(Boolean).join('\n')
}

export function selectMemories(story, { task, chapter, options }) {
  const last = story.chapters.findIndex(({ id }) => id === chapter)
  const ahead = task === 'review' && options?.ahead === true
  const boundary = ahead ? story.chapters.length : last + Number(task === 'continue-new')
  const order = new Map(story.chapters.map(({ id }, index) => [id, index]))
  const list = memoryEntries(story).filter(({ state }) => state !== 'empty').map((entry) => {
    const index = order.get(entry.chapter) ?? Infinity
    const allowed = index < boundary && entry.state === 'ready'
    return { ...entry, index, allowed, text: memoryText(entry) }
  }).sort((a, b) => a.index - b.index)
  const explicit = Array.isArray(options?.keys) ? new Set(options.keys) : null
  const eligible = list.filter((entry) => entry.allowed)
  const recent = Math.max(0, last + Number(task === 'continue-new') - recentChapters)
  const wanted = explicit ? eligible.filter(({ key }) => explicit.has(key)) : [
    ...eligible.filter(({ pinned }) => pinned),
    ...eligible.filter(({ pinned, index }) => !pinned && index >= recent && index <= last).reverse(),
  ]
  const chosen = new Set()
  const trimmed = new Set()
  let used = 0
  for (const entry of wanted) {
    const next = entry.text.length + (used ? 2 : 0)
    if (used + next > memoryBudget) trimmed.add(entry.key)
    else { chosen.add(entry.key); used += next }
  }
  const sent = list.filter(({ key }) => chosen.has(key))
  return {
    items: list.map((entry) => ({ ...entry, index: undefined, selected: chosen.has(entry.key), trimmed: trimmed.has(entry.key) })),
    text: sent.map(({ text }) => text).join('\n\n'), used, budget: memoryBudget,
    revision: digest([task, chapter, ahead, sent.map(({ key, version, sources }) => [key, version, sources]), [...trimmed]]),
  }
}

export async function extendMemoryContext(bookDir, context, request, run = false) {
  if (!chapterTasks.has(request.task) || !context.chapter) return
  const story = await readStory(bookDir)
  const memory = selectMemories(story, { task: request.task, chapter: context.chapter.id, options: request.memory })
  if (run && request.memory?.revision !== memory.revision) {
    // An empty catalogue does not require confirmation from an older renderer.
    if (request.memory?.revision || memory.items.some(({ allowed }) => allowed)) {
      throw invalid('本次引用已变化，请重新预览前情。', 409, 'memory-preview-changed')
    }
  }
  const resolve = chapterLookup(story.chapters)
  const index = new Map(story.chapters.map(({ id }, position) => [id, position]))
  const active = index.get(context.chapter.id)
  if (!(request.task === 'review' && request.memory?.ahead === true)) {
    const allowed = (ref) => {
      const id = resolve(ref)?.id
      return id && index.get(id) <= active
    }
    context.chapters = context.chapters.filter(({ id }) => allowed(id))
    context.issues = []
    context.beats = context.beats.filter(({ chapter }) => allowed(chapter))
    context.arcs = context.arcs.filter(({ to }) => allowed(to))
    context.pools = context.pools.map((pool) => {
      if (!['outline/scenes', 'world/timeline', 'outline/foreshadowing'].includes(pool.key)) return pool
      if (pool.key !== 'outline/foreshadowing') {
        return { ...pool, items: pool.items.map((item) => ({ ...item, on: item.on && allowed(item.data?.chapter) })) }
      }
      return { ...pool, items: pool.items.map((item) => {
        const { due, ...data } = item.data || {}
        return { ...item, data: allowed(due) ? item.data : data,
          on: item.on && allowed(data.plantedChapter || data.planted) && (!data.payoff || allowed(data.payoff)) }
      }) }
    })
  }
  context.memory = memory
}

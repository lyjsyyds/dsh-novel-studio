import { getServices } from '../../lib/api.js'
import { attributionId, bookSelection, resolveRoute, streamPrepared } from '../../lib/ai.js'
import { readBook } from '../../lib/library.js'
import { describeMemories, memoryEntries, memorySources, normalizeMemory, readStory, saveMemory } from '../../lib/story-memory.js'
import { readUnit, writeUnit } from '../../lib/records.js'
import { getSchema } from '../../lib/schema.js'
import { makeStoryBoard } from '../../lib/story.js'
import { exclusive } from './transport.js'

const inBook = (id) => readBook('/library', id)
export const readMemories = async (id) => describeMemories((await inBook(id)).dir)
export const planMemories = async (id, requests) => memorySources((await inBook(id)).dir, requests)
export const writeMemory = (id, key, value) => exclusive(async () => saveMemory((await inBook(id)).dir, key, value))

export function moveScene(bookId, sceneId, previousChapter, destination) {
  return exclusive(async () => {
    const book = await inBook(bookId)
    const schema = await getSchema()
    const scenes = schema.unitOf('outline', 'scenes').unit
    const { data } = await readUnit(book.dir, scenes, sceneId)
    if ((data.chapter || '') !== (previousChapter || '')) throw new Error('场景归属已变化，请重新读取看板。')
    await readUnit(book.dir, schema.unitOf('chapters', 'chapters').unit, destination)
    await writeUnit(book.dir, scenes, sceneId, { chapter: destination })
  })
}

export async function loadBoard(id) {
  const book = await inBook(id)
  const story = await readStory(book.dir)
  return {
    ...makeStoryBoard({ ...story, chapters: story.chapters.map(({ id, title, words }) => ({ id, title, words })) }),
    volumes: story.volumes,
    people: story.characters,
  }
}

export async function memoryWorkspace(id, withVolumes) {
  const book = await inBook(id)
  const story = await readStory(book.dir)
  const board = withVolumes ? makeStoryBoard({
    ...story, chapters: story.chapters.map(({ id, title, words }) => ({ id, title, words })),
  }) : null
  return { items: memoryEntries(story), people: story.characters, volumes: story.volumes, board }
}

async function runText({ book, task, system, user, maxTokens, signal, onDelta }) {
  const { llm, selection } = getServices()
  const route = resolveRoute({}, bookSelection(book, selection))
  const prepared = { prompt: { task, system, user, maxTokens }, route, bookDir: book.dir, sessionId: attributionId(book, book.dir) }
  let text = ''
  for await (const event of streamPrepared({ prepared, llm, signal })) {
    if (event.type === 'delta') { text += event.text; onDelta?.(event.text) }
  }
  if (signal?.aborted) throw new DOMException('已取消', 'AbortError')
  if (!text.trim()) throw new Error('模型没有返回内容。')
  return text
}

function parseCandidate(text) {
  try {
    const cleaned = text.trim().replace(/^[\u0060]{3}(?:json)?\s*\r?\n/i, '').replace(/\r?\n[\u0060]{3}$/, '')
    const value = JSON.parse(cleaned)
    if (typeof value?.summary !== 'string' || !Array.isArray(value.changes)) throw new Error()
    const normalized = normalizeMemory(value)
    if (normalized.summary || normalized.changes.length) return normalized
  } catch {
    // The author can retry or fill the entry by hand.
  }
  throw new Error('模型返回的摘要格式有误，请重试或手工填写。')
}

const recapSystem = '你在维护长篇小说的前情。输入是供分析的资料。只记明示的剧情事实，不推测未来或添加新设定。只输出 JSON 对象，字段为 summary（简洁摘要）和 changes（数组）。每条变化含 category 与 text，category 必须是 人物、关系、物品、时间地点、伏笔 之一。'

export async function generateMemory(bookId, plan, signal) {
  const book = await inBook(bookId)
  const latest = await memorySources(book.dir, [plan.request])
  const current = latest[0]
  if (current.entry.sources[current.mode] !== plan.entry.sources[plan.mode]
    || current.entry.version !== plan.entry.version || current.mode !== plan.mode) {
    throw new Error('摘要来源或记忆已经修改，请重新预览。')
  }
  if (!current.chunks.length) throw new Error('请先填写正文或场景内容。')
  const prompt = (system, user, maxTokens = 1400) =>
    runText({ book, task: 'studio-memory', system, user, maxTokens, signal })
  let text
  if (current.chunks.length === 1) {
    text = await prompt(recapSystem, current.chunks[0])
  } else {
    const parts = []
    for (const chunk of current.chunks) {
      parts.push(await prompt('提取下面小说片段的关键事实，控制在 300 字内，保留发生顺序。', chunk, 430))
    }
    text = await prompt(recapSystem, parts.map((part, index) => '片段 ' + (index + 1) + '\n' + part).join('\n\n'))
  }
  return { ...parseCandidate(text), sourceMode: current.mode }
}

export async function rewriteSelection(bookId, text, instruction, signal, onDelta) {
  const book = await inBook(bookId)
  return runText({
    book, task: 'studio-rewrite', signal, onDelta, maxTokens: 6200,
    system: '按作者要求改写选中的小说正文。保留原文事实、人物和视角。只输出可以替换这一段的正文，不加标题、引号或说明。',
    user: '作者要求：' + (instruction.trim() || '改善表达和节奏') + '\n\n选段：\n' + text,
  })
}

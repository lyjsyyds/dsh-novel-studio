import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { createBook } from '../lib/library.js'
import { getSchema } from '../lib/schema.js'
import { readUnit, writeUnit } from '../lib/records.js'
import { readDraft, reorderChapters, saveDraft } from '../lib/chapters.js'
import { extendMemoryContext, memoryChunks, memoryEntries, memorySources, readStory, saveMemory, selectMemories } from '../lib/story-memory.js'
import { chapterLookup, makeStoryBoard } from '../lib/story.js'
import { buildPrompt } from '../lib/prompt.js'
import { collectContext } from '../lib/ai.js'

const temp = await mkdtemp(join(tmpdir(), 'novel-continuity-'))
const id = (number) => `第${String(number).padStart(3, '0')}章`
try {
  const book = await createBook(temp, { title: '前情验收' })
  const schema = await getSchema()
  const unit = (section, group = section) => schema.unitOf(section, group).unit
  for (let start = 1; start <= 300; start += 30) {
    await Promise.all(Array.from({ length: 30 }, (_, offset) => {
      const n = start + offset
      return writeFile(join(book.dir, 'chapters', id(n) + '.md'),
        `---\ntitle: ${id(n)} 登记 ${n}\nsummary: 旧摘要 ${n}\n---\n\n正文 ${n}\n`)
    }))
  }
  await writeFile(join(book.dir, 'outline', 'scenes', 'bridge.yml'),
    'title: 过桥\nchapter: 第299章\nwhen: 1042年霜月12日\ncharacters: [lan]\ngoal: 交钥匙\n')
  await writeUnit(book.dir, unit('world', 'calendar'), 'new', { name: '霜月', days: 34 })
  await writeUnit(book.dir, unit('world', 'timeline'), 'new', { when: '1042年霜月2日', event: '离港', chapter: id(3) })
  await writeUnit(book.dir, unit('world', 'timeline'), 'new', { when: '开篇前', event: '未定' })
  await writeUnit(book.dir, unit('outline', 'tree'), 'new', { title: '终卷', from: id(299), to: id(300), summary: '未来结局标志' })
  await writeUnit(book.dir, unit('outline', 'foreshadowing'), 'new', { title: '灰羽', plantedChapter: id(3), due: id(300) })
  assert.equal((await readStory(book.dir)).chapters.length, 300)
  assert.equal(memoryEntries(await readStory(book.dir))[0].state, 'stale')

  const save = async (key, summary, pinned = false, sourceMode) => {
    const entry = memoryEntries(await readStory(book.dir)).find((item) => item.key === key)
    const mode = sourceMode || entry.sourceMode
    return saveMemory(book.dir, key, { summary, pinned, sourceMode: mode, version: entry.version,
      sourceRevision: entry.sources[mode], changes: [{ category: '物品', text: '交给澜一把钥匙', people: ['lan'] }] })
  }
  const key = (number) => 'chapter:' + id(number)
  for (const n of [3, 289, 293, 294, 295, 296, 297, 298, 299, 300]) {
    assert.equal((await save(key(n), n === 300 ? '未来摘要标志' : `确认前情 ${n}`, n === 3 || n === 300)).state, 'ready')
  }
  assert.equal((await save('scene:bridge', '桥上交接', false, 'excerpt')).state, 'ready')
  assert.match(await readFile(join(book.dir, 'outline', 'scenes', 'bridge.yml'), 'utf8'), /桥上交接/)
  let story = await readStory(book.dir)
  const request = { task: 'continue', chapter: id(299) }
  const selected = selectMemories(story, { ...request, options: null })
  assert.deepEqual(selected.items.filter(({ selected }) => selected).map((item) => item.key), [3, 294, 295, 296, 297, 298].map(key))
  const review = selectMemories(story, { task: 'review', chapter: id(299), options: { ahead: true, keys: [key(300), 'scene:bridge'] } })
  assert.match(review.text, /未来摘要标志/)
  assert.match(review.text, /桥上交接/)
  assert.ok(selected.used <= selected.budget)
  assert.equal(selected.used, selected.text.length)
  assert.equal(selectMemories(story, { ...request, options: { ahead: true, keys: [key(300)] } }).used, 0)
  const launch = selectMemories(story, { task: 'continue-new', chapter: id(299) })
  assert.match(launch.text, /桥上交接/)
  assert.ok(!launch.text.includes('未来摘要标志'))

  const longEntries = [5, 6, 7, 8]
  for (const n of longEntries) await save(key(n), '甲'.repeat(1800), true)
  const budget = selectMemories(await readStory(book.dir), { ...request, options: { keys: longEntries.map(key) } })
  assert.equal(budget.items.filter(({ selected }) => selected).length, 3)
  assert.equal(budget.items.filter(({ trimmed }) => trimmed).length, 1)
  assert.equal(budget.used, budget.text.length)
  assert.ok(budget.used <= budget.budget)

  const context = await collectContext(book.dir, book, request)
  const memory = { keys: selected.items.filter(({ selected }) => selected).map(({ key }) => key), revision: selected.revision }
  await extendMemoryContext(book.dir, context, { ...request, memory }, true)
  const prompt = buildPrompt(request, context).user
  assert.ok(prompt.includes(selected.text))
  for (const marker of ['未来摘要标志', '未来结局标志', '第300章']) assert.ok(!prompt.includes(marker))

  const [source] = await memorySources(book.dir, [{ key: 'scene:bridge', selection: {
    chapter: id(299), original: story.chapters[298].body, start: 0, end: 2,
  } }])
  assert.equal(source.mode, 'excerpt')
  assert.equal(source.text, '正文')
  assert.equal(source.calls, 1)
  const padded = '甲'.repeat(7999) + '🚀' + '乙'.repeat(25)
  assert.equal(memoryChunks(padded).join(''), padded)
  assert.ok(memoryChunks(padded).every((chunk) => chunk.length <= 8000))
  await writeUnit(book.dir, unit('chapters'), id(299), { body: '已改正文' })
  await writeUnit(book.dir, unit('chapters'), id(298), { body: '已改正文' })
  story = await readStory(book.dir)
  assert.equal(memoryEntries(story).find(({ key }) => key === 'scene:bridge').state, 'stale')
  await assert.rejects(extendMemoryContext(book.dir, context, { ...request, memory }, true), { code: 'memory-preview-changed' })
  await assert.rejects(saveMemory(book.dir, source.key, { version: source.entry.version, sourceMode: 'excerpt',
    sourceRevision: source.entry.sources.excerpt, summary: '过期候选' }), { code: 'memory-source-changed' })

  const board = makeStoryBoard(story)
  assert.equal(board.chapters[298].volume, '终卷')
  assert.deepEqual(board.dated.map(({ title }) => title), ['离港', '过桥'])
  assert.equal(board.pending[0].title, '未定')
  assert.equal(board.chapters[299].rows.find(({ kind }) => kind === 'foreshadowing').label, '预期回收')
  assert.equal(chapterLookup(story.chapters)('第三章').id, id(3))
  const draft = await saveDraft(book.dir, id(299))
  await writeFile(join(book.dir, '.studio-session.json'), JSON.stringify({ chapter: id(299), offset: 2 }))
  const order = story.chapters.map(({ id }) => id)
  order.splice(-2, 2, id(300), id(299))
  const { renamed } = await reorderChapters(book.dir, order)
  const newId = renamed.find(({ from }) => from === id(299)).to
  assert.equal((await readUnit(book.dir, unit('outline', 'scenes'), 'bridge')).data.chapter, newId)
  assert.equal((await readDraft(book.dir, draft.id)).chapter, newId)
  assert.equal(JSON.parse(await readFile(join(book.dir, '.studio-session.json'), 'utf8')).chapter, newId)
  assert.equal((await readUnit(book.dir, unit('chapters'), newId)).data.body, '已改正文')
  console.log('300 chapters: source checks, prompt bounds, scene files, chronology, drafts and reading order')
} finally {
  if (dirname(resolve(temp)).toLowerCase() === resolve(tmpdir()).toLowerCase() && resolve(temp).includes(sep + 'novel-continuity-')) {
    await rm(temp, { recursive: true, force: true })
  }
}

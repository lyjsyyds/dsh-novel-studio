import { compareChapters } from './records.js'
import { chapterNumber, splitOrdinal } from './chapters.js'
import { parseDate } from './calendar.js'

export function chapterLookup(chapters) {
  const byId = new Map(chapters.map((chapter) => [chapter.id, chapter]))
  const titles = new Map()
  const numbers = new Map()
  for (const chapter of chapters) {
    const title = chapter.title?.trim()
    if (title) titles.set(title, titles.has(title) ? null : chapter)
    const n = chapterNumber(chapter.id)
    if (Number.isFinite(n)) numbers.set(n, numbers.has(n) ? null : chapter)
  }
  return (value) => {
    const label = String(value ?? '').trim()
    if (!label) return null
    if (byId.has(label)) return byId.get(label)
    if (titles.has(label)) return titles.get(label)
    // Match a bare ordinal, not the first number in an arbitrary note.
    const ordinal = splitOrdinal(label)
    return !ordinal.rest && numbers.get(chapterNumber(label)) || null
  }
}

export function storyDates(events, months) {
  const buckets = { dated: [], pending: [] }
  for (const row of events) {
    const date = parseDate(row.when, months)
    if (date?.year == null || date.unknownMonth || date.overflow || date.day === 0) {
      buckets.pending.push(row)
    } else {
      buckets.dated.push({ ...row, date })
    }
  }
  buckets.dated.sort((a, b) => a.date.year - b.date.year
    || (a.date.month || 0) - (b.date.month || 0)
    || (a.date.day || 0) - (b.date.day || 0)
    || compareChapters(a.chapter?.id || '', b.chapter?.id || ''))
  return buckets
}

export function makeStoryBoard({ chapters, scenes, volumes, foreshadowing, timeline, months }) {
  const resolve = chapterLookup(chapters)
  const rows = [
    ...scenes.map((scene) => ({
      ...scene, kind: 'scene', title: scene.title || scene.id,
      chapterRef: scene.chapter, chapter: resolve(scene.chapter),
    })),
    ...timeline.map((event, index) => ({
      ...event, id: index, kind: 'event', title: event.event || '未命名事件',
      chapterRef: event.chapter, chapter: resolve(event.chapter),
    })),
  ]
  const milestones = [
    ['plantedChapter', '埋设', 'planted'], ['due', '预期回收'], ['payoff', '实际回收'],
  ]
  for (const [index, thread] of foreshadowing.entries()) {
    const info = { id: index, kind: 'foreshadowing', title: thread.title || '未命名伏笔', status: thread.status, notes: thread.notes }
    let linked = false
    for (const [field, label, fallback] of milestones) {
      const chapterRef = thread[field] || (fallback && thread[fallback])
      if (!chapterRef) continue
      linked = true
      rows.push({ ...info, milestone: field, label, chapterRef, chapter: resolve(chapterRef) })
    }
    if (!linked) rows.push({ ...info, label: '伏笔待关联' })
  }
  const order = new Map(chapters.map(({ id }, index) => [id, index]))
  const ranges = volumes.map((volume) => ({
    ...volume, first: order.get(resolve(volume.from)?.id), last: order.get(resolve(volume.to)?.id),
  }))
  const byChapter = new Map(chapters.map(({ id }) => [id, []]))
  for (const row of rows) if (row.chapter) byChapter.get(row.chapter.id).push(row)
  return {
    chapters: chapters.map((chapter, index) => ({
      ...chapter, index, rows: byChapter.get(chapter.id),
      volume: ranges.find(({ first, last }) => first <= index && index <= last)?.title || '',
    })),
    unlinked: rows.filter(({ chapter, kind, chapterRef }) => !chapter && (kind !== 'event' || chapterRef)),
    ...storyDates(rows.filter(({ kind }) => kind === 'event' || kind === 'scene'), months),
  }
}

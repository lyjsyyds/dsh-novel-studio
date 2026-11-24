import React, { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { ArrowRight, BookOpen, CalendarDays, ChevronRight, FileDown, FilePlus2, Files, GitBranch, History, ListChecks, MapPin, Search, Sparkles, UsersRound } from 'lucide-react'
import { api } from './transport.js'
import { CharacterMemory } from './memory.jsx'

const Manuscript = lazy(() => import('./manuscript.jsx'))
const enc = encodeURIComponent

const deskGroups = [
  ['当前章节', [['find', '查找替换', Search], ['drafts', '章节快照', History], ['validate', '校验与读者报告', ListChecks]]],
  ['参考资料', [['search', '全书检索', Search], ['story', '剧情看板', Files], ['graph', '关系图', GitBranch],
    ['calendar', '历法总览', CalendarDays], ['catalog', '设定分类', BookOpen]]],
  ['稿件管理', [['manage', '章节管理', Files], ['draft-library', '全部草稿', History], ['progress', '写作进度', ListChecks],
    ['import', '导入章节', FilePlus2], ['export', '稿件导出', FileDown]]],
  ['设置', [['paper', '纸面排版'], ['appearance', '页面配色'], ['book-settings', '作品设置'], ['ai-settings', 'AI 模型', Sparkles]]],
]

export const panelTitles = {
  context: '本章设定', memory: '前情记忆', ai: 'AI 写作', tools: '写作工具', catalog: '设定分类',
  'scene-memory': '场景前情', 'chapter-reference': '参考章节', rewrite: '改写选段', overview: '作品总览', shared: '共享库',
  ...Object.fromEntries(deskGroups.flatMap(([, items]) => items.map(([key, label]) => [key, label]))),
}

const aliases = { find: '替换 搜索正文', drafts: '草稿 历史 版本', search: '查询 人物 章节',
  story: '场景 伏笔 时间轴', validate: '检查 错误 一致性', appearance: '白天 夜晚 主题 颜色', 'ai-settings': '免费 模型 API Key Ollama OpenRouter' }

export function DeskMenu({ open, disabled, focusRequest }) {
  const [query, setQuery] = useState('')
  const input = useRef(null)
  useEffect(() => { if (focusRequest) input.current?.focus({ preventScroll: true }) }, [focusRequest])
  const needle = query.trim().toLowerCase()
  const groups = deskGroups.map(([label, items]) => [label, needle
    ? items.filter(([key, name]) => (name + ' ' + (aliases[key] || '')).toLowerCase().includes(needle)) : items])
    .filter(([, items]) => items.length)
  const filtered = groups.flatMap(([, items]) => items.filter(([key]) => !disabled || !['find', 'drafts'].includes(key)))
  return <div className="desk-menu">
    <label className="command-field"><Search size={16} aria-hidden /><input ref={input} aria-label="搜索工具名称" placeholder="搜索工具名称"
      value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing && needle && filtered.length) { event.preventDefault(); open(filtered[0][0]) }
      }} /></label>
    {!groups.length && <p className="muted" role="status">没有匹配的工具。</p>}
    {groups.map(([label, items]) => <section key={label}>
      <h3>{label}</h3>
      {items.map(([key, title, Icon]) => <button key={key} disabled={disabled && ['find', 'drafts'].includes(key)}
        onClick={() => open(key)}>{Icon && <Icon size={16} aria-hidden />}{title}<ChevronRight size={15} aria-hidden /></button>)}
    </section>)}
  </div>
}

export function ReferenceCatalog({ sections, go }) {
  return <div className="desk-menu"><section><h3>剧情与资料</h3>
    {[['story', '剧情看板'], ['graph', '关系图'], ['calendar', '历法总览'], ['shared', '共享库']].map(([key, title]) =>
      <button key={key} onClick={() => go(key)}>{title}<ChevronRight size={15} aria-hidden /></button>)}
  </section>{sections.filter(({ key }) => !['chapters', 'drafts', 'overview'].includes(key)).map((section) =>
    <section key={section.key}>
      <h3>{section.zh}</h3>
      {section.groups ? section.groups.map((group) => <button key={group.key} onClick={() => go(section.key, group.key)}>
        {group.zh}<ChevronRight size={15} aria-hidden /></button>) : <button onClick={() => go(section.key)}>
        浏览{section.zh}<ChevronRight size={15} aria-hidden /></button>}
    </section>)}</div>
}

export function ChapterContext({ data, error, chapter, body, onGo, onCheck, note, onNote }) {
  const references = (data?.nodes || []).filter((node) => ['characters', 'locations'].includes(node.kind) && node.label && body.includes(node.label))
  const groups = [
    ['本章人物与地点', references.map(({ id, label, kind }) => ({
      key: kind + ':' + id, title: label, icon: kind === 'characters' ? UsersRound : MapPin,
      open: () => kind === 'characters' ? onGo('characters', undefined, id) : onGo('world', 'locations', id),
    })), '正文中出现的人物和地点会显示在这里。'],
    ['本章场景', (data?.scenes || []).map(({ id, title, goal }) => ({
      key: id, title: title || id, info: goal, open: () => onGo('outline', 'scenes', id),
    })), '尚无关联场景。'],
    ['本章伏笔', (data?.threads || []).map(({ index, title, status }) => ({
      key: index, title, info: status || '未回收', open: () => onGo('outline', 'foreshadowing', String(index)),
    })), '尚无关联伏笔。'],
  ]
  return <div className="chapter-context">
    <div className="reference-shortcuts" aria-label="常用设定">
      <button onClick={() => onGo('characters')}>人物</button><button onClick={() => onGo('world', 'locations')}>地点</button>
      <button onClick={() => onGo('outline', 'foreshadowing')}>伏笔</button><button onClick={() => onGo('story')}>剧情</button>
    </div>
    {error && <p className="notice" role="alert">{error}</p>}
    {!data && !error && <p role="status" className="muted">正在读取本章设定…</p>}
    {data && groups.map(([title, rows, empty]) => <section className="reference-section" key={title}>
      <h3>{title}</h3>
      {rows.length > 0 ? <ul className="context-list">{rows.map(({ key, title: name, info, icon: Icon, open }) =>
        <li key={key}><button onClick={open}>{Icon && <Icon size={15} aria-hidden />}<span>{name}</span>
          {info && <small>{info}</small>}<ChevronRight size={15} aria-hidden /></button></li>)}</ul> : <p className="muted">{empty}</p>}
    </section>)}
    {data && <section className="reference-section">
      <h3>本章检查</h3>
      {data.issues.filter(({ rule }) => rule !== 'empty-chapter' || !body.trim()).map((issue, index) =>
        <p className="reference-issue" key={index}>{issue.message}</p>)}
      <div className="actions">
        <button onClick={onCheck}>刷新检查</button><button onClick={() => onGo('validate')}>查看报告</button>
        <button onClick={() => onGo('graph')}>关系图</button>
      </div>
    </section>}
    <label className="handoff">接力备注<textarea key={chapter.id} rows={3} value={note} onChange={(event) => onNote(event.target.value)}
      placeholder="下次从哪里继续？" /></label>
  </div>
}

export function ChapterReference({ book, id, line, localBody, onOpen }) {
  const [result, setResult] = useState(null)
  const local = localBody !== undefined
  useEffect(() => {
    if (local) return
    let active = true
    api('GET', '/library/' + enc(book.id) + '/unit/chapters/' + enc(id))
      .then(({ data }) => { if (active) setResult({ body: data.body || '', title: data.title }) })
      .catch((error) => { if (active) setResult({ error: error.message }) })
    return () => { active = false }
  }, [book.id, id, local])
  const data = local ? { body: localBody } : result
  if (!data) return <p role="status" className="muted">正在读取章节…</p>
  if (data.error) return <p role="alert" className="notice">{data.error}</p>
  const lines = data.body.split('\n')
  const index = Math.max(0, Math.min(lines.length - 1, (line || 1) - 1))
  const offset = lines.slice(0, index).reduce((sum, text) => sum + text.length + 1, 0)
  return <div className="chapter-reference">
    {data.title && <h3>{data.title}</h3>}
    {line && <div className="reference-excerpt"><small>第 {line} 行</small><p>{lines[index]}</p></div>}
    <button className="primary" onClick={() => onOpen(id, offset, offset + (line ? lines[index].length : 0))}>
      {line ? '在正文中定位' : '在写作区打开'}<ArrowRight size={16} /></button>
    <Suspense fallback={<p>正在排版…</p>}><Manuscript body={data.body} /></Suspense>
  </div>
}

export function RecordReference({ book, section, group, id, onEdit, onOpenChapter }) {
  const [result, setResult] = useState(null)
  const [showChanges, setShowChanges] = useState(false)
  const unit = group || section
  useEffect(() => {
    let active = true
    const path = '/library/' + enc(book.id) + '/unit/' + enc(section.key) + (group ? '/' + enc(group.key) : '') + '/' + enc(id)
    api('GET', path).then((value) => { if (active) setResult(value) })
      .catch((error) => { if (active) setResult({ error: error.message }) })
    return () => { active = false }
  }, [book.id, section.key, group?.key, id])
  if (!result) return <p className="muted" role="status">正在读取设定…</p>
  if (result.error) return <p className="notice" role="alert">{result.error}</p>
  const { data } = result
  const titleKey = unit.titleField || 'name'
  const title = data[titleKey] || id
  const facts = (result.fields || unit.fields || []).flatMap(({ k, zh }) => {
    const value = data[k]
    if (k === titleKey || value == null || value === '' || (Array.isArray(value) && !value.length)) return []
    return [{ key: k, label: zh || k, text: Array.isArray(value) ? value.join(' · ') : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value) }]
  })
  return <article className="reference-record">
    <header><h3>{title}</h3><button onClick={onEdit}>编辑条目</button></header>
    {data.text && <pre>{data.text}</pre>}
    {facts.length ? <dl>{facts.map(({ key, label, text }) => <div key={key}><dt>{label}</dt><dd>{text}</dd></div>)}</dl>
      : !data.text && <p className="muted">这条设定还没有详细内容。</p>}
    {section.key === 'characters' && <details onToggle={(event) => setShowChanges(event.currentTarget.open)}>
      <summary>查看已确认的人物变化</summary>
      {showChanges && <CharacterMemory book={book} person={id} onOpenChapter={onOpenChapter} />}
    </details>}
  </article>
}

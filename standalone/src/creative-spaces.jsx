import React, { useEffect, useRef, useState } from 'react'
import { Archive, ArrowDown, ArrowUp, BookOpen, Columns3, GitBranch, Grid2X2, GripVertical, Layers, Mic, Music, Plus, Scale, Settings2, Sparkles } from 'lucide-react'
import { createItem, spaceNames, uid } from './spaces.js'
import { Ecosystem, SoundCard } from './experiments.jsx'
import { SpaceAi, spaceAiLabel } from './space-ai.jsx'

export const spaceIcons = { shelf: BookOpen, ideas: Layers, clips: Music, paths: GitBranch, choices: Scale, projects: Columns3, stage: Mic, ecosystem: Grid2X2 }
const nouns = { ideas: '展览', clips: '明信片', paths: '推演', choices: '决策', projects: '沙盘', stage: '演练稿', ecosystem: '实验' }

function AddLine({ label, add }) {
  const [text, setText] = useState('')
  return <form className="space-add" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { add(text.trim()); setText('') } }}>
    <input aria-label={label} placeholder={label} value={text} maxLength={160} onChange={(e) => setText(e.target.value)} />
    <button type="submit" aria-label={'添加' + label} disabled={!text.trim()}><Plus size={17} />添加</button>
  </form>
}

function Field({ label, value, set, lines = 0 }) {
  const props = { value, 'aria-label': label, onChange: (e) => set(e.target.value) }
  return <label className="space-field">{label}{lines ? <textarea rows={lines} {...props} /> : <input {...props} />}</label>
}

function Ideas({ item, patch }) {
  const [selected, select] = useState(null)
  const [visiting, setVisiting] = useState(false)
  const drag = useRef(null)
  const notes = item.notes
  const active = notes.find((n) => n.id === selected)
  function update(id, values) { patch({ notes: notes.map((n) => n.id === id ? { ...n, ...values } : n) }) }
  function move(id, x, y) { update(id, { x: Math.round(Math.max(0, Math.min(578, x))), y: Math.round(Math.max(0, Math.min(318, y))) }) }
  return <div className="gallery-workspace">
    <div className="gallery-toolbar">
      <button className="primary" disabled={!notes.length} onClick={() => setVisiting(!visiting)}>{visiting ? '返回布展' : '漫游展览'}</button>
      {!visiting && <AddLine label="新展项" add={(text) => { const id = uid(); const i = notes.length
      patch({ notes: [...notes, { id, text, x: 12 + i % 4 * 145, y: 12 + i % 5 * 60 }] }); select(id) }} />
      }
    </div>
    <div className="idea-scroll"><div className="idea-board" aria-label="便签画布">
      {notes.map((n) => <article className="idea-note" data-on={n.id === selected} key={n.id} style={{ left: n.x, top: n.y }}>
        {!visiting && <button aria-label={'移动便签 ' + n.text} className="idea-grip" onPointerDown={(e) => {
          if (e.button !== 0) return
          select(n.id); drag.current = { x: n.x - e.clientX, y: n.y - e.clientY }
          e.currentTarget.setPointerCapture(e.pointerId)
        }} onPointerMove={(e) => { if (drag.current && e.currentTarget.hasPointerCapture(e.pointerId)) move(n.id, drag.current.x + e.clientX, drag.current.y + e.clientY) }}
          onLostPointerCapture={() => { drag.current = null }} onKeyDown={(e) => {
            const v = { ArrowLeft: [-12,0], ArrowRight: [12,0], ArrowUp: [0,-12], ArrowDown: [0,12] }[e.key]
            if (v) { e.preventDefault(); move(n.id, n.x + v[0], n.y + v[1]) }
          }}><GripVertical size={16} /></button>}
        <button className="idea-text" aria-pressed={n.id === selected} onClick={() => select(n.id)}>{n.text}</button>
      </article>)}
    </div></div>
    <aside className="gallery-inspector">
      {visiting ? (active ? <><h2>{active.text}</h2>{active.caption && <div className="exhibit-caption">{active.caption}</div>}</>
        : <p>点选画布上的任意展项查看展签。</p>) : active ?
      <><Field label="展项名称" value={active.text} set={(text) => update(active.id, { text })} />
      <Field label="展签说明" value={active.caption || ''} set={(caption) => update(active.id, { caption })} lines={2} />
      <button onClick={() => { patch({ notes: notes.filter((note) => note.id !== active.id) }); select(null) }}>移除展项</button></>
      : <p>选中展项后编辑展签，拖动手柄安排位置。</p>}
    </aside>
  </div>
}

function Collection({ item, patch }) {
  return <div className="postcard-workspace"><div className="postcard-message">
    <Field label="明信片文字" value={item.text} set={(text) => patch({ text })} lines={5} />
    <Field label="来源" value={item.source} set={(source) => patch({ source })} />
    <Field label="标签（空格分隔）" value={item.tags} set={(tags) => patch({ tags })} />
  </div><SoundCard item={item} patch={patch} /></div>
}

function Scenarios({ item, patch, compare }) {
  const [notice, setNotice] = useState('')
  const [showEffects, setShowEffects] = useState(false)
  return <div className="branch-workspace"><div className="branch-origin"><Field label="共同起点" value={item.premise} set={(premise) => patch({ premise })} lines={2} /></div>
    <div className="scenario-pair">{['a', 'b'].map((k) => <div className="branch-lane" key={k}>
      <Field label={'走向 ' + k.toUpperCase()} value={item[k]} set={(value) => patch({ [k]: value })} lines={4} />
      {showEffects && <><Field label={'走向 ' + k.toUpperCase() + ' 的近期后果'} value={item[k + 'Soon'] || ''} set={(value) => patch({ [k + 'Soon']: value })} lines={2} />
        <Field label={'走向 ' + k.toUpperCase() + ' 的长期隐患'} value={item[k + 'Later'] || ''} set={(value) => patch({ [k + 'Later']: value })} lines={2} /></>}
      {item.anchor && <button disabled={!item[k].trim() || item[k] === item.anchor.text} onClick={async () => {
        try { setNotice(await compare(item.anchor, item[k]) ? '已应用到正文' : '') } catch (e) { setNotice(e.message) }
      }}>与来源正文对照</button>}</div>)}</div>
    <button aria-expanded={showEffects} onClick={() => setShowEffects(!showEffects)}>{showEffects ? '收起后果' : '并排看后果'}</button>
    <Field label="推演笔记" value={item.decision} set={(decision) => patch({ decision })} lines={2} />
    {notice && <p role="status">{notice}</p>}</div>
}

function Decisions({ item, patch }) {
  const { options, criteria } = item
  const [excluded, setExcluded] = useState('')
  const included = criteria.filter((criterion) => criterion.id !== excluded)
  const weight = criteria.reduce((s,c) => s + c.weight, 0)
  const ranked = options.map((name, i) => ({ name, i, score: criteria.reduce((s,c) => s + c.scores[i] * c.weight, 0) / weight })).sort((a,b) => b.score - a.score)
  const stress = excluded && included.length ? options.map((name, i) => ({ name, i,
    score: included.reduce((total, c) => total + c.scores[i] * c.weight, 0) / included.reduce((total, c) => total + c.weight, 0)
  })).sort((a, b) => b.score - a.score) : []
  const change = (id, value) => patch({ criteria: criteria.map((c) => c.id === id ? { ...c, ...value } : c) })
  return <div className="decision-workspace"><div className="score-editor">
    <div className="space-table"><table><thead><tr><th>比较指标</th><th>权重</th>{options.map((o,i) => <th key={i}><input aria-label={'选项名称 ' + (i+1)} value={o}
      onChange={(e) => patch({ options: options.map((v,j) => j === i ? e.target.value : v) })} /></th>)}</tr></thead>
      <tbody>{criteria.map((c) => <tr key={c.id}><th>{c.title}</th><td><select aria-label={c.title + '权重'} value={c.weight} onChange={(e) => change(c.id, { weight: +e.target.value })}>
        {[1,2,3,4,5].map((n) => <option key={n}>{n}</option>)}</select></td>
        {options.map((o,i) => <td key={i}><select aria-label={o + ' ' + c.title + '评分'} value={c.scores[i]}
          onChange={(e) => change(c.id, { scores: c.scores.map((v,j) => j === i ? +e.target.value : v) })}>{[1,2,3,4,5].map((n) => <option key={n}>{n}</option>)}</select></td>)}</tr>)}</tbody></table></div>
    <AddLine label="新指标" add={(title) => patch({ criteria: [...criteria, { id: uid(), title, weight: 1, scores: options.map(() => 3) }] })} />
    <AddLine label="新选项" add={(name) => patch({ options: [...options, name], criteria: criteria.map((c) => ({ ...c, scores: [...c.scores, 3] })) })} /></div>
    <aside className="decision-results"><h2>加权排名</h2>
      <ol className="score-bars" aria-label="加权得分">{ranked.map((o) => <li key={o.i}>
        <div><span>{o.name}</span><strong>{o.score.toFixed(2)} / 5</strong></div><meter min={0} max={5} value={o.score} aria-label={o.name + '加权得分'} />
      </li>)}</ol>
      <h3>敏感度测试</h3>
      <label className="space-field">临时忽略一个指标<select value={excluded} disabled={criteria.length < 2} onChange={(e) => setExcluded(e.target.value)}>
        <option value="">采用全部指标</option>{criteria.map((c) => <option value={c.id} key={c.id}>{c.title}</option>)}
      </select></label>
      {stress.length > 0 && <div className="decision-ranking" aria-label="敏感度测试得分">{stress.map((o) =>
        <span key={o.i}>{o.name} <strong>{o.score.toFixed(2)}</strong> / 5</span>)}</div>}
    </aside></div>
}

const stages = ['待办', '进行中', '已完成']
function Projects({ item, patch }) {
  const change = (id, values) => patch({ tasks: item.tasks.map((t) => t.id === id ? { ...t, ...values } : t) })
  const hours = item.hours ?? 12
  const backlog = item.tasks.filter((t) => t.step !== 2).reduce((total, task) => total + (task.hours ?? 1), 0)
  const remaining = hours - backlog
  return <div className="project-workspace">
    <section className="project-budget">
      <div className="experiment-metrics"><strong>{remaining >= 0 ? '剩余' : '超出'} {Math.abs(remaining).toFixed(1)} 小时</strong><span>待完成 {backlog} 小时</span></div>
      <label className="space-field">可投入工时<input type="number" min="0" max="999" value={hours} onChange={(e) => patch({ hours: Math.max(0, Math.min(999, Number(e.target.value))) })} /></label>
    </section>
    <AddLine label="任务名称" add={(text) => patch({ tasks: [...item.tasks, { id: uid(), text, step: 0, due: '' }] })} />
    <div className="kanban">{stages.map((name,i) => <section key={name}><h3>{name} <small>{item.tasks.filter((t) => t.step === i).length}</small></h3>
      {item.tasks.filter((t) => t.step === i).map((t) => <article key={t.id}><Field label="任务" value={t.text} set={(text) => change(t.id,{ text })} />
        <label>截止日期<input aria-label="截止日期" type="date" value={t.due} onChange={(e) => change(t.id,{ due: e.target.value })} /></label>
        <label>预计工时<input type="number" min="0" max="999" value={t.hours ?? 1} onChange={(e) => change(t.id, { hours: Math.max(0, Math.min(999, Number(e.target.value))) })} /></label>
        <select aria-label={t.text + '状态'} value={t.step} onChange={(e) => change(t.id,{ step: +e.target.value })}>{stages.map((s,j) => <option value={j} key={s}>{s}</option>)}</select>
      </article>)}</section>)}</div></div>
}

const duration = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2,'0') }
function Stage({ item, patch }) {
  const { cards, session, runs } = item
  const [now, tick] = useState(Date.now)
  useEffect(() => { if (!session) return; const id = setInterval(() => tick(Date.now()), 300); return () => clearInterval(id) }, [session?.start])
  const deck = session?.deck || cards
  function next(end) {
    const at = Date.now()
    const splits = [...session.splits, { text: deck[session.index], ms: at - session.since }]
    if (end || session.index + 1 === deck.length) patch({ session: null, runs: [{ at, ms: at - session.start, splits }, ...runs].slice(0,30) })
    else patch({ session: { ...session, index: session.index + 1, since: at, splits } })
  }
  function reorder(i,j) { const nextCards = [...cards]; [nextCards[i],nextCards[j]] = [nextCards[j],nextCards[i]]; patch({ cards: nextCards }) }
  function start(improvise) {
    const shuffled = [...cards]
    if (improvise) {
      for (let i = shuffled.length - 1; i > 0; i--) {
        const index = Math.floor(Math.random() * (i + 1))
        ;[shuffled[i], shuffled[index]] = [shuffled[index], shuffled[i]]
      }
    }
    const time = Date.now()
    tick(time)
    patch({ session: { start: time, since: time, index: 0, splits: [], deck: shuffled } })
  }
  return <div className="stage-workspace"><div className="stage-main">{session ? <section className="cue-card"><small>提示卡 {session.index + 1} / {deck.length}</small>
    <p>{deck[session.index]}</p><time>{duration(now - session.start)}</time><div className="actions">
      <button className="primary" onClick={() => next(false)}>{session.index + 1 === deck.length ? '完成演练' : '下一张'}</button>
      {session.index + 1 < deck.length && <button onClick={() => next(true)}>提前结束</button>}</div></section>
    : <><div className="stage-launch"><div className="stage-count"><strong>{cards.length}</strong><span>张提示卡</span></div><div className="actions">
        <button disabled={!cards.length} className="primary" onClick={() => start(false)}>开始计时演练</button>
        <button disabled={cards.length < 2} onClick={() => start(true)}>随机抽题排演</button></div></div>
      <AddLine label="提示卡内容" add={(text) => patch({ cards: [...cards,text] })} />
      {cards.map((text,i) => <div key={i} className="cue-row"><Field label={'提示卡 ' + (i+1)} value={text} set={(nextText) => patch({ cards: cards.map((v,j) => i === j ? nextText : v) })} />
        <button aria-label="上移" disabled={!i} onClick={() => reorder(i,i-1)}><ArrowUp size={16} /></button><button aria-label="下移" disabled={i === cards.length - 1} onClick={() => reorder(i,i+1)}><ArrowDown size={16} /></button></div>)}
    </>}</div>
    <aside className="stage-records"><h3>演练记录</h3>{!runs.length && <p className="muted">每轮结束后在这里查看总用时和分段用时。</p>}
      {runs.map((r) => <details key={r.at}><summary>{new Date(r.at).toLocaleString()} · {duration(r.ms)} · {r.splits.length} 张</summary>
      {r.splits.map((s,i) => <p key={i}>{duration(s.ms)}　{s.text}</p>)}</details>)}</aside></div>
}

const pages = { ideas: Ideas, clips: Collection, paths: Scenarios, choices: Decisions, projects: Projects, stage: Stage, ecosystem: Ecosystem }
export function CreativeSpace({ kind, hub, initialId, compare, onModelSettings }) {
  const [selected, select] = useState(initialId)
  const [query, search] = useState('')
  const [archived, toggle] = useState(false)
  const [aiOpen, openAi] = useState(false)
  const management = useRef(null)
  const rows = hub.data?.[kind] || []
  const filtered = rows.filter((r) => Boolean(r.archived) === archived && [r.title,r.tags,r.text,r.source].join(' ').toLowerCase().includes(query.trim().toLowerCase()))
  const item = filtered.find((r) => r.id === selected) || filtered[0]
  const patch = (values) => hub.change(kind, (all) => all.map((r) => r.id === item.id ? { ...r,...values } : r))
  const Page = pages[kind]
  const Icon = spaceIcons[kind]
  if (!hub.data) return <p role="alert">创作空间数据尚未载入。</p>
  function add(title) {
    const row = createItem(kind, title)
    hub.change(kind, (all) => [row, ...all])
    toggle(false)
    search('')
    select(row.id)
    if (management.current) management.current.open = false
  }
  return <section className="workspace creative-space" data-space={kind}>
    <header className="space-heading">
      <div className="space-title"><Icon size={25} aria-hidden /><h1>{spaceNames[kind]}</h1></div>
      <div className="space-context">
        {item && <select aria-label={'切换' + nouns[kind]} value={item.id} onChange={(e) => select(e.target.value)}>
          {filtered.map((row) => <option key={row.id} value={row.id}>{row.title || '未命名'}</option>)}
        </select>}
        <details className="space-management" ref={management}>
          <summary><Settings2 size={16} aria-hidden />管理{nouns[kind]}</summary>
          <div className="space-index">
            <AddLine label={'新' + nouns[kind] + '名称'} add={add} />
            <input aria-label="检索条目" placeholder={kind === 'clips' ? '搜索标题、标签、摘录或来源' : '搜索名称'} value={query} onChange={(e) => search(e.target.value)} />
            {item && <Field label={nouns[kind] + '名称'} value={item.title} set={(title) => patch({ title })} />}
            <div className="actions">
              <button className="archive-switch" aria-pressed={archived} onClick={() => toggle(!archived)}><Archive size={15} />{archived ? '返回当前条目' : '查看归档'}</button>
              {item && <button disabled={Boolean(item.session)} onClick={() => patch({ archived: !archived })}>{archived ? '恢复' : '归档当前'}</button>}
            </div>
          </div>
        </details>
        {item && !archived && !item.session && <button className="workspace-ai-button" onClick={() => { if (management.current) management.current.open = false; openAi(true) }}>
          <Sparkles size={16} aria-hidden />{spaceAiLabel(kind)}
        </button>}
      </div>
    </header>
    {item ? <article className="space-sheet" key={item.id}>
      <Page item={item} patch={patch} compare={compare} aiOpen={aiOpen} /><small className="space-save" role="status">{hub.status}</small>
      {aiOpen && <SpaceAi kind={kind} item={item} patch={patch} onClose={() => openAi(false)}
        onSettings={() => { openAi(false); onModelSettings() }} />}
    </article> : <div className="space-empty">
      {archived || query ? <><p>没有匹配的{archived ? '归档' : ''}条目</p><button onClick={() => { toggle(false); search('') }}>返回当前条目</button></>
        : <AddLine label={'新' + nouns[kind] + '名称'} add={add} />}
    </div>}
  </section>
}

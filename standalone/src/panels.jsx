import React, { useEffect, useId, useRef, useState } from 'react'
import { ArrowRight, Archive, BookOpen, Download, Plus, Trash2, Upload } from 'lucide-react'
import { Buffer } from 'buffer'
import { api, clearModel, loadModel, saveModel, testModel } from './transport.js'
import { exportLibrary, importPreview, legacyPreview, loadSession, recoveries, replaceLibrary, restoreRecovery } from './library.js'
import { native, platform } from './platform.js'
import { Drawer } from './drawer.jsx'
import { freeRouter, modelProfiles, profileSlot } from './model-profiles.js'

const enc = encodeURIComponent
const formatNumber = (value) => Number(value || 0).toLocaleString('zh-CN')

export function Bookshelf({ books, openBook, refresh, ui, recentId }) {
  const { TemplateStart, Websites } = ui
  const [title, setTitle] = useState('')
  const [creating, setCreating] = useState(false)
  const [trash, setTrash] = useState(null)
  const [error, setError] = useState('')
  async function run(work) {
    setError('')
    try { await work() } catch (failure) { setError(failure.message) }
  }
  const loadTrash = () => run(async () => setTrash((await api('GET', '/trash')).entries || []))
  function create(event) {
    event.preventDefault()
    if (!title.trim()) return
    run(async () => {
      const { book } = await api('POST', '/library', { title: title.trim() })
      setCreating(false)
      setTitle('')
      await refresh()
      await openBook(book.id)
    })
  }
  return <div className="workspace page-books">
    <header className="page-heading"><div><h1>书架</h1><p>{books.length} 部作品</p></div>
      <div className="actions">
        <button onClick={loadTrash}><Trash2 size={16} /> 回收站</button>
        <button className="primary" onClick={() => setCreating(true)}><Plus size={18} /> 新建作品</button>
      </div>
    </header>
    {error && <p className="notice" role="alert">{error}</p>}
    {books.length ? <div className="book-list">{books.map((book) =>
      <article className="book-row" key={book.id}>
        <button className="book-open" onClick={() => openBook(book.id)}>
          <span className="book-cover" aria-hidden style={{ '--book-accent': book.coverAccent }} />
          <span><strong>{book.title || book.id}</strong>{(book.author || book.genre) &&
            <small>{[book.author, book.genre].filter(Boolean).join(' · ')}</small>}
            {book.id === recentId && <small>最近打开</small>}</span>
          <ArrowRight size={19} />
        </button>
        <button aria-label={'删除' + (book.title || book.id)} className="icon-button book-trash" onClick={() => {
          if (confirm('将《' + (book.title || book.id) + '》移入回收站？')) run(async () => {
            await api('DELETE', '/library/' + enc(book.id))
            await refresh()
          })
        }}><Trash2 size={17} /></button>
      </article>)}</div> :
      <div className="workspace-empty"><BookOpen size={42} /><h2>开启第一部作品</h2><p>在书架创建作品，或从书库管理导入已有备份。</p>
        <button className="primary" onClick={() => setCreating(true)}>新建作品</button></div>}
    <div className="library-extras">
      <TemplateStart onCreated={async (id) => { await refresh(); await openBook(id) }} />
      <Websites />
    </div>
    {creating && <Drawer title="新建作品" guideTopic="shelf" onClose={() => setCreating(false)}>
      <form className="form-stack" onSubmit={create}>
        <label>作品名<input aria-label="作品名" autoFocus required value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <button className="primary" type="submit" disabled={!title.trim()}>创建作品</button>
      </form>
    </Drawer>}
    {trash && <Drawer title="回收站" guideTopic="shelf" onClose={() => setTrash(null)}>
      {!trash.length && <p className="muted">回收站是空的。</p>}
      {trash.map((entry) => <article className="trash-row" key={entry.id}>
        <strong>{entry.title || entry.name}</strong><div className="actions">
          <button onClick={() => run(async () => {
            await api('POST', '/trash/' + enc(entry.id) + '/restore', {})
            await loadTrash(); await refresh()
          })}>恢复</button>
          <button className="danger" onClick={() => {
            if (!confirm('永久删除这部作品？')) return
            run(async () => { await api('DELETE', '/trash/' + enc(entry.id)); await loadTrash() })
          }}>永久删除</button>
        </div>
      </article>)}
    </Drawer>}
  </div>
}

function Trend({ days }) {
  if (!days.length) return <p className="muted">保存章节后开始记录。</p>
  const top = Math.max(10, ...days.map(({ words }) => words))
  const bottom = Math.min(0, ...days.map(({ words }) => words))
  const x = (i) => 38 + i / Math.max(1, days.length - 1) * 508
  const y = (value) => 140 - (value - bottom) / (top - bottom) * 120
  const points = days.map((day, i) => x(i) + ',' + y(day.words)).join(' ')
  return <svg className="trend" viewBox="0 0 572 170" aria-label="近七天净写作字数" role="img">
    {[top, Math.round((top + bottom) / 2), bottom].map((mark) => <g key={mark}>
      <path d={'M38 ' + y(mark) + ' H546'} />
      <text x="32" y={y(mark) + 4} textAnchor="end">{mark}</text>
    </g>)}
    <polygon points={'38,' + y(0) + ' ' + points + ' 546,' + y(0)} />
    <polyline points={points} />
    {days.map((day, index) => <g key={day.date}>
      <circle cx={x(index)} cy={y(day.words)} r="3.8"><title>{day.date + ' · ' + day.words + ' 字'}</title></circle>
      <text x={x(index)} y="160" textAnchor="middle">{day.date.slice(5)}</text>
    </g>)}
  </svg>
}

export function Dashboard({ book, go }) {
  const root = '/library/' + enc(book.id)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    Promise.all([api('GET', root + '/progress'), api('GET', root + '/validate'),
      api('GET', root + '/unit/chapters'), loadSession(book.id)])
      .then(([progress, validation, chapters, session]) => {
        if (active) setData({ progress, validation, chapters: chapters.items || [], session })
      }).catch((failure) => { if (active) setError(failure.message) })
    return () => { active = false }
  }, [root, book.id])
  const chapter = data?.chapters.find((item) => item.id === data.session.chapter) || data?.chapters.at(-1)
  const alerts = (data?.validation.issues || []).filter((issue) => issue.level !== 'info')
  const progress = data?.progress
  return <div className="dashboard">
    <div className="resume">
      <div><small>{chapter ? '上次写到' : '正文'}</small><strong>{chapter?.title || '开始第一章'}</strong>
        {data?.session.note && <p>{data.session.note}</p>}</div>
      <button className="primary" onClick={() => go('write')}>继续写作 <ArrowRight size={16} /></button>
    </div>
    {error && <p role="alert" className="notice">{error}</p>}
    <div className="metrics">
      <div><small>今日净写作</small><strong>{progress ? formatNumber(progress.today) : '—'} <sub>字</sub></strong></div>
      <div><small>连续写作</small><strong>{progress?.streak ?? '—'} <sub>天</sub></strong></div>
      <div><small>全书字数</small><strong>{progress ? formatNumber(progress.done) : '—'} <sub>字</sub></strong></div>
      <div><small>写作目标</small><strong>{progress?.goal.words ? progress.percent + '%' : '—'}</strong>
        <button className="text-button" onClick={() => go('progress')}>{progress?.goal.words ? formatNumber(progress.goal.words) + ' 字' : '设置目标'}</button></div>
    </div>
    <div className="dashboard-lower">
      <section><h2>近七天写作趋势</h2><Trend days={progress?.history.slice(-7) || []} /></section>
      <section><h2>待处理</h2>
        {alerts.length ? <ul className="context-list">{alerts.slice(0, 4).map((issue, index) =>
          <li key={index}><button onClick={() => go('validate')}>{issue.message}<ArrowRight size={15} /></button></li>)}</ul>
          : <p className="muted">{data ? '当前没有错误或提醒。' : '正在检查书稿…'}</p>}
        <button className="text-button" onClick={() => go('validate')}>查看校验与读者报告</button>
      </section>
    </div>
  </div>
}

export function DraftLibrary({ book, go, compare }) {
  const root = '/library/' + enc(book.id)
  const [drafts, setDrafts] = useState([])
  const [chapters, setChapters] = useState([])
  const [active, setActive] = useState('')
  const [error, setError] = useState('')
  async function load() {
    const [snapshots, units] = await Promise.all([api('GET', root + '/drafts'), api('GET', root + '/unit/chapters')])
    setDrafts(snapshots.drafts || [])
    setChapters(units.items || [])
  }
  useEffect(() => { void load().catch((failure) => setError(failure.message)) }, [root])
  async function restore(id) {
    try {
      const saved = await api('GET', root + '/drafts/' + enc(id))
      const { data } = await api('GET', root + '/unit/chapters/' + enc(saved.chapter))
      if (await compare({ bookId: book.id, chapter: saved.chapter, original: data.body, proposed: saved.body })) await load()
    } catch (failure) {
      setError(failure.message)
    }
  }
  const known = new Map(chapters.map((chapter) => [chapter.id, chapter.title || chapter.id]))
  return <section className="settings-card">
    <div className="actions">
      <label>章节 <select value={active} onChange={(event) => setActive(event.target.value)}>
        <option value="">全部章节</option>
        {chapters.map((chapter) => <option key={chapter.id} value={chapter.id}>{known.get(chapter.id)}</option>)}
      </select></label>
      {active && <button onClick={() => go('write', undefined, active)}>打开正文</button>}
    </div>
    {error && <p className="notice" role="alert">{error}</p>}
    {!drafts.length && <p className="muted">在正文页保存快照后，即可在这里恢复。</p>}
    {drafts.filter((entry) => !active || active === entry.chapter).map((entry) => <article className="trash-row" key={entry.id}>
      <strong>{known.get(entry.chapter) || entry.chapter}</strong>
      <small>{entry.note || '章节快照'} · {entry.words} 字 · {entry.at ? new Date(entry.at).toLocaleString() : '未标时间'}</small>
      <div className="actions">
        <button disabled={!known.has(entry.chapter)} onClick={() => restore(entry.id)}>对照并恢复</button>
        <button className="danger" onClick={async () => {
          if (!confirm('删除这个章节快照？')) return
          try { await api('DELETE', root + '/drafts/' + enc(entry.id)); await load() }
          catch (failure) { setError(failure.message) }
        }}>删除快照</button>
      </div>
    </article>)}
  </section>
}

export function BookDetails({ book, onSaved }) {
  const [details, setDetails] = useState({ title: book.title, author: book.author || '', genre: book.genre || '', coverAccent: book.coverAccent || '' })
  const [status, setStatus] = useState('')
  async function save(event) {
    event.preventDefault()
    if (!details.title.trim()) return
    try {
      const result = await api('PATCH', '/library/' + enc(book.id), details)
      await onSaved(result.book)
      setStatus('作品信息已保存。')
    } catch (failure) { setStatus(failure.message) }
  }
  return <section className="settings-card">
    <h2>作品信息</h2>
    <form className="form-stack" onSubmit={save}>
      {[['title', '作品名'], ['author', '作者'], ['genre', '题材']].map(([key, label]) =>
        <label key={key}>{label}<input required={key === 'title'} value={details[key]}
          onChange={(event) => setDetails({ ...details, [key]: event.target.value })} /></label>)}
      <div className="actions book-color-setting">
        <label>书脊颜色<input type="color" value={/^#[\da-f]{6}$/i.test(details.coverAccent) ? details.coverAccent : '#2f5748'}
          onChange={(event) => setDetails({ ...details, coverAccent: event.target.value })} /></label>
        <button type="button" disabled={!details.coverAccent} onClick={() => setDetails({ ...details, coverAccent: '' })}>使用主题色</button>
      </div>
      <button type="submit" className="primary">保存作品信息</button>
    </form>
    {status && <p role="status">{status}</p>}
  </section>
}

export function WritingDefaults({ book, settings, onSaved }) {
  const [instruction, setInstruction] = useState(settings.writingInstruction || '')
  const [status, setStatus] = useState('')
  return <section className="settings-card">
    <h2>默认写作要求</h2>
    <form className="form-stack" onSubmit={async (event) => {
      event.preventDefault()
      try {
        const result = await api('PATCH', '/library/' + enc(book.id) + '/settings', { writingInstruction: instruction.trim() })
        onSaved(result.settings)
        setStatus('默认写作要求已保存。')
      } catch (failure) { setStatus(failure.message) }
    }}>
      <label>写作要求<textarea value={instruction} maxLength={600} rows={5}
        onChange={(event) => setInstruction(event.target.value)} /></label>
      <button className="primary">保存写作要求</button>
    </form>
    {status && <p role="status">{status}</p>}
  </section>
}

export function Backup({ book, refreshed }) {
  const [backup, setBackup] = useState(null)
  const [loose, setLoose] = useState(null)
  const [versions, setVersions] = useState([])
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const updateVersions = () => recoveries().then(setVersions)
  useEffect(() => { void updateVersions().catch(() => {}) }, [])

  async function run(work) {
    setBusy(true); setStatus('')
    try { await work() } catch (error) { setStatus(error.message) }
    finally { setBusy(false) }
  }
  async function openFile() {
    const file = await native('openFile')
    if (file.canceled) return
    const bytes = Buffer.from(file.base64, 'base64')
    if (file.name.toLowerCase().endsWith('.zip') || bytes.subarray(0, 2).toString() === 'PK') {
      setLoose(null)
      setBackup(importPreview(file))
      return
    }
    const kind = file.name.toLowerCase().endsWith('.json') ? 'backup' : 'markdown'
    const text = bytes.toString('utf8')
    if (!book && kind === 'markdown') throw new Error('请先打开要接收 Markdown 章节的作品。')
    const route = book ? '/library/' + enc(book.id) + '/import' : '/library'
    const report = book ? await api('POST', route, { kind, text, dryRun: true }) : null
    const title = kind === 'backup' ? JSON.parse(text).book?.title : null
    if (kind === 'backup' && !title) throw new Error('JSON 中没有作品信息。')
    setBackup(null)
    setLoose({ ...file, text, title, kind, report })
  }
  async function applyLoose() {
    let id = book?.id
    if (!id) {
      const made = await api('POST', '/library', { title: loose.title })
      id = made.book.id
    }
    const result = await api('POST', '/library/' + enc(id) + '/import', { kind: loose.kind, text: loose.text, dryRun: false })
    setLoose(null)
    setStatus('已导入 ' + (result.chapters ?? result.written ?? 0) + ' 章。')
    await refreshed(id)
  }
  return <section className="settings-card">
    <h2>备份与恢复</h2>
    <div className="actions">
      <button disabled={busy} className="primary" onClick={() => run(async () => {
        if (!(await exportLibrary()).canceled) setStatus('整库备份已保存。')
      })}><Download size={17} /> 导出整库 ZIP</button>
      <button disabled={busy} onClick={() => run(openFile)}><Upload size={17} /> 导入备份或手稿</button>
      {platform === 'windows' && <button disabled={busy} onClick={() => run(async () => {
        setLoose(null)
        setBackup(await legacyPreview())
      })}><Archive size={17} /> 复制旧 DSH 书库</button>}
    </div>
    {backup && <div className="backup-preview"><h3>{backup.name}</h3>
      <p>{backup.books.length} 部作品 · {backup.entries.length} 个文件</p>
      {!!backup.books.length && <p>{backup.books.slice(0, 12).join('、')}</p>}
      <p>恢复前会保存当前书库的副本。</p>
      <div className="actions"><button disabled={busy} className="primary" onClick={() => run(async () => {
        await replaceLibrary(backup)
        setBackup(null)
        setStatus('书库已恢复。')
        await updateVersions()
        await refreshed()
      })}>替换当前书库</button><button disabled={busy} onClick={() => setBackup(null)}>取消</button></div></div>}
    {loose && <div className="backup-preview"><h3>{loose.name}</h3>
      <p>{loose.report?.chapters ?? ''} {loose.report ? '章 · ' : ''}{book ? '导入到《' + book.title + '》' : '恢复为《' + loose.title + '》'}</p>
      <div className="actions"><button disabled={busy} className="primary" onClick={() => run(applyLoose)}>确认导入</button>
        <button disabled={busy} onClick={() => setLoose(null)}>取消</button></div></div>}
    {!!versions.length && <><h3>本地恢复副本</h3><ul className="context-list">{versions.map((name) =>
      <li key={name}><button disabled={busy} onClick={() => {
        if (!confirm('恢复这个书库版本？当前书库也会留下副本。')) return
        run(async () => { await restoreRecovery(name); await updateVersions(); await refreshed(); setStatus('已恢复。') })
      }}>{name.slice(9, -9).replace('T', ' ')}<ArrowRight size={15} /></button></li>)}</ul></>}
    <p className="muted" role="status">{busy ? '正在处理书库文件…' : status}</p>
  </section>
}

export function ModelSettings({ onConfigured, active = true }) {
  if (platform === 'dsh') return <HostModelSettings />
  return <NativeModelSettings onConfigured={onConfigured} active={active} />
}

function HostModelSettings() {
  const [record, setRecord] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    loadModel().then((value) => { if (live) setRecord(value) }, (failure) => { if (live) setError(failure.message) })
    return () => { live = false }
  }, [])
  return <section className="settings-card">
    <h2>DSH 宿主模型</h2>
    <p>{record?.configured ? record.models[0]?.name || record.model : record ? '尚未选择模型' : error || '正在读取…'}</p>
    <p className="muted">请在 DSH 的模型菜单中选择或配置模型，再回到工作台生成。</p>
  </section>
}

function NativeModelSettings({ onConfigured, active }) {
  const [profile, setProfile] = useState('deepseek')
  const [base, setBase] = useState(modelProfiles.deepseek.base)
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [saved, setSaved] = useState(null)
  const [models, setModels] = useState([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const initialized = useRef(false)
  const modelListId = useId()
  const preset = modelProfiles[profile]
  const slot = profileSlot(profile)
  const local = profile === 'ollama'
  const free = profile === 'openrouter'
  const hasKey = saved?.keys?.[slot] && saved.profiles[slot]?.base === base.trim().replace(/\/$/, '')
  const selected = saved?.profiles?.[slot]
  const current = saved?.profiles?.[saved.active]
  const modelName = (config) => config?.models?.find((item) => item.id === config.model)?.name || config?.model
  const edited = models.find((item) => item.id === name)
  const canTest = saved?.configured && saved.active === slot && selected?.profile === profile && selected.base === base
    && selected.model === name && !value.trim()
  useEffect(() => {
    if (!active) return
    let alive = true
    loadModel().then((result) => {
      if (!alive) return
      setSaved(result)
      if (initialized.current) return
      initialized.current = true
      if (result.profile && modelProfiles[result.profile]) setProfile(result.profile)
      if (result.base) setBase(result.base)
      setName(result.model || '')
      setModels(result.models || [])
    }).catch((error) => { if (alive) setMessage(error.message) })
    return () => { alive = false }
  }, [active])
  function choose(next) {
    const config = saved?.profiles?.[profileSlot(next)]
    const previous = config?.profile === next ? config : null
    setProfile(next)
    setBase(previous?.base || modelProfiles[next].base)
    setName(previous?.model || (next === 'openrouter' ? freeRouter.id : ''))
    setModels(previous?.models || (next === 'openrouter' ? [freeRouter] : []))
    setValue('')
    setMessage('')
  }
  async function save(event) {
    event.preventDefault()
    setBusy(true)
    setMessage('正在识别模型…')
    try {
      const result = await saveModel({ base, name, value, profile })
      setValue('')
      setBase(result.base)
      setName(result.model)
      setSaved(result)
      setModels(result.models)
      onConfigured?.()
      setMessage(result.discoveryError || '已识别 ' + result.models.length + ' 个模型。')
    } catch (error) { setMessage(error.message) }
    finally { setBusy(false) }
  }
  return <section className="settings-card">
    <div className="model-summary" role="status">
      <span>当前应用默认</span>
      <strong>{!saved ? '正在读取…' : saved.configured
        ? modelProfiles[current.profile].name + ' · ' + modelName(current) : '尚未配置'}</strong>
      {saved?.configured && modelName(current) !== current.model && <code>{current.model}</code>}
    </div>
    <form className="form-stack" onSubmit={save}>
      <label>服务<select aria-label="服务" value={profile} disabled={busy} onChange={(event) => choose(event.target.value)}>
        {Object.entries(modelProfiles).filter(([id]) => platform === 'windows' || id !== 'ollama').map(([id, info]) =>
          <option key={id} value={id}>{info.name}</option>)}
      </select></label>
      {free && <div className="provider-summary"><p>填写自己的 OpenRouter API Key，使用免费自动路由或选择具体免费模型。免费额度与可用模型由服务方决定。</p>
        <button type="button" className="text-button" onClick={() => native('external', { url: preset.keyPage }).catch((error) => setMessage(error.message))}>获取 OpenRouter API Key</button></div>}
      {local && <div className="provider-summary"><p>启动本机的 Ollama 并下载一个模型，随后从这里识别，无需填写 Key。</p>
        <button type="button" className="text-button" onClick={() => native('external', { url: preset.keyPage }).catch((error) => setMessage(error.message))}>打开 Ollama 下载页</button></div>}
      <label>API 基础地址<input type="url" required readOnly={local || free} value={base} onChange={(event) => setBase(event.target.value)} /></label>
      {!local && <label>API Key<input type="password" autoComplete="off" value={value} placeholder={hasKey ? '密钥已保存在本机' : '在应用内输入密钥'}
        onChange={(event) => setValue(event.target.value)} /></label>}
      {free || local ? <label>默认模型<select aria-label="默认模型" value={name} disabled={busy} onChange={(event) => setName(event.target.value)}>
        {!edited && <option value={name} disabled>{name ? name + '（不可用）' : '保存后自动识别模型'}</option>}
        {models.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label> : <><label>默认模型<input list={modelListId} value={name} placeholder="保存密钥后自动识别"
        onChange={(event) => setName(event.target.value)} /></label>
        <datalist id={modelListId}>{models.map((item) => <option key={item.id} value={item.id} />)}</datalist></>}
      {edited?.name && edited.name !== edited.id && <p className="muted">模型 ID · <code>{edited.id}</code></p>}
      {edited?.efforts?.length > 0 && <p className="muted">思考档位 · {edited.efforts.join(' / ')}</p>}
      {saved?.configured && !canTest && <p className="muted">保存后启用当前选择。</p>}
      <div className="actions"><button className="primary" disabled={busy || (!local && !value.trim() && !hasKey)}>识别模型并保存</button>
        {canTest && <button type="button" disabled={busy} title="发送一条简短的连接测试请求" onClick={async () => {
          setBusy(true)
          setMessage('正在测试连接…')
          try { await testModel(AbortSignal.timeout(25000)); setMessage('模型连接成功。') }
          catch (error) { setMessage(error.message) }
          finally { setBusy(false) }
        }}>测试连接</button>}
        {hasKey && <button type="button" disabled={busy} onClick={async () => {
          try { setSaved(await clearModel(profile)); onConfigured?.(); setMessage('已移除密钥。') }
          catch (error) { setMessage(error.message) }
        }}>移除密钥</button>}</div>
    </form>
    {message && <p role="status" className="muted">{message}</p>}
  </section>
}

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { rewriteSelection } from './continuity.js'

export function FindReplace({ original, onJump, onCompare, initialQuery = '' }) {
  const [query, setQuery] = useState(initialQuery)
  const [replacement, setReplacement] = useState('')
  const occurrences = useMemo(() => {
    const matches = []
    if (!query) return matches
    let start = original.indexOf(query)
    while (start !== -1) {
      matches.push(start)
      start = original.indexOf(query, start + query.length)
    }
    return matches
  }, [original, query])
  return <form className="writing-tool form-stack" onSubmit={(event) => {
    event.preventDefault()
    if (occurrences.length) onCompare(original, original.split(query).join(replacement))
  }}>
    <label>查找<input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    <label>替换为<input value={replacement} onChange={(event) => setReplacement(event.target.value)} /></label>
    <p role="status" className="muted">本章 · {occurrences.length} 处</p>
    <ul className="context-list search-preview">{occurrences.slice(0, 15).map((offset) => <li key={offset}>
      <button type="button" onClick={() => onJump(offset, offset + query.length)}>
        {original.slice(Math.max(0, offset - 20), offset)}<mark>{query}</mark>{original.slice(offset + query.length, offset + query.length + 35)}
      </button></li>)}</ul>
    <button className="primary" type="submit" disabled={!occurrences.length || replacement === query}>预览全部替换</button>
  </form>
}

export function RewritePassage({ book, text, onCompare }) {
  const [instruction, setInstruction] = useState('')
  const [out, setOut] = useState('')
  const [status, setStatus] = useState('')
  const [running, setRunning] = useState(false)
  const cancellation = useRef(null)
  useEffect(() => () => cancellation.current?.abort(), [])
  async function generate() {
    const controller = new AbortController()
    cancellation.current = controller
    setRunning(true)
    setOut('')
    setStatus('正在生成候选…')
    try {
      const result = await rewriteSelection(book.id, text, instruction, controller.signal, (delta) => setOut((value) => value + delta))
      setOut(result)
      setStatus('候选已就绪')
    } catch (error) { setStatus(controller.signal.aborted ? '已停止，保留收到的文字。' : error.message) }
    finally { setRunning(false); cancellation.current = null }
  }
  return <div className="writing-tool form-stack">
    <details open><summary>本次发送的原段 · {text.length} 字符</summary><pre>{text}</pre></details>
    <label>改写要求<textarea rows={3} value={instruction} maxLength={600} onChange={(event) => setInstruction(event.target.value)} /></label>
    <div className="actions">
      <button className="primary" disabled={running} onClick={generate}><Sparkles size={16} />生成改写</button>
      {running && <button onClick={() => cancellation.current?.abort()}>停止</button>}
    </div>
    <label>候选正文<textarea rows={8} readOnly={running} value={out} onChange={(event) => setOut(event.target.value)} /></label>
    {status && <p role="status">{status}</p>}
    <button disabled={running || !out.trim()} onClick={() => onCompare(out)}>与原段对照</button>
  </div>
}

import React, { useEffect, useRef, useState } from 'react'

const columns = 18
const rows = 10
const rules = {
  life: { label: '经典生命', birth: [3], stay: [2, 3] },
  high: { label: '复制生命', birth: [3, 6], stay: [2, 3] },
  seeds: { label: '种子蔓延', birth: [2], stay: [] },
}

function evolve(cells, rule) {
  const alive = new Set(cells)
  const next = []
  for (let index = 0; index < columns * rows; index++) {
    const x = index % columns
    const y = Math.floor(index / columns)
    let n = 0
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((dx || dy) && x + dx >= 0 && x + dx < columns && y + dy >= 0 && y + dy < rows &&
          alive.has(index + dx + dy * columns)) n++
      }
    }
    if ((alive.has(index) ? rule.stay : rule.birth).includes(n)) next.push(index)
  }
  return next
}

export function Ecosystem({ item, patch, aiOpen }) {
  const [running, setRunning] = useState(false)
  const { cells, generation, rule, checkpoint } = item
  const alive = new Set(cells)
  const settings = rules[rule]
  function step() { patch({ cells: evolve(cells, settings), generation: generation + 1 }) }
  useEffect(() => {
    if (aiOpen) { setRunning(false); return }
    if (!running) return
    const timer = setTimeout(step, 330)
    return () => clearTimeout(timer)
  }, [running, cells, generation, rule, aiOpen])
  return <div className="ecosystem-workspace">
    <div className="ecosystem-grid" aria-label="细胞画板" role="group">
      {Array.from({ length: rows * columns }, (_, i) => <button key={i} type="button"
        aria-label={`第 ${Math.floor(i / columns) + 1} 行第 ${i % columns + 1} 列`} aria-pressed={alive.has(i)}
        disabled={running} onClick={() => patch({ cells: alive.has(i) ? cells.filter((v) => v !== i) : [...cells, i] })} />)}
    </div>
    <aside className="ecosystem-controls"><div className="experiment-metrics"><strong>第 {generation} 代</strong><span>{cells.length} 个活细胞</span></div>
    <label className="space-field">演化规则<select value={rule} onChange={(e) => patch({ rule: e.target.value })}>
      {Object.entries(rules).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
    </select></label>
    <p className="muted">邻居数为 {settings.birth.join('、')} 时出生。{settings.stay.length ? `活细胞在 ${settings.stay.join('、')} 个邻居时存活。` : '活细胞只存活一代。'}</p>
    <div className="actions">
      <button className="primary" onClick={() => setRunning(!running)}>{running ? '暂停' : '自动演化'}</button>
      <button disabled={running} onClick={step}>下一代</button>
      <button disabled={running} onClick={() => patch({ checkpoint: { cells, generation, rule } })}>记录检查点</button>
      <button disabled={running || !checkpoint} onClick={() => patch(checkpoint)}>回到检查点</button>
      <button disabled={running || !cells.length} onClick={() => patch({ cells: [], generation: 0 })}>清空画板</button>
    </div></aside>
  </div>
}

const tones = [0, 196, 261.63, 329.63, 392, 523.25]
const toneNames = ['休止', '低音 G', 'C', 'E', 'G', '高音 C']

export function SoundCard({ item, patch }) {
  const [active, setActive] = useState(-1)
  const [error, setError] = useState('')
  const session = useRef(null)
  const beats = item.beats || [1, 0, 2, 3, 0, 4, 3, 2]
  function stop() {
    const current = session.current
    session.current = null
    if (!current) return
    current.timers.forEach(clearTimeout)
    void current.context.close().catch(() => {})
  }
  useEffect(() => stop, [])
  async function play() {
    stop()
    setActive(-1)
    setError('')
    const Audio = window.AudioContext || window.webkitAudioContext
    try {
      if (!Audio) throw new Error('此预览环境不支持音频播放。')
      const current = { context: new Audio(), timers: [] }
      session.current = current
      await current.context.resume()
      if (session.current !== current) return
      const { context, timers } = current
      const start = context.currentTime + 0.04
      beats.forEach((tone, i) => {
        const time = start + 0.35 * i
        timers.push(setTimeout(() => setActive(i), 40 + 350 * i))
        if (!tones[tone]) return
        const oscillator = context.createOscillator()
        const volume = context.createGain()
        oscillator.type = item.voice || 'sine'
        oscillator.frequency.value = tones[tone]
        volume.gain.setValueAtTime(0, time)
        volume.gain.linearRampToValueAtTime(0.12, time + 0.02)
        volume.gain.exponentialRampToValueAtTime(0.001, time + 0.29)
        oscillator.connect(volume).connect(context.destination)
        oscillator.start(time)
        oscillator.stop(time + 0.3)
      })
      timers.push(setTimeout(() => { stop(); setActive(-1) }, beats.length * 350 + 60))
    } catch (failure) {
      stop()
      setActive(-1)
      setError(failure.message)
    }
  }
  return <section className="postcard-sequencer">
    <div className="sound-transport"><h2>八拍旋律</h2><div className="actions">
      <button className="primary" onClick={play}>播放旋律</button>
      <button disabled={active < 0} onClick={() => { stop(); setActive(-1) }}>停止</button>
    </div></div>
    <div className="sound-steps">{beats.map((tone, i) => <label key={i} data-playing={active === i} data-rest={tone === 0}>
      第 {i + 1} 拍<select value={tone} onChange={(e) => patch({ beats: beats.map((v, j) => j === i ? Number(e.target.value) : v) })}>
        {toneNames.map((name, idx) => <option value={idx} key={name}>{name}</option>)}
      </select></label>)}</div>
    <div className="actions">
      <label className="space-field">音色<select value={item.voice || 'sine'} onChange={(e) => patch({ voice: e.target.value })}>
        <option value="sine">柔和</option><option value="triangle">木质</option>
      </select></label>
    </div>
    {error && <p role="alert" className="notice">{error}</p>}
  </section>
}

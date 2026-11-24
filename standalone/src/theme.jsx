import React, { useEffect, useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { readFile, writeFile } from './files.js'

const modes = ['system', 'day', 'night']
const defaults = {
  day: { background: '#F0EDE4', surface: '#FAF8F1', text: '#282C25', accent: '#2F5748', paper: '#FFFDF7', ink: '#252823' },
  night: { background: '#171D1C', surface: '#232925', text: '#E5E8DF', accent: '#A8C4A9', paper: '#1D2421', ink: '#EEE9DD' },
}
const themeFile = '/settings/appearance.json'
const fields = [
  ['background', '窗口背景'], ['surface', '面板'], ['text', '界面文字'],
  ['accent', '强调色'], ['paper', '正文纸面'], ['ink', '正文文字'],
]
const hex = /^#[0-9a-f]{6}$/i

function load(raw) {
  const parsed = { mode: modes.includes(raw?.mode) ? raw.mode : 'system' }
  for (const mode of ['day', 'night']) {
    parsed[mode] = Object.fromEntries(fields.map(([key]) => [
      key, hex.test(raw?.[mode]?.[key] || '') ? raw[mode][key] : defaults[mode][key],
    ]))
  }
  return parsed
}

function luminance(color) {
  const channels = color.slice(1).match(/../g).map((value) => parseInt(value, 16) / 255)
    .map((n) => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4)
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((left, right) => right - left)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

export function useTheme() {
  const [theme, setTheme] = useState(() => load({}))
  const [preview, setPreview] = useState(null)
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    readFile(themeFile, 'utf8').then(JSON.parse).then((value) => setTheme(load(value))).catch(() => {})
    const media = matchMedia('(prefers-color-scheme: dark)')
    const change = (event) => setSystemDark(event.matches)
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])
  const mode = theme.mode === 'system' ? (systemDark ? 'night' : 'day') : theme.mode
  const effective = preview?.mode || mode
  const palette = preview?.colors || theme[effective]
  useEffect(() => {
    const root = document.documentElement
    root.dataset.appearance = effective
    root.style.colorScheme = effective === 'night' ? 'dark' : 'light'
    for (const [key, value] of Object.entries(palette)) root.style.setProperty('--studio-' + key, value)
    root.style.setProperty('--studio-on-accent',
      contrast('#FFFFFF', palette.accent) > contrast('#000000', palette.accent) ? '#FFFFFF' : '#000000')
    root.style.setProperty('--studio-focus',
      contrast(palette.accent, palette.surface) >= 3 && contrast(palette.accent, palette.background) >= 3 ? palette.accent : palette.text)
  }, [effective, palette])
  async function persist(next) {
    await writeFile(themeFile, JSON.stringify(next))
    setTheme(next)
  }
  return { theme, mode, persist, setPreview }
}

export function ThemeMenu({ theme, persist, onError }) {
  const Icon = theme.mode === 'day' ? Sun : theme.mode === 'night' ? Moon : Monitor
  return <label className="theme-switch" title="切换白天、夜晚或跟随系统">
    <Icon size={17} aria-hidden />
    <select aria-label="配色模式" value={theme.mode} onChange={(e) => persist({ ...theme, mode: e.target.value }).catch(onError)}>
      <option value="system">跟随系统</option><option value="day">白天</option><option value="night">夜晚</option>
    </select>
  </label>
}

export function Appearance({ theme, mode, persist, setPreview, sample, active = true }) {
  const [editing, setEditing] = useState(mode)
  const [colors, setColors] = useState(theme[mode])
  const [previewing, setPreviewing] = useState(false)
  const [message, setMessage] = useState('')
  const valid = fields.every(([key]) => hex.test(colors[key]))
  const readable = valid && contrast(colors.paper, colors.ink) >= 4.5
    && contrast(colors.surface, colors.text) >= 4.5 && contrast(colors.background, colors.text) >= 4.5

  useEffect(() => {
    if (!active || !previewing || !valid) return
    setPreview({ mode: editing, colors })
    return () => setPreview(null)
  }, [active, editing, colors, previewing, valid, setPreview])

  function changeColors(next) {
    setColors(next)
    setPreviewing(true)
    setMessage('')
  }

  function pick(next) {
    setEditing(next)
    changeColors(theme[next])
  }

  async function save() {
    try {
      await persist({ ...theme, [editing]: colors })
      setPreviewing(false)
      setMessage('配色已保存')
    } catch (error) {
      setMessage(error.message)
    }
  }

  return <div className="settings-card">
    <div className="segments" aria-label="编辑主题">
      <button data-on={editing === 'day'} aria-pressed={editing === 'day'} onClick={() => pick('day')}>白天</button>
      <button data-on={editing === 'night'} aria-pressed={editing === 'night'} onClick={() => pick('night')}>夜晚</button>
    </div>
    <div className="color-grid">
      {fields.map(([key, label]) => <div className="color-field" key={key}>
        <span>{label}</span>
        <input type="color" aria-label={'选择' + label} value={hex.test(colors[key]) ? colors[key] : defaults[editing][key]}
          onChange={(e) => changeColors({ ...colors, [key]: e.target.value })} />
        <input type="text" aria-label={label + ' HEX'} value={colors[key]} maxLength={7}
          onChange={(e) => changeColors({ ...colors, [key]: e.target.value })} />
      </div>)}
    </div>
    <div className="paper-sample" style={valid ? { backgroundColor: colors.paper, color: colors.ink } : undefined}>
      <h3>{sample?.title || '午后一页'}</h3><p>{sample?.body || '沿着书页的行距，继续写下一段故事。'}</p>
    </div>
    <div className="actions">
      <button className="primary" disabled={!readable} onClick={save}>保存配色</button>
      <button onClick={() => changeColors(defaults[editing])}>恢复默认</button>
    </div>
    {!readable && <p className="notice" role="status">{valid ? '文字与背景的对比度需要达到 4.5:1。' : '请输入 #RRGGBB 格式的颜色。'}</p>}
    {message && <p role="status">{message}</p>}
  </div>
}

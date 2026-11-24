/* Runs inside the dedicated Guaji sandbox, before the original view. */
const studioStorage = Object.create(null)
const studioPrefs = {
  getItem: (key) => studioStorage[key] ?? null,
  setItem(key, value) {
    studioStorage[key] = String(value)
    if (studioPort) void studioRequest('preference', { key, value: studioStorage[key] }).catch(() => {})
  },
}
let studioPort, studioSerial = 0
const studioRequests = new Map()
let studioDraftValue = null

function studioRequest(action, value = {}) {
  if (!studioPort) return Promise.reject(new Error('工作台连接尚未就绪。'))
  const id = ++studioSerial
  return new Promise((resolve, reject) => {
    studioRequests.set(id, { resolve, reject })
    studioPort.postMessage({ id, action, value })
  })
}

function studioShowDraft(draft) {
  studioDraftValue = draft
  $('#studioModel').textContent = draft.model || '当前配置模型'
  $('#studioText').textContent = draft.text
  $('#studioDraft').hidden = false
  $('#studioStatus').textContent = ''
}

function studioPresent(result) {
  studioDraftValue = null
  $('#studioDraft').hidden = true
  $('#studioConfirm').hidden = true
  $('#studioResultActions').hidden = false
  $('#studioAccepted').replaceChildren()
  $('#studioStatus').textContent = ''
  const input = result.studioInput
  $('#studioEffective').textContent = [result.method_name, input.timestamp.replace('T', ' '),
    `种子 ${input.seed}`, input.numbers.length ? '数字 ' + input.numbers.join('、') : ''].filter(Boolean).join(' · ')
  for (const entry of result.studioNotes || []) studioAppend(entry)
  $('#offlineBadge').style.display = 'none'
}

function studioAppend(entry) {
  const p = document.createElement('p')
  p.textContent = (entry.followup ? entry.followup + ' · ' : '') + entry.text
  $('#studioAccepted').appendChild(p)
}

async function studioRun(button, work) {
  if (button.disabled) return
  const status = $('#studioStatus')
  button.disabled = true
  status.textContent = '处理中…'
  try { status.textContent = (await work()) || '' }
  catch (error) { status.textContent = error.message }
  finally { button.disabled = false }
}

function studioBind(initial) {
  $('#studioModelSettings').addEventListener('click', () => studioRequest('settings').catch((error) => toast(error.message)))
  const help = document.createElement('button')
  help.type = 'button'
  help.textContent = '使用说明'
  help.addEventListener('click', () => studioRequest('guide').catch((error) => toast(error.message)))
  document.querySelector('.top-actions').prepend(help)
  $('#studioInterpret').addEventListener('click', (event) => studioRun(event.currentTarget, async () => {
    studioShowDraft(await studioRequest('interpret'))
    return '解读已生成'
  }))
  $('#studioAdopt').addEventListener('click', (event) => studioRun(event.currentTarget, async () => {
    if (!studioDraftValue) return ''
    const adopted = await studioRequest('adopt', { draftId: studioDraftValue.id })
    studioAppend(adopted.entry)
    studioDraftValue = null
    $('#studioDraft').hidden = true
    return '已采纳并保存'
  }))
  $('#studioDiscard').addEventListener('click', () => {
    studioDraftValue = null
    $('#studioDraft').hidden = true
  })
  $('#studioSave').addEventListener('click', (event) => studioRun(event.currentTarget, async () => {
    await studioRequest('save')
    return '已保存卦象笔记'
  }))
  $('#studioFork').addEventListener('click', () => { $('#studioConfirm').hidden = false })
  $('#studioCancelFork').addEventListener('click', () => { $('#studioConfirm').hidden = true })
  $('#studioConfirmFork').addEventListener('click', (event) => studioRun(event.currentTarget, async () => {
    await studioRequest('fork')
    $('#studioConfirm').hidden = true
    return '已创建推演'
  }))
  if (initial) {
    $('#question').value = initial.question
    $('#studioTimestamp').value = initial.studioInput.timestamp
    $('#studioSeed').value = initial.studioInput.seed
    LAST_RESULT = initial
    $('#resultPanel').style.display = 'block'
    const progressive = PROGRESSIVE
    PROGRESSIVE = false
    void renderResult(initial).then(() => studioPresent(initial)).catch((error) => toast(error.message))
      .finally(() => { PROGRESSIVE = progressive })
  }
}

function studioConnect(event) {
  if (event.source !== parent || event.data?.type !== 'novel-studio-guaji-init' || event.ports.length !== 1 || studioPort) return
  window.removeEventListener('message', studioConnect)
  studioPort = event.ports[0]
  studioPort.onmessage = ({ data }) => {
    if (data.type === 'theme') {
      document.documentElement.dataset.studioTheme = data.theme === 'night' ? 'night' : 'day'
      return
    }
    const request = studioRequests.get(data.id)
    if (!request) return
    studioRequests.delete(data.id)
    if (data.error) request.reject(new Error(data.error))
    else request.resolve(data.value)
  }
  document.documentElement.dataset.studioTheme = event.data.theme === 'night' ? 'night' : 'day'
  Object.assign(studioStorage, event.data.prefs)
  init()
  studioBind(event.data.result)
}
window.addEventListener('message', studioConnect)

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('novelNative', {
  invoke: (action, payload) => ipcRenderer.invoke('novel:invoke', action, payload),
  onProvider: (callback) => {
    const listener = (_, event) => callback(event)
    ipcRenderer.on('novel:provider', listener)
    return () => ipcRenderer.removeListener('novel:provider', listener)
  },
  onClosing: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('novel:closing', listener)
    return () => ipcRenderer.removeListener('novel:closing', listener)
  },
})

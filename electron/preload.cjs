const { contextBridge, ipcRenderer } = require('electron')

const invokeChannels = new Set([
  'settings:get',
  'settings:set',
  'settings:hasKey',
  'settings:autoLaunch',
  'state:save',
  'state:load',
  'state:clear',
  'gemini:ask',
  'gemini:chat',
  'dialog:pickArena',
  'arena:import',
  'arena:previewPath',
  'dialog:pickFootage',
  'footage:analyze',
  'render:start',
  'render:cancel',
  'render:reveal',
  'render:copyToDownloads',
  'updater:check',
])

const eventChannels = new Set(['render:progress', 'render:done', 'render:error', 'updater:status'])

function assertChannel(channel, allowed) {
  if (!allowed.has(channel)) throw new Error(`IPC channel is not exposed: ${channel}`)
}

contextBridge.exposeInMainWorld('northframe', {
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  ipc: {
    invoke: (channel, payload) => {
      assertChannel(channel, invokeChannels)
      return ipcRenderer.invoke(channel, payload)
    },
    on: (channel, callback) => {
      assertChannel(channel, eventChannels)
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    },
  },
  paths: {
    arenaPreviewUrl: (localPath) => ipcRenderer.invoke('arena:previewPath', localPath),
  },
})

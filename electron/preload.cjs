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
  'dialog:pickFootage', 'dialog:pickFolder',
  'footage:analyze',
  'media:status',
  'render:start',
  'render:cancel',
  'render:reveal',
  'render:copyToDownloads',
  'updater:check',
  'automation:start', 'automation:cancel', 'automation:resume', 'automation:get', 'automation:list', 'automation:approveStep', 'automation:rejectStep', 'automation:setWatchedFolder', 'automation:setOutputFolder', 'automation:openOutput',
])

const eventChannels = new Set(['render:progress', 'render:done', 'render:error', 'updater:status', 'automation:progress', 'automation:step', 'automation:waiting', 'automation:done', 'automation:error'])

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

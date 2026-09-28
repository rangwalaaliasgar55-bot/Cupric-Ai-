const { contextBridge, ipcRenderer, webUtils } = require('electron')

const invokeChannels = new Set([
  'settings:get',
  'settings:set',
  'settings:hasKey',
  'settings:autoLaunch',
  'ai:autoDiscover',
  'ai:freeModels',
  'ai:health',
  'agent:generateAnimation',
  'agent:saveGenerated',
  'ai:ackNewModels',
  'ai:openZenAuth',
  'ai:installOllama',
  'ai:useTemplate',
  'gemini:listModels',
  'state:save',
  'state:load',
  'state:clear',
  'state:recoveryInfo', 'state:listVersions', 'state:snapshotNow', 'state:restoreVersion',
  'diag:report',
  'log:write',
  'voice:status', 'voice:tts', 'voice:transcribe', 'voice:transcribeMedia',
  'media:proxy', 'media:proxyDelete',
  'gemini:ask',
  'gemini:chat',
  'ai:testConnection',
  'opencode:listModels',
  'opencode:discoverModels',
  'dialog:pickArena',
  'arena:import',
  'arena:previewPath',
  'arena:readHtml',
  'path:reveal',
  'capture:rect',
  'arena:openBuilder',
  'dialog:pickFootage', 'dialog:pickFolder',
  'footage:analyze',
  'media:status',
  'studio:exportMp4',
  'studio:planEdits',
  'render:start',
  'render:cancel',
  'render:pause',
  'render:resume',
  'render:reveal', 'render:preview',
  'render:copyToDownloads',
  'studio:submitRecording', 'studio:recordingError', 'studio:progress',
  'stock:search', 'stock:download', 'stock:fetchForTerm', 'stock:keyStatus', 'stock:testConnection', 'stock:proxyHealth',
  'review:list', 'review:add', 'review:resolve',
  'updater:check',
  'updater:install',
  'automation:start', 'automation:cancel', 'automation:resume', 'automation:get', 'automation:list', 'automation:approveStep', 'automation:rejectStep', 'automation:setWatchedFolder', 'automation:setOutputFolder', 'automation:openOutput', 'automation:openArena',
])

const eventChannels = new Set(['render:progress', 'render:done', 'render:error', 'studio:backgroundExport', 'updater:status', 'automation:progress', 'automation:step', 'automation:waiting', 'automation:done', 'automation:error', 'media:proxyProgress', 'ai:discovery', 'ai:rundownPolished', 'ai:notice', 'ai:models', 'ai:health'])

function assertChannel(channel, allowed) {
  if (!allowed.has(channel)) throw new Error(`IPC channel is not exposed: ${channel}`)
}

/**
 * The ONE bridge object. It is deep-frozen here and exposed exactly once per
 * name below; contextBridge then defines `window.cupric` / `window.northframe`
 * as non-writable, non-configurable properties. Nothing — preload or renderer —
 * may mutate, extend, reassign or delete it (0.10.0 blanked the Studio by
 * doing `window.cupric = {...window.cupric, studio}`). Renderer-owned globals
 * use their own names, e.g. `window.__cupricStudio`. Enforced by
 * `npm run check:bridge`.
 */
function deepFreeze(value) {
  if (value && (typeof value === 'object' || typeof value === 'function') && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.getOwnPropertyNames(value)) deepFreeze(value[key])
  }
  return value
}

const bridge = deepFreeze({
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  filePathFor: (file) => {
    try {
      return webUtils.getPathForFile(file) || null
    } catch {
      return null
    }
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

for (const name of ['cupric', 'northframe']) contextBridge.exposeInMainWorld(name, bridge)

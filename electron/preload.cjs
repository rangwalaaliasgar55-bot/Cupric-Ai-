const { contextBridge, ipcRenderer } = require('electron')

// Minimal, safe surface. The prototype is fully mocked — the desktop shell
// only advertises itself so the UI can show a "desktop" badge if it wants to.
contextBridge.exposeInMainWorld('northframe', {
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  // Reserved for the real render pipeline (Puppeteer + ffmpeg) later:
  ipc: { invoke: (channel, payload) => ipcRenderer.invoke(channel, payload) },
})

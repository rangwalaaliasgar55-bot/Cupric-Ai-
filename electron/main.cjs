const { app, BrowserWindow, Menu, shell } = require('electron')
const path = require('path')

const DEV_URL = process.env.ELECTRON_START_URL

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: '#0B0B10',
    title: 'Northframe Studio',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })

  Menu.setApplicationMenu(null) // clean Windows chrome — the app has its own top bar

  win.once('ready-to-show', () => win.show())

  // Open external links (arena.ai/code, docs) in the user's browser, never in-app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    const allowed = DEV_URL && url.startsWith(DEV_URL)
    if (!allowed && !url.startsWith('file://')) {
      e.preventDefault()
      if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    }
  })

  if (DEV_URL) win.loadURL(DEV_URL)
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
}

app.setAppUserModelId('app.northframe.studio')

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Windows users only — closing the window quits the app
app.on('window-all-closed', () => app.quit())

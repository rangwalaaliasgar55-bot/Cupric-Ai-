const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron')
const fs = require('fs')
const path = require('path')
const { GoogleGenerativeAI } = require('@google/generative-ai')
const { execFile } = require('child_process')
const { dialog } = require('electron')
let autoUpdater
try { ({ autoUpdater } = require('electron-updater')) } catch {}
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()
else app.on('second-instance', () => { const w=BrowserWindow.getAllWindows()[0]; if(w){if(w.isMinimized())w.restore();w.focus()} })
const AdmZip = require('adm-zip')
let ffmpegPath, ffprobePath
try { ffmpegPath = require('ffmpeg-static') } catch {}
try { ffprobePath = require('ffprobe-static').path } catch {}
const jobs = new Map()
const projectRoot = (id) => path.join(app.getPath('userData'), 'projects', String(id))
const run = (bin, args) => new Promise((resolve, reject) => execFile(bin, args, { maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => err ? reject(Object.assign(err, { stderr })) : resolve({ stdout, stderr })))
const DEV_URL = process.env.ELECTRON_START_URL
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json')
function readSettings() { try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) } catch { return {} } }
function writeSettings(next) { fs.mkdirSync(app.getPath('userData'), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2), 'utf8') }
function apiKey() { return readSettings().geminiApiKey || process.env.GEMINI_API_KEY || '' }
function parseJson(text) { const m = String(text).match(/```(?:json)?\s*([\s\S]*?)```/) || String(text).match(/\{[\s\S]*\}/); return JSON.parse(m ? (m[1] || m[0]) : text) }
function makePrompt(prompt, context) { return `Return STRICT JSON only matching SceneRundown: {title:string,durationSec:number,fps:number,size:[number,number],style:string,scenes:[{id,from,to,type,copy,motion}],arenaPrompt:string}. Brief: ${prompt}. Context: ${JSON.stringify(context || {})}. arenaPrompt must say: Build a SINGLE FILE index.html, #scene WxH, Duration Ns at 30fps, window.__seek(t) pure function of t, style details.` }
async function generateRundown(prompt, context) { const model = new GoogleGenerativeAI(apiKey()).getGenerativeModel({ model:'gemini-2.0-flash', generationConfig:{ responseMimeType:'application/json' } }); let error; for (let i=0;i<2;i++) try { const result=await model.generateContent(makePrompt(prompt,context)); return parseJson(result.response.text()) } catch(e) { error=e } throw error }
async function chat(text, ctx) { const model=new GoogleGenerativeAI(apiKey()).getGenerativeModel({model:'gemini-2.0-flash'}); const result=await model.generateContent(`You are Northframe Studio's creative copilot. Be concise and practical. Context: ${JSON.stringify(ctx||{})}. User: ${text}`); return result.response.text() }
ipcMain.handle('settings:get', () => { const s=readSettings(); return { hasKey:Boolean(apiKey()), ...s, geminiApiKey:undefined } })
ipcMain.handle('settings:hasKey', () => Boolean(apiKey()))
ipcMain.handle('settings:set', (_e, patch) => { const s=readSettings(); if(typeof patch?.geminiApiKey==='string') s.geminiApiKey=patch.geminiApiKey; writeSettings(s); return {hasKey:Boolean(apiKey())} })
ipcMain.handle('gemini:ask', async (_e, p) => { if(!apiKey()) throw new Error('Gemini API key is not configured'); return {text:'Live Gemini response generated.', rundownPatch:await generateRundown(p.prompt,p.rundownContext)} })
ipcMain.handle('gemini:chat', async (_e, p) => { if(!apiKey()) throw new Error('Gemini API key is not configured'); return chat(p.text,p.ctx) })
ipcMain.handle('settings:autoLaunch', (_e, enabled) => { app.setLoginItemSettings({ openAtLogin:Boolean(enabled) }); const s=readSettings(); s.autoLaunch=Boolean(enabled); writeSettings(s); return {autoLaunch:Boolean(enabled)} })
ipcMain.handle('state:save', (_e, state) => { const f=path.join(app.getPath('userData'),'projects.json'); fs.writeFileSync(f,JSON.stringify(state)); return true })
ipcMain.handle('state:load', () => { try { return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'projects.json'),'utf8')) } catch { return null } })
ipcMain.handle('render:reveal', (_e, outputPath) => { if(outputPath) shell.showItemInFolder(outputPath); return true })
ipcMain.handle('dialog:pickArena', async () => { const r = await require('electron').dialog.showOpenDialog({ properties:['openFile'], filters:[{name:'Arena export', extensions:['zip','html']}] }); return r.canceled ? null : r.filePaths[0] })
ipcMain.handle('arena:import', async (_e, { filePath, projectId }) => { if(!filePath) throw new Error('No Arena file selected'); const id=Date.now().toString(36); const out=path.join(projectRoot(projectId),'arena',id); fs.mkdirSync(out,{recursive:true}); if(filePath.toLowerCase().endsWith('.zip')) new AdmZip(filePath).extractAllTo(out,true); else fs.copyFileSync(filePath,path.join(out,'index.html')); let indexPath; const walk=d=>{for(const x of fs.readdirSync(d,{withFileTypes:true})){const q=path.join(d,x.name);if(x.isDirectory()) {const hit=walk(q);if(hit)return hit} else if(x.name.toLowerCase()==='index.html') return q}}; indexPath=walk(out); if(!indexPath) throw new Error('Arena export does not contain index.html'); const html=fs.readFileSync(indexPath,'utf8'); if(!html.includes('__seek')) throw new Error('Arena index.html must define window.__seek(t)'); return {htmlFileName:path.basename(indexPath), localPath:indexPath, thumbnailDataUrl:null} })
ipcMain.handle('arena:previewPath', async (_e, localPath) => { const root=path.join(app.getPath('userData'),'projects'); if(!path.resolve(localPath).startsWith(path.resolve(root))) throw new Error('Preview path is outside project data'); return `file://${localPath.replace(/\\/g,'/')}` })
ipcMain.handle('footage:analyze', async (_e, {srcPath, projectId}) => { if(!srcPath) throw new Error('No footage selected'); const dir=path.join(projectRoot(projectId),'footage'); fs.mkdirSync(dir,{recursive:true}); const dest=path.join(dir,`${Date.now()}-${path.basename(srcPath)}`); fs.copyFileSync(srcPath,dest); if(!ffprobePath || !ffmpegPath) throw new Error('FFmpeg binaries are unavailable in this build'); const probe=await run(ffprobePath,['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',dest]); const durationSec=Number.parseFloat(probe.stdout)||0; const sil=await run(ffmpegPath,['-i',dest,'-af','silencedetect=noise=-35dB:d=0.8','-f','null','-']); const starts=[...sil.stderr.matchAll(/silence_start: ([0-9.]+)/g)].map(m=>Number(m[1])); const ends=[...sil.stderr.matchAll(/silence_end: ([0-9.]+)/g)].map(m=>Number(m[1])); return {videoPath:dest,durationSec,silenceRanges:starts.map((v,i)=>[v,ends[i]||durationSec]),waveform:[] } })

function createWindow() { const win=new BrowserWindow({width:1440,height:900,minWidth:1120,minHeight:720,backgroundColor:'#0B0B10',title:'Northframe Studio',autoHideMenuBar:true,show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,spellcheck:false}}); Menu.setApplicationMenu(null); win.once('ready-to-show',()=>win.show()); win.webContents.setWindowOpenHandler(({url})=>{if(/^https?:\/\//i.test(url))shell.openExternal(url);return {action:'deny'}}); if(DEV_URL)win.loadURL(DEV_URL);else win.loadFile(path.join(__dirname,'..','dist','index.html')); return win }
app.setAppUserModelId('app.northframe.studio'); app.whenReady().then(()=>{ if(autoUpdater && !DEV_URL) autoUpdater.checkForUpdatesAndNotify().catch(()=>{}); createWindow();app.on('activate',()=>{if(!BrowserWindow.getAllWindows().length)createWindow()})}); app.on('window-all-closed',()=>app.quit())

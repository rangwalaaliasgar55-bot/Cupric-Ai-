const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron')
const fs = require('fs')
const path = require('path')
const { GoogleGenerativeAI } = require('@google/generative-ai')
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
ipcMain.handle('render:reveal', (_e, outputPath) => { if(outputPath) shell.showItemInFolder(outputPath); return true })
function createWindow() { const win=new BrowserWindow({width:1440,height:900,minWidth:1120,minHeight:720,backgroundColor:'#0B0B10',title:'Northframe Studio',autoHideMenuBar:true,show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,spellcheck:false}}); Menu.setApplicationMenu(null); win.once('ready-to-show',()=>win.show()); win.webContents.setWindowOpenHandler(({url})=>{if(/^https?:\/\//i.test(url))shell.openExternal(url);return {action:'deny'}}); if(DEV_URL)win.loadURL(DEV_URL);else win.loadFile(path.join(__dirname,'..','dist','index.html')); return win }
app.setAppUserModelId('app.northframe.studio'); app.whenReady().then(()=>{createWindow();app.on('activate',()=>{if(!BrowserWindow.getAllWindows().length)createWindow()})}); app.on('window-all-closed',()=>app.quit())

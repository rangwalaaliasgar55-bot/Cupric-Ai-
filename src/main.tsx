import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import { installDiagnostics } from './lib/diagnostics'
import { primeVoiceEngines } from './lib/voice'
import './lib/studio/proxy' // registers the auto-proxy hook (2.7)

installDiagnostics()
// Offline speech engines (1.10): known before the first mic press.
void primeVoiceEngines()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

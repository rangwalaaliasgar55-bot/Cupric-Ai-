/// <reference lib="webworker" />
// Validates agent code off the main thread so nothing it does can freeze the app;
// the caller terminates this worker on timeout.
import { validateAgentCode } from './agentCode'

self.onmessage = (event: MessageEvent<{ code: string; props: Record<string, unknown> }>) => {
  const result = validateAgentCode(event.data.code, event.data.props)
  self.postMessage(result.ok ? { ok: true } : { ok: false, rejections: result.rejections })
}

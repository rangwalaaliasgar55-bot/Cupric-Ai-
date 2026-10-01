/**
 * Type-level fixture for `npm run check:bridge` (not shipped, not imported).
 *
 * Every line marked @ts-expect-error MUST be a type error: if someone makes
 * window.newbrand / window.northframe writable again in the types, the directive
 * becomes unused and tsc fails. The unmarked lines must keep compiling.
 */
import { getBridge, getIpc, type NewBrandBridge } from '../../src/lib/bridge'
import type { StudioApi } from '../../src/lib/studio/studioApi'

export function readOnlyBridgeFixture(bridge: NewBrandBridge, api: StudioApi) {
  // ——— must NOT compile ———
  // @ts-expect-error window.newbrand is read-only (contextBridge)
  window.newbrand = bridge
  // @ts-expect-error window.northframe is read-only (contextBridge)
  window.northframe = bridge
  // @ts-expect-error the bridge object has no `studio` slot to write into
  window.newbrand!.studio = api
  // @ts-expect-error bridge members are read-only
  window.newbrand!.isDesktop = false
  // @ts-expect-error nested bridge members are read-only
  window.newbrand!.ipc.invoke = async () => undefined
  // @ts-expect-error `delete` needs an optional, writable property
  delete window.newbrand

  // ——— must compile ———
  const b = getBridge()
  const ipc = getIpc()
  void b?.platform
  void ipc?.invoke('settings:get')
  window.__newbrandStudio = api
  delete window.__newbrandStudio
}

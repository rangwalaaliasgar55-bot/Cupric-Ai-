import { createElement, useMemo, type ReactNode } from 'react'
import { validateAgentCode, renderAgentTree, type AgentNode } from '../../lib/studio/agentCode'

/** Allowlisted tree → React elements. Attributes were already filtered by renderAgentTree. */
function toReact(node: AgentNode | string, key: number): ReactNode {
  if (typeof node === 'string') return node
  const style: Record<string, string | number> = {}
  const attrs: Record<string, string | number | object> = { key }
  for (const [k, v] of Object.entries(node.attrs)) {
    if (k.startsWith('style.')) style[k.slice(6)] = v
    else attrs[k] = v
  }
  if (Object.keys(style).length) attrs.style = style
  return createElement(node.tag, attrs, ...node.children.map((c, i) => toReact(c, i)))
}

/**
 * Renders an agent-generated animation at clip progress t (0..1). Code is
 * re-validated here (never trusted from storage); a rejection renders an
 * honest inline reason instead of anything the code produced.
 */
export function GeneratedFrame({ code, props, t, seed = 7, reducedMotion = false }: { code: string; props?: Record<string, unknown>; t: number; seed?: number; reducedMotion?: boolean }) {
  const compiled = useMemo(() => validateAgentCode(code, props ?? {}, seed), [code, props, seed])
  if (!compiled.ok) {
    return <div className="rounded border border-line bg-panel p-3 text-xs text-muted" data-generated-error>{compiled.rejections[0]?.quote}</div>
  }
  let tree: AgentNode
  try {
    tree = renderAgentTree(compiled.fn, { t, seed, reducedMotion, props: props ?? {} })
  } catch (e) {
    return <div className="rounded border border-line bg-panel p-3 text-xs text-muted" data-generated-error>{(e as Error).message}</div>
  }
  return <div data-generated-frame>{toReact(tree, 0)}</div>
}

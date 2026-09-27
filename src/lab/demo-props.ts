import { createContext, useContext } from 'react'

/** Per-clip props for a lab demo (framecn text, colours…); null = the demo's defaults. */
export type DemoProps = Record<string, string | number | boolean>
export const DemoPropsContext = createContext<DemoProps | null>(null)
export const useDemoProps = () => useContext(DemoPropsContext)

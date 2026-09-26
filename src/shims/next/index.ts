import React from 'react'

export type Metadata = Record<string, any>

export default function Head({ children }: { children?: React.ReactNode }) {
  return React.createElement(React.Fragment, null, children)
}

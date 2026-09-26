import React from 'react'

const DialogRoot = ({ children }: any) => <div className="radix-dialog">{children}</div>
const DialogTrigger = ({ children, onClick }: any) => (
  <button type="button" onClick={onClick}>{children}</button>
)
const DialogContent = ({ children }: any) => <div className="radix-dialog-content">{children}</div>
const DialogTitle = ({ children }: any) => <h2>{children}</h2>
const DialogDescription = ({ children }: any) => <p>{children}</p>
const DialogClose = ({ children, onClick }: any) => <button type="button" onClick={onClick}>{children}</button>
const DialogPortal = ({ children }: any) => <>{children}</>
const DialogOverlay = ({ children }: any) => <div className="radix-overlay">{children}</div>

export const Dialog: any = ({ children }: any) => <DialogRoot>{children}</DialogRoot>
Dialog.Root = DialogRoot
Dialog.Trigger = DialogTrigger
Dialog.Content = DialogContent
Dialog.Title = DialogTitle
Dialog.Description = DialogDescription
Dialog.Close = DialogClose
Dialog.Portal = DialogPortal
Dialog.Overlay = DialogOverlay

const TabsRoot = ({ children }: any) => <div className="radix-tabs">{children}</div>
const TabsList = ({ children }: any) => <div className="radix-tabs-list">{children}</div>
const TabsTrigger = ({ children }: any) => <button type="button">{children}</button>
const TabsContent = ({ children }: any) => <div className="radix-tabs-content">{children}</div>

export const Tabs: any = ({ children }: any) => <TabsRoot>{children}</TabsRoot>
Tabs.Root = TabsRoot
Tabs.List = TabsList
Tabs.Trigger = TabsTrigger
Tabs.Content = TabsContent

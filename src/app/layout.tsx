import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "NewBrand — motion, 3D & video design engine",
  description: "A deterministic motion graphics, 3D, typography, effects and video composition engine with a schema-driven editor and AI-ready registry.",
};

const NAV = [
  ["Components", "/components"], ["Motion", "/motion"], ["Typography", "/typography"], ["Backgrounds", "/backgrounds"], ["3D", "/3d"],
  ["Effects", "/effects"], ["Transitions", "/transitions"], ["Video", "/video"], ["Templates", "/templates"], ["Themes", "/themes"], ["Docs", "/docs"],
] as const;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#07080c] text-zinc-200 antialiased">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-black">Skip to content</a>
        <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[#07080c]/80 backdrop-blur-xl">
          <nav aria-label="Primary" className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-6">
            <Link href="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight text-white">
              <span aria-hidden className="h-5 w-5 rounded-md bg-[conic-gradient(from_210deg,#7c8cff,#38bdf8,#c084fc,#7c8cff)]" />MotionOS
            </Link>
            <ul className="hidden flex-1 items-center gap-1 overflow-x-auto text-[13px] lg:flex">
              {NAV.map(([l, h]) => <li key={h}><Link href={h} className="rounded-md px-2.5 py-1.5 text-zinc-400 transition hover:bg-white/5 hover:text-white">{l}</Link></li>)}
            </ul>
            <Link href="/editor" className="ml-auto rounded-lg bg-white px-3 py-1.5 text-[13px] font-medium text-black transition hover:bg-zinc-200 lg:ml-0">Open editor</Link>
          </nav>
        </header>
        <main id="main">{children}</main>
      </body>
    </html>
  );
}

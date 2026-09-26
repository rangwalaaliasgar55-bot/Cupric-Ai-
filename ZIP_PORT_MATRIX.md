# ZIP port matrix

The source archives were reviewed file-by-file. Cupric AI supports TypeScript/TSX, JavaScript, CommonJS, Electron IPC, and JSON. Python/Next.js/Drizzle files cannot be copied directly without changing the runtime.

| Archive | Source file | Action |
|---|---|---|
| autonomous-capcut-ai-editor | `drizzle.config.json` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `eslint.config.mjs` | Reviewed: documentation/config/reference only |
| autonomous-capcut-ai-editor | `next.config.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `package.json` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `postcss.config.mjs` | Reviewed: documentation/config/reference only |
| autonomous-capcut-ai-editor | `tsconfig.json` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `backend/backups.py` | Port candidate: Python logic must be rewritten as Electron/TypeScript |
| autonomous-capcut-ai-editor | `backend/capcut_builder.py` | Port candidate: Python logic must be rewritten as Electron/TypeScript |
| autonomous-capcut-ai-editor | `backend/cli.py` | Port candidate: Python logic must be rewritten as Electron/TypeScript |
| autonomous-capcut-ai-editor | `backend/diagnostics.py` | Port candidate: Python logic must be rewritten as Electron/TypeScript |
| autonomous-capcut-ai-editor | `backend/media_analysis.py` | Port candidate: Python logic must be rewritten as Electron/TypeScript |
| autonomous-capcut-ai-editor | `backend/protocol.py` | Port candidate: Python logic must be rewritten as Electron/TypeScript |
| autonomous-capcut-ai-editor | `backend/requirements.txt` | Reviewed: documentation/config/reference only |
| autonomous-capcut-ai-editor | `backend/transcription.py` | Port candidate: Python logic must be rewritten as Electron/TypeScript |
| autonomous-capcut-ai-editor | `backend/validation.py` | Port candidate: Python logic must be rewritten as Electron/TypeScript |
| autonomous-capcut-ai-editor | `backend/__pycache__/backups.cpython-311.pyc` | Rejected: generated Python bytecode |
| autonomous-capcut-ai-editor | `backend/__pycache__/capcut_builder.cpython-311.pyc` | Rejected: generated Python bytecode |
| autonomous-capcut-ai-editor | `backend/__pycache__/diagnostics.cpython-311.pyc` | Rejected: generated Python bytecode |
| autonomous-capcut-ai-editor | `backend/__pycache__/media_analysis.cpython-311.pyc` | Rejected: generated Python bytecode |
| autonomous-capcut-ai-editor | `backend/__pycache__/protocol.cpython-311.pyc` | Rejected: generated Python bytecode |
| autonomous-capcut-ai-editor | `backend/__pycache__/transcription.cpython-311.pyc` | Rejected: generated Python bytecode |
| autonomous-capcut-ai-editor | `backend/__pycache__/validation.cpython-311.pyc` | Rejected: generated Python bytecode |
| autonomous-capcut-ai-editor | `src/app/globals.css` | Reviewed: documentation/config/reference only |
| autonomous-capcut-ai-editor | `src/app/layout.tsx` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `src/app/page.tsx` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `src/app/api/diagnostics/route.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `src/app/api/files/route.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `src/app/api/health/route.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `src/app/api/jobs/route.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `src/app/api/jobs/[id]/route.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `src/app/api/media/[id]/route.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `src/app/api/projects/route.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `src/app/api/projects/[id]/route.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `src/app/api/projects/[id]/upload/route.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `src/app/api/settings/route.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `src/app/api/system/route.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `src/app/diagnostics/page.tsx` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `src/app/projects/[id]/layout.tsx` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `src/app/projects/[id]/page.tsx` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `src/app/projects/[id]/director/page.tsx` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `src/app/projects/[id]/generate/page.tsx` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `src/app/projects/[id]/history/page.tsx` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `src/app/projects/[id]/media/page.tsx` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `src/app/projects/[id]/plan/page.tsx` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `src/app/projects/new/page.tsx` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `src/app/settings/page.tsx` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `src/app/welcome/page.tsx` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `src/components/JobTray.tsx` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `src/components/Sidebar.tsx` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `src/components/hooks.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `src/components/ui.tsx` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `src/db/index.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `src/db/schema.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `src/lib/api.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `src/lib/engine.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `src/lib/jobs.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `src/lib/media.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `src/lib/pipeline.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `src/lib/secrets.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `src/lib/settings.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `src/lib/ai/director.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `src/lib/ai/presets.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `src/lib/edl/compile.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `src/lib/edl/validate.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `src/features/generation/useJob.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `src/features/media/MediaImporter.tsx` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `src/features/project/ProjectContext.tsx` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `src/features/settings/Diagnostics.tsx` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `src/features/timeline/Timeline.tsx` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `src/shared/types.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `src/shared/schemas/edl.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `tests/edl.test.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| autonomous-capcut-ai-editor | `tests/engine/test_engine.py` | Port candidate: Python logic must be rewritten as Electron/TypeScript |
| autonomous-capcut-ai-editor | `tests/engine/__pycache__/test_engine.cpython-311.pyc` | Rejected: generated Python bytecode |
| capcut-editing-agent-specification | `drizzle.config.json` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| capcut-editing-agent-specification | `eslint.config.mjs` | Reviewed: documentation/config/reference only |
| capcut-editing-agent-specification | `next.config.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| capcut-editing-agent-specification | `package.json` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| capcut-editing-agent-specification | `postcss.config.mjs` | Reviewed: documentation/config/reference only |
| capcut-editing-agent-specification | `tsconfig.json` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| capcut-editing-agent-specification | `public/companion/build_capcut_draft.py` | Port candidate: Python logic must be rewritten as Electron/TypeScript |
| capcut-editing-agent-specification | `public/companion/transcribe.py` | Port candidate: Python logic must be rewritten as Electron/TypeScript |
| capcut-editing-agent-specification | `public/companion/__pycache__/build_capcut_draft.cpython-311.pyc` | Rejected: generated Python bytecode |
| capcut-editing-agent-specification | `public/companion/__pycache__/transcribe.cpython-311.pyc` | Rejected: generated Python bytecode |
| capcut-editing-agent-specification | `src/app/globals.css` | Reviewed: documentation/config/reference only |
| capcut-editing-agent-specification | `src/app/layout.tsx` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| capcut-editing-agent-specification | `src/app/page.tsx` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| capcut-editing-agent-specification | `src/app/studio.tsx` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| capcut-editing-agent-specification | `src/app/api/health/route.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| capcut-editing-agent-specification | `src/app/api/media/route.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| capcut-editing-agent-specification | `src/app/api/projects/route.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| capcut-editing-agent-specification | `src/app/api/projects/[id]/route.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| capcut-editing-agent-specification | `src/app/api/projects/[id]/export/route.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| capcut-editing-agent-specification | `src/app/api/projects/[id]/generate/route.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| capcut-editing-agent-specification | `src/db/index.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| capcut-editing-agent-specification | `src/db/schema.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| capcut-editing-agent-specification | `src/lib/demo-project.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| capcut-editing-agent-specification | `src/lib/director-prompt.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| capcut-editing-agent-specification | `src/lib/edl.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| u1 | `index.html` | Reviewed: documentation/config/reference only |
| u1 | `package-lock.json` | Rejected: dependency/build artifact |
| u1 | `package.json` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| u1 | `tsconfig.json` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| u1 | `vite.config.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| u1 | `public/background.js` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| u1 | `public/content.js` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| u1 | `public/extension.css` | Reviewed: documentation/config/reference only |
| u1 | `public/extension.html` | Reviewed: documentation/config/reference only |
| u1 | `public/extension.js` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| u1 | `public/manifest.json` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| u1 | `src/App.tsx` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| u1 | `src/index.css` | Reviewed: documentation/config/reference only |
| u1 | `src/main.tsx` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| u1 | `src/utils/cn.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| u2 | `index.html` | Reviewed: documentation/config/reference only |
| u2 | `package-lock.json` | Rejected: dependency/build artifact |
| u2 | `package.json` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| u2 | `tsconfig.json` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| u2 | `vite.config.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| u2 | `src/App.tsx` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| u2 | `src/index.css` | Reviewed: documentation/config/reference only |
| u2 | `src/main.tsx` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| u2 | `src/components/Analytics.tsx` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| u2 | `src/components/ExtensionPanel.tsx` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| u2 | `src/components/Hero.tsx` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| u2 | `src/components/Orchestrator.tsx` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| u2 | `src/components/Translator.tsx` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| u2 | `src/components/ui.tsx` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| u2 | `src/extension/files.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| u2 | `src/lib/engine.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| u2 | `src/lib/store.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| u2 | `src/lib/zip.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |
| u2 | `src/utils/cn.ts` | Reviewed: compatible concepts ported selectively; source architecture not copied |

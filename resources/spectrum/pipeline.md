# Spectrum UI — pull without dual-kit

Site: https://ui.spectrumhq.in  
Repo: https://github.com/arihantcodes/spectrum-ui

## Rule

Cupric chrome stays local (`src/components/*` + DESIGN tokens).  
Spectrum blocks are **copy-own** into a feature folder only when a screen needs a dense block (empty states, AI assistant steps).

```bash
# Example — one block at a time
npx shadcn@latest add @spectrumui/chat-empty-state
# then restyle colors/radii to Cupric tokens; delete unused variants
```

## Prefer for Cupric

- AI Assistants: agent-plan, agent-steps, approval-card, chat-empty-state
- Empty states blocks
- Forms / settings density patterns

## Avoid

- Second Button / Input kit
- Purple SaaS default palette
- Shipping the whole Next docs app inside Electron

Index of item names: `resources/spectrum/index.json`.

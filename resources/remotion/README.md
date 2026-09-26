# Remotion capability index

Cupric uses [`@remotion/player`](https://www.remotion.dev/docs/player) for the in-app rundown preview. This directory adds a license-safe capability index from the upstream Remotion repository:

- all upstream `template-*` starters currently present in the repository;
- the Google Fonts catalog names exposed by `@remotion/google-fonts`;
- the upstream `.agents/skills` names and descriptions.

The index is metadata, not a copy of the Remotion monorepo. Templates and skills link back to their upstream source, while Cupric keeps its own deterministic Studio renderer and local-font fallback. Individual font licenses must be reviewed before packaging a font in a commercial export.

`src/lib/remotionResources.ts` turns a brief into a deterministic template/font/skill plan. The autonomous screen shows that plan before starting a desktop job, and `npm run packs:build` exposes it in the offline Library as the `remotion` pack.

To refresh the catalog against a newer Remotion checkout, regenerate `catalog.json` with the same metadata extraction process and run:

```bash
npm run packs:build
```

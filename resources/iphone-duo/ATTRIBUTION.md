# iPhone Duo attribution and usage boundary

This directory preserves a source snapshot from [chuspeeism/iphone-duo](https://github.com/chuspeeism/iphone-duo), commit `2662ebbeb6aa844cd4f6888f7d6f8958662249fd`, because the user explicitly requested that Cupric inspect and adapt its foldable-device animation pattern.

The original application code is MIT-licensed; see `reference/LICENSE`. The source repository's `THIRD_PARTY_NOTICES.md` records the licenses for its Three.js and Octicons dependencies. The Apple iPhone Duo model, textures, wallpapers, screenshots, product name, and trademarks are not covered by that MIT grant and are not bundled in this directory. `reference/prepare-assets.py` is preserved only as documentation and must not be run for the Cupric resource pack.

Cupric does not execute the upstream Three.js page or redistribute its Apple assets. Studio uses an original, deterministic Canvas projection: a fixed rear-camera panel, an editable hinged cover panel, front-projected screen modes, bounded fold darkening/glare, and user-replaceable browser, SaaS, product, social, or custom media. The same renderer drives preview and export, and the native resource action is `phoneDesign` with design id `iphone-duo`.

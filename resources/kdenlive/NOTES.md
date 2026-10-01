# Kdenlive → NewBrand mapping

Upstream: KDE Kdenlive (GPL). xevrion GSoC widgets (Curves, multi-stop gradient, time-remap keyframes) ship in native Qt — **not** embedded here.

## Portable ideas for NewBrand

| Kdenlive idea | NewBrand implementation |
|---|---|
| Per-channel curves | Future footage color panel → FFmpeg `curves` / `eq` |
| Multi-stop gradient editor | Arena HTML gradients + `resources/backgrounds/stage.css` |
| Time remap keyframes | Timeline clip speed (future) + `__seek(t)` time warp in Arena |
| Effect stack | `src/lib/effects.ts` + Library Effects |

Native C++ effect widgets stay upstream. NewBrand stays FFmpeg + deterministic HTML motion.

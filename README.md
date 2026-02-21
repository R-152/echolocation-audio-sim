# Sonic World (Next.js + TypeScript)

Spatial audio prototype for earbud-based "echolocation-like" awareness in an interactive digital world.

## Features

- Real-time 3D spatial audio (`PannerNode` HRTF)
- Walk mode with collisions (`W/A/S/D` move, `Q/E` rotate)
- Collision zones + hard walls that block movement and affect audio occlusion
- Moving emitters with bounce physics
- Editable collision obstacles (move + resize + delete)
- Per-emitter controls (frequency, gain, elevation, waveform, moving toggle)

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

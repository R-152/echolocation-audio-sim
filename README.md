# Sonic World

Spatial-audio web app for earbud-based "echolocation-like" world awareness.
Built with Next.js + TypeScript.

## Production-Ready Baseline Included

- Pinned dependency versions
- Node engine pin (`>=20.9.0`) + `.nvmrc`
- ESLint + TypeScript checks
- CI workflow (lint + typecheck + build)
- Health endpoint (`GET /api/health`)
- Standalone production output and Dockerfile
- Safer Next.js defaults (`poweredByHeader: false`, compression enabled)

## Core Features

- Real-time 3D spatial audio (`PannerNode`, HRTF)
- Walk mode (`W/A/S/D` move, `Q/E` rotate)
- Collision zones + walls with occlusion effects
- Moving emitters with bounce physics
- Obstacle editing: add, drag, resize, delete
- Emitter controls: frequency, gain, elevation, waveform

## Requirements

- Node.js `20.9.0+` (recommended: `20.20.0`)
- npm `10+`

## Local Development

```bash
nvm use
npm ci
npm run dev
```

Open `http://localhost:3000`.

## Quality Gates

```bash
npm run lint
npm run typecheck
npm run build
```

Or run all:

```bash
npm run check
```

## Production Run (Node)

```bash
npm ci
npm run build
npm run start
```

App listens on port `3000` by default.

## Docker

Build image:

```bash
docker build -t echolocation-audio-sim:latest .
```

Run container:

```bash
docker run --rm -p 3000:3000 echolocation-audio-sim:latest
```

## Health Check

```bash
curl http://localhost:3000/api/health
```

Expected JSON includes:
- `status: "ok"`
- `service: "echolocation-audio-sim"`
- `timestamp`

## Controls

- Move: `W` `A` `S` `D`
- Rotate: `Q` `E`
- Map actions: drag emitters/obstacles, double-click map to add emitter

## Notes

- Use stereo earbuds/headphones for proper 3D cues.
- Keep volume low when testing.

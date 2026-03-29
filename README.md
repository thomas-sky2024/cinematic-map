# Cinematic Map

> Tauri + Rust + Swift — M1-optimized cinematic map video renderer

## Week 1 goal: Get the app running

### Prerequisites

```bash
# 1. Xcode Command Line Tools (if not installed)
xcode-select --install

# 2. Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env
rustup target add aarch64-apple-darwin

# 3. Tauri CLI v2
cargo install tauri-cli --version "^2"

# 4. pnpm
npm install -g pnpm

# 5. Node.js 20+ (use nvm if needed)
nvm install 20 && nvm use 20
```

### Run in development

```bash
# From repo root
cd cinematic-map

# Install JS dependencies
pnpm install

# Run Tauri dev (starts Vite + Rust backend simultaneously)
pnpm dev
```

Tauri will:
1. Compile the Rust backend (`src-tauri/`)
2. Start Vite dev server on `localhost:5173`
3. Open the app window with hot reload

### Build Swift encoder (optional in week 1)

The Swift encoder is a stub in week 1 — it just tests the IPC pipe.
Real WKWebView capture comes in week 3.

```bash
cd packages/swift-encoder
swift build -c release
# Binary output: .build/release/map-capture
```

### Project structure

```
cinematic-map/
├── apps/desktop/
│   ├── src/                  ← React + TypeScript frontend
│   │   ├── components/
│   │   │   ├── App.tsx       ← Root layout
│   │   │   ├── TopBar.tsx    ← Header + token + export
│   │   │   ├── MapView.tsx   ← MapLibre GL JS canvas
│   │   │   ├── KeyframePanel.tsx  ← Left sidebar
│   │   │   ├── CameraPanel.tsx    ← Right sidebar
│   │   │   └── Timeline.tsx  ← Bottom scrubber
│   │   ├── store/
│   │   │   └── useMapStore.ts ← Zustand global state
│   │   ├── hooks/
│   │   │   └── useTauri.ts   ← invoke() wrappers
│   │   └── types/
│   │       └── index.ts      ← Shared TypeScript types
│   └── src-tauri/
│       └── src/
│           └── lib.rs        ← Tauri commands (call Rust engine)
├── packages/
│   ├── map-engine/           ← Rust interpolation library
│   │   └── src/lib.rs        ← compute_frames(), interpolate_single()
│   └── swift-encoder/        ← Swift CLI (VideoToolbox, week 3)
│       └── Sources/main.swift
└── Cargo.toml               ← Workspace
```

### Week 1 features working

- [x] MapLibre GL map renders in Tauri window
- [x] Navigate map, capture keyframes with thumbnail
- [x] Timeline scrubber with diamond keyframes
- [x] Play/pause with Rust-computed interpolation
- [x] Keyboard shortcuts (Space, ←→, Home/End)
- [x] Persist keyframes across app restarts (localStorage)
- [x] Export config JSON

### Week 2 plan

- [ ] Tauri ↔ Swift IPC pipe tested end-to-end
- [ ] Drag-to-reorder keyframes on timeline
- [ ] Import JSON config
- [ ] 3D terrain toggle (MapTiler terrain tiles)
- [ ] Sky layer + atmosphere effect

### Week 3 plan

- [ ] Swift WKWebView frame capture
- [ ] VideoToolbox HEVC hardware encode
- [ ] Metal vignette + color grade shader
- [ ] Progress bar in UI during render

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `←` / `→` | Scrub 0.1s |
| `⇧ ←` / `⇧ →` | Scrub 1s |
| `Home` | Go to start |
| `End` | Go to end |

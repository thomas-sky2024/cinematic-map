# Cinematic Map

> Tauri + Rust + Remotion — optimized cinematic map video renderer

## Week 1 goal: Get the app running ✅

### Prerequisites

```bash
# 1. Rust

# 1. Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env

# 2. Tauri CLI v2
cargo install tauri-cli --version "^2"

# 3. pnpm
npm install -g pnpm

# 4. Node.js 20+
nvm install 20 && nvm use 20
```

### Run in development

```bash
cd cinematic-map

# Install JS dependencies
pnpm install

# Run Tauri dev (starts Vite + Rust backend simultaneously)
pnpm dev
```

---

---

## Week 1 features ✅

- MapLibre GL map renders in Tauri window
- Navigate map, capture keyframes with thumbnail
- Timeline scrubber with diamond keyframes
- Play/pause with Rust-computed interpolation
- Keyboard shortcuts (Space, ←→, Home/End)
- Persist keyframes across app restarts (localStorage)
- Export/Import config JSON

---

## Week 2 features ✅

| Feature | Status | Notes |
|---------|--------|-------|
| Tauri ↔ Remotion IPC | ✅ | `cmd_start_render` launches Remotion CLI, streams progress JSON from stderr, emits Tauri events |
| Drag-to-reorder keyframe times | ✅ | Drag diamonds on timeline to change time; drag-handle in sidebar reorders order |
| Import JSON config | ✅ | Also restores annotations from saved config |
| 3D terrain toggle | ✅ | MapTiler DEM tiles + 1.5× exaggeration |
| Sky layer + atmosphere effect | ✅ | Cinematic blue sky with sun halo |

---

## Week 3 features ✅

| Feature | Status | Notes |
|---------|--------|-------|
| Remotion Renderer | ✅ | `remotion-bundle` + `remotion-render` with Puppeteer. Hardware accelerated HEVC/ProRes output. |
| Progress bar in UI | ✅ | Real-time events from Rust/Remotion → React progress bar in RenderPanel modal |

---

## Annotations ✅ (new feature)

Add interactive overlays at any map coordinate.

### Supported types

| Type | Description |
|------|-------------|
| **Text** | Floating label with custom font size and color |
| **Callout** | Speech bubble with title + body text |
| **Image** | Upload a photo or illustration (PNG/JPEG) |
| **3D Object** | Upload a `.glb`/`.gltf` model (pinned to coordinate) |

### How to place

1. Open the **Annotations** panel (right sidebar)
2. Click one of the four type buttons
3. Click anywhere on the map — the annotation appears immediately
4. Press **Esc** to cancel placement mode

### Features

- **Visibility window**: Show/hide annotation only between `showFrom` → `showUntil` seconds
- **Color picker**: 8 presets + custom hex color
- **Timeline ticks**: Annotations with a start time appear as amber ticks on the timeline
- **Edit in place**: Click an annotation marker on the map to select and edit it
- **Image upload**: Drop any PNG/JPEG; stored as base64 in the config
- **3D model upload**: Upload `.glb` file; scale and Y-rotation editable
- **Exported in JSON**: Annotations are included in Export/Import config

---

## Project structure

```
cinematic-map/
├── apps/desktop/
│   ├── src/
│   │   ├── components/
│   │   │   ├── App.tsx              ← Root layout (adds AnnotationPanel + RenderPanel)
│   │   │   ├── TopBar.tsx           ← Header + Render button
│   │   │   ├── MapView.tsx          ← MapLibre canvas + annotation placement handler
│   │   │   ├── KeyframePanel.tsx    ← Left sidebar
│   │   │   ├── CameraPanel.tsx      ← Right sidebar (camera stats + sliders)
│   │   │   ├── AnnotationPanel.tsx  ← Right sidebar (NEW: text/callout/image/3D)
│   │   │   ├── AnnotationLayer.tsx  ← NEW: MapLibre HTML markers for annotations
│   │   │   ├── RenderPanel.tsx      ← NEW: render modal with progress bar
│   │   │   └── Timeline.tsx         ← Bottom scrubber (drag diamond, ann ticks)
│   │   ├── store/
│   │   │   └── useMapStore.ts       ← Zustand (annotations + renderStatus added)
│   │   ├── hooks/
│   │   │   └── useTauri.ts          ← invoke() wrappers (startRender added)
│   │   └── types/
│   │       └── index.ts             ← Annotation + RenderStatus types
│   └── src-tauri/
│       └── src/
│           └── lib.rs               ← cmd_start_render: Rust→Remotion IPC
├── packages/
│   ├── map-engine/                  ← Rust interpolation
│   └── renderer-remotion/           ← NEW: Remotion rendering pipeline
└── Cargo.toml
```

---

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `←` / `→` | Scrub 0.1s |
| `⇧ ←` / `⇧ →` | Scrub 1s |
| `Home` | Go to start |
| `End` | Go to end |
| `Ctrl+↑` / `Ctrl+↓` | Pitch +5° / -5° |
| `Ctrl+←` / `Ctrl+→` | Bearing ±10° |
| `Esc` | Cancel annotation placement |

---

---

## Custom map styles (MapLibre & Mapbox)

### Option A — Any MapLibre-compatible style URL

Open `apps/desktop/src/types/index.ts` and add your style to `MAP_STYLES`:

```ts
{
  id: "my-style",
  label: "My Style",
  url: "https://your-host.com/style.json",   // any GL style URL
  preview: "#334155",
}
```

No other change needed. The style picker in the sidebar will show it automatically.

### Option B — MapTiler hosted styles (already supported)

Set your API key via the **API Key** button. Satellite and Terrain styles are already wired up.

Explore other MapTiler styles at `https://api.maptiler.com/maps/<STYLE_ID>/style.json?key=KEY`:
- `streets-v2`, `topo-v2`, `winter-v2`, `backdrop`, `bright`, `dataviz`, etc.

### Option C — Mapbox style (GL-compatible)

MapLibre can render Mapbox styles (v8 spec) directly:

```ts
{
  id: "mapbox-streets",
  label: "Mapbox Streets",
  url: "mapbox://styles/mapbox/streets-v12",  // requires Mapbox GL JS, not MapLibre
  preview: "#e2d4b7",
}
```

> ⚠️ **Caveat**: Native `mapbox://` URLs only work with Mapbox GL JS, not MapLibre GL.  
> For MapLibre, use the REST form:  
> `https://api.mapbox.com/styles/v1/mapbox/streets-v12?access_token=pk.xxx`

To use Mapbox tiles with MapLibre, set the token as `mapToken` in the app (the API Key field already stores it) and construct the URL:

```ts
url: `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12?access_token=${mapToken}`
```

### Option D — Self-hosted / PMTiles / local tiles

Any URL that serves a GL-compatible `style.json` works, including:
- **PMTiles** via the `pmtiles://` protocol (add the `maplibre-pmtiles` plugin)
- **Martin tile server** (`https://localhost:3000/style`)
- **MapTiler Server** on-prem
- **Protomaps** hosted tiles

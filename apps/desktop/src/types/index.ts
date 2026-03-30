// Matches Rust structs in map-engine exactly

export type EasingType = "Linear" | "EaseInOut" | "CinematicArc";

export interface Keyframe {
  id: string;
  label: string;
  time: number;
  lat: number;
  lng: number;
  zoom: number;
  pitch: number;
  bearing: number;
  easing: EasingType;
  thumbnail?: string;
}

export interface FrameCamera {
  frame: number;
  time: number;
  lat: number;
  lng: number;
  zoom: number;
  pitch: number;
  bearing: number;
}

export interface RenderConfig {
  keyframes: Keyframe[];
  fps: 30 | 60;
  resolution: "1080p" | "4K";
  outputPath: string;
}

export interface RenderProgress {
  encoded: number;
  total: number;
  fps: number;
  stage: "capturing" | "encoding" | "postprocess" | "done" | "error";
  error?: string;
}

export interface MapStyle {
  id: string;
  label: string;
  url: string;
  preview: string;
}

// ── Annotations ────────────────────────────────────────────────────────────

export type AnnotationType = "text" | "callout" | "image" | "model3d";

export interface Annotation {
  id: string;
  type: AnnotationType;
  lat: number;
  lng: number;
  label: string;
  content?: string;
  color?: string;
  fontSize?: number;
  imageUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
  modelUrl?: string;
  modelScale?: number;
  modelRotationY?: number;
  modelAltitude?: number;
  showFrom?: number;
  showUntil?: number;
  visible?: boolean;
}

// ── Render status ──────────────────────────────────────────────────────────

export type RenderStage =
  | "idle"
  | "computing"
  | "capturing"
  | "encoding"
  | "postprocess"
  | "done"
  | "error";

export interface RenderStatus {
  stage: RenderStage;
  encoded: number;
  total: number;
  fps: number;
  error?: string;
  outputPath?: string;
}

// ── Map styles ─────────────────────────────────────────────────────────────

export const MAP_STYLES: MapStyle[] = [
  { id: "dark",     label: "Dark",     url: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json", preview: "#1a1a2e" },
  { id: "voyager",  label: "Voyager",  url: "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",    preview: "#e8e0d0" },
  { id: "satellite",label: "Satellite",url: "https://api.maptiler.com/maps/satellite/style.json?key=",         preview: "#2d4a22" },
  { id: "terrain",  label: "Terrain",  url: "https://api.maptiler.com/maps/outdoor-v2/style.json?key=",        preview: "#4a7c59" },
  { id: "positron", label: "Light",    url: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",   preview: "#f5f5f0" },
];

export function getStyleUrl(styleId: string, token: string): string {
  const tokenStyles = new Set(["satellite", "terrain"]);
  const s = MAP_STYLES.find((st) => st.id === styleId) ?? MAP_STYLES[0];
  if (tokenStyles.has(styleId)) {
    if (!token) {
      console.warn(`[cinematic-map] Style "${styleId}" requires a MapTiler API key.`);
      return MAP_STYLES[0].url;
    }
    return `${s.url}${token}`;
  }
  return s.url;
}

export function getTerrainUrl(token: string): string {
  return `https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=${token}`;
}

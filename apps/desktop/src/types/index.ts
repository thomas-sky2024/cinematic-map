// Matches Rust structs in map-engine exactly

export type EasingType = "Linear" | "EaseInOut" | "CinematicArc";

export interface Keyframe {
  id: string;
  label: string;
  time: number;       // seconds from start
  lat: number;
  lng: number;
  zoom: number;
  pitch: number;
  bearing: number;
  easing: EasingType;
  thumbnail?: string; // base64 JPEG, captured from map canvas
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
  stage: "capturing" | "encoding" | "done" | "error";
  error?: string;
}

export interface MapStyle {
  id: string;
  label: string;
  url: string;
  preview: string; // hex color for swatch
}

export const MAP_STYLES: MapStyle[] = [
  {
    id: "dark",
    label: "Dark",
    url: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
    preview: "#1a1a2e",
  },
  {
    id: "voyager",
    label: "Voyager",
    url: "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
    preview: "#e8e0d0",
  },
  {
    id: "satellite",
    label: "Satellite",
    // Requires MapTiler token — resolved dynamically via getStyleUrl()
    url: "https://api.maptiler.com/maps/satellite/style.json?key=",
    preview: "#2d4a22",
  },
  {
    id: "terrain",
    label: "Terrain",
    // Requires MapTiler token — resolved dynamically via getStyleUrl()
    url: "https://api.maptiler.com/maps/outdoor-v2/style.json?key=",
    preview: "#4a7c59",
  },
  {
    id: "positron",
    label: "Light",
    url: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
    preview: "#f5f5f0",
  },
];

/** Returns the resolved tile URL for a style, injecting the MapTiler token when needed. */
export function getStyleUrl(styleId: string, token: string): string {
  const tokenStyles = new Set(["satellite", "terrain"]);
  const s = MAP_STYLES.find((st) => st.id === styleId) ?? MAP_STYLES[0];

  if (tokenStyles.has(styleId)) {
    if (!token) {
      // Fallback to dark style when no token provided
      console.warn(`[cinematic-map] Style "${styleId}" requires a MapTiler API key. Add one via the API Key button.`);
      return MAP_STYLES[0].url;
    }
    return `${s.url}${token}`;
  }
  return s.url;
}

/** Returns the MapTiler terrain-rgb DEM tile URL. */
export function getTerrainUrl(token: string): string {
  return `https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=${token}`;
}

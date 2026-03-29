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
    url: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
    preview: "#2d4a22",
  },
  {
    id: "positron",
    label: "Light",
    url: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
    preview: "#f5f5f0",
  },
];

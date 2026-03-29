import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Keyframe, FrameCamera, EasingType, MAP_STYLES } from "../types";

import maplibregl from "maplibre-gl";

interface MapState {
  // Map
  mapToken: string;
  mapStyleId: string;
  mapRef: maplibregl.Map | null;

  // Keyframes
  keyframes: Keyframe[];
  selectedKeyframeId: string | null;
  totalDuration: number; // seconds

  // Playback
  currentTime: number;
  isPlaying: boolean;
  fps: 30 | 60;

  // Computed frames cache (from Rust)
  computedFrames: FrameCamera[];
  isComputing: boolean;

  // Actions — Map
  setMapRef: (map: maplibregl.Map | null) => void;
  setMapToken: (token: string) => void;
  setMapStyle: (styleId: string) => void;

  // Actions — Keyframes
  captureKeyframe: () => void;
  updateKeyframe: (id: string, patch: Partial<Keyframe>) => void;
  deleteKeyframe: (id: string) => void;
  reorderKeyframes: (fromIdx: number, toIdx: number) => void;
  selectKeyframe: (id: string | null) => void;
  setTotalDuration: (seconds: number) => void;

  // Actions — Playback
  setCurrentTime: (t: number) => void;
  setIsPlaying: (v: boolean) => void;
  setFps: (fps: 30 | 60) => void;

  // Actions — Rust integration
  setComputedFrames: (frames: FrameCamera[]) => void;
  setIsComputing: (v: boolean) => void;
}

// Simple ID generator
let _id = 0;
const uid = () => `kf_${Date.now()}_${++_id}`;

export const useMapStore = create<MapState>()(
  persist(
    (set, get) => ({
      // Initial state
      mapToken: "",
      mapStyleId: "dark",
      mapRef: null,
      keyframes: [],
      selectedKeyframeId: null,
      totalDuration: 10,
      currentTime: 0,
      isPlaying: false,
      fps: 30,
      computedFrames: [],
      isComputing: false,

      // Map actions
      setMapRef: (map) => set({ mapRef: map }),
      setMapToken: (token) => set({ mapToken: token }),
      setMapStyle: (styleId) => set({ mapStyleId: styleId }),

      // Keyframe actions
      captureKeyframe: () => {
        const { mapRef, keyframes, totalDuration } = get();
        if (!mapRef) return;

        const center = mapRef.getCenter();
        const kfCount = keyframes.length;

        // Capture thumbnail from map canvas
        let thumbnail: string | undefined;
        try {
          const canvas = mapRef.getCanvas();
          thumbnail = canvas.toDataURL("image/jpeg", 0.4);
        } catch { /* ignore */ }

        // Auto-assign time: spread evenly or append
        const time = kfCount === 0
          ? 0
          : kfCount === 1
            ? totalDuration
            : keyframes[kfCount - 1].time + (totalDuration / (kfCount));

        const newKf: Keyframe = {
          id: uid(),
          label: `Scene ${kfCount + 1}`,
          time: parseFloat(time.toFixed(1)),
          lat: center.lat,
          lng: center.lng,
          zoom: mapRef.getZoom(),
          pitch: mapRef.getPitch(),
          bearing: mapRef.getBearing(),
          easing: "EaseInOut",
          thumbnail,
        };

        set((s) => ({
          keyframes: [...s.keyframes, newKf],
          selectedKeyframeId: newKf.id,
        }));
      },

      updateKeyframe: (id, patch) =>
        set((s) => ({
          keyframes: s.keyframes.map((kf) =>
            kf.id === id ? { ...kf, ...patch } : kf
          ),
        })),

      deleteKeyframe: (id) =>
        set((s) => ({
          keyframes: s.keyframes.filter((kf) => kf.id !== id),
          selectedKeyframeId:
            s.selectedKeyframeId === id ? null : s.selectedKeyframeId,
        })),

      reorderKeyframes: (fromIdx, toIdx) =>
        set((s) => {
          const kfs = [...s.keyframes];
          const [moved] = kfs.splice(fromIdx, 1);
          kfs.splice(toIdx, 0, moved);
          // Re-sort by time after drag
          return { keyframes: kfs };
        }),

      selectKeyframe: (id) => set({ selectedKeyframeId: id }),
      setTotalDuration: (seconds) => set({ totalDuration: seconds }),

      // Playback
      setCurrentTime: (t) => set({ currentTime: t }),
      setIsPlaying: (v) => set({ isPlaying: v }),
      setFps: (fps) => set({ fps }),

      // Rust integration
      setComputedFrames: (frames) => set({ computedFrames: frames }),
      setIsComputing: (v) => set({ isComputing: v }),
    }),
    {
      name: "cinematic-map-state",
      // Don't persist mapRef or computed frames
      partialize: (s) => ({
        mapToken: s.mapToken,
        mapStyleId: s.mapStyleId,
        keyframes: s.keyframes,
        totalDuration: s.totalDuration,
        fps: s.fps,
      }),
    }
  )
);


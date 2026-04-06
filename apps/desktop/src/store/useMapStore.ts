import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Keyframe, FrameCamera, EasingType, MAP_STYLES, Annotation, AnnotationType, RenderStatus } from "../types";

import maplibregl from "maplibre-gl";

interface MapState {
  // Map
  mapToken: string;
  mapStyleId: string;
  mapRef: maplibregl.Map | null;
  terrainEnabled: boolean;

  // Keyframes
  keyframes: Keyframe[];
  selectedKeyframeId: string | null;
  totalDuration: number;

  // Playback
  currentTime: number;
  isPlaying: boolean;
  fps: 30 | 60;

  // Computed frames cache (from Rust)
  computedFrames: FrameCamera[];
  isComputing: boolean;

  // Annotations
  annotations: Annotation[];
  selectedAnnotationId: string | null;
  annotationMode: AnnotationType | null; // active placement mode

  // Render
  renderStatus: RenderStatus | null;
  renderResolution: "1080p" | "4K";
  renderCodec: "h265" | "prores";
  renderBitrate: number;
  showRenderPanel: boolean;

  // Actions — Map
  setMapRef: (map: maplibregl.Map | null) => void;
  setMapToken: (token: string) => void;
  setMapStyle: (styleId: string) => void;
  setTerrainEnabled: (v: boolean) => void;

  // Actions — Keyframes
  captureKeyframe: () => void;
  updateKeyframe: (id: string, patch: Partial<Keyframe>) => void;
  deleteKeyframe: (id: string) => void;
  reorderKeyframes: (fromIdx: number, toIdx: number) => void;
  selectKeyframe: (id: string | null) => void;
  syncSelectedKeyframeWithMap: () => void;
  setTotalDuration: (seconds: number) => void;
  importConfig: (jsonStr: string) => void;

  // Actions — Playback
  setCurrentTime: (t: number | ((prev: number) => number)) => void;
  setIsPlaying: (v: boolean) => void;
  setFps: (fps: 30 | 60) => void;

  // Actions — Rust integration
  setComputedFrames: (frames: FrameCamera[]) => void;
  setIsComputing: (v: boolean) => void;

  // Actions — Annotations
  addAnnotation: (ann: Annotation) => void;
  updateAnnotation: (id: string, patch: Partial<Annotation>) => void;
  deleteAnnotation: (id: string) => void;
  selectAnnotation: (id: string | null) => void;
  setAnnotationMode: (mode: AnnotationType | null) => void;

  // Actions — Render
  setRenderStatus: (status: RenderStatus | null) => void;
  setRenderResolution: (r: "1080p" | "4K") => void;
  setRenderCodec: (c: "h265" | "prores") => void;
  setRenderBitrate: (b: number) => void;
  setShowRenderPanel: (v: boolean) => void;
}

let _id = 0;
const uid = () => `id_${Date.now()}_${++_id}`;

export const useMapStore = create<MapState>()(
  persist(
    (set, get) => ({
      // Initial state
      mapToken: "",
      mapStyleId: "dark",
      mapRef: null,
      terrainEnabled: false,
      keyframes: [],
      selectedKeyframeId: null,
      totalDuration: 10,
      currentTime: 0,
      isPlaying: false,
      fps: 30,
      computedFrames: [],
      isComputing: false,
      annotations: [],
      selectedAnnotationId: null,
      annotationMode: null,
      renderStatus: null,
      renderResolution: "1080p",
      renderCodec: "h265",
      renderBitrate: 50,
      showRenderPanel: false,

      // Map actions
      setMapRef: (map) => set({ mapRef: map }),
      setMapToken: (token) => set({ mapToken: token }),
      setMapStyle: (styleId) => set({ mapStyleId: styleId }),
      setTerrainEnabled: (v) => set({ terrainEnabled: v }),

      // Keyframe actions
      captureKeyframe: () => {
        const { mapRef, keyframes, totalDuration } = get();
        if (!mapRef) return;

        const center = mapRef.getCenter();
        const kfCount = keyframes.length;

        let thumbnail: string | undefined;
        try {
          const canvas = mapRef.getCanvas();
          thumbnail = canvas.toDataURL("image/jpeg", 0.4);
        } catch { /* ignore */ }

        const time = kfCount === 0
          ? 0
          : kfCount === 1
            ? totalDuration
            : keyframes[kfCount - 1].time + (totalDuration / kfCount);

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
          selectedKeyframeId: s.selectedKeyframeId === id ? null : s.selectedKeyframeId,
        })),

      reorderKeyframes: (fromIdx, toIdx) =>
        set((s) => {
          const sorted = [...s.keyframes].sort((a, b) => a.time - b.time);
          const [moved] = sorted.splice(fromIdx, 1);
          sorted.splice(toIdx, 0, moved);
          return { keyframes: sorted };
        }),

      selectKeyframe: (id) => set({ selectedKeyframeId: id, selectedAnnotationId: null }),
      
      syncSelectedKeyframeWithMap: () => {
        const { selectedKeyframeId, mapRef, updateKeyframe } = get();
        if (!selectedKeyframeId || !mapRef) return;
        const center = mapRef.getCenter();
        updateKeyframe(selectedKeyframeId, {
          lat: center.lat,
          lng: center.lng,
          zoom: mapRef.getZoom(),
          pitch: mapRef.getPitch(),
          bearing: mapRef.getBearing(),
        });
      },

      setTotalDuration: (seconds) => set((s) => {
        if (s.keyframes.length < 2) return { totalDuration: seconds };
        const oldTotal = s.keyframes[s.keyframes.length - 1].time;
        if (oldTotal <= 0) return { totalDuration: seconds };
        const scale = seconds / oldTotal;
        const newKeyframes = s.keyframes.map((kf, i) => {
            if (i === 0) return { ...kf, time: 0 };
            if (i === s.keyframes.length - 1) return { ...kf, time: seconds };
            return { ...kf, time: parseFloat((kf.time * scale).toFixed(2)) };
        });
        return { totalDuration: seconds, keyframes: newKeyframes };
      }),

      importConfig: (jsonStr) => {
        try {
          const config = JSON.parse(jsonStr);
          if (!Array.isArray(config.keyframes)) throw new Error("Invalid config");
          set({
            keyframes: config.keyframes.map((kf: any) => ({
              ...kf,
              id: kf.id ?? uid(),
              easing: kf.easing ?? "EaseInOut",
            })),
            annotations: config.annotations ?? [],
            totalDuration: config.totalDuration ?? 10,
            fps: config.fps ?? 30,
            selectedKeyframeId: null,
          });
        } catch (e) {
          console.error("[cinematic-map] Failed to import config:", e);
          alert("Invalid config file. Please check the JSON format.");
        }
      },

      // Playback
      setCurrentTime: (t) => set((s) => ({ currentTime: typeof t === "function" ? t(s.currentTime) : t })),
      setIsPlaying: (v) => set({ isPlaying: v }),
      setFps: (fps) => set({ fps }),

      // Rust integration
      setComputedFrames: (frames) => set({ computedFrames: frames }),
      setIsComputing: (v) => set({ isComputing: v }),

      // Annotations
      addAnnotation: (ann) =>
        set((s) => ({
          annotations: [...s.annotations, ann],
          selectedAnnotationId: ann.id,
          annotationMode: null,
        })),

      updateAnnotation: (id, patch) =>
        set((s) => ({
          annotations: s.annotations.map((a) =>
            a.id === id ? { ...a, ...patch } : a
          ),
        })),

      deleteAnnotation: (id) =>
        set((s) => ({
          annotations: s.annotations.filter((a) => a.id !== id),
          selectedAnnotationId: s.selectedAnnotationId === id ? null : s.selectedAnnotationId,
        })),

      selectAnnotation: (id) => set({ selectedAnnotationId: id, selectedKeyframeId: null }),
      setAnnotationMode: (mode) => set({ annotationMode: mode }),

      // Render
      setRenderStatus: (status) => set({ renderStatus: status }),
      setRenderResolution: (r) => set({ renderResolution: r }),
      setRenderCodec: (c) => set({ renderCodec: c }),
      setRenderBitrate: (b) => set({ renderBitrate: b }),
      setShowRenderPanel: (v) => set({ showRenderPanel: v }),
    }),
    {
      name: "cinematic-map-state",
      partialize: (s) => ({
        mapToken: s.mapToken,
        mapStyleId: s.mapStyleId,
        terrainEnabled: s.terrainEnabled,
        keyframes: s.keyframes,
        annotations: s.annotations,
        totalDuration: s.totalDuration,
        fps: s.fps,
        renderResolution: s.renderResolution,
        renderCodec: s.renderCodec,
        renderBitrate: s.renderBitrate,
      }),
    }
  )
);

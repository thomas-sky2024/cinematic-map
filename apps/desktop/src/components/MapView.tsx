import { useEffect, useRef, useCallback } from "react";
import maplibregl from "maplibre-gl";
import { useMapStore } from "../store/useMapStore";
import { getStyleUrl, getTerrainUrl, Annotation, AnnotationType } from "../types";
import { interpolateAt } from "../hooks/useTauri";
import { AnnotationLayer } from "./AnnotationLayer";

// ── Terrain helpers ────────────────────────────────────────────────────────

const TERRAIN_SOURCE_ID = "maplibre-terrain-dem";
const SKY_LAYER_ID = "cinematic-sky";

function applyTerrain(map: maplibregl.Map, token: string) {
  if (!map.getSource(TERRAIN_SOURCE_ID)) {
    map.addSource(TERRAIN_SOURCE_ID, {
      type: "raster-dem",
      url: getTerrainUrl(token),
      tileSize: 256,
    } as any);
  }
  (map as any).setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration: 1.5 });
}

function removeTerrain(map: maplibregl.Map) {
  (map as any).setTerrain(null);
  if (map.getSource(TERRAIN_SOURCE_ID)) map.removeSource(TERRAIN_SOURCE_ID);
}

// ── Placement cursor overlay ───────────────────────────────────────────────

const TYPE_CURSOR_ICON: Record<AnnotationType, string> = {
  text:    "✏️",
  callout: "💬",
  image:   "🖼️",
  model3d: "📦",
};

// ── Component ──────────────────────────────────────────────────────────────

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const animFrameRef = useRef<number>(0);
  const currentTimeRef = useRef(0);

  const {
    mapStyleId, mapToken, terrainEnabled,
    keyframes, currentTime, isPlaying, fps,
    setMapRef, setCurrentTime, setIsPlaying, totalDuration,
    annotationMode, addAnnotation, setAnnotationMode,
  } = useMapStore();

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  const resolvedStyleUrl = getStyleUrl(mapStyleId, mapToken);

  // ── Init map ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: resolvedStyleUrl,
      center: [108.05, 12.66],
      zoom: 5,
      pitch: 0,
      bearing: 0,
      antialias: true,
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("load", () => {
      mapRef.current = map;
      setMapRef(map as any);
      if (terrainEnabled && mapToken) applyTerrain(map, mapToken);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      setMapRef(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Style change ──────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(resolvedStyleUrl);
    const onStyleLoad = () => {
      if (terrainEnabled && mapToken) applyTerrain(map, mapToken);
    };
    map.once("style.load", onStyleLoad);
    return () => { map.off("style.load", onStyleLoad); };
  }, [resolvedStyleUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Terrain toggle ────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    if (terrainEnabled && mapToken) {
      applyTerrain(map, mapToken);
    } else {
      removeTerrain(map);
    }
  }, [terrainEnabled, mapToken]);

  // ── Annotation click-to-place ─────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const handleClick = (e: maplibregl.MapMouseEvent) => {
      if (!annotationMode) return;
      const { lng, lat } = e.lngLat;

      const labelMap: Record<AnnotationType, string> = {
        text:    "Text label",
        callout: "Callout",
        image:   "Image",
        model3d: "3D Object",
      };

      const newAnn: Annotation = {
        id: `ann_${Date.now()}`,
        type: annotationMode,
        lat,
        lng,
        label: labelMap[annotationMode],
        color: "#3b82f6",
        visible: true,
        ...(annotationMode === "callout" ? { content: "Description here" } : {}),
        ...(annotationMode === "image"   ? { imageWidth: 160, imageHeight: 90 } : {}),
        ...(annotationMode === "model3d" ? { modelScale: 1, modelRotationY: 0, modelAltitude: 0 } : {}),
        ...(annotationMode === "text"    ? { fontSize: 13 } : {}),
      };

      addAnnotation(newAnn);
    };

    map.on("click", handleClick);
    return () => { map.off("click", handleClick); };
  }, [annotationMode, addAnnotation]);

  // ── Escape key to cancel placement mode ───────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && annotationMode) {
        setAnnotationMode(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [annotationMode, setAnnotationMode]);

  // ── Cursor style when in placement mode ───────────────────────────────────
  useEffect(() => {
    const canvas = mapRef.current?.getCanvas();
    if (canvas) {
      canvas.style.cursor = annotationMode ? "crosshair" : "";
    }
  }, [annotationMode]);

  // ── Ctrl+Arrow pitch/bearing ──────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const map = mapRef.current;
      if (!map || (!e.ctrlKey && !e.altKey)) return;
      const PITCH_STEP = 5;
      const BEARING_STEP = 10;
      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          map.setPitch(Math.min(85, map.getPitch() + PITCH_STEP));
          break;
        case "ArrowDown":
          e.preventDefault();
          map.setPitch(Math.max(0, map.getPitch() - PITCH_STEP));
          break;
        case "ArrowLeft":
          e.preventDefault();
          map.setBearing(map.getBearing() - BEARING_STEP);
          break;
        case "ArrowRight":
          e.preventDefault();
          map.setBearing(map.getBearing() + BEARING_STEP);
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // ── Playback loop ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isPlaying) {
      cancelAnimationFrame(animFrameRef.current);
      return;
    }

    let lastTimestamp = performance.now();
    const frameDuration = 1000 / fps;

    const tick = async (timestamp: number) => {
      const elapsed = timestamp - lastTimestamp;
      if (elapsed >= frameDuration) {
        lastTimestamp = timestamp;
        const nextTime = currentTimeRef.current + elapsed / 1000;

        if (nextTime >= totalDuration) {
          setCurrentTime(totalDuration);
          setIsPlaying(false);
          return;
        }

        setCurrentTime(nextTime);

        if (mapRef.current && keyframes.length >= 2) {
          const cam = await interpolateAt(keyframes, nextTime);
          if (cam) {
            mapRef.current.jumpTo({
              center: [cam.lng, cam.lat],
              zoom: cam.zoom,
              pitch: cam.pitch,
              bearing: cam.bearing,
            });
          }
        }
      }
      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrameRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, keyframes, fps, totalDuration]);

  // ── Scrub to time ─────────────────────────────────────────────────────────
  const scrubTo = useCallback(
    async (time: number) => {
      if (!mapRef.current || keyframes.length < 2) return;
      const cam = await interpolateAt(keyframes, time);
      if (cam) {
        mapRef.current.jumpTo({
          center: [cam.lng, cam.lat],
          zoom: cam.zoom,
          pitch: cam.pitch,
          bearing: cam.bearing,
        });
      }
    },
    [keyframes]
  );

  return (
    <div className="relative flex-1 overflow-hidden bg-gray-950">
      {/* Map canvas */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* Annotation markers (portal into MapLibre) */}
      <AnnotationLayer />

      {/* Time badge */}
      <div className="absolute top-3 left-3 px-2.5 py-1 rounded-md bg-black/60 backdrop-blur-sm text-white text-xs font-mono tabular-nums pointer-events-none">
        {currentTime.toFixed(1)}s / {totalDuration.toFixed(1)}s
      </div>

      {/* Satellite/terrain token warning */}
      {(mapStyleId === "satellite" || mapStyleId === "terrain") && !mapToken && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/40 backdrop-blur-sm text-amber-300 text-xs flex items-center gap-2 whitespace-nowrap pointer-events-none">
          <span>⚠️</span>
          <span>
            <strong>{mapStyleId === "satellite" ? "Satellite" : "Terrain"}</strong>{" "}
            requires a MapTiler API key — click <strong>API Key</strong> to add one.
          </span>
        </div>
      )}

      {/* Annotation placement overlay */}
      {annotationMode && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-blue-600/90 backdrop-blur-sm text-white text-xs font-medium flex items-center gap-2 shadow-lg pointer-events-none">
          <span>{TYPE_CURSOR_ICON[annotationMode]}</span>
          <span>Click anywhere on the map to place — <kbd className="bg-white/20 px-1.5 py-0.5 rounded text-[10px]">Esc</kbd> to cancel</span>
        </div>
      )}

      {/* Keyboard hint */}
      <div className="absolute bottom-10 right-3 px-2 py-1 rounded bg-black/40 text-white/25 text-[10px] pointer-events-none select-none">
        Ctrl+↑↓ Pitch · Ctrl+←→ Bearing
      </div>

      {/* No keyframes hint */}
      {keyframes.length === 0 && !annotationMode && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center text-white/40">
            <p className="text-sm">Navigate the map, then press</p>
            <p className="text-lg font-medium mt-1">+ Capture Keyframe</p>
          </div>
        </div>
      )}
    </div>
  );
}

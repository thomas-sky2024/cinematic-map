import { useRef, useCallback, useEffect } from "react";
import { useMapStore } from "../store/useMapStore";
import { getStyleUrl, AnnotationType } from "../types";
import { MapBase, AnnotationLayerBase } from "@cinematic-map/ui-core";
import { interpolateAt } from "../hooks/useTauri";

// ── Placement cursor overlay ───────────────────────────────────────────────

const TYPE_CURSOR_ICON: Record<AnnotationType, string> = {
  text:    "✏️",
  callout: "💬",
  image:   "🖼️",
  model3d: "📦",
};

// ── Component ──────────────────────────────────────────────────────────────

export function MapView() {
  const {
    mapStyleId, mapToken, terrainEnabled,
    annotations, currentTime, totalDuration,
    setMapRef, annotationMode, mapRef, keyframes
  } = useMapStore();

  const lastProcessedTime = useRef(-1);

  // Sync map camera with currentTime
  useEffect(() => {
    if (!mapRef || keyframes.length < 2) return;
    if (Math.abs(currentTime - lastProcessedTime.current) < 0.001) return;

    const syncMap = async () => {
      const cam = await interpolateAt(keyframes, currentTime);
      if (cam && mapRef) {
        lastProcessedTime.current = currentTime;
        (mapRef as any).jumpTo({
          center: [cam.lng, cam.lat],
          zoom: cam.zoom,
          pitch: cam.pitch,
          bearing: cam.bearing,
        });
      }
    };
    
    syncMap();
  }, [mapRef, currentTime, keyframes]);

  const resolvedStyleUrl = getStyleUrl(mapStyleId, mapToken);

  const onMapLoad = useCallback((map: any) => {
    setMapRef(map);
  }, [setMapRef]);

  return (
    <div className="relative flex-1 overflow-hidden bg-gray-950">
      <MapBase
        styleUrl={resolvedStyleUrl}
        terrainToken={terrainEnabled ? mapToken : undefined}
        center={[108.05, 12.66]} 
        zoom={5}
        pitch={0}
        bearing={0}
        onMapLoad={onMapLoad}
      >
        <AnnotationLayerBase 
          annotations={annotations}
          currentTime={currentTime}
        />
      </MapBase>

      {/* Time badge */}
      <div className="absolute top-3 left-3 px-2.5 py-1 rounded-md bg-black/60 backdrop-blur-sm text-white text-xs font-mono tabular-nums pointer-events-none">
        {currentTime.toFixed(1)}s / {totalDuration.toFixed(1)}s
      </div>

      {/* Warnings & Hints */}
      {(mapStyleId === "satellite" || mapStyleId === "terrain") && !mapToken && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/40 backdrop-blur-sm text-amber-300 text-xs flex items-center gap-2 whitespace-nowrap pointer-events-none">
          <span>⚠️</span>
          <span>
            <strong>{mapStyleId === "satellite" ? "Satellite" : "Terrain"}</strong>{" "}
            requires a MapTiler API key.
          </span>
        </div>
      )}

      {annotationMode && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-blue-600/90 backdrop-blur-sm text-white text-xs font-medium flex items-center gap-2 shadow-lg pointer-events-none">
          <span>{TYPE_CURSOR_ICON[annotationMode]}</span>
          <span>Click on map to place — <kbd className="bg-white/20 px-1.5 py-0.5 rounded text-[10px]">Esc</kbd></span>
        </div>
      )}
    </div>
  );
}

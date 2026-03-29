import { useEffect, useState } from "react";
import { useMapStore } from "../store/useMapStore";

interface LiveCamera {
  lat: number;
  lng: number;
  zoom: number;
  pitch: number;
  bearing: number;
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0">
      <span className="text-[10px] text-white/35 uppercase tracking-wider">{label}</span>
      <span className="text-[11px] text-white/70 font-mono tabular-nums">{value}</span>
    </div>
  );
}

export function CameraPanel() {
  const { mapRef, selectedKeyframeId, keyframes } = useMapStore();
  const [live, setLive] = useState<LiveCamera | null>(null);

  // Update live camera values as map moves
  useEffect(() => {
    if (!mapRef) return;
    const map = mapRef as any;

    const update = () => {
      const c = map.getCenter();
      setLive({
        lat: c.lat,
        lng: c.lng,
        zoom: map.getZoom(),
        pitch: map.getPitch(),
        bearing: map.getBearing(),
      });
    };

    update();
    map.on("move", update);
    return () => map.off("move", update);
  }, [mapRef]);

  const selectedKf = keyframes.find((k) => k.id === selectedKeyframeId);

  return (
    <aside className="w-44 flex flex-col bg-gray-950 border-l border-white/8 overflow-hidden">
      {/* Live camera */}
      <div className="px-3 py-2 border-b border-white/8">
        <p className="text-[10px] font-semibold text-white/35 tracking-widest uppercase mb-2">
          Live Camera
        </p>
        {live ? (
          <div>
            <StatRow label="Lat" value={live.lat.toFixed(4)} />
            <StatRow label="Lng" value={live.lng.toFixed(4)} />
            <StatRow label="Zoom" value={live.zoom.toFixed(2)} />
            <StatRow label="Pitch" value={`${live.pitch.toFixed(1)}°`} />
            <StatRow label="Bearing" value={`${live.bearing.toFixed(1)}°`} />
          </div>
        ) : (
          <p className="text-white/20 text-[10px]">Loading map…</p>
        )}
      </div>

      {/* Selected keyframe details */}
      {selectedKf && (
        <div className="px-3 py-2 border-b border-white/8">
          <p className="text-[10px] font-semibold text-white/35 tracking-widest uppercase mb-2">
            Selected
          </p>
          <div>
            <p className="text-white/60 text-[11px] font-medium mb-1.5 truncate">
              {selectedKf.label}
            </p>
            <StatRow label="Time" value={`${selectedKf.time.toFixed(1)}s`} />
            <StatRow label="Zoom" value={selectedKf.zoom.toFixed(2)} />
            <StatRow label="Pitch" value={`${selectedKf.pitch.toFixed(1)}°`} />
            <StatRow label="Bearing" value={`${selectedKf.bearing.toFixed(1)}°`} />
          </div>
        </div>
      )}

      {/* Keyboard shortcuts hint */}
      <div className="mt-auto px-3 py-3 border-t border-white/8">
        <p className="text-[10px] font-semibold text-white/25 tracking-widest uppercase mb-2">
          Shortcuts
        </p>
        <div className="space-y-1">
          {[
            ["Space", "Play / Pause"],
            ["←  →", "Scrub 0.1s"],
            ["⇧ ← →", "Scrub 1s"],
            ["Home", "Go to start"],
            ["End", "Go to end"],
          ].map(([key, desc]) => (
            <div key={key} className="flex items-center justify-between gap-1">
              <kbd className="text-[9px] bg-white/8 border border-white/12 rounded px-1 py-0.5 text-white/50 font-mono">
                {key}
              </kbd>
              <span className="text-[9px] text-white/25 text-right leading-tight">
                {desc}
              </span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

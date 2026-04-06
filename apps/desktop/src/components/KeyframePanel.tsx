import { useCallback, useRef } from "react";
import {
  Plus, Trash2, GripVertical, Clock, ChevronRight,
  Mountain, RefreshCw, MapPin, Navigation,
} from "lucide-react";
import { useMapStore } from "../store/useMapStore";
import { Keyframe, EasingType, MAP_STYLES } from "../types";
import { computeFrames } from "../hooks/useTauri";

// ── Easing picker ─────────────────────────────────────────────────────────

const EASING_LABELS: Record<EasingType, string> = {
  Linear: "Linear",
  EaseInOut: "Ease",
  CinematicArc: "Cinematic",
};
const EASING_TOOLTIPS: Record<EasingType, string> = {
  Linear: "Constant speed",
  EaseInOut: "Smooth start and end",
  CinematicArc: "Arc zoom + smooth — best for long flights",
};

function EasingPicker({ value, onChange }: { value: EasingType; onChange: (v: EasingType) => void }) {
  return (
    <div className="flex gap-1 mt-1">
      {(["Linear", "EaseInOut", "CinematicArc"] as EasingType[]).map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          title={EASING_TOOLTIPS[opt]}
          className={`flex-1 py-0.5 text-[10px] rounded border transition-colors ${
            value === opt
              ? "bg-blue-500/20 border-blue-500/50 text-blue-300"
              : "bg-transparent border-white/10 text-white/40 hover:text-white/60"
          }`}
        >
          {EASING_LABELS[opt]}
        </button>
      ))}
    </div>
  );
}

// ── Keyframe card ─────────────────────────────────────────────────────────

function KeyframeCard({
  kf, index, isSelected, onDragStart, onDragOver, onDrop,
}: {
  kf: Keyframe; index: number; isSelected: boolean;
  onDragStart: (i: number) => void;
  onDragOver: (e: React.DragEvent, i: number) => void;
  onDrop: (i: number) => void;
}) {
  const { selectKeyframe, updateKeyframe, deleteKeyframe, mapRef } = useMapStore();

  // Click card → fly to this keyframe's position
  const handleClick = useCallback(() => {
    selectKeyframe(kf.id);
    if (mapRef) {
      (mapRef as any).flyTo({
        center: [kf.lng, kf.lat],
        zoom: kf.zoom,
        pitch: kf.pitch,
        bearing: kf.bearing,
        duration: 800,
        easing: (t: number) => t < 0.5 ? 2*t*t : -1+(4-2*t)*t,
      });
    }
  }, [kf, mapRef, selectKeyframe]);

  // "Update" — overwrite this keyframe with current map view
  const handleUpdate = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!mapRef) return;
    const center = mapRef.getCenter();
    let thumbnail: string | undefined;
    try { thumbnail = mapRef.getCanvas().toDataURL("image/jpeg", 0.5); } catch {}
    updateKeyframe(kf.id, {
      lat: center.lat, lng: center.lng,
      zoom: mapRef.getZoom(),
      pitch: mapRef.getPitch(),
      bearing: mapRef.getBearing(),
      ...(thumbnail ? { thumbnail } : {}),
    });
  }, [kf.id, mapRef, updateKeyframe]);

  return (
    <div
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={(e) => onDragOver(e, index)}
      onDrop={() => onDrop(index)}
      onClick={handleClick}
      className={`group rounded-lg border transition-all cursor-pointer mb-2 overflow-hidden ${
        isSelected
          ? "border-blue-500/50 bg-blue-500/10"
          : "border-white/8 bg-white/4 hover:bg-white/6"
      }`}
    >
      {/* Thumbnail + header */}
      <div className="flex items-stretch">
        <div className="relative w-14 h-12 flex-shrink-0 bg-gray-800 overflow-hidden">
          {kf.thumbnail ? (
            <img src={kf.thumbnail} alt={kf.label} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <span className="text-white/20 text-lg font-mono">{index + 1}</span>
            </div>
          )}
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/40 transition-opacity">
            <GripVertical size={14} className="text-white/60" />
          </div>
        </div>

        <div className="flex-1 px-2.5 py-1.5 min-w-0">
          <input
            value={kf.label}
            onChange={(e) => updateKeyframe(kf.id, { label: e.target.value })}
            onClick={(e) => e.stopPropagation()}
            className="w-full bg-transparent text-white/90 text-xs font-medium outline-none border-none focus:text-white truncate"
          />
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-white/40 text-[10px] font-mono tabular-nums">{kf.time.toFixed(1)}s</span>
            <span className="text-white/25 text-[10px]">z{kf.zoom.toFixed(1)} p{kf.pitch.toFixed(0)}°</span>
          </div>
        </div>

        {/* Actions: shown when selected or hovered */}
        <div className={`flex items-center gap-0.5 px-1.5 transition-opacity ${
          isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}>
          {/* Update with current view */}
          <button
            onClick={handleUpdate}
            className="p-1 rounded hover:bg-blue-500/20 text-white/30 hover:text-blue-400 transition-colors"
            title="Update with current map view"
          >
            <RefreshCw size={11} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); deleteKeyframe(kf.id); }}
            className="p-1 rounded hover:bg-red-500/20 text-white/30 hover:text-red-400 transition-colors"
            title="Delete keyframe"
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>

      {/* Expanded: easing + time when selected */}
      {isSelected && (
        <div className="px-2.5 pb-2.5 border-t border-white/6 pt-2 space-y-2">
          {/* Coords display */}
          <div className="flex items-center gap-1.5 text-[10px] text-white/30">
            <MapPin size={9} />
            <span className="font-mono">{kf.lat.toFixed(4)}, {kf.lng.toFixed(4)}</span>
          </div>

          {/* Update hint */}
          <div className="flex items-center gap-1.5 p-1.5 rounded bg-blue-500/8 border border-blue-500/15">
            <Navigation size={9} className="text-blue-400/70 flex-shrink-0" />
            <p className="text-[9px] text-blue-300/60 leading-tight">
              Navigate the map, then press{" "}
              <button
                onClick={handleUpdate}
                className="text-blue-400 hover:text-blue-300 font-medium underline"
              >
                Update
              </button>{" "}
              to save current view
            </p>
          </div>

          {/* Easing */}
          <div>
            <p className="text-[10px] text-white/30 mb-1">Transition easing</p>
            <EasingPicker
              value={kf.easing}
              onChange={(easing) => updateKeyframe(kf.id, { easing })}
            />
          </div>

          {/* Time */}
          <div className="flex items-center gap-2">
            <Clock size={10} className="text-white/30 flex-shrink-0" />
            <input
              type="number" min={0} step={0.1} value={kf.time}
              onChange={(e) => updateKeyframe(kf.id, { time: parseFloat(e.target.value) || 0 })}
              onClick={(e) => e.stopPropagation()}
              className="w-16 bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-[11px] text-white/70 font-mono outline-none focus:border-blue-500/50"
            />
            <span className="text-white/30 text-[10px]">sec</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Map style picker ──────────────────────────────────────────────────────

function StylePicker() {
  const { mapStyleId, mapToken, setMapStyle } = useMapStore();
  const tokenRequired = new Set(["satellite", "terrain"]);

  return (
    <div className="flex gap-1.5 flex-wrap">
      {MAP_STYLES.map((s) => {
        const needsToken = tokenRequired.has(s.id) && !mapToken;
        return (
          <button
            key={s.id}
            onClick={() => setMapStyle(s.id)}
            title={needsToken ? `${s.label} (requires MapTiler API key)` : s.label}
            className={`flex items-center gap-1.5 px-2 py-1 rounded border text-[10px] transition-all ${
              mapStyleId === s.id
                ? "border-blue-500/60 text-blue-300"
                : "border-white/10 text-white/40 hover:text-white/60"
            } ${needsToken ? "opacity-60" : ""}`}
          >
            <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: s.preview }} />
            {s.label}
            {needsToken && <span className="text-amber-400 text-[8px]">🔑</span>}
          </button>
        );
      })}
    </div>
  );
}

// ── Main KeyframePanel ────────────────────────────────────────────────────

export function KeyframePanel() {
  const {
    keyframes, selectedKeyframeId, totalDuration, setTotalDuration,
    captureKeyframe, fps, setFps, isComputing, terrainEnabled,
    setTerrainEnabled, mapToken, reorderKeyframes, mapRef,
  } = useMapStore();

  const dragIndexRef = useRef<number | null>(null);

  const handleDragStart = (idx: number) => { dragIndexRef.current = idx; };
  const handleDragOver  = (e: React.DragEvent) => { e.preventDefault(); };
  const handleDrop      = (toIdx: number) => {
    if (dragIndexRef.current === null || dragIndexRef.current === toIdx) return;
    reorderKeyframes(dragIndexRef.current, toIdx);
    dragIndexRef.current = null;
  };

  const handleCompute = useCallback(async () => {
    if (keyframes.length < 2) return;
    await computeFrames(keyframes, fps);
  }, [keyframes, fps]);

  const sorted = [...keyframes].sort((a, b) => a.time - b.time);

  return (
    <aside className="w-56 flex flex-col bg-gray-950 border-r border-white/8 overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-white/8 flex items-center justify-between">
        <span className="text-[10px] font-semibold text-white/40 tracking-widest uppercase">
          Keyframes
        </span>
        <span className="text-[10px] text-white/25">{keyframes.length} scenes</span>
      </div>

      {/* Workflow hint */}
      {keyframes.length === 0 && (
        <div className="px-3 py-3 border-b border-white/6 bg-blue-500/5">
          <p className="text-[10px] text-blue-300/70 leading-relaxed">
            <strong className="text-blue-300">How to use:</strong><br />
            1. Navigate to start position<br />
            2. Press <strong>+ Capture</strong><br />
            3. Navigate to next position<br />
            4. Press <strong>+ Capture</strong> again<br />
            5. Select any keyframe to edit it
          </p>
        </div>
      )}

      {keyframes.length > 0 && keyframes.length < 2 && (
        <div className="px-3 py-2 border-b border-white/6 bg-amber-500/5">
          <p className="text-[10px] text-amber-300/70">
            Add at least one more keyframe to enable playback
          </p>
        </div>
      )}

      {/* Keyframe list */}
      <div className="flex-1 overflow-y-auto p-2">
        {sorted.map((kf, i) => (
          <KeyframeCard
            key={kf.id}
            kf={kf}
            index={i}
            isSelected={kf.id === selectedKeyframeId}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          />
        ))}
      </div>

      {/* Capture button */}
      <div className="p-2 border-t border-white/8">
        <button
          onClick={captureKeyframe}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors"
        >
          <Plus size={14} />
          Capture Keyframe
        </button>
        <p className="text-[9px] text-white/20 text-center mt-1">
          Captures current map view as a scene
        </p>
      </div>

      {/* Map style */}
      <div className="px-2 pb-2 border-t border-white/8 pt-2">
        <p className="text-[10px] text-white/30 mb-1.5 uppercase tracking-wider">Map style</p>
        <StylePicker />
      </div>

      {/* 3D Terrain */}
      <div className="px-2 pb-2 border-t border-white/8 pt-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Mountain size={11} className="text-white/40" />
            <span className="text-[10px] text-white/40">3D Terrain</span>
            {!mapToken && <span className="text-[9px] text-amber-400" title="Requires MapTiler API key">🔑</span>}
          </div>
          <button
            onClick={() => setTerrainEnabled(!terrainEnabled)}
            disabled={!mapToken}
            className={`relative w-8 h-4 rounded-full border transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
              terrainEnabled ? "bg-blue-600 border-blue-500" : "bg-white/10 border-white/15"
            }`}
          >
            <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all ${
              terrainEnabled ? "left-4" : "left-0.5"
            }`} />
          </button>
        </div>
      </div>

      {/* Settings */}
      <div className="px-2 pb-3 border-t border-white/8 pt-2 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-white/40">Duration</span>
          <div className="flex items-center gap-1">
            <input
              type="number" min={1} max={300} value={totalDuration}
              onChange={(e) => setTotalDuration(Number(e.target.value) || 10)}
              className="w-12 bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-[11px] text-white/70 font-mono text-right outline-none focus:border-blue-500/40"
            />
            <span className="text-[10px] text-white/30">sec</span>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-[10px] text-white/40">FPS</span>
          <div className="flex gap-1">
            {([30, 60] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFps(f)}
                className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${
                  fps === f
                    ? "border-blue-500/50 text-blue-300 bg-blue-500/10"
                    : "border-white/10 text-white/40 hover:text-white/60"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={handleCompute}
          disabled={keyframes.length < 2 || isComputing}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded border border-white/15 text-white/50 hover:text-white/80 hover:border-white/30 text-[11px] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {isComputing ? (
            <><span className="animate-spin">⟳</span> Computing…</>
          ) : (
            <><ChevronRight size={11} /> Pre-compute frames</>
          )}
        </button>
      </div>
    </aside>
  );
}

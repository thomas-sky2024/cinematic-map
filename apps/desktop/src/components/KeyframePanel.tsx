import { useCallback } from "react";
import { Plus, Trash2, GripVertical, Clock, ChevronRight } from "lucide-react";
import { useMapStore } from "../store/useMapStore";
import { Keyframe, EasingType, MAP_STYLES } from "../types";
import { computeFrames } from "../hooks/useTauri";

// ── Easing badge ───────────────────────────────────────────────────────────
const EASING_LABELS: Record<EasingType, string> = {
  Linear: "Linear",
  EaseInOut: "Ease",
  CinematicArc: "Cinematic",
};

function EasingPicker({
  value,
  onChange,
}: {
  value: EasingType;
  onChange: (v: EasingType) => void;
}) {
  const options: EasingType[] = ["Linear", "EaseInOut", "CinematicArc"];
  return (
    <div className="flex gap-1 mt-1">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
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

// ── Single keyframe card ───────────────────────────────────────────────────
function KeyframeCard({
  kf,
  index,
  isSelected,
}: {
  kf: Keyframe;
  index: number;
  isSelected: boolean;
}) {
  const { selectKeyframe, updateKeyframe, deleteKeyframe, captureKeyframe, mapRef } =
    useMapStore();

  const handleClick = useCallback(() => {
    selectKeyframe(kf.id);
    // Jump map to this keyframe position
    if (mapRef) {
      (mapRef as any).flyTo({
        center: [kf.lng, kf.lat],
        zoom: kf.zoom,
        pitch: kf.pitch,
        bearing: kf.bearing,
        duration: 600,
      });
    }
  }, [kf, mapRef, selectKeyframe]);

  return (
    <div
      onClick={handleClick}
      className={`group rounded-lg border transition-all cursor-pointer mb-2 overflow-hidden ${
        isSelected
          ? "border-blue-500/50 bg-blue-500/10"
          : "border-white/8 bg-white/4 hover:bg-white/6"
      }`}
    >
      {/* Thumbnail + header */}
      <div className="flex items-stretch gap-0">
        {/* Thumbnail */}
        <div className="w-14 h-12 flex-shrink-0 bg-gray-800 overflow-hidden">
          {kf.thumbnail ? (
            <img
              src={kf.thumbnail}
              alt={kf.label}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <span className="text-white/20 text-lg font-mono">{index + 1}</span>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 px-2.5 py-1.5 min-w-0">
          {/* Editable label */}
          <input
            value={kf.label}
            onChange={(e) => updateKeyframe(kf.id, { label: e.target.value })}
            onClick={(e) => e.stopPropagation()}
            className="w-full bg-transparent text-white/90 text-xs font-medium outline-none border-none focus:text-white truncate"
          />
          {/* Time + coords */}
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-white/40 text-[10px] font-mono tabular-nums">
              {kf.time.toFixed(1)}s
            </span>
            <span className="text-white/25 text-[10px]">
              z{kf.zoom.toFixed(1)}  p{kf.pitch.toFixed(0)}°
            </span>
          </div>
        </div>

        {/* Actions — show on hover/selected */}
        <div
          className={`flex items-center gap-1 px-2 transition-opacity ${
            isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              deleteKeyframe(kf.id);
            }}
            className="p-1 rounded hover:bg-red-500/20 text-white/30 hover:text-red-400 transition-colors"
            title="Delete keyframe"
          >
            <Trash2 size={12} />
          </button>
          <GripVertical size={12} className="text-white/20 cursor-grab" />
        </div>
      </div>

      {/* Expanded easing picker when selected */}
      {isSelected && (
        <div className="px-2.5 pb-2 border-t border-white/6 pt-1.5">
          <p className="text-[10px] text-white/30 mb-1">Transition easing</p>
          <EasingPicker
            value={kf.easing}
            onChange={(easing) => updateKeyframe(kf.id, { easing })}
          />
          {/* Time input */}
          <div className="flex items-center gap-2 mt-2">
            <Clock size={10} className="text-white/30 flex-shrink-0" />
            <input
              type="number"
              min={0}
              step={0.1}
              value={kf.time}
              onChange={(e) =>
                updateKeyframe(kf.id, { time: parseFloat(e.target.value) || 0 })
              }
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

// ── Map style picker ───────────────────────────────────────────────────────
function StylePicker() {
  const { mapStyleId, setMapStyle } = useMapStore();

  return (
    <div className="flex gap-1.5 flex-wrap">
      {MAP_STYLES.map((s) => (
        <button
          key={s.id}
          onClick={() => setMapStyle(s.id)}
          title={s.label}
          className={`flex items-center gap-1.5 px-2 py-1 rounded border text-[10px] transition-all ${
            mapStyleId === s.id
              ? "border-blue-500/60 text-blue-300"
              : "border-white/10 text-white/40 hover:text-white/60"
          }`}
        >
          <span
            className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
            style={{ background: s.preview }}
          />
          {s.label}
        </button>
      ))}
    </div>
  );
}

// ── Main KeyframePanel ─────────────────────────────────────────────────────
export function KeyframePanel() {
  const {
    keyframes,
    selectedKeyframeId,
    totalDuration,
    setTotalDuration,
    captureKeyframe,
    fps,
    setFps,
    isComputing,
  } = useMapStore();

  const handleCompute = useCallback(async () => {
    if (keyframes.length < 2) return;
    await computeFrames(keyframes, fps);
  }, [keyframes, fps]);

  return (
    <aside className="w-56 flex flex-col bg-gray-950 border-r border-white/8 overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-white/8 flex items-center justify-between">
        <span className="text-[10px] font-semibold text-white/40 tracking-widest uppercase">
          Keyframes
        </span>
        <span className="text-[10px] text-white/25">{keyframes.length} scenes</span>
      </div>

      {/* Keyframe list */}
      <div className="flex-1 overflow-y-auto p-2">
        {keyframes.length === 0 ? (
          <div className="text-center py-8 text-white/20 text-xs">
            <p>No keyframes yet.</p>
            <p className="mt-1">Navigate the map</p>
            <p>then capture.</p>
          </div>
        ) : (
          keyframes
            .slice()
            .sort((a, b) => a.time - b.time)
            .map((kf, i) => (
              <KeyframeCard
                key={kf.id}
                kf={kf}
                index={i}
                isSelected={kf.id === selectedKeyframeId}
              />
            ))
        )}
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
      </div>

      {/* Map style */}
      <div className="px-2 pb-2 border-t border-white/8 pt-2">
        <p className="text-[10px] text-white/30 mb-1.5 uppercase tracking-wider">Map style</p>
        <StylePicker />
      </div>

      {/* Settings */}
      <div className="px-2 pb-3 border-t border-white/8 pt-2 space-y-2">
        {/* Duration */}
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-white/40">Duration</span>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={1}
              max={300}
              value={totalDuration}
              onChange={(e) => setTotalDuration(Number(e.target.value) || 10)}
              className="w-12 bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-[11px] text-white/70 font-mono text-right outline-none focus:border-blue-500/40"
            />
            <span className="text-[10px] text-white/30">sec</span>
          </div>
        </div>

        {/* FPS */}
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

        {/* Compute button */}
        <button
          onClick={handleCompute}
          disabled={keyframes.length < 2 || isComputing}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded border border-white/15 text-white/50 hover:text-white/80 hover:border-white/30 text-[11px] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {isComputing ? (
            <>
              <span className="animate-spin">⟳</span> Computing…
            </>
          ) : (
            <>
              <ChevronRight size={11} /> Pre-compute frames
            </>
          )}
        </button>
      </div>
    </aside>
  );
}

import { useRef, useCallback, useEffect } from "react";
import { Play, Pause, SkipBack, SkipForward } from "lucide-react";
import { useMapStore } from "../store/useMapStore";
import { interpolateAt } from "../hooks/useTauri";

// ── Playhead ───────────────────────────────────────────────────────────────
function Playhead({ pct }: { pct: number }) {
  return (
    <div
      className="absolute top-0 bottom-0 w-px bg-red-500 pointer-events-none z-10"
      style={{ left: `${pct * 100}%` }}
    >
      {/* Triangle head */}
      <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[5px] border-r-[5px] border-t-[7px] border-l-transparent border-r-transparent border-t-red-500" />
    </div>
  );
}

// ── Keyframe diamond ───────────────────────────────────────────────────────
function KeyframeDiamond({
  pct,
  isSelected,
  label,
  onClick,
}: {
  pct: number;
  isSelected: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-20 group"
      style={{ left: `${pct * 100}%` }}
    >
      <div
        className={`w-3 h-3 rotate-45 border transition-all ${
          isSelected
            ? "bg-blue-400 border-blue-300 scale-125"
            : "bg-gray-700 border-white/40 hover:bg-blue-500/60 hover:border-blue-400 hover:scale-110"
        }`}
      />
      {/* Label tooltip */}
      <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-[9px] text-white/60 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity bg-gray-900 px-1 rounded">
        {label}
      </span>
    </button>
  );
}

// ── Segment between two keyframes ─────────────────────────────────────────
function Segment({ fromPct, toPct }: { fromPct: number; toPct: number }) {
  return (
    <div
      className="absolute top-1/2 -translate-y-1/2 h-1 rounded-full bg-blue-500/25"
      style={{
        left: `${fromPct * 100}%`,
        width: `${(toPct - fromPct) * 100}%`,
      }}
    />
  );
}

// ── Timeline ruler ticks ──────────────────────────────────────────────────
function Ruler({ duration }: { duration: number }) {
  const ticks: number[] = [];
  // One tick per second, max 60 visible ticks
  const interval = duration > 60 ? 5 : 1;
  for (let t = 0; t <= duration; t += interval) {
    ticks.push(t);
  }

  return (
    <div className="absolute inset-x-0 top-0 h-3 pointer-events-none">
      {ticks.map((t) => {
        const pct = t / duration;
        return (
          <div
            key={t}
            className="absolute flex flex-col items-center"
            style={{ left: `${pct * 100}%` }}
          >
            <div className="w-px h-1.5 bg-white/15" />
            <span className="text-[8px] text-white/20 tabular-nums mt-0.5">
              {t}s
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Main Timeline ─────────────────────────────────────────────────────────
export function Timeline() {
  const trackRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const {
    keyframes,
    selectedKeyframeId,
    currentTime,
    isPlaying,
    totalDuration,
    mapRef,
    selectKeyframe,
    setCurrentTime,
    setIsPlaying,
  } = useMapStore();

  const sortedKfs = [...keyframes].sort((a, b) => a.time - b.time);
  const playheadPct = Math.min(currentTime / totalDuration, 1);

  // Convert click/drag X position to time
  const xToTime = useCallback(
    (clientX: number): number => {
      if (!trackRef.current) return 0;
      const rect = trackRef.current.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return pct * totalDuration;
    },
    [totalDuration]
  );

  // Scrub map to a time position
  const scrubTo = useCallback(
    async (time: number) => {
      setCurrentTime(time);
      if (mapRef && keyframes.length >= 2) {
        const cam = await interpolateAt(keyframes, time);
        if (cam && mapRef) {
          (mapRef as any).jumpTo({
            center: [cam.lng, cam.lat],
            zoom: cam.zoom,
            pitch: cam.pitch,
            bearing: cam.bearing,
          });
        }
      }
    },
    [keyframes, mapRef, setCurrentTime]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      isDragging.current = true;
      setIsPlaying(false);
      const time = xToTime(e.clientX);
      scrubTo(time);
    },
    [xToTime, scrubTo, setIsPlaying]
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      scrubTo(xToTime(e.clientX));
    };
    const handleMouseUp = () => {
      isDragging.current = false;
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [xToTime, scrubTo]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      switch (e.code) {
        case "Space":
          e.preventDefault();
          setIsPlaying(!isPlaying);
          break;
        case "ArrowLeft":
          e.preventDefault();
          scrubTo(Math.max(0, currentTime - (e.shiftKey ? 1 : 0.1)));
          break;
        case "ArrowRight":
          e.preventDefault();
          scrubTo(Math.min(totalDuration, currentTime + (e.shiftKey ? 1 : 0.1)));
          break;
        case "Home":
          scrubTo(0);
          break;
        case "End":
          scrubTo(totalDuration);
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isPlaying, currentTime, totalDuration, scrubTo, setIsPlaying]);

  const goToStart = () => { setIsPlaying(false); scrubTo(0); };
  const goToEnd = () => { setIsPlaying(false); scrubTo(totalDuration); };

  return (
    <div className="h-14 bg-gray-950 border-t border-white/8 flex items-center gap-0 select-none">
      {/* Transport controls */}
      <div className="flex items-center gap-1 px-3 border-r border-white/8 h-full">
        <button
          onClick={goToStart}
          className="p-1.5 rounded hover:bg-white/8 text-white/40 hover:text-white/70 transition-colors"
          title="Go to start (Home)"
        >
          <SkipBack size={13} />
        </button>

        <button
          onClick={() => setIsPlaying(!isPlaying)}
          disabled={keyframes.length < 2}
          className={`p-2 rounded-full transition-all ${
            keyframes.length < 2
              ? "text-white/20 cursor-not-allowed"
              : isPlaying
              ? "bg-white/15 text-white hover:bg-white/20"
              : "bg-blue-600 hover:bg-blue-500 text-white"
          }`}
          title="Play / Pause (Space)"
        >
          {isPlaying ? <Pause size={14} /> : <Play size={14} />}
        </button>

        <button
          onClick={goToEnd}
          className="p-1.5 rounded hover:bg-white/8 text-white/40 hover:text-white/70 transition-colors"
          title="Go to end (End)"
        >
          <SkipForward size={13} />
        </button>

        {/* Time display */}
        <span className="ml-1 text-[11px] font-mono tabular-nums text-white/50 min-w-[64px]">
          {currentTime.toFixed(2)}s
        </span>
      </div>

      {/* Track area */}
      <div
        ref={trackRef}
        onMouseDown={handleMouseDown}
        className="relative flex-1 h-full cursor-col-resize overflow-hidden"
      >
        {/* Ruler */}
        {totalDuration > 0 && <Ruler duration={totalDuration} />}

        {/* Track background */}
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-2 rounded-full bg-white/6 mx-2" />

        {/* Progress fill */}
        <div
          className="absolute top-1/2 -translate-y-1/2 h-2 rounded-full bg-blue-600/30 ml-2"
          style={{ width: `calc(${playheadPct * 100}% - 8px)` }}
        />

        {/* Keyframe segments */}
        {sortedKfs.length >= 2 &&
          sortedKfs.slice(0, -1).map((kf, i) => (
            <Segment
              key={kf.id}
              fromPct={kf.time / totalDuration}
              toPct={sortedKfs[i + 1].time / totalDuration}
            />
          ))}

        {/* Keyframe diamonds */}
        {sortedKfs.map((kf) => (
          <KeyframeDiamond
            key={kf.id}
            pct={kf.time / totalDuration}
            isSelected={kf.id === selectedKeyframeId}
            label={kf.label}
            onClick={() => {
              selectKeyframe(kf.id);
              scrubTo(kf.time);
            }}
          />
        ))}

        {/* Playhead */}
        {totalDuration > 0 && <Playhead pct={playheadPct} />}
      </div>

      {/* Duration badge */}
      <div className="px-3 border-l border-white/8 h-full flex items-center">
        <span className="text-[10px] text-white/25 font-mono tabular-nums">
          {totalDuration.toFixed(0)}s
        </span>
      </div>
    </div>
  );
}

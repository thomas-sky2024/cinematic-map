import { useEffect, useRef, useCallback } from "react";
import maplibregl from "maplibre-gl";
import { useMapStore } from "../store/useMapStore";
import { MAP_STYLES } from "../types";
import { interpolateAt } from "../hooks/useTauri";

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const animFrameRef = useRef<number>(0);

  const {
    mapStyleId,
    keyframes,
    currentTime,
    isPlaying,
    fps,
    setMapRef,
    setCurrentTime,
    setIsPlaying,
    totalDuration,
  } = useMapStore();

  const style = MAP_STYLES.find((s) => s.id === mapStyleId) ?? MAP_STYLES[0];

  // Init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: style.url,
      center: [108.05, 12.66], // Buôn Ma Thuột default
      zoom: 5,
      pitch: 0,
      bearing: 0,
      antialias: true,
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("load", () => {
      mapRef.current = map;
      setMapRef(map as any);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      setMapRef(null);
    };
  }, []); // only once

  // Update style when changed
  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.setStyle(style.url);
  }, [style.url]);

  // Playback loop
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
        const nextTime = currentTime + elapsed / 1000;

        if (nextTime >= totalDuration) {
          setCurrentTime(totalDuration);
          setIsPlaying(false);
          return;
        }

        setCurrentTime(nextTime);

        // Move map to interpolated position
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
  }, [isPlaying, currentTime, keyframes, fps, totalDuration]);

  // Scrub to a time position (on timeline drag, not playing)
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

  // Jump to specific keyframe
  const jumpToKeyframe = useCallback((kfIndex: number) => {
    const kf = keyframes[kfIndex];
    if (!kf || !mapRef.current) return;
    mapRef.current.flyTo({
      center: [kf.lng, kf.lat],
      zoom: kf.zoom,
      pitch: kf.pitch,
      bearing: kf.bearing,
      duration: 800,
    });
    setCurrentTime(kf.time);
  }, [keyframes]);

  return (
    <div className="relative flex-1 overflow-hidden bg-gray-950">
      {/* Map canvas */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* Overlay: current time badge */}
      <div className="absolute top-3 left-3 px-2.5 py-1 rounded-md bg-black/60 backdrop-blur-sm text-white text-xs font-mono tabular-nums">
        {currentTime.toFixed(1)}s / {totalDuration.toFixed(1)}s
      </div>

      {/* Overlay: no keyframes hint */}
      {keyframes.length === 0 && (
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

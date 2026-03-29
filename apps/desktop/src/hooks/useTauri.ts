import { invoke } from "@tauri-apps/api/core";
import { useMapStore } from "../store/useMapStore";
import { Keyframe, FrameCamera } from "../types";

/**
 * Calls Rust's compute_frames command.
 * Returns all interpolated camera positions for every frame.
 */
export async function computeFrames(
  keyframes: Keyframe[],
  fps: number
): Promise<FrameCamera[]> {
  if (keyframes.length < 2) return [];

  const { setIsComputing, setComputedFrames } = useMapStore.getState();
  setIsComputing(true);

  try {
    // Tauri auto-serializes to/from JSON matching Rust structs
    const frames = await invoke<FrameCamera[]>("cmd_compute_frames", {
      keyframes,
      fps,
    });
    setComputedFrames(frames);
    return frames;
  } catch (err) {
    console.error("Rust compute_frames failed:", err);
    return [];
  } finally {
    setIsComputing(false);
  }
}

/**
 * Calls Rust's interpolate_at for a single point in time.
 * Used for scrubbing timeline preview — fast, no bulk computation.
 */
export async function interpolateAt(
  keyframes: Keyframe[],
  time: number
): Promise<FrameCamera | null> {
  if (keyframes.length < 2) return null;

  try {
    return await invoke<FrameCamera | null>("cmd_interpolate_at", {
      keyframes,
      time,
    });
  } catch {
    return null;
  }
}

/** Check if running inside Tauri (desktop) vs browser */
export const isTauri = (): boolean => {
  return typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in window;
};

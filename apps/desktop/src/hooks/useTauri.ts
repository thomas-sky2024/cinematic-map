import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useMapStore } from "../store/useMapStore";
import { Keyframe, FrameCamera, RenderStatus } from "../types";
import { getStyleUrl } from "../types";

/**
 * Compute all interpolated frame cameras (Rust).
 */
export async function computeFrames(
  keyframes: Keyframe[],
  fps: number
): Promise<FrameCamera[]> {
  if (keyframes.length < 2) return [];
  const { setIsComputing, setComputedFrames } = useMapStore.getState();
  setIsComputing(true);
  try {
    const frames = await invoke<FrameCamera[]>("cmd_compute_frames", { keyframes, fps });
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
 * Interpolate a single time point (Rust) — used for live scrubbing.
 */
export async function interpolateAt(
  keyframes: Keyframe[],
  time: number
): Promise<FrameCamera | null> {
  if (keyframes.length < 2) return null;
  try {
    return await invoke<FrameCamera | null>("cmd_interpolate_at", { keyframes, time });
  } catch {
    return null;
  }
}

/**
 * Validate a MapTiler API key format (Rust).
 */
export async function validateToken(token: string): Promise<boolean> {
  try {
    return await invoke<boolean>("cmd_validate_token", { token });
  } catch {
    return token.trim().length >= 16; // fallback
  }
}

/**
 * Start the full render pipeline (Rust → Remotion renderer).
 * Subscribes to render-progress events and updates store.
 */
export async function startRender(
  keyframes: Keyframe[],
  fps: number,
  resolution: "1080p" | "4K",
  outputPath: string
): Promise<void> {
  const { 
    setRenderStatus, mapStyleId, mapToken, 
    renderCodec, renderBitrate, annotations, terrainEnabled 
  } = useMapStore.getState();

  setRenderStatus({ stage: "computing", encoded: 0, total: 0, fps: 0 });

  const unlisten = await listen<RenderStatus>("render-progress", (event) => {
    setRenderStatus(event.payload);
  });

  try {
    await invoke("cmd_start_render", {
      keyframes,
      fps,
      resolution,
      codec: renderCodec,
      bitrate: renderBitrate,
      outputPath,
      styleId: mapStyleId,
      mapToken,
      annotations,
      terrainEnabled,
    });
  } catch (err: any) {
    setRenderStatus({
      stage: "error",
      encoded: 0,
      total: 0,
      fps: 0,
      error: String(err),
    });
    console.error("Render failed:", err);
  } finally {
    unlisten();
  }
}

/** True when running inside Tauri desktop */
export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

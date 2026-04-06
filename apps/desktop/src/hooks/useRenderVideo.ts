import { useState, useCallback, useMemo } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { useMapStore } from "../store/useMapStore";
import { startRender, isTauri } from "./useTauri";

export function useRenderVideo() {
  const {
    keyframes, fps, renderResolution, renderStatus, totalDuration,
    renderCodec, renderBitrate,
    setShowRenderPanel, setRenderStatus,
  } = useMapStore();

  const [outputPath, setOutputPath] = useState("");

  const isRunning = useMemo(() => 
    renderStatus !== null &&
    renderStatus.stage !== "idle" &&
    renderStatus.stage !== "done" &&
    renderStatus.stage !== "error"
  , [renderStatus]);

  const actualTotalDuration = useMemo(() => 
    keyframes.length > 0 ? Math.max(...keyframes.map(k => k.time)) : totalDuration
  , [keyframes, totalDuration]);

  const canRender = useMemo(() => 
    keyframes.length >= 2 && !isRunning && outputPath.trim().length > 0
  , [keyframes, isRunning, outputPath]);

  const handleSelectPath = useCallback(async () => {
    try {
      const ext = renderCodec === "prores" ? "mov" : "mp4";
      const selected = await save({
        filters: [{ name: "Video", extensions: [ext] }],
        defaultPath: `cinematic-output.${ext}`
      });
      if (selected) {
        setOutputPath(selected as string);
      }
    } catch (e) {
      console.error("Failed to select save path:", e);
    }
  }, [renderCodec]);

  const handleRender = useCallback(async () => {
    if (!canRender) return;

    if (!isTauri()) {
      setRenderStatus({
        stage: "error",
        encoded: 0,
        total: 0,
        fps: 0,
        error: "Rendering requires the Tauri desktop build. Run `pnpm tauri dev` or `pnpm tauri build` to use this feature.",
      });
      return;
    }

    await startRender(keyframes, fps, renderResolution, outputPath);
  }, [keyframes, fps, renderResolution, outputPath, canRender, setRenderStatus]);

  const handleClose = useCallback(() => {
    if (!isRunning) {
      setShowRenderPanel(false);
      setRenderStatus(null);
    }
  }, [isRunning, setShowRenderPanel, setRenderStatus]);

  const resetStatus = useCallback(() => {
    setRenderStatus(null);
  }, [setRenderStatus]);

  return {
    isRunning,
    canRender,
    outputPath,
    handleRender,
    handleSelectPath,
    handleClose,
    resetStatus,
    actualTotalDuration,
    renderStatus,
    keyframesCount: keyframes.length
  };
}

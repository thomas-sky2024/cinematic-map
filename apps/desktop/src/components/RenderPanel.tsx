/**
 * RenderPanel.tsx
 * Refactored using Frontend Patterns: decomposed into useRenderVideo hook and sub-components.
 */

import { X, Film, RefreshCw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useRenderVideo } from "../hooks/useRenderVideo";
import { RenderOptions } from "./render/RenderOptions";
import { RenderStatusView } from "./render/RenderStatusView";
import { useMapStore } from "../store/useMapStore";

export function RenderPanel() {
  const {
    isRunning, canRender, outputPath, renderStatus, keyframesCount,
    handleRender, handleSelectPath, handleClose, resetStatus,
    actualTotalDuration,
  } = useRenderVideo();

  const { fps, showRenderPanel } = useMapStore();
  const stage = renderStatus?.stage ?? "idle";

  return (
    <AnimatePresence>
      {showRenderPanel && (
        <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
          {/* Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="relative bg-[#0d1117] border border-white/10 rounded-[2rem] p-8 w-[540px] shadow-[0_0_50px_rgba(0,0,0,0.5)] max-h-[95vh] overflow-y-auto overflow-hidden"
          >
            {/* Glossy Header Glow */}
            <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-blue-500/10 to-transparent pointer-events-none" />

            {/* Header */}
            <div className="flex items-center justify-between mb-8 relative">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-500/10 rounded-xl border border-blue-500/20">
                    <Film size={20} className="text-blue-400" />
                </div>
                <div>
                    <h2 className="text-white font-black text-xl tracking-tight">Export Visuals</h2>
                    <p className="text-[10px] text-white/30 uppercase font-bold tracking-widest leading-none mt-0.5">
                        Remotion Render Engine
                    </p>
                </div>
              </div>
              <button
                onClick={handleClose}
                disabled={isRunning}
                className="p-2 rounded-full text-white/20 hover:text-white/80 hover:bg-white/5 transition-all disabled:opacity-0"
              >
                <X size={18} />
              </button>
            </div>

            {/* Config Mode */}
            {!isRunning && stage !== "done" && (
              <RenderOptions
                handleSelectPath={handleSelectPath}
                outputPath={outputPath}
                totalDuration={actualTotalDuration}
              />
            )}

            {/* Status / Progress Mode */}
            {(isRunning || stage === "done" || stage === "error") && (
              <RenderStatusView
                status={renderStatus}
                isRunning={isRunning}
                totalDuration={actualTotalDuration}
                fps={fps}
              />
            )}

            {/* Footer Actions */}
            <div className="flex gap-3 justify-end mt-10 relative">
              {(stage === "done" || stage === "error") && (
                <button
                  onClick={resetStatus}
                  className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-white/5 hover:bg-white/10 text-white/60 hover:text-white text-sm font-bold transition-all border border-white/5"
                >
                  <RefreshCw size={14} className="opacity-50" /> Reset
                </button>
              )}

              {!isRunning && stage !== "done" && (
                <button
                  onClick={handleClose}
                  className="px-6 py-3 rounded-2xl border border-white/5 text-white/40 hover:text-white/60 text-sm font-bold transition-all hover:bg-white/2"
                >
                  Cancel
                </button>
              )}

              {!isRunning && stage !== "done" && (
                <button
                  onClick={handleRender}
                  disabled={!canRender}
                  className="group px-8 py-3 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 hover:from-blue-500 hover:to-indigo-600 text-white text-sm font-black transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-3 shadow-[0_10px_20px_rgba(37,99,235,0.3)] hover:shadow-[0_15px_30px_rgba(37,99,235,0.4)] disabled:shadow-none"
                >
                  <Film size={16} className="group-hover:scale-110 transition-transform" />
                  Generate Video
                </button>
              )}

              {stage === "done" && (
                <button
                  onClick={handleClose}
                  className="px-8 py-3 rounded-2xl bg-gradient-to-br from-green-600 to-emerald-700 hover:from-green-500 hover:to-emerald-600 text-white text-sm font-black transition-all shadow-[0_10px_20px_rgba(16,185,129,0.3)]"
                >
                  Mission Complete
                </button>
              )}
            </div>
            
            {/* Warning if too few keyframes */}
            {!isRunning && stage !== "done" && keyframesCount < 2 && (
                <p className="text-center text-[10px] text-yellow-500/60 font-bold uppercase mt-4 tracking-tighter">
                    Need at least 2 keyframes to start animation
                </p>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

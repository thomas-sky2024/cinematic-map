import { RenderStatus } from "../../types";
import { Loader, CheckCircle, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface RenderStatusViewProps {
  status: RenderStatus | null;
  isRunning: boolean;
  totalDuration: number;
  fps: number;
}

const STAGE_LABEL: Record<string, string> = {
  idle:       "Ready to render",
  computing:  "Computing interpolated frames…",
  bundling:   "Bundling scene assets…",
  capturing:  "Capturing frames with Remotion…",
  encoding:   "Encoding video output…",
  done:       "Render complete ✓",
  error:      "Render error",
};

export function RenderStatusView({ status, isRunning, totalDuration, fps }: RenderStatusViewProps) {
  const stage = status?.stage ?? "idle";
  const encoded = status?.encoded ?? 0;
  const total = status?.total ?? Math.ceil(totalDuration * fps);
  const rfps = status?.fps ?? 0;
  const errMsg = status?.error;

  const pct = total > 0 ? Math.min(100, (encoded / total) * 100) : 0;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="space-y-6"
    >
      <div className="flex items-center gap-4 bg-white/5 border border-white/8 rounded-2xl p-5 shadow-2xl relative overflow-hidden">
        {/* Animated Background Progress */}
        {isRunning && (
            <motion.div
                className="absolute inset-0 bg-blue-500/5"
                initial={{ x: "-100%" }}
                animate={{ x: `${pct - 100}%` }}
                transition={{ type: "spring", damping: 30, stiffness: 50 }}
            />
        )}

        <div className="relative">
            {isRunning && (
                <div className="w-10 h-10 rounded-full border-2 border-blue-500/20 border-t-blue-500 animate-spin flex items-center justify-center" />
            )}
            {stage === "done" && (
                <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center text-green-400">
                    <CheckCircle size={20} />
                </div>
            )}
            {stage === "error" && (
                <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center text-red-400">
                    <AlertCircle size={20} />
                </div>
            )}
            {stage === "idle" && (
                <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-white/20">
                    <Loader size={20} />
                </div>
            )}
        </div>

        <div className="flex-1 space-y-1 relative">
          <h3 className={`text-sm font-bold uppercase tracking-wider ${
                stage === "done" ? "text-green-400" :
                stage === "error" ? "text-red-400" :
                "text-white/80"
          }`}>
            {STAGE_LABEL[stage] ?? stage}
          </h3>
          <p className="text-[10px] text-white/30 font-medium tracking-tight">
            Remotion Pipeline v3.1.0
          </p>
        </div>

        {isRunning && (
           <div className="text-right space-y-0.5 relative">
             <span className="text-lg font-mono font-black text-white/90">{Math.round(pct)}%</span>
             <div className="text-[9px] text-white/30 uppercase font-black tabular-nums">
                {rfps > 0 ? `${rfps.toFixed(1)} FPS` : "WAITING"}
             </div>
           </div>
        )}
      </div>

      <AnimatePresence mode="wait">
        {isRunning && total > 0 && (
          <motion.div
            key="progress-bar"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-2 px-1"
          >
             <div className="h-1.5 w-full bg-black/40 rounded-full overflow-hidden border border-white/5">
                <motion.div
                    className="h-full bg-gradient-to-r from-blue-600 to-cyan-400 shadow-[0_0_15px_rgba(37,99,235,0.4)]"
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ type: "spring", damping: 25, stiffness: 100 }}
                />
             </div>
             <div className="flex justify-between text-[10px] font-mono font-bold text-white/20 tabular-nums uppercase">
                <span>Rendering Segment</span>
                <span>{encoded} / {total} frames</span>
             </div>
          </motion.div>
        )}

        {stage === "error" && errMsg && (
          <motion.div
            key="error-box"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-red-500/5 border border-red-500/20 rounded-xl p-4 space-y-2 shadow-inner"
          >
            <div className="flex items-center gap-2 text-red-400">
                <AlertCircle size={14} />
                <span className="text-[10px] font-black uppercase tracking-widest">Error Details</span>
            </div>
            <p className="text-red-300/80 text-[11px] font-mono leading-relaxed bg-black/20 p-2 rounded-lg border border-red-500/10">
                {errMsg}
            </p>
          </motion.div>
        )}

        {stage === "done" && status?.outputPath && (
           <motion.div
             key="done-box"
             initial={{ opacity: 0, y: 10 }}
             animate={{ opacity: 1, y: 0 }}
             className="bg-green-500/5 border border-green-500/20 rounded-xl p-4 space-y-2"
           >
              <div className="flex items-center gap-2 text-green-400">
                  <CheckCircle size={14} />
                  <span className="text-[10px] font-black uppercase tracking-widest">Output Ready</span>
              </div>
              <p className="text-green-300/80 text-[11px] font-mono leading-relaxed bg-black/20 p-2 rounded-lg border border-green-500/10 select-all truncate">
                {status.outputPath}
              </p>
           </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/**
 * RenderPanel.tsx
 * Render modal: configures & launches the Swift VideoToolbox encode pipeline.
 *
 * Handles the "encoder not built" case gracefully with a clear setup guide.
 */

import { useState, useCallback } from "react";
import { X, Film, Loader, CheckCircle, AlertCircle, Terminal, RefreshCw, Search, FolderOpen } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { useMapStore } from "../store/useMapStore";
import { startRender, isTauri } from "../hooks/useTauri";

const STAGE_LABEL: Record<string, string> = {
  idle:       "Ready to render",
  computing:  "Computing interpolated frames…",
  capturing:  "Capturing frames via WKWebView…",
  encoding:   "Encoding HEVC with VideoToolbox…",
  postprocess:"Applying Metal post-process…",
  done:       "Render complete ✓",
  error:      "Render error",
};

function isEncoderMissing(err?: string): boolean {
  return !!err && (
    err.includes("No such file") ||
    err.includes("os error 2") ||
    err.includes("not found") ||
    err.toLowerCase().includes("encoder")
  );
}

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="w-full h-2 bg-white/8 rounded-full overflow-hidden">
      <div
        className="h-full bg-blue-500 rounded-full transition-all duration-200"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ── "Build the encoder first" helper card ─────────────────────────────────

type DiagInfo = {
  exe: string;
  cwd: string;
  resource_dir: string;
  resolved_encoder: string;
  encoder_exists: boolean;
};

function EncoderSetupGuide() {
  const [copied, setCopied]         = useState(false);
  const [diagInfo, setDiagInfo]     = useState<DiagInfo | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const buildCmd  = "cd packages/swift-encoder && swift build -c release";
  const scriptCmd = "./scripts/build-encoder.sh";

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const diagnose = async () => {
    setDiagLoading(true);
    try {
      const info = await invoke<DiagInfo>("cmd_debug_paths");
      setDiagInfo(info);
    } catch (e) {
      setDiagInfo(null);
      console.error("diagnose failed", e);
    } finally {
      setDiagLoading(false);
    }
  };

  return (
    <div className="mt-4 bg-amber-500/8 border border-amber-500/25 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-amber-400">
          <Terminal size={14} />
          <span className="text-sm font-semibold">Swift encoder not built (or not found)</span>
        </div>
        <button
          onClick={diagnose}
          disabled={diagLoading}
          className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-white/15 text-white/40 hover:text-white/70 transition-colors disabled:opacity-50"
          title="Show where Rust is looking for the encoder"
        >
          <Search size={10} />
          {diagLoading ? "Checking…" : "Diagnose"}
        </button>
      </div>

      {/* Diagnose result */}
      {diagInfo && (
        <div className="bg-black/40 rounded-lg p-3 space-y-1.5 text-[10px] font-mono">
          <div className={`flex gap-2 ${diagInfo.encoder_exists ? "text-green-400" : "text-red-400"}`}>
            <span>{diagInfo.encoder_exists ? "✓" : "✗"}</span>
            <span className="break-all">{diagInfo.resolved_encoder}</span>
          </div>
          <div className="text-white/30 break-all">cwd: {diagInfo.cwd}</div>
          <div className="text-white/30 break-all">exe: {diagInfo.exe}</div>
          {!diagInfo.encoder_exists && (
            <div className="text-amber-400/80 pt-1">
              Binary missing at the path above. Build it with the command below, then restart the app.
            </div>
          )}
          {diagInfo.encoder_exists && (
            <div className="text-green-400/80 pt-1">
              Binary exists! If render still fails, try restarting the app — Tauri may have cached the old path.
            </div>
          )}
        </div>
      )}

      <p className="text-white/55 text-xs leading-relaxed">
        The render pipeline requires the Swift encoder binary.
        Build it once from the <strong className="text-white/70">repo root</strong>:
      </p>

      {/* Option A: script */}
      <div>
        <p className="text-[10px] text-white/30 mb-1">Option A — helper script (recommended)</p>
        <div className="flex items-center gap-2 bg-black/40 rounded-lg px-3 py-2">
          <code className="flex-1 text-xs text-green-300/80 font-mono">{scriptCmd}</code>
          <button onClick={() => copy(scriptCmd)} className="text-[10px] px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white/50 hover:text-white transition-colors flex-shrink-0">
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>

      {/* Option B: manual */}
      <div>
        <p className="text-[10px] text-white/30 mb-1">Option B — manual</p>
        <div className="flex items-center gap-2 bg-black/40 rounded-lg px-3 py-2">
          <code className="flex-1 text-xs text-amber-300/80 font-mono">{buildCmd}</code>
          <button onClick={() => copy(buildCmd)} className="text-[10px] px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white/50 hover:text-white transition-colors flex-shrink-0">
            Copy
          </button>
        </div>
      </div>

      <p className="text-white/35 text-[11px]">
        Expected binary:{" "}
        <code className="text-white/50 font-mono text-[10px]">
          packages/swift-encoder/.build/release/map-capture
        </code>
      </p>

      <p className="text-white/25 text-[10px]">
        After building, <strong className="text-white/40">restart the app</strong> — then click Start Render again.
        Requires macOS 13+, Xcode CLT, Swift 5.9+.
      </p>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────

export function RenderPanel() {
  const {
    keyframes, fps, renderResolution, renderStatus, totalDuration,
    setShowRenderPanel, setRenderStatus, setRenderResolution, setFps,
  } = useMapStore();

  const [outputPath, setOutputPath] = useState("");

  const isRunning =
    renderStatus !== null &&
    renderStatus.stage !== "idle" &&
    renderStatus.stage !== "done" &&
    renderStatus.stage !== "error";

  const handleSelectPath = async () => {
    try {
      const selected = await save({
        filters: [{ name: "Video", extensions: ["mp4"] }],
        defaultPath: "cinematic-output.mp4"
      });
      if (selected) {
        setOutputPath(selected as string);
      }
    } catch (e) {
      console.error("Failed to select save path:", e);
    }
  };

  const actualTotalDuration = keyframes.length > 0 ? Math.max(...keyframes.map(k => k.time)) : totalDuration;
  const canRender = keyframes.length >= 2 && !isRunning && outputPath.trim().length > 0;

  const handleRender = useCallback(async () => {
    if (!canRender) return;

    if (!isTauri()) {
      // Show a polite browser-mode message instead of erroring
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

  const handleClose = () => {
    if (!isRunning) {
      setShowRenderPanel(false);
      setRenderStatus(null);
    }
  };

  const stage    = renderStatus?.stage ?? "idle";
  const encoded  = renderStatus?.encoded ?? 0;
  const total    = renderStatus?.total ?? Math.ceil(actualTotalDuration * fps);
  const rfps     = renderStatus?.fps ?? 0;
  const errMsg   = renderStatus?.error;
  const showEncoderGuide = stage === "error" && isEncoderMissing(errMsg);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-white/12 rounded-2xl p-6 w-[500px] shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Film size={16} className="text-blue-400" />
            <h2 className="text-white font-semibold">Render Video</h2>
          </div>
          <button
            onClick={handleClose}
            disabled={isRunning}
            className="p-1.5 rounded-lg text-white/40 hover:text-white/70 hover:bg-white/8 transition-colors disabled:opacity-30"
          >
            <X size={14} />
          </button>
        </div>

        {/* Config (shown when idle or after reset) */}
        {!isRunning && stage !== "done" && (
          <div className="space-y-3 mb-5">
            {/* Resolution */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-white/60">Resolution</span>
              <div className="flex gap-1.5">
                {(["1080p", "4K"] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setRenderResolution(r)}
                    className={`px-3 py-1 rounded-lg border text-xs font-medium transition-colors ${
                      renderResolution === r
                        ? "border-blue-500/60 bg-blue-500/15 text-blue-300"
                        : "border-white/12 text-white/40 hover:text-white/60"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            {/* FPS */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-white/60">Frame rate</span>
              <div className="flex gap-1.5">
                {([30, 60] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFps(f)}
                    className={`px-3 py-1 rounded-lg border text-xs font-medium transition-colors ${
                      fps === f
                        ? "border-blue-500/60 bg-blue-500/15 text-blue-300"
                        : "border-white/12 text-white/40 hover:text-white/60"
                    }`}
                  >
                    {f} fps
                  </button>
                ))}
              </div>
            </div>

            {/* Total frames */}
            <div className="flex items-center justify-between text-xs text-white/40">
              <span>Total frames</span>
              <span className="font-mono">{Math.ceil(actualTotalDuration * fps)}</span>
            </div>

            {/* Output path */}
            <div>
              <label className="text-xs text-white/40 block mb-1.5">Output destination</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={outputPath}
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white/70 font-mono outline-none cursor-not-allowed opacity-75"
                  placeholder="Select a folder to save to..."
                />
                <button
                  onClick={handleSelectPath}
                  className="px-3 py-1.5 rounded-lg border border-white/12 text-white/60 hover:text-white/90 hover:border-white/20 bg-white/5 transition-colors flex-shrink-0 flex items-center gap-1.5 text-xs"
                >
                  <FolderOpen size={14} />
                  Choose
                </button>
              </div>
              <p className="text-[10px] text-white/20 mt-1">
                HEVC .mp4 · M1 VideoToolbox hardware encode · Metal post-process
              </p>
            </div>
          </div>
        )}

        {/* Progress section */}
        {(isRunning || stage === "done" || stage === "error") && (
          <div className="mb-5 space-y-3">
            <div className="flex items-center gap-2">
              {isRunning && <Loader size={14} className="text-blue-400 animate-spin flex-shrink-0" />}
              {stage === "done"  && <CheckCircle size={14} className="text-green-400 flex-shrink-0" />}
              {stage === "error" && <AlertCircle size={14} className="text-red-400 flex-shrink-0" />}
              <span className={`text-sm font-medium ${
                stage === "done"  ? "text-green-400" :
                stage === "error" ? "text-red-400" :
                "text-white/80"
              }`}>
                {STAGE_LABEL[stage] ?? stage}
              </span>
            </div>

            {isRunning && total > 0 && (
              <>
                <ProgressBar value={encoded} max={total} />
                <div className="flex justify-between text-[11px] text-white/35 font-mono">
                  <span>{encoded} / {total} frames</span>
                  <span>{rfps > 0 ? `${rfps.toFixed(1)} fps` : "—"}</span>
                </div>
              </>
            )}

            {/* Error: missing encoder → show setup guide */}
            {stage === "error" && showEncoderGuide && <EncoderSetupGuide />}

            {/* Error: other */}
            {stage === "error" && !showEncoderGuide && errMsg && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                <p className="text-red-400 text-xs font-mono break-all leading-relaxed">{errMsg}</p>
              </div>
            )}

            {/* Done */}
            {stage === "done" && renderStatus?.outputPath && (
              <div className="bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2">
                <p className="text-green-400/70 text-[10px] mb-0.5">Saved to</p>
                <p className="text-green-300 text-xs font-mono break-all">{renderStatus.outputPath}</p>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 justify-end">
          {(stage === "done" || stage === "error") && (
            <button
              onClick={() => setRenderStatus(null)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/8 hover:bg-white/12 text-white/60 hover:text-white text-sm transition-colors"
            >
              <RefreshCw size={13} /> Reset
            </button>
          )}

          {!isRunning && stage !== "done" && (
            <button
              onClick={handleClose}
              className="px-4 py-2 rounded-xl border border-white/10 text-white/50 hover:text-white/70 text-sm transition-colors"
            >
              Cancel
            </button>
          )}

          {!isRunning && stage !== "done" && (
            <button
              onClick={handleRender}
              disabled={!canRender}
              className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <Film size={13} /> Start Render
            </button>
          )}

          {stage === "done" && (
            <button
              onClick={handleClose}
              className="px-4 py-2 rounded-xl bg-green-600 hover:bg-green-500 text-white text-sm font-medium transition-colors"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

import { useMapStore } from "../../store/useMapStore";
import { FolderOpen } from "lucide-react";
import { motion } from "framer-motion";

interface RenderOptionsProps {
  handleSelectPath: () => Promise<void>;
  outputPath: string;
  totalDuration: number;
}

export function RenderOptions({ handleSelectPath, outputPath, totalDuration }: RenderOptionsProps) {
  const {
    fps, renderResolution, renderCodec, renderBitrate,
    setRenderResolution, setFps, setRenderCodec, setRenderBitrate,
  } = useMapStore();

  const totalFrames = Math.ceil(totalDuration * fps);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4 mb-6"
    >
      {/* Configuration Group */}
      <div className="bg-white/5 border border-white/8 rounded-xl p-4 space-y-4">
        {/* Resolution */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-white/50">Resolution</span>
          <div className="flex bg-black/30 p-1 rounded-lg">
            {(["1080p", "4K"] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRenderResolution(r)}
                className={`px-4 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  renderResolution === r
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20"
                    : "text-white/40 hover:text-white/70"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {/* FPS */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-white/50">Frame rate</span>
          <div className="flex bg-black/30 p-1 rounded-lg">
            {([30, 60] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFps(f)}
                className={`px-4 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  fps === f
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20"
                    : "text-white/40 hover:text-white/70"
                }`}
              >
                {f} fps
              </button>
            ))}
          </div>
        </div>

        {/* Codec */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-white/50">Video Codec</span>
          <div className="flex bg-black/30 p-1 rounded-lg">
            {(["h265", "prores"] as const).map((c) => (
              <button
                key={c}
                onClick={() => setRenderCodec(c)}
                className={`px-4 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  renderCodec === c
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20"
                    : "text-white/40 hover:text-white/70"
                }`}
              >
                {c === "h265" ? "HEVC" : "ProRes"}
              </button>
            ))}
          </div>
        </div>

        {/* Bitrate (H265 only) */}
        {renderCodec === "h265" && (
          <div className="pt-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-white/40">Target Bitrate</span>
              <span className="text-xs text-blue-400 font-mono font-bold">{renderBitrate} Mbps</span>
            </div>
            <input
              type="range"
              min={10} max={100} step={5}
              value={renderBitrate}
              onChange={(e) => setRenderBitrate(Number(e.target.value))}
              className="w-full h-1.5 bg-black/50 rounded-full appearance-none cursor-pointer accent-blue-500"
            />
          </div>
        )}
      </div>

      {/* Info Section */}
      <div className="flex items-center justify-between px-2 text-[10px] text-white/30 uppercase tracking-widest font-bold">
        <span>Total Frames</span>
        <span className="font-mono text-white/50">{totalFrames}</span>
      </div>

      {/* Output Selection */}
      <div className="space-y-2">
        <label className="text-xs text-white/40 block ml-1">Destination</label>
        <div className="flex gap-2 group">
          <div className="relative flex-1">
            <input
              type="text"
              readOnly
              value={outputPath}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white/60 font-mono outline-none group-hover:border-white/20 transition-colors truncate"
              placeholder="Select output file path..."
            />
          </div>
          <button
            onClick={handleSelectPath}
            className="px-4 py-2.5 rounded-xl bg-white/8 hover:bg-black text-white/70 hover:text-white border border-white/10 hover:border-blue-500/50 transition-all flex-shrink-0 flex items-center gap-2 text-xs font-semibold shadow-lg"
          >
            <FolderOpen size={14} className="text-blue-400" />
            Browse
          </button>
        </div>
      </div>
    </motion.div>
  );
}

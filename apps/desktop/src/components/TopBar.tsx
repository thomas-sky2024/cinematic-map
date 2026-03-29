import { useRef, useState } from "react";
import { Download, Upload, Key } from "lucide-react";
import { useMapStore } from "../store/useMapStore";

// ── Token modal ─────────────────────────────────────────────────────────────
function TokenModal({ onClose }: { onClose: () => void }) {
  const { mapToken, setMapToken } = useMapStore();
  const [draft, setDraft] = useState(mapToken);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-white/12 rounded-xl p-6 w-[420px] shadow-2xl">
        <h2 className="text-white font-medium mb-1">MapTiler API Key</h2>
        <p className="text-white/40 text-xs mb-4">
          Get a free key at{" "}
          <a
            href="https://cloud.maptiler.com"
            target="_blank"
            rel="noreferrer"
            className="text-blue-400 hover:underline"
          >
            cloud.maptiler.com
          </a>
          . Required for Satellite, Terrain, and 3D terrain tiles.
        </p>
        <input
          autoFocus
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Enter your MapTiler API key…"
          className="w-full bg-white/5 border border-white/12 rounded-lg px-3 py-2 text-white/80 text-sm font-mono outline-none focus:border-blue-500/60 placeholder:text-white/20"
        />
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-white/10 text-white/50 text-sm hover:text-white/70 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              setMapToken(draft.trim());
              onClose();
            }}
            className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
          >
            Save Key
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main TopBar ─────────────────────────────────────────────────────────────
export function TopBar() {
  const { keyframes, totalDuration, fps, mapToken, importConfig } = useMapStore();
  const [showToken, setShowToken] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  const exportConfig = () => {
    const config = {
      version: "1.0",
      exportedAt: new Date().toISOString(),
      fps,
      totalDuration,
      keyframes: keyframes.map(({ thumbnail, ...kf }) => kf),
    };
    const blob = new Blob([JSON.stringify(config, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cinematic-map-config.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      importConfig(text);
    };
    reader.readAsText(file);
    // Reset input so the same file can be re-imported
    e.target.value = "";
  };

  return (
    <>
      <header className="h-11 bg-gray-950 border-b border-white/8 flex items-center px-4 gap-3 flex-shrink-0">
        {/* Logo */}
        <div className="flex items-center gap-2 mr-2">
          <div className="w-5 h-5 rounded bg-blue-600 flex items-center justify-center">
            <span className="text-white text-[10px] font-bold">CM</span>
          </div>
          <span className="text-white/80 text-sm font-medium">Cinematic Map</span>
        </div>

        <div className="w-px h-4 bg-white/10" />

        <span className="text-white/30 text-xs">
          {keyframes.length} keyframes · {totalDuration}s · {fps}fps
        </span>

        <div className="flex-1" />

        {/* API Key */}
        <button
          onClick={() => setShowToken(true)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs transition-colors ${
            mapToken
              ? "border-green-500/30 text-green-400/70 hover:text-green-400"
              : "border-white/10 text-white/40 hover:text-white/70 hover:border-white/20"
          }`}
          title={mapToken ? "MapTiler API key is set" : "Add MapTiler API Key (required for Satellite & Terrain)"}
        >
          <Key size={11} />
          {mapToken ? "Key ✓" : "API Key"}
        </button>

        {/* Import JSON (Week 2) */}
        <button
          onClick={() => importRef.current?.click()}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-white/10 text-white/40 hover:text-white/70 hover:border-white/20 text-xs transition-colors"
          title="Import JSON config"
        >
          <Upload size={11} />
          Import
        </button>
        <input
          ref={importRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={handleImportFile}
        />

        {/* Export JSON */}
        <button
          onClick={exportConfig}
          disabled={keyframes.length === 0}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-white/10 text-white/40 hover:text-white/70 hover:border-white/20 text-xs transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title="Export JSON config"
        >
          <Download size={11} />
          Export
        </button>

        <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-green-500/10 border border-green-500/20">
          <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
          <span className="text-green-400 text-[10px]">Ready</span>
        </div>
      </header>

      {showToken && <TokenModal onClose={() => setShowToken(false)} />}
    </>
  );
}

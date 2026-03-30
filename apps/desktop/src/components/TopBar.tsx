import { useRef, useState } from "react";
import { Download, Upload, Key, Film, CheckCircle, XCircle } from "lucide-react";
import { useMapStore } from "../store/useMapStore";
import { isTauri, validateToken } from "../hooks/useTauri";

// ── Tauri dialog helpers ──────────────────────────────────────────────────

async function tauriSaveDialog(defaultName: string): Promise<string | null> {
  try {
    const { save } = await import("@tauri-apps/plugin-dialog");
    return await save({
      defaultPath: defaultName,
      filters: [{ name: "JSON config", extensions: ["json"] }],
    });
  } catch { return null; }
}

async function tauriOpenDialog(): Promise<string | null> {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const result = await open({
      multiple: false,
      filters: [{ name: "JSON config", extensions: ["json"] }],
    });
    return typeof result === "string" ? result : null;
  } catch { return null; }
}

async function tauriWriteFile(path: string, content: string): Promise<void> {
  const { writeTextFile } = await import("@tauri-apps/plugin-fs");
  await writeTextFile(path, content);
}

async function tauriReadFile(path: string): Promise<string> {
  const { readTextFile } = await import("@tauri-apps/plugin-fs");
  return readTextFile(path);
}

// ── Token modal (with validation feedback) ────────────────────────────────

function TokenModal({ onClose }: { onClose: () => void }) {
  const { mapToken, setMapToken } = useMapStore();
  const [draft, setDraft]   = useState(mapToken);
  const [state, setState]   = useState<"idle" | "checking" | "ok" | "bad">("idle");

  const handleSave = async () => {
    const t = draft.trim();
    if (!t) { setMapToken(""); onClose(); return; }

    setState("checking");
    const valid = await validateToken(t);
    if (valid) {
      setState("ok");
      setMapToken(t);
      setTimeout(onClose, 600);
    } else {
      setState("bad");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-white/12 rounded-xl p-6 w-[420px] shadow-2xl">
        <h2 className="text-white font-medium mb-1">MapTiler API Key</h2>
        <p className="text-white/40 text-xs mb-4">
          Get a free key at{" "}
          <a href="https://cloud.maptiler.com" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">
            cloud.maptiler.com
          </a>
          . Required for Satellite, Terrain, and 3D terrain tiles.
        </p>

        <div className="relative">
          <input
            autoFocus
            type="text"
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setState("idle"); }}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            placeholder="Enter your MapTiler API key…"
            className={`w-full bg-white/5 border rounded-lg px-3 py-2 text-white/80 text-sm font-mono outline-none placeholder:text-white/20 pr-9 transition-colors ${
              state === "ok"  ? "border-green-500/60" :
              state === "bad" ? "border-red-500/60"   :
              "border-white/12 focus:border-blue-500/60"
            }`}
          />
          {state === "ok"  && <CheckCircle size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-green-400" />}
          {state === "bad" && <XCircle     size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-red-400"   />}
        </div>

        {state === "bad" && (
          <p className="text-red-400 text-xs mt-1.5">
            Key appears invalid — should be 16+ alphanumeric characters.
          </p>
        )}

        <div className="flex items-center justify-between mt-4">
          {mapToken && (
            <button
              onClick={() => { setMapToken(""); onClose(); }}
              className="text-xs text-white/30 hover:text-red-400 transition-colors"
            >
              Clear key
            </button>
          )}
          <div className="flex gap-2 ml-auto">
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg border border-white/10 text-white/50 text-sm hover:text-white/70 transition-colors">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={state === "checking"}
              className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors disabled:opacity-60"
            >
              {state === "checking" ? "Checking…" : "Save Key"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main TopBar ─────────────────────────────────────────────────────────────

export function TopBar() {
  const { keyframes, annotations, totalDuration, fps, mapToken, importConfig, setShowRenderPanel } = useMapStore();
  const [showToken,   setShowToken]   = useState(false);
  const [importState, setImportState] = useState<"idle" | "ok" | "err">("idle");
  const [exportState, setExportState] = useState<"idle" | "ok" | "err">("idle");
  const fallbackImportRef = useRef<HTMLInputElement>(null);

  // ── Export ────────────────────────────────────────────────────────────────
  const exportConfig = async () => {
    const config = {
      version: "1.1",
      exportedAt: new Date().toISOString(),
      fps, totalDuration,
      keyframes: keyframes.map(({ thumbnail, ...kf }) => kf),
      annotations,
    };
    const json = JSON.stringify(config, null, 2);

    if (isTauri()) {
      const path = await tauriSaveDialog("cinematic-map-config.json");
      if (!path) return;
      try {
        await tauriWriteFile(path, json);
        flash(setExportState, "ok");
      } catch { flash(setExportState, "err"); }
    } else {
      const a = Object.assign(document.createElement("a"), {
        href: URL.createObjectURL(new Blob([json], { type: "application/json" })),
        download: "cinematic-map-config.json",
      });
      a.click();
      URL.revokeObjectURL(a.href);
      flash(setExportState, "ok");
    }
  };

  // ── Import ────────────────────────────────────────────────────────────────
  const handleImport = async () => {
    if (isTauri()) {
      const path = await tauriOpenDialog();
      if (!path) return;
      try {
        importConfig(await tauriReadFile(path));
        flash(setImportState, "ok");
      } catch { flash(setImportState, "err"); }
    } else {
      fallbackImportRef.current?.click();
    }
  };

  const handleFallbackFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { importConfig(ev.target?.result as string); flash(setImportState, "ok"); };
    reader.onerror = () => flash(setImportState, "err");
    reader.readAsText(file);
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
          {keyframes.length} keyframes · {annotations.length} annotations · {totalDuration}s · {fps}fps
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
          title={mapToken ? "MapTiler API key set" : "Add MapTiler API Key"}
        >
          <Key size={11} />
          {mapToken ? "Key ✓" : "API Key"}
        </button>

        {/* Import */}
        <button
          onClick={handleImport}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs transition-colors ${
            importState === "ok"  ? "border-green-500/40 text-green-400" :
            importState === "err" ? "border-red-500/40 text-red-400"     :
            "border-white/10 text-white/40 hover:text-white/70 hover:border-white/20"
          }`}
          title="Import JSON config"
        >
          <Upload size={11} />
          {importState === "ok" ? "Imported ✓" : importState === "err" ? "Error!" : "Import"}
        </button>
        <input ref={fallbackImportRef} type="file" accept=".json,application/json" className="hidden" onChange={handleFallbackFile} />

        {/* Export */}
        <button
          onClick={exportConfig}
          disabled={keyframes.length === 0}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
            exportState === "ok"  ? "border-green-500/40 text-green-400" :
            exportState === "err" ? "border-red-500/40 text-red-400"     :
            "border-white/10 text-white/40 hover:text-white/70 hover:border-white/20"
          }`}
          title="Export JSON config"
        >
          <Download size={11} />
          {exportState === "ok" ? "Saved ✓" : exportState === "err" ? "Error!" : "Export"}
        </button>

        {/* Render */}
        <button
          onClick={() => setShowRenderPanel(true)}
          disabled={keyframes.length < 2}
          className="flex items-center gap-1.5 px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title="Open render panel (need ≥2 keyframes)"
        >
          <Film size={11} />
          Render
        </button>

        <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-green-500/10 border border-green-500/20">
          <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          <span className="text-green-400 text-[10px]">Ready</span>
        </div>
      </header>

      {showToken && <TokenModal onClose={() => setShowToken(false)} />}
    </>
  );
}

function flash(
  setter: React.Dispatch<React.SetStateAction<"idle" | "ok" | "err">>,
  state: "ok" | "err"
) {
  setter(state);
  setTimeout(() => setter("idle"), 2500);
}

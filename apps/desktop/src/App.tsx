import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { TopBar } from "./components/TopBar";
import { KeyframePanel } from "./components/KeyframePanel";
import { MapView } from "./components/MapView";
import { CameraPanel } from "./components/CameraPanel";
import { AnnotationPanel } from "./components/AnnotationPanel";
import { Timeline } from "./components/Timeline";
import { RenderPanel } from "./components/RenderPanel";
import { useMapStore } from "./store/useMapStore";
import "maplibre-gl/dist/maplibre-gl.css";

// ── First-run API key nudge (dismissable, once per session) ───────────────

function ApiKeyNudge() {
  // Only show if not dismissed this session
  const [visible, setVisible] = useState(() => {
    return sessionStorage.getItem("cm-nudge-dismissed") !== "1";
  });

  if (!visible) return null;

  const dismiss = () => {
    sessionStorage.setItem("cm-nudge-dismissed", "1");
    setVisible(false);
  };

  return (
    <div className="fixed bottom-4 right-4 bg-gray-900 border border-white/12 rounded-xl px-4 py-3 shadow-xl max-w-xs z-40 flex gap-3 items-start">
      <div className="flex-1">
        <p className="text-white/80 text-sm font-medium mb-1">
          Add a MapTiler key for satellite tiles
        </p>
        <p className="text-white/40 text-xs">
          Click <span className="text-white/60">API Key</span> in the top bar. Free at{" "}
          <a
            href="https://cloud.maptiler.com"
            target="_blank"
            rel="noreferrer"
            className="text-blue-400 hover:underline"
          >
            cloud.maptiler.com
          </a>
          . The app works without one using OpenStreetMap tiles.
        </p>
      </div>
      <button
        onClick={dismiss}
        className="flex-shrink-0 p-1 rounded text-white/25 hover:text-white/60 hover:bg-white/8 transition-colors mt-0.5"
        title="Dismiss"
      >
        <X size={13} />
      </button>
    </div>
  );
}

// ── Root App ──────────────────────────────────────────────────────────────

export default function App() {
  const { mapToken, showRenderPanel } = useMapStore();

  useEffect(() => {
    document.body.style.background = "#030712";
    document.body.style.overflow = "hidden";
  }, []);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-gray-950 text-white">
      <TopBar />

      <div className="flex flex-1 overflow-hidden">
        {/* Left: Keyframe panel */}
        <KeyframePanel />

        {/* Center: Map + timeline */}
        <div className="flex flex-col flex-1 overflow-hidden">
          <MapView />
          <Timeline />
        </div>

        {/* Right: Camera + Annotation panels */}
        <div className="flex">
          <CameraPanel />
          <AnnotationPanel />
        </div>
      </div>

      {/* Render modal */}
      {showRenderPanel && <RenderPanel />}

      {/* First-run nudge — only when no token AND not dismissed */}
      {!mapToken && <ApiKeyNudge />}
    </div>
  );
}

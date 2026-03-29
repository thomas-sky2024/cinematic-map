import { useEffect } from "react";
import { TopBar } from "./components/TopBar";
import { KeyframePanel } from "./components/KeyframePanel";
import { MapView } from "./components/MapView";
import { CameraPanel } from "./components/CameraPanel";
import { Timeline } from "./components/Timeline";
import { useMapStore } from "./store/useMapStore";
import "maplibre-gl/dist/maplibre-gl.css";

export default function App() {
  const { mapToken } = useMapStore();

  // Apply dark background to entire app
  useEffect(() => {
    document.body.style.background = "#030712"; // gray-950
    document.body.style.overflow = "hidden";
  }, []);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-gray-950 text-white">
      {/* Top bar */}
      <TopBar />

      {/* Main editor area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Keyframe panel */}
        <KeyframePanel />

        {/* Center: Map + timeline stacked */}
        <div className="flex flex-col flex-1 overflow-hidden">
          <MapView />
          <Timeline />
        </div>

        {/* Right: Camera info panel */}
        <CameraPanel />
      </div>

      {/* First-run prompt if no token */}
      {!mapToken && (
        <div className="fixed bottom-4 right-4 bg-gray-900 border border-white/12 rounded-xl px-4 py-3 shadow-xl max-w-xs z-40">
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
      )}
    </div>
  );
}

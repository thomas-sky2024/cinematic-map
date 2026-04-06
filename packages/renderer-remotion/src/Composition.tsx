import React, { useMemo, useState, useEffect } from "react";
import { useCurrentFrame, useVideoConfig, AbsoluteFill, continueRender, delayRender } from "remotion";
import { MapBase, AnnotationLayerBase, getStyleUrl } from "@cinematic-map/ui-core";
import { CinematicMapProps } from "./Root";

export const CinematicMapComposition = ({
  frames,
  annotations,
  mapStyleId,
  mapToken,
  terrainEnabled,
}: CinematicMapProps) => {
  const frame = useCurrentFrame();
  const [map, setMap] = useState<any>(null);
  // Per-frame rendering lock to ensure the map is fully loaded
  const handle = useMemo(() => delayRender("Rendering frame " + frame), [frame]);

  useEffect(() => {
    // Global fallback for this frame's handle in case map never loads
    const timeout = setTimeout(() => {
      try {
        continueRender(handle);
      } catch (e) {
        // Ignore if already cleared
      }
    }, 8000);
    return () => clearTimeout(timeout);
  }, [handle]);

  useEffect(() => {
    if (!map) return;
    
    let isMounted = true;
    let handled = false;

    const doContinue = () => {
      if (handled || !isMounted) return;
      handled = true;
      continueRender(handle);
    };

    const checkStatus = () => {
      if (map.loaded() && map.isStyleLoaded()) {
        map.off("render", checkStatus);
        doContinue();
      }
    };

    if (map.loaded() && map.isStyleLoaded()) {
      doContinue();
    } else {
      map.on("render", checkStatus);
    }

    const fallback = setTimeout(() => {
      map.off("render", checkStatus);
      doContinue();
    }, 5000); 

    return () => { 
      isMounted = false;
      map.off("render", checkStatus);
      clearTimeout(fallback);
    };
  }, [map, frame, handle]);

  const cam = useMemo(() => {
    return frames.find((f: any) => f.frame === frame) ?? frames[0];
  }, [frames, frame]);

  const styleUrl = useMemo(() => getStyleUrl(mapStyleId, mapToken), [mapStyleId, mapToken]);

  const { width, height } = useVideoConfig();

  if (!cam) return null;

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <MapBase
        width={width}
        height={height}
        styleUrl={styleUrl}
        terrainToken={terrainEnabled ? mapToken : undefined}
        center={[cam.lng, cam.lat]}
        zoom={cam.zoom}
        pitch={cam.pitch}
        bearing={cam.bearing}
        onMapLoad={setMap}
        interactive={false}
      >
        <AnnotationLayerBase
          annotations={annotations}
          currentTime={cam.time}
        />
      </MapBase>
    </AbsoluteFill>
  );
};

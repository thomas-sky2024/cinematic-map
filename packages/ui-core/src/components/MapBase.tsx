import React, { useEffect, useRef, useState, createContext, useContext } from "react";
import maplibregl from "maplibre-gl";

export interface MapContextValue {
  map: maplibregl.Map | null;
}

const MapContext = createContext<MapContextValue>({ map: null });

export const useMap = () => useContext(MapContext);

export interface MapBaseProps {
  styleUrl: string;
  terrainToken?: string;
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
  className?: string;
  onMapLoad?: (map: maplibregl.Map) => void;
  interactive?: boolean;
  width?: number | string;
  height?: number | string;
  children?: React.ReactNode;
}

const TERRAIN_SOURCE_ID = "maplibre-terrain-dem";

export function MapBase({
  styleUrl,
  terrainToken,
  center,
  zoom,
  pitch,
  bearing,
  className,
  onMapLoad,
  interactive = true,
  width,
  height,
  children,
}: MapBaseProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const currentStyleRef = useRef(styleUrl);
  const [map, setMap] = useState<maplibregl.Map | null>(null);

  const applyTerrain = (m: maplibregl.Map, token: string) => {
    if (!m.getSource(TERRAIN_SOURCE_ID)) {
      m.addSource(TERRAIN_SOURCE_ID, {
        type: "raster-dem",
        url: `https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=${token}`,
        tileSize: 256,
      } as any);
    }
    (m as any).setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration: 1.5 });
  };

  const removeTerrain = (m: maplibregl.Map) => {
    (m as any).setTerrain(null);
    if (m.getSource(TERRAIN_SOURCE_ID)) m.removeSource(TERRAIN_SOURCE_ID);
  };

  useEffect(() => {
    if (!containerRef.current || map) return;

    const m = new maplibregl.Map({
      container: containerRef.current,
      style: styleUrl,
      center,
      zoom,
      pitch,
      bearing,
      antialias: true,
      interactive,
      preserveDrawingBuffer: true,
      fadeDuration: 0,
      crossSourceCollisions: false,
    });

    m.on("load", () => {
      setMap(m);
      if (terrainToken) applyTerrain(m, terrainToken);
      onMapLoad?.(m);
    });

    return () => {
      m.remove();
      setMap(null);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!map) return;
    if (currentStyleRef.current !== styleUrl) {
      currentStyleRef.current = styleUrl;
      map.setStyle(styleUrl);
      map.once("style.load", () => {
        if (terrainToken) applyTerrain(map, terrainToken);
      });
    }
  }, [styleUrl, terrainToken, map]);

  useEffect(() => {
    if (!map || !map.isStyleLoaded()) return;
    if (terrainToken) {
      applyTerrain(map, terrainToken);
    } else {
      removeTerrain(map);
    }
  }, [terrainToken, map]);

  useEffect(() => {
    if (!map) return;
    map.resize();
    map.jumpTo({
      center,
      zoom,
      pitch,
      bearing,
    });
  }, [center, zoom, pitch, bearing, map]);

  return (
    <MapContext.Provider value={{ map }}>
      <div className={className} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: width || "100%", height: height || "100%" }}>
        <div ref={containerRef} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: width || "100%", height: height || "100%" }} />
        {map && children}
      </div>
    </MapContext.Provider>
  );
}

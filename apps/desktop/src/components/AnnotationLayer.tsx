/**
 * AnnotationLayer.tsx
 *
 * Renders annotation markers on the MapLibre canvas.
 *
 * Performance strategy:
 *   - Content-hash diffing: only rebuild DOM when a visual property changes
 *   - Zoom-based scale + opacity (matching Mapbox label behavior)
 *   - Single RAF-based zoom listener — no per-marker listeners
 *   - Marker elements reused; position updated in-place when lat/lng changes
 */

import { useEffect, useRef, useCallback, memo } from "react";
import maplibregl from "maplibre-gl";
import { useMapStore } from "../store/useMapStore";
import { Annotation, AnnotationType } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// MARK: Content hash — rebuild only when visual properties change
// ─────────────────────────────────────────────────────────────────────────────

function contentHash(ann: Annotation): string {
  return [
    ann.type,
    ann.label,
    ann.content  ?? "",
    ann.color    ?? "",
    ann.fontSize ?? 13,
    ann.imageUrl    ?? "",
    ann.imageWidth  ?? 160,
    ann.imageHeight ?? 90,
    ann.modelUrl       ?? "",
    ann.modelScale     ?? 1,
    ann.modelRotationY ?? 0,
  ].join("|");
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: Zoom → scale & opacity  (mimics Mapbox label scaling)
// ─────────────────────────────────────────────────────────────────────────────

const SCALE_FACTOR: Record<AnnotationType, number> = {
  text:    0.13,
  callout: 0.10,
  image:   0.08,
  model3d: 0.09,
};

function zoomScale(zoom: number, type: AnnotationType): number {
  // Native size at zoom 10; scale by factor per zoom level
  const delta = zoom - 10;
  return Math.max(0.45, Math.min(1.9, 1 + delta * SCALE_FACTOR[type]));
}

function zoomOpacity(zoom: number): number {
  if (zoom < 2)  return Math.max(0, (zoom - 0.5) / 1.5);
  if (zoom > 18) return Math.max(0, 1 - (zoom - 18) / 2);
  return 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: DOM element builders
// ─────────────────────────────────────────────────────────────────────────────

function mkText(ann: Annotation): HTMLElement {
  const el = document.createElement("div");
  Object.assign(el.style, {
    background: ann.color ?? "#1e293b",
    color: "#fff",
    border: `1.5px solid ${ann.color ?? "#3b82f6"}80`,
    borderRadius: "6px",
    padding: "4px 9px",
    fontSize: `${ann.fontSize ?? 13}px`,
    fontFamily: "system-ui, sans-serif",
    fontWeight: "600",
    whiteSpace: "nowrap",
    boxShadow: "0 2px 8px rgba(0,0,0,0.45)",
    cursor: "pointer",
    userSelect: "none",
    pointerEvents: "auto",
    transformOrigin: "bottom center",
    transition: "transform 0.12s ease, opacity 0.12s ease",
  });
  el.textContent = ann.label;
  return el;
}

function mkCallout(ann: Annotation): HTMLElement {
  const wrap = document.createElement("div");
  Object.assign(wrap.style, {
    position: "relative",
    cursor: "pointer",
    pointerEvents: "auto",
    transformOrigin: "bottom center",
    transition: "transform 0.12s ease, opacity 0.12s ease",
  });

  const bubble = document.createElement("div");
  Object.assign(bubble.style, {
    background: ann.color ?? "#1e293b",
    border: "1.5px solid rgba(255,255,255,0.15)",
    borderRadius: "10px",
    padding: "8px 12px",
    maxWidth: "200px",
    fontFamily: "system-ui, sans-serif",
    boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
  });

  const title = document.createElement("div");
  Object.assign(title.style, {
    color: "#fff",
    fontWeight: "700",
    fontSize: "12px",
    marginBottom: ann.content ? "4px" : "0",
  });
  title.textContent = ann.label;
  bubble.appendChild(title);

  if (ann.content) {
    const body = document.createElement("div");
    Object.assign(body.style, {
      color: "rgba(255,255,255,0.65)",
      fontSize: "11px",
      lineHeight: "1.4",
    });
    body.textContent = ann.content;
    bubble.appendChild(body);
  }

  const tail = document.createElement("div");
  Object.assign(tail.style, {
    width: "0", height: "0",
    borderLeft: "7px solid transparent",
    borderRight: "7px solid transparent",
    borderTop: `8px solid ${ann.color ?? "#1e293b"}`,
    margin: "0 auto",
  });

  wrap.appendChild(bubble);
  wrap.appendChild(tail);
  return wrap;
}

function mkImage(ann: Annotation): HTMLElement {
  const w = ann.imageWidth  ?? 160;
  const h = ann.imageHeight ?? 90;
  const wrap = document.createElement("div");
  Object.assign(wrap.style, {
    cursor: "pointer",
    pointerEvents: "auto",
    border: `2px solid ${ann.color ?? "rgba(255,255,255,0.3)"}`,
    borderRadius: "8px",
    overflow: "hidden",
    boxShadow: "0 4px 16px rgba(0,0,0,0.6)",
    width: `${w}px`,
    transformOrigin: "center center",
    transition: "transform 0.12s ease, opacity 0.12s ease",
  });

  if (ann.imageUrl) {
    const img = document.createElement("img");
    Object.assign(img.style, { width: `${w}px`, height: `${h}px`, objectFit: "cover", display: "block" });
    img.src = ann.imageUrl;
    wrap.appendChild(img);
  } else {
    Object.assign(wrap.style, { height: `${h}px`, background: "#1e293b", display: "flex", alignItems: "center", justifyContent: "center" });
    wrap.innerHTML = `<span style="color:rgba(255,255,255,0.3);font-size:11px">No image</span>`;
  }

  const strip = document.createElement("div");
  Object.assign(strip.style, {
    background: "rgba(0,0,0,0.7)", color: "#fff",
    fontSize: "10px", fontFamily: "system-ui,sans-serif", fontWeight: "600",
    padding: "3px 6px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
  });
  strip.textContent = ann.label;
  wrap.appendChild(strip);
  return wrap;
}

function mkModel3D(ann: Annotation): HTMLElement {
  const wrap = document.createElement("div");
  Object.assign(wrap.style, {
    cursor: "pointer", pointerEvents: "auto", textAlign: "center",
    transformOrigin: "bottom center",
    transition: "transform 0.12s ease, opacity 0.12s ease",
  });

  const cube = document.createElement("div");
  Object.assign(cube.style, {
    width: "32px", height: "32px",
    background: ann.color ?? "#6366f1",
    borderRadius: "6px",
    margin: "0 auto 4px",
    boxShadow: "0 4px 14px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.2)",
    transform: `perspective(50px) rotateX(10deg) rotateY(${ann.modelRotationY ?? 15}deg)`,
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: "16px",
  });
  cube.textContent = "📦";

  const lbl = document.createElement("div");
  Object.assign(lbl.style, {
    color: "#fff", fontSize: "10px", fontFamily: "system-ui,sans-serif",
    fontWeight: "600", whiteSpace: "nowrap",
    background: "rgba(0,0,0,0.6)", borderRadius: "4px", padding: "2px 6px",
  });
  lbl.textContent = ann.label;

  wrap.appendChild(cube);
  wrap.appendChild(lbl);
  return wrap;
}

function buildElement(ann: Annotation, onSelect: (id: string) => void): HTMLElement {
  const el = ann.type === "text"    ? mkText(ann)
           : ann.type === "callout" ? mkCallout(ann)
           : ann.type === "image"   ? mkImage(ann)
           :                          mkModel3D(ann);
  el.addEventListener("click", (e) => { e.stopPropagation(); onSelect(ann.id); });
  return el;
}

function applySelection(el: HTMLElement, selected: boolean) {
  el.style.outline      = selected ? "2px solid #3b82f6" : "none";
  el.style.outlineOffset = "3px";
  el.style.borderRadius  = "6px";
  el.style.zIndex        = selected ? "20" : "1";
}

function isVisible(ann: Annotation, t: number): boolean {
  if (ann.visible === false)                              return false;
  if (ann.showFrom  !== undefined && t < ann.showFrom)  return false;
  if (ann.showUntil !== undefined && t > ann.showUntil) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: Component
// ─────────────────────────────────────────────────────────────────────────────

export const AnnotationLayer = memo(function AnnotationLayer() {
  const { mapRef, annotations, currentTime, selectedAnnotationId, selectAnnotation } = useMapStore();

  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const hashRef    = useRef<Map<string, string>>(new Map());
  const zoomRef    = useRef<number>(5);

  const onSelect = useCallback((id: string) => selectAnnotation(id), [selectAnnotation]);

  // ── Apply zoom-based transform to all existing markers ─────────────────────
  const applyZoom = useCallback(() => {
    const z = zoomRef.current;
    const op = zoomOpacity(z);
    for (const [id, marker] of markersRef.current) {
      const ann = annotations.find((a) => a.id === id);
      if (!ann) continue;
      const el = marker.getElement() as HTMLElement;
      const s  = zoomScale(z, ann.type);
      el.style.transform = `scale(${s.toFixed(3)})`;
      el.style.opacity   = op.toFixed(3);
    }
  }, [annotations]);

  // ── Zoom listener ────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef as maplibregl.Map | null;
    if (!map) return;
    const onZoom = () => { zoomRef.current = map.getZoom(); applyZoom(); };
    map.on("zoom", onZoom);
    zoomRef.current = map.getZoom();
    applyZoom();
    return () => { map.off("zoom", onZoom); };
  }, [mapRef, applyZoom]);

  // ── Sync markers ──────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef as maplibregl.Map | null;
    if (!map) return;

    const liveIds = new Set(annotations.map((a) => a.id));

    // Remove deleted
    for (const id of [...markersRef.current.keys()]) {
      if (!liveIds.has(id)) {
        markersRef.current.get(id)?.remove();
        markersRef.current.delete(id);
        hashRef.current.delete(id);
      }
    }

    for (const ann of annotations) {
      const visible    = isVisible(ann, currentTime);
      const selected   = ann.id === selectedAnnotationId;
      const newHash    = contentHash(ann);
      const existing   = markersRef.current.get(ann.id);
      const hashChanged = hashRef.current.get(ann.id) !== newHash;

      if (!existing || hashChanged) {
        // Remove stale marker
        existing?.remove();

        if (!visible) {
          markersRef.current.delete(ann.id);
          hashRef.current.delete(ann.id);
          continue;
        }

        const el     = buildElement(ann, onSelect);
        // Linearly interpolate coordinates for smoother tracking
        const anchor =
          ann.type === "callout" || ann.type === "text" ? "bottom" : "center";

        applySelection(el, selected);
        const z = zoomRef.current;
        el.style.transform = `scale(${zoomScale(z, ann.type).toFixed(3)})`;
        el.style.opacity   = zoomOpacity(z).toFixed(3);

        const marker = new maplibregl.Marker({ element: el, anchor })
          .setLngLat([ann.lng, ann.lat])
          .addTo(map);

        markersRef.current.set(ann.id, marker);
        hashRef.current.set(ann.id, newHash);
      } else {
        // Lightweight update: position + visibility + selection
        existing.setLngLat([ann.lng, ann.lat]);
        const el = existing.getElement() as HTMLElement;
        el.style.display = visible ? "" : "none";
        applySelection(el, selected);
      }
    }
  }, [annotations, mapRef, currentTime, selectedAnnotationId, onSelect]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => () => {
    for (const m of markersRef.current.values()) m.remove();
    markersRef.current.clear();
    hashRef.current.clear();
  }, []);

  return null;
});

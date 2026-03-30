/**
 * AnnotationPanel.tsx
 * Right panel for managing annotations (text, callout, image, 3D model).
 */

import { useRef, useState } from "react";
import {
  Type, MessageSquare, Image as ImageIcon, Box,
  Plus, Trash2, Eye, EyeOff, ChevronDown, ChevronUp, MapPin,
} from "lucide-react";
import { useMapStore } from "../store/useMapStore";
import { Annotation, AnnotationType } from "../types";

// ── Type config ────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<AnnotationType, { label: string; Icon: any; desc: string; color: string }> = {
  text:    { label: "Text",    Icon: Type,          desc: "Floating label on the map",    color: "#3b82f6" },
  callout: { label: "Callout", Icon: MessageSquare, desc: "Speech bubble with title+body", color: "#8b5cf6" },
  image:   { label: "Image",   Icon: ImageIcon,     desc: "Photo or illustration overlay", color: "#10b981" },
  model3d: { label: "3D Object", Icon: Box,         desc: "3D model pinned to coordinate", color: "#f59e0b" },
};

const PRESET_COLORS = [
  "#3b82f6", "#8b5cf6", "#10b981", "#f59e0b",
  "#ef4444", "#ec4899", "#06b6d4", "#ffffff",
];

// ── Add toolbar ────────────────────────────────────────────────────────────

function AddAnnotationBar() {
  const { annotationMode, setAnnotationMode } = useMapStore();

  return (
    <div className="p-2 border-b border-white/8">
      <p className="text-[10px] text-white/30 mb-2 uppercase tracking-wider">
        {annotationMode
          ? `Click map to place ${TYPE_CONFIG[annotationMode].label}`
          : "Add annotation"}
      </p>
      <div className="grid grid-cols-2 gap-1">
        {(Object.entries(TYPE_CONFIG) as [AnnotationType, typeof TYPE_CONFIG[AnnotationType]][]).map(
          ([type, cfg]) => {
            const active = annotationMode === type;
            return (
              <button
                key={type}
                onClick={() => setAnnotationMode(active ? null : type)}
                title={cfg.desc}
                className={`flex items-center gap-1.5 px-2 py-1.5 rounded border text-[10px] transition-all ${
                  active
                    ? "border-blue-500/60 bg-blue-500/15 text-white"
                    : "border-white/10 text-white/40 hover:text-white/60 hover:border-white/20"
                }`}
              >
                <cfg.Icon size={11} style={{ color: active ? "#fff" : cfg.color }} />
                {cfg.label}
              </button>
            );
          }
        )}
      </div>
      {annotationMode && (
        <p className="mt-1.5 text-[9px] text-amber-400/70 text-center">
          Press Esc to cancel
        </p>
      )}
    </div>
  );
}

// ── Color picker ───────────────────────────────────────────────────────────

function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (c: string) => void;
}) {
  return (
    <div className="flex gap-1 flex-wrap mt-1">
      {PRESET_COLORS.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          style={{ background: c }}
          className={`w-5 h-5 rounded border-2 transition-all ${
            value === c ? "border-white scale-110" : "border-transparent"
          }`}
        />
      ))}
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-5 h-5 rounded cursor-pointer bg-transparent border border-white/20"
        title="Custom color"
      />
    </div>
  );
}

// ── Annotation editor card (expanded) ─────────────────────────────────────

function AnnotationEditor({ ann }: { ann: Annotation }) {
  const { updateAnnotation, deleteAnnotation } = useMapStore();
  const [expanded, setExpanded] = useState(true);
  
  const imageInputRef = useRef<HTMLInputElement>(null);
  const modelInputRef = useRef<HTMLInputElement>(null);

  const cfg = TYPE_CONFIG[ann.type];

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      updateAnnotation(ann.id, { imageUrl: dataUrl });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleModelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    updateAnnotation(ann.id, { modelUrl: url, label: ann.label === "3D Object" ? file.name : ann.label });
    e.target.value = "";
  };

  return (
    <div className="border border-white/10 rounded-lg bg-white/4 overflow-hidden mb-2">
      {/* Header */}
      <div className="flex items-center gap-2 px-2.5 py-2">
        <cfg.Icon size={12} style={{ color: cfg.color, flexShrink: 0 }} />
        <input
          value={ann.label}
          onChange={(e) => updateAnnotation(ann.id, { label: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          placeholder="Label..."
          className="flex-1 bg-transparent text-white/85 text-xs font-medium outline-none min-w-0 placeholder:text-white/20"
        />
        <button
          onClick={(e) => {
            e.stopPropagation();
            updateAnnotation(ann.id, { visible: !(ann.visible ?? true) });
          }}
          className="p-1 text-white/30 hover:text-white/70 transition-colors"
          title={ann.visible === false ? "Show" : "Hide"}
        >
          {ann.visible === false ? <EyeOff size={11} /> : <Eye size={11} />}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
          className="p-1 text-white/30 hover:text-white/70"
        >
          {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            deleteAnnotation(ann.id);
          }}
          className="p-1 text-white/25 hover:text-red-400 transition-colors"
        >
          <Trash2 size={11} />
        </button>
      </div>

      {/* Expanded fields */}
      {expanded && (
        <div className="px-2.5 pb-2.5 space-y-2 border-t border-white/6 pt-2">
          {/* Coordinates (read-only) */}
          <div className="flex items-center gap-1 text-[10px] text-white/30">
            <MapPin size={9} />
            <span className="font-mono">{ann.lat.toFixed(5)}, {ann.lng.toFixed(5)}</span>
          </div>

          {/* Color */}
          <div>
            <p className="text-[10px] text-white/30 mb-0.5">Color</p>
            <ColorPicker
              value={ann.color ?? "#3b82f6"}
              onChange={(c) => updateAnnotation(ann.id, { color: c })}
            />
          </div>

          {/* Text-specific */}
          {ann.type === "text" && (
            <div>
              <p className="text-[10px] text-white/30 mb-1">Font size</p>
              <input
                type="range"
                min={10}
                max={32}
                step={1}
                value={ann.fontSize ?? 13}
                onChange={(e) => updateAnnotation(ann.id, { fontSize: +e.target.value })}
                className="w-full h-1 appearance-none rounded-full bg-white/10 accent-blue-500"
              />
              <div className="flex justify-between text-[9px] text-white/20 mt-0.5">
                <span>10px</span><span>{ann.fontSize ?? 13}px</span><span>32px</span>
              </div>
            </div>
          )}

          {/* Callout-specific */}
          {ann.type === "callout" && (
            <div>
              <p className="text-[10px] text-white/30 mb-1">Body text</p>
              <textarea
                value={ann.content ?? ""}
                onChange={(e) => updateAnnotation(ann.id, { content: e.target.value })}
                rows={3}
                placeholder="Description…"
                className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-[11px] text-white/70 outline-none focus:border-blue-500/40 resize-none placeholder:text-white/20"
              />
            </div>
          )}

          {/* Image-specific */}
          {ann.type === "image" && (
            <div className="space-y-1.5">
              <button
                onClick={() => imageInputRef.current?.click()}
                className="w-full py-1.5 rounded border border-dashed border-white/20 text-[10px] text-white/40 hover:text-white/60 hover:border-white/30 transition-colors"
              >
                {ann.imageUrl ? "Replace image" : "Upload image…"}
              </button>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageUpload}
              />
              {ann.imageUrl && (
                <img
                  src={ann.imageUrl}
                  alt={ann.label}
                  className="w-full rounded border border-white/10"
                  style={{ maxHeight: 80, objectFit: "cover" }}
                />
              )}
              <div className="flex gap-1.5 items-center">
                <span className="text-[10px] text-white/30">W</span>
                <input
                  type="number"
                  value={ann.imageWidth ?? 160}
                  onChange={(e) => updateAnnotation(ann.id, { imageWidth: +e.target.value })}
                  className="w-14 bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-[11px] text-white/70 font-mono outline-none"
                />
                <span className="text-[10px] text-white/30">H</span>
                <input
                  type="number"
                  value={ann.imageHeight ?? 90}
                  onChange={(e) => updateAnnotation(ann.id, { imageHeight: +e.target.value })}
                  className="w-14 bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-[11px] text-white/70 font-mono outline-none"
                />
              </div>
            </div>
          )}

          {/* 3D Model-specific */}
          {ann.type === "model3d" && (
            <div className="space-y-1.5">
              <button
                onClick={() => modelInputRef.current?.click()}
                className="w-full py-1.5 rounded border border-dashed border-white/20 text-[10px] text-white/40 hover:text-white/60 hover:border-white/30 transition-colors"
              >
                {ann.modelUrl ? "Replace model (.glb)" : "Upload .glb model…"}
              </button>
              <input
                ref={modelInputRef}
                type="file"
                accept=".glb,.gltf"
                className="hidden"
                onChange={handleModelUpload}
              />
              {ann.modelUrl && (
                <p className="text-[9px] text-green-400/70">Model loaded ✓</p>
              )}
              <div>
                <p className="text-[10px] text-white/30 mb-0.5">Scale</p>
                <input
                  type="range"
                  min={0.1}
                  max={5}
                  step={0.1}
                  value={ann.modelScale ?? 1}
                  onChange={(e) => updateAnnotation(ann.id, { modelScale: +e.target.value })}
                  className="w-full h-1 appearance-none rounded-full bg-white/10 accent-blue-500"
                />
                <span className="text-[9px] text-white/30">{(ann.modelScale ?? 1).toFixed(1)}x</span>
              </div>
              <div>
                <p className="text-[10px] text-white/30 mb-0.5">Rotation Y</p>
                <input
                  type="range"
                  min={0}
                  max={360}
                  step={5}
                  value={ann.modelRotationY ?? 0}
                  onChange={(e) => updateAnnotation(ann.id, { modelRotationY: +e.target.value })}
                  className="w-full h-1 appearance-none rounded-full bg-white/10 accent-blue-500"
                />
                <span className="text-[9px] text-white/30">{ann.modelRotationY ?? 0}°</span>
              </div>
            </div>
          )}

          {/* Visibility window */}
          <div>
            <p className="text-[10px] text-white/30 mb-1">Visibility window (seconds)</p>
            <div className="flex gap-1.5 items-center">
              <input
                type="number"
                min={0}
                step={0.1}
                placeholder="Start"
                value={ann.showFrom ?? ""}
                onChange={(e) =>
                  updateAnnotation(ann.id, {
                    showFrom: e.target.value ? +e.target.value : undefined,
                  })
                }
                className="w-14 bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-[11px] text-white/70 font-mono outline-none placeholder:text-white/20"
              />
              <span className="text-[10px] text-white/25">→</span>
              <input
                type="number"
                min={0}
                step={0.1}
                placeholder="End"
                value={ann.showUntil ?? ""}
                onChange={(e) =>
                  updateAnnotation(ann.id, {
                    showUntil: e.target.value ? +e.target.value : undefined,
                  })
                }
                className="w-14 bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-[11px] text-white/70 font-mono outline-none placeholder:text-white/20"
              />
            </div>
            <p className="text-[9px] text-white/20 mt-0.5">Leave blank to always show</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Annotation list item (collapsed) ──────────────────────────────────────

function AnnotationListItem({ ann }: { ann: Annotation }) {
  const { selectedAnnotationId, selectAnnotation, updateAnnotation, deleteAnnotation } = useMapStore();
  const isSelected = ann.id === selectedAnnotationId;
  const cfg = TYPE_CONFIG[ann.type];

  return (
    <div
      onClick={() => selectAnnotation(isSelected ? null : ann.id)}
      className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border mb-1.5 cursor-pointer transition-all ${
        isSelected
          ? "border-blue-500/50 bg-blue-500/10"
          : "border-white/8 bg-white/4 hover:bg-white/6"
      }`}
    >
      <cfg.Icon size={11} style={{ color: cfg.color, flexShrink: 0 }} />
      <span className="flex-1 text-[11px] text-white/75 truncate">{ann.label}</span>
      <span className="text-[9px] text-white/25">{cfg.label}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          updateAnnotation(ann.id, { visible: !(ann.visible ?? true) });
        }}
        className="p-1 text-white/25 hover:text-white/60 transition-colors"
      >
        {ann.visible === false ? <EyeOff size={10} /> : <Eye size={10} />}
      </button>
    </div>
  );
}

// ── Main AnnotationPanel ───────────────────────────────────────────────────

export function AnnotationPanel() {
  const { annotations, selectedAnnotationId } = useMapStore();
  const selectedAnn = annotations.find((a) => a.id === selectedAnnotationId);

  return (
    <aside className="w-52 flex flex-col bg-gray-950 border-l border-white/8 overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-white/8 flex items-center justify-between flex-shrink-0">
        <span className="text-[10px] font-semibold text-white/40 tracking-widest uppercase">
          Annotations
        </span>
        <span className="text-[10px] text-white/25">{annotations.length}</span>
      </div>

      {/* Add bar */}
      <AddAnnotationBar />

      {/* List / editor */}
      <div className="flex-1 overflow-y-auto p-2">
        {annotations.length === 0 ? (
          <div className="text-center py-8 text-white/20 text-xs">
            <p>No annotations yet.</p>
            <p className="mt-1">Pick a type above,</p>
            <p>then click on the map.</p>
          </div>
        ) : selectedAnn ? (
          <>
            <button
              onClick={() => useMapStore.getState().selectAnnotation(null)}
              className="text-[10px] text-white/30 hover:text-white/60 mb-2 flex items-center gap-1"
            >
              ← All annotations
            </button>
            <AnnotationEditor ann={selectedAnn} />
          </>
        ) : (
          annotations.map((ann) => (
            <AnnotationListItem key={ann.id} ann={ann} />
          ))
        )}
      </div>
    </aside>
  );
}

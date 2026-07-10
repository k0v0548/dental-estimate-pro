import React, { useCallback, useEffect, useRef, useState } from 'react';

export type PenColor = 'black' | 'red';
export type ToolMode = 'pen' | 'eraser' | 'stamp-upper' | 'stamp-lower' | 'text';
export type PenWidth = 'thin' | 'medium' | 'thick';
export type StampOrientation = 'upper' | 'lower';

// Text font size as a fraction of the chart container width, so it scales identically
// between the interactive preview and the hidden PDF-source copy.
// Baseline is a small size (large sizes aren't needed); it can be nudged a bit
// smaller or larger from there in fine steps.
export const TEXT_FONT_MIN = 0.015;
export const TEXT_FONT_MAX = 0.045;
export const TEXT_FONT_STEP = 0.0025;
export const TEXT_FONT_DEFAULT = 0.025;
export const clampTextFont = (f: number) => Math.min(TEXT_FONT_MAX, Math.max(TEXT_FONT_MIN, f));

// Gothic face that pairs with the sheet's Noto Serif JP (mincho).
const TEXT_FONT_FAMILY = "'Noto Sans JP', sans-serif";
// 'commit' = an undoable action (finished stroke, stamp add/delete);
// 'move' = a continuous stamp drag, not recorded in undo history.
export type AnnotationChangeKind = 'commit' | 'move';

// Relative to the chart container's rendered width, so line thickness scales
// consistently between the interactive preview and the hidden PDF-source copy.
// The old "thin" (0.0035) becomes the new "thick"; two thinner tiers were added below it.
// Actual line width is still floored at 1px in redraw() so "thin" never disappears.
export const PEN_WIDTH_RATIOS: Record<PenWidth, number> = {
  thin: 0.0012,
  medium: 0.0022,
  thick: 0.0035,
};
const MIN_PEN_LINE_WIDTH_PX = 1;

const ERASER_WIDTH_RATIO = 0.03;
const CANVAS_PIXEL_RATIO = 2; // fixed factor for crisp strokes regardless of device

// The chart image is displayed at half size anchored to the box's top-left corner
// (used as a faint trace-over guide), while the container itself keeps its original
// footprint (based on the image's native aspect ratio) so there's room to write beyond it.
const DENTAL_CHART_NATIVE_WIDTH = 955;
const DENTAL_CHART_NATIVE_HEIGHT = 379;
const CHART_BOX_ASPECT_RATIO = DENTAL_CHART_NATIVE_HEIGHT / DENTAL_CHART_NATIVE_WIDTH;
const CHART_DISPLAY_WIDTH_PERCENT = 50; // chart image size relative to the (unchanged) container
const CHART_OPACITY = 0.6;
const STAMP_WIDTH_PERCENT = 2.5; // implant icon width, % of container width — scaled with the chart (was 5%)

const DENTAL_CHART_IMAGE_SRC = '/dental-chart.png';
const IMPLANT_STAMP_IMAGE_SRC = '/implant.png';

const PEN_COLOR_HEX: Record<PenColor, string> = {
  black: '#111827',
  red: '#dc2626',
};

// Points/coordinates are normalized (0-1) relative to the chart container so the
// annotation renders identically regardless of the container's actual pixel size
// (the interactive preview and the hidden PDF-source copy are different DOM nodes).
export interface StrokePoint {
  x: number;
  y: number;
}

export interface Stroke {
  id: string;
  tool: 'pen' | 'eraser';
  color: string;
  width: PenWidth;
  points: StrokePoint[];
}

export interface ImplantStamp {
  id: string;
  x: number;
  y: number;
  // 'upper' = maxilla, rendered vertically flipped (screw pointing up);
  // 'lower' = mandible, rendered in the image's native orientation.
  orientation: StampOrientation;
}

export interface TextAnnotation {
  id: string;
  x: number;
  y: number;
  text: string;
  fontSize: number; // fraction of container width
}

export interface DentalAnnotationData {
  strokes: Stroke[];
  stamps: ImplantStamp[];
  texts: TextAnnotation[];
}

export const EMPTY_ANNOTATION: DentalAnnotationData = { strokes: [], stamps: [], texts: [] };

interface DentalChartCanvasProps {
  data: DentalAnnotationData;
  onChange?: (data: DentalAnnotationData, kind: AnnotationChangeKind) => void;
  interactive?: boolean;
  toolMode?: ToolMode | null; // null = no tool active (taps do nothing)
  penColor?: PenColor;
  penWidth?: PenWidth;
  // Current zoom factor of the preview. Only used to re-sync the canvas backing
  // resolution — a CSS transform on an ancestor doesn't trigger ResizeObserver.
  zoom?: number;
  // True while the user is pinch-zooming; suppresses drawing so a pinch doesn't leave a mark.
  pinchActive?: boolean;
  // Font size (fraction of width) used when placing a new text box.
  textFontSize?: number;
  // Selected text box id is lifted to the parent so the toolbar's font-size control
  // can target it. null when nothing is selected.
  selectedTextId?: string | null;
  onSelectTextId?: (id: string | null) => void;
}

export const DentalChartCanvas: React.FC<DentalChartCanvasProps> = ({
  data,
  onChange,
  interactive = false,
  toolMode = 'pen',
  penColor = 'black',
  penWidth = 'medium',
  zoom = 1,
  pinchActive = false,
  textFontSize = TEXT_FONT_DEFAULT,
  selectedTextId = null,
  onSelectTextId,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inProgressStrokeRef = useRef<Stroke | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  const [selectedStampId, setSelectedStampId] = useState<string | null>(null);
  // Container width in CSS px, kept in state so text font size (a fraction of width)
  // re-renders when the box resizes or the preview zooms.
  const [renderWidth, setRenderWidth] = useState(0);
  const autoFocusTextIdRef = useRef<string | null>(null);
  const texts = data.texts ?? [];

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const { width, height } = sizeRef.current;
    ctx.save();
    ctx.setTransform(CANVAS_PIXEL_RATIO, 0, 0, CANVAS_PIXEL_RATIO, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const strokes = inProgressStrokeRef.current ? [...data.strokes, inProgressStrokeRef.current] : data.strokes;

    strokes.forEach((stroke) => {
      if (stroke.points.length === 0) return;
      ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth =
        stroke.tool === 'eraser'
          ? ERASER_WIDTH_RATIO * width
          : Math.max(MIN_PEN_LINE_WIDTH_PX, PEN_WIDTH_RATIOS[stroke.width] * width);

      if (stroke.points.length === 1) {
        // Render a dot for a single tap so a click still leaves a mark
        const p = stroke.points[0];
        ctx.beginPath();
        ctx.arc(p.x * width, p.y * height, ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fillStyle = stroke.color;
        ctx.fill();
        return;
      }

      // Smooth the stroke with midpoint quadratic curves: each raw point becomes a
      // control point, and the curve passes through the midpoints between consecutive
      // points. This turns the polyline into a continuous curve without extra data.
      const pts = stroke.points;
      ctx.beginPath();
      ctx.moveTo(pts[0].x * width, pts[0].y * height);
      if (pts.length === 2) {
        ctx.lineTo(pts[1].x * width, pts[1].y * height);
      } else {
        for (let i = 1; i < pts.length - 1; i++) {
          const midX = ((pts[i].x + pts[i + 1].x) / 2) * width;
          const midY = ((pts[i].y + pts[i + 1].y) / 2) * height;
          ctx.quadraticCurveTo(pts[i].x * width, pts[i].y * height, midX, midY);
        }
        // Final segment: curve into the last point using the previous point as control
        const last = pts[pts.length - 1];
        const prev = pts[pts.length - 2];
        ctx.quadraticCurveTo(prev.x * width, prev.y * height, last.x * width, last.y * height);
      }
      ctx.stroke();
    });

    ctx.restore();
  }, [data]);

  const resizeCanvas = useCallback(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    // getBoundingClientRect reflects any ancestor CSS transform, so under zoom the
    // backing store scales with the on-screen size and strokes stay crisp.
    const rect = container.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    sizeRef.current = { width: w, height: h };
    setRenderWidth(w);
    canvas.width = w * CANVAS_PIXEL_RATIO;
    canvas.height = h * CANVAS_PIXEL_RATIO;
    redraw();
  }, [redraw]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    resizeCanvas();
    const ro = new ResizeObserver(resizeCanvas);
    ro.observe(container);
    return () => ro.disconnect();
  }, [resizeCanvas]);

  // Re-sync backing resolution when zoom changes (ResizeObserver ignores transforms).
  useEffect(() => {
    resizeCanvas();
  }, [zoom, resizeCanvas]);

  // Abort any in-progress stroke as soon as a pinch begins.
  useEffect(() => {
    if (pinchActive && inProgressStrokeRef.current) {
      inProgressStrokeRef.current = null;
      redraw();
    }
  }, [pinchActive, redraw]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  const getRelativePoint = (clientX: number, clientY: number): StrokePoint | null => {
    const container = containerRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!interactive) return;

    // Two-finger pinch is detected reliably by the stage's touch handler (pinchActive).
    // We rely solely on that flag here — no local pointer-counting, which could strand a
    // stale id after a missed pointerup and then wrongly block the next stroke.
    if (pinchActive) {
      if (inProgressStrokeRef.current) {
        inProgressStrokeRef.current = null;
        redraw();
      }
      return;
    }

    e.preventDefault();
    setSelectedStampId(null);
    onSelectTextId?.(null); // tapping the canvas deselects any text box
    if (!toolMode) return; // no tool selected → canvas taps do nothing
    const point = getRelativePoint(e.clientX, e.clientY);
    if (!point) return;

    if (toolMode === 'text') {
      const newText: TextAnnotation = {
        id: `text-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        x: point.x,
        y: point.y,
        text: '',
        fontSize: textFontSize,
      };
      autoFocusTextIdRef.current = newText.id;
      onChange?.({ ...data, texts: [...texts, newText] }, 'commit');
      onSelectTextId?.(newText.id);
      return;
    }

    e.currentTarget.setPointerCapture(e.pointerId);

    if (toolMode === 'stamp-upper' || toolMode === 'stamp-lower') {
      const stamp: ImplantStamp = {
        id: `stamp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        x: point.x,
        y: point.y,
        orientation: toolMode === 'stamp-upper' ? 'upper' : 'lower',
      };
      onChange?.({ ...data, stamps: [...data.stamps, stamp] }, 'commit');
      return;
    }

    inProgressStrokeRef.current = {
      id: `stroke-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      tool: toolMode === 'eraser' ? 'eraser' : 'pen',
      color: PEN_COLOR_HEX[penColor],
      width: penWidth,
      points: [point],
    };
    redraw();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!interactive || pinchActive || !inProgressStrokeRef.current) return;
    e.preventDefault();
    const point = getRelativePoint(e.clientX, e.clientY);
    if (!point) return;
    inProgressStrokeRef.current.points.push(point);
    redraw();
  };

  const finishStroke = () => {
    const finished = inProgressStrokeRef.current;
    inProgressStrokeRef.current = null;
    if (finished) {
      onChange?.({ ...data, strokes: [...data.strokes, finished] }, 'commit');
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!interactive) return;
    e.preventDefault();
    finishStroke();
  };

  const moveStamp = (id: string, x: number, y: number) => {
    onChange?.(
      { ...data, stamps: data.stamps.map((s) => (s.id === id ? { ...s, x, y } : s)) },
      'move'
    );
  };

  const deleteStamp = (id: string) => {
    setSelectedStampId((current) => (current === id ? null : current));
    onChange?.({ ...data, stamps: data.stamps.filter((s) => s.id !== id) }, 'commit');
  };

  const moveText = (id: string, x: number, y: number) => {
    onChange?.({ ...data, texts: texts.map((t) => (t.id === id ? { ...t, x, y } : t)) }, 'move');
  };

  const editText = (id: string, value: string) => {
    onChange?.({ ...data, texts: texts.map((t) => (t.id === id ? { ...t, text: value } : t)) }, 'move');
  };

  const deleteText = (id: string) => {
    if (selectedTextId === id) onSelectTextId?.(null);
    onChange?.({ ...data, texts: texts.filter((t) => t.id !== id) }, 'commit');
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full select-none"
      style={{ paddingBottom: `${CHART_BOX_ASPECT_RATIO * 100}%`, WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}
    >
      <img
        src={DENTAL_CHART_IMAGE_SRC}
        alt="歯式図"
        draggable={false}
        className="absolute top-0 left-0 select-none"
        style={{ width: `${CHART_DISPLAY_WIDTH_PERCENT}%`, height: 'auto', opacity: CHART_OPACITY, pointerEvents: 'none' }}
      />
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 w-full h-full ${interactive ? 'touch-none' : 'pointer-events-none'} ${
          interactive && (toolMode === 'stamp-upper' || toolMode === 'stamp-lower')
            ? 'cursor-crosshair'
            : interactive && toolMode === 'text'
            ? 'cursor-text'
            : ''
        }`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
      <div className="absolute inset-0" style={{ pointerEvents: 'none' }}>
        {data.stamps.map((stamp) => (
          <ImplantStampMarker
            key={stamp.id}
            stamp={stamp}
            interactive={interactive}
            selected={interactive && selectedStampId === stamp.id}
            containerRef={containerRef}
            onSelect={() => setSelectedStampId(stamp.id)}
            onMove={(x, y) => moveStamp(stamp.id, x, y)}
            onDelete={() => deleteStamp(stamp.id)}
          />
        ))}
        {texts.map((t) => (
          <TextAnnotationMarker
            key={t.id}
            text={t}
            fontPx={t.fontSize * renderWidth}
            editingEnabled={interactive && toolMode === 'text'}
            selected={interactive && toolMode === 'text' && selectedTextId === t.id}
            autoFocus={autoFocusTextIdRef.current === t.id}
            containerRef={containerRef}
            onSelect={() => onSelectTextId?.(t.id)}
            onMove={(x, y) => moveText(t.id, x, y)}
            onEdit={(value) => editText(t.id, value)}
            onDelete={() => deleteText(t.id)}
            onAutoFocusDone={() => { autoFocusTextIdRef.current = null; }}
          />
        ))}
      </div>
    </div>
  );
};

interface ImplantStampMarkerProps {
  stamp: ImplantStamp;
  interactive: boolean;
  selected: boolean;
  containerRef: React.RefObject<HTMLDivElement>;
  onSelect: () => void;
  onMove: (x: number, y: number) => void;
  onDelete: () => void;
}

const DRAG_THRESHOLD_PX = 4;

const ImplantStampMarker: React.FC<ImplantStampMarkerProps> = ({
  stamp,
  interactive,
  selected,
  containerRef,
  onSelect,
  onMove,
  onDelete,
}) => {
  const draggedRef = useRef(false);
  const startClientRef = useRef({ x: 0, y: 0 });

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!interactive) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    draggedRef.current = false;
    startClientRef.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!interactive || e.buttons === 0) return;
    e.preventDefault();
    e.stopPropagation();

    const dx = e.clientX - startClientRef.current.x;
    const dy = e.clientY - startClientRef.current.y;
    if (!draggedRef.current && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    draggedRef.current = true;

    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    onMove(
      Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
    );
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!interactive) return;
    e.preventDefault();
    e.stopPropagation();
    if (!draggedRef.current) {
      onSelect();
    }
  };

  return (
    <div
      className="absolute"
      style={{
        left: `${stamp.x * 100}%`,
        top: `${stamp.y * 100}%`,
        width: `${STAMP_WIDTH_PERCENT}%`,
        transform: 'translate(-50%, -50%)',
        pointerEvents: interactive ? 'auto' : 'none',
        touchAction: 'none',
        cursor: interactive ? 'grab' : undefined,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <img
        src={IMPLANT_STAMP_IMAGE_SRC}
        alt={stamp.orientation === 'upper' ? 'インプラントスタンプ(上顎)' : 'インプラントスタンプ(下顎)'}
        draggable={false}
        className={`w-full h-auto select-none ${selected ? 'ring-2 ring-blue-500 ring-offset-1' : ''}`}
        style={stamp.orientation === 'upper' ? { transform: 'scaleY(-1)' } : undefined}
      />
      {selected && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="absolute -top-2 -right-2 w-4 h-4 rounded-full bg-red-600 text-white text-[10px] leading-4 flex items-center justify-center shadow"
          aria-label="スタンプを削除"
        >
          ×
        </button>
      )}
    </div>
  );
};

interface TextAnnotationMarkerProps {
  text: TextAnnotation;
  fontPx: number;
  editingEnabled: boolean; // interactive AND the text tool is active
  selected: boolean;
  autoFocus: boolean;
  containerRef: React.RefObject<HTMLDivElement>;
  onSelect: () => void;
  onMove: (x: number, y: number) => void;
  onEdit: (value: string) => void;
  onDelete: () => void;
  onAutoFocusDone: () => void;
}

const TextAnnotationMarker: React.FC<TextAnnotationMarkerProps> = ({
  text,
  fontPx,
  editingEnabled,
  selected,
  autoFocus,
  containerRef,
  onSelect,
  onMove,
  onEdit,
  onDelete,
  onAutoFocusDone,
}) => {
  const editRef = useRef<HTMLDivElement>(null);
  const draggedRef = useRef(false);
  const startClientRef = useRef({ x: 0, y: 0 });
  const editable = editingEnabled && selected;

  // Keep the DOM text in sync with state without clobbering the caret while typing.
  useEffect(() => {
    const el = editRef.current;
    if (el && el.textContent !== text.text) {
      el.textContent = text.text;
    }
  }, [text.text]);

  // Focus a newly placed box and put the caret at the end.
  useEffect(() => {
    if (autoFocus && editable && editRef.current) {
      const el = editRef.current;
      el.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
      onAutoFocusDone();
    }
  }, [autoFocus, editable, onAutoFocusDone]);

  const handleHandleDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    draggedRef.current = false;
    startClientRef.current = { x: e.clientX, y: e.clientY };
  };
  const handleHandleMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons === 0) return;
    e.preventDefault();
    e.stopPropagation();
    const dx = e.clientX - startClientRef.current.x;
    const dy = e.clientY - startClientRef.current.y;
    if (!draggedRef.current && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    draggedRef.current = true;
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    onMove(
      Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
    );
  };

  return (
    <div
      className="absolute"
      style={{
        left: `${text.x * 100}%`,
        top: `${text.y * 100}%`,
        maxWidth: '85%',
        pointerEvents: editingEnabled ? 'auto' : 'none',
        touchAction: 'none',
      }}
    >
      <div
        ref={editRef}
        contentEditable={editable}
        suppressContentEditableWarning
        onInput={(e) => onEdit(e.currentTarget.textContent ?? '')}
        onPointerDown={(e) => {
          // Let the caret land normally while editing; otherwise select on tap.
          if (!editable) {
            e.preventDefault();
            e.stopPropagation();
            onSelect();
          }
        }}
        className={`whitespace-pre-wrap leading-tight outline-none ${
          selected ? 'ring-1 ring-blue-500 bg-white/40' : ''
        }`}
        style={{
          fontSize: fontPx,
          fontFamily: TEXT_FONT_FAMILY,
          color: '#111827',
          minWidth: Math.max(6, fontPx * 0.6),
          minHeight: fontPx,
          padding: '1px 2px',
          cursor: editable ? 'text' : editingEnabled ? 'pointer' : 'default',
        }}
      />
      {selected && (
        <>
          {/* Move handle */}
          <div
            onPointerDown={handleHandleDown}
            onPointerMove={handleHandleMove}
            className="absolute -top-3 -left-3 w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] leading-5 text-center shadow cursor-grab select-none"
            aria-label="テキストを移動"
          >
            ✥
          </div>
          {/* Delete button */}
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="absolute -top-3 -right-3 w-5 h-5 rounded-full bg-red-600 text-white text-[10px] leading-5 flex items-center justify-center shadow"
            aria-label="テキストを削除"
          >
            ×
          </button>
        </>
      )}
    </div>
  );
};

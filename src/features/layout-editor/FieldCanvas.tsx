import { useEffect, useRef, useState } from 'react';
import { ELEMENT_SPECS } from '../../domain';
import type { LayoutMode, PathPreview, Rect, RenderElement } from '../../types';

interface FieldCanvasProps {
  field: { width: number; height: number };
  elements: RenderElement[];
  selectedIds: string[];
  selectionBounds: Rect | null;
  isGroupMoving: boolean;
  mode: LayoutMode;
  overlaps: Array<{ firstId: string; secondId: string }>;
  bounds: Array<{ elementId: string }>;
  channels: Array<{ firstId: string; secondId: string }>;
  path: PathPreview | null;
  onSelect: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onAddToSelection: (id: string) => void;
  onClearSelection: () => void;
  onMove: (id: string, x: number, y: number) => void;
  onMarquee: (rect: Rect, additive: boolean) => void;
  onStartGroupMove: () => void;
  onGroupMove: (dx: number, dy: number) => void;
  onFinishGroupMove: () => void;
  onCancelGroupMove: () => void;
}

interface DragSession {
  kind: 'marquee' | 'element' | 'group';
  additive: boolean;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  moved: boolean;
  id?: string;
  dx?: number;
  dy?: number;
  originX?: number;
  originY?: number;
}

const MARQUEE_PIXEL_THRESHOLD = 5;

export function FieldCanvas({
  field, elements, selectedIds, selectionBounds, isGroupMoving, mode,
  overlaps, bounds, channels, path,
  onSelect, onToggleSelect, onAddToSelection, onClearSelection, onMove,
  onMarquee, onStartGroupMove, onGroupMove, onFinishGroupMove, onCancelGroupMove,
}: FieldCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [session, setSession] = useState<DragSession | null>(null);
  const sessionRef = useRef<DragSession | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<Rect | null>(null);
  const [marqueePreview, setMarqueePreview] = useState<Set<string>>(new Set());
  const selectedSet = new Set(selectedIds);

  const updateSession = (next: DragSession | null) => {
    sessionRef.current = next;
    setSession(next);
  };

  const pointFromEvent = (event: React.PointerEvent) => {
    const box = canvasRef.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    return { x: (event.clientX - box.left) * field.width / box.width, y: (event.clientY - box.top) * field.height / box.height };
  };

  const fieldPointFromClient = (clientX: number, clientY: number) => {
    const box = canvasRef.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    return { x: (clientX - box.left) * field.width / box.width, y: (clientY - box.top) * field.height / box.height };
  };

  // 框选到一半松手之外的中断：Esc / 指针丢失。框选取消不改选区，整组拖动整体回滚
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !sessionRef.current) return;
      event.stopPropagation();
      if (sessionRef.current.kind === 'group') onCancelGroupMove();
      updateSession(null);
      setMarqueeRect(null);
      setMarqueePreview(new Set());
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onCancelGroupMove]);

  const handleCanvasPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    // 普通框选是"替换选区"语义，但清空动作延后到松手提交时，
    // 这样框选到一半按 Esc 取消可以完整保留原选区
    updateSession({ kind: 'marquee', additive, pointerId: event.pointerId, startClientX: event.clientX, startClientY: event.clientY, moved: false });
    setMarqueeRect(null);
    setMarqueePreview(new Set());
  };

  const handleElementPointerDown = (event: React.PointerEvent, element: RenderElement) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    const point = pointFromEvent(event);
    if (additive) {
      // Shift+按下先不改选区，移动了就并入整组，只是点击则在松手时切换
      updateSession({ kind: 'element', additive: true, pointerId: event.pointerId, startClientX: event.clientX, startClientY: event.clientY, moved: false, id: element.id, dx: point.x - element.x, dy: point.y - element.y, originX: element.x, originY: element.y });
      return;
    }
    if (!selectedSet.has(element.id)) onSelect(element.id);
    const groupSize = selectedSet.has(element.id) ? selectedSet.size : 1;
    updateSession({
      kind: groupSize > 1 ? 'group' : 'element',
      additive: false,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      moved: false,
      id: element.id,
      dx: point.x - element.x,
      dy: point.y - element.y,
      originX: element.x,
      originY: element.y,
    });
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    const current = sessionRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const pixelDistance = Math.hypot(event.clientX - current.startClientX, event.clientY - current.startClientY);
    if (!current.moved && pixelDistance < MARQUEE_PIXEL_THRESHOLD) return;

    if (current.kind === 'marquee') {
      if (!current.moved) updateSession({ ...current, moved: true });
      const start = fieldPointFromClient(current.startClientX, current.startClientY);
      const now = fieldPointFromClient(event.clientX, event.clientY);
      const rect: Rect = {
        left: Math.max(0, Math.min(start.x, now.x)),
        top: Math.max(0, Math.min(start.y, now.y)),
        right: Math.min(field.width, Math.max(start.x, now.x)),
        bottom: Math.min(field.height, Math.max(start.y, now.y)),
      };
      setMarqueeRect(rect);
      const base = current.additive ? selectedSet : new Set<string>();
      const preview = new Set(base);
      elements.forEach((element) => {
        const box = { left: element.x, top: element.y, right: element.x + element.displayWidth, bottom: element.y + element.displayHeight };
        if (!(box.right < rect.left || rect.right < box.left || box.bottom < rect.top || rect.bottom < box.top)) preview.add(element.id);
      });
      setMarqueePreview(preview);
      return;
    }

    if (!current.moved) {
      const started = { ...current, moved: true };
      if (current.additive && current.id) {
        onAddToSelection(current.id);
        const groupCount = selectedSet.has(current.id) ? selectedSet.size : selectedSet.size + 1;
        started.kind = groupCount > 1 ? 'group' : 'element';
        if (started.kind === 'group') onStartGroupMove();
      } else if (current.kind === 'group') {
        onStartGroupMove();
      }
      updateSession(started);
    }

    const active = sessionRef.current;
    if (!active) return;
    if (active.kind === 'group') {
      const point = pointFromEvent(event);
      onGroupMove(point.x - (active.dx ?? 0) - (active.originX ?? 0), point.y - (active.dy ?? 0) - (active.originY ?? 0));
    } else if (active.id) {
      const point = pointFromEvent(event);
      onMove(active.id, point.x - (active.dx ?? 0), point.y - (active.dy ?? 0));
    }
  };

  const endSession = (event: React.PointerEvent) => {
    const current = sessionRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (current.kind === 'group') onFinishGroupMove();
    if (current.kind === 'marquee') {
      if (current.moved && marqueeRect) {
        onMarquee(marqueeRect, current.additive);
      } else if (!current.additive) {
        // 没有形成框选的普通按下 = 点击空白：清空选区
        onClearSelection();
      }
    }
    if (current.kind === 'element' && current.additive && !current.moved && current.id) onToggleSelect(current.id);
    updateSession(null);
    setMarqueeRect(null);
    setMarqueePreview(new Set());
  };

  const issueIds = new Set(overlaps.flatMap((item) => [item.firstId, item.secondId]));
  const channelIds = new Set(channels.flatMap((item) => [item.firstId, item.secondId]));
  const boundsIds = new Set(bounds.map((item) => item.elementId));
  const canvasWidth = 100 / Math.max(1, field.width / (field.height * 1.35));
  const highlightIds = marqueeRect ? marqueePreview : selectedSet;

  const boundsStyle = selectionBounds ? {
    left: `${selectionBounds.left / field.width * 100}%`,
    top: `${selectionBounds.top / field.height * 100}%`,
    width: `${(selectionBounds.right - selectionBounds.left) / field.width * 100}%`,
    height: `${(selectionBounds.bottom - selectionBounds.top) / field.height * 100}%`,
  } : null;
  const tagBelow = selectionBounds ? selectionBounds.top / field.height < 0.09 : false;

  return <div className="canvas-wrap">
    <div className="canvas-ruler top-ruler"><span>0 m</span><span>{Math.round(field.width / 2)} m</span><span>{field.width} m</span></div>
    <div className="canvas-ruler side-ruler"><span>0</span><span>{Math.round(field.height / 2)} m</span><span>{field.height} m</span></div>
    <div
      className={`field-canvas mode-${mode} ${session?.kind === 'marquee' ? 'is-marqueeing' : ''}`}
      ref={canvasRef}
      style={{ width: `${Math.min(100, canvasWidth)}%`, aspectRatio: `${field.width} / ${field.height}` }}
      onPointerDown={handleCanvasPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endSession}
      onPointerCancel={() => {
        if (sessionRef.current?.kind === 'group') onCancelGroupMove();
        updateSession(null);
        setMarqueeRect(null);
        setMarqueePreview(new Set());
      }}
    >
      <div className="grid-overlay" />
      <div className="field-label"><span>EXPO HALL A</span><strong>{field.width} × {field.height} m</strong></div>
      {path && mode === 'path' ? <svg className="path-layer" viewBox={`0 0 ${field.width} ${field.height}`} preserveAspectRatio="none"><polyline points={path.points.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#ef795f" strokeWidth="0.3" strokeDasharray="0.75 0.55" /><circle cx={path.points[0].x} cy={path.points[0].y} r="0.45" fill="#ef795f" /><circle cx={path.points[path.points.length - 1].x} cy={path.points[path.points.length - 1].y} r="0.45" fill="#ef795f" /></svg> : null}
      {elements.map((element) => {
        const spec = ELEMENT_SPECS[element.kind];
        const classes = [
          'canvas-element',
          highlightIds.has(element.id) ? 'is-selected' : '',
          issueIds.has(element.id) && mode !== 'edit' ? 'is-overlap' : '',
          channelIds.has(element.id) && mode !== 'edit' ? 'is-channel' : '',
          boundsIds.has(element.id) ? 'is-out' : '',
        ].filter(Boolean).join(' ');
        return <button
          key={element.id}
          type="button"
          className={classes}
          style={{ left: `${element.x / field.width * 100}%`, top: `${element.y / field.height * 100}%`, width: `${element.displayWidth / field.width * 100}%`, height: `${element.displayHeight / field.height * 100}%`, background: spec.color, transform: `rotate(${element.rotation}deg)` }}
          onPointerDown={(event) => handleElementPointerDown(event, element)}
        >
          <span className="element-icon">{spec.icon}</span><span className="element-name">{element.name}</span><small>{element.displayWidth.toFixed(1)} × {element.displayHeight.toFixed(1)} m</small>
          {issueIds.has(element.id) && mode !== 'edit' ? <span className="issue-dot">!</span> : null}
        </button>;
      })}
      {boundsStyle && !marqueeRect ? <div className="selection-box" style={boundsStyle}>
        <span className={`selection-box-tag${tagBelow ? ' below' : ''}`}>已选 {selectedIds.length} 个{isGroupMoving ? ' · 移动中' : ''}</span>
      </div> : null}
      {marqueeRect ? <div className="marquee-box" style={{ left: `${marqueeRect.left / field.width * 100}%`, top: `${marqueeRect.top / field.height * 100}%`, width: `${(marqueeRect.right - marqueeRect.left) / field.width * 100}%`, height: `${(marqueeRect.bottom - marqueeRect.top) / field.height * 100}%` }}><span className="selection-box-tag live">{marqueePreview.size} 个</span></div> : null}
      <div className="axis-hint">拖动元素移动 · 空白处框选 · Shift 加选</div>
    </div>
    <div className="canvas-legend"><span><i className="legend-dot green" />可通行</span><span><i className="legend-dot coral" />需关注</span><span><i className="legend-line" />访问路径</span></div>
  </div>;
}

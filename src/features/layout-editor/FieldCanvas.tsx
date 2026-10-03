import { useEffect, useRef, useState } from 'react';
import { ELEMENT_SPECS } from '../../domain';
import { findElementsInRect, normalizeRect } from '../../batchEditing';
import type { LayoutMode, PathPreview, RenderElement, SelectionBounds } from '../../types';

interface FieldCanvasProps {
  field: { width: number; height: number };
  elements: RenderElement[];
  selectedIds: string[];
  selectionBounds: SelectionBounds | null;
  mode: LayoutMode;
  overlaps: Array<{ firstId: string; secondId: string }>;
  bounds: Array<{ elementId: string }>;
  channels: Array<{ firstId: string; secondId: string }>;
  path: PathPreview | null;
  onSelect: (id: string, additive?: boolean) => void;
  onMove: (id: string, x: number, y: number) => void;
  onGroupMove: (dx: number, dy: number) => boolean;
  onMarquee: (ids: string[], additive?: boolean) => void;
  onClearSelection: () => void;
}

interface MarqueeState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  additive: boolean;
  active: boolean;
}

interface GroupDragState {
  startClientX: number;
  startClientY: number;
  lastAppliedDx: number;
  lastAppliedDy: number;
  blocked: boolean;
}

const MARQUEE_THRESHOLD = 6; // px，小于这个距离视为点击，避免“框选到一半松开”误改选区

export function FieldCanvas({ field, elements, selectedIds, selectionBounds, mode, overlaps, bounds, channels, path, onSelect, onMove, onGroupMove, onMarquee, onClearSelection }: FieldCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const [groupDrag, setGroupDrag] = useState<GroupDragState | null>(null);
  const issueIds = new Set(overlaps.flatMap((item) => [item.firstId, item.secondId]));
  const channelIds = new Set(channels.flatMap((item) => [item.firstId, item.secondId]));
  const boundsIds = new Set(bounds.map((item) => item.elementId));
  const canvasWidth = 100 / Math.max(1, field.width / (field.height * 1.35));
  const selectedIdSet = new Set(selectedIds);

  const pointFromEvent = (event: React.PointerEvent | PointerEvent) => {
    const box = canvasRef.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    return { x: (event.clientX - box.left) * field.width / box.width, y: (event.clientY - box.top) * field.height / box.height };
  };

  const isMarqueeHit = (rect: ReturnType<typeof normalizeRect>) => rect.right - rect.left > 0.2 || rect.bottom - rect.top > 0.2;

  const cancelMarquee = () => {
    // 框选取消：丢弃橡皮筋矩形，不改动既有选区（不会出现“选了一半”的中间态）。
    setMarquee(null);
  };

  useEffect(() => {
    if (!marquee) return;
    // 捕获阶段 + stopImmediatePropagation：框选过程中按 Esc 只取消橡皮筋，保留既有选区
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopImmediatePropagation(); cancelMarquee(); } };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [marquee]);

  const onFieldPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    // 只有点在空白处（画布本体或网格层）才开始框选；元素的 pointerdown 会 stopPropagation。
    if (event.target !== event.currentTarget && !(event.target as HTMLElement).classList.contains('grid-overlay')) return;
    // 把指针捕获到画布，保证拖出元素/快速移动时仍能收到 move/up，框选不会“断在一半”。
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFromEvent(event);
    setMarquee({ startX: point.x, startY: point.y, currentX: point.x, currentY: point.y, additive: event.shiftKey || event.ctrlKey || event.metaKey, active: false });
  };

  const onFieldPointerMove = (event: React.PointerEvent) => {
    setMarquee((current) => {
      if (!current) return current;
      const point = pointFromEvent(event);
      const box = canvasRef.current?.getBoundingClientRect();
      const movedPx = box ? Math.hypot(event.clientX - (box.left + current.startX * box.width / field.width), event.clientY - (box.top + current.startY * box.height / field.height)) : 0;
      return { ...current, currentX: point.x, currentY: point.y, active: current.active || movedPx > MARQUEE_THRESHOLD };
    });
  };

  const finishMarquee = (commit: boolean) => {
    if (!marquee) return;
    if (commit) {
      if (marquee.active) {
        const rect = normalizeRect({ x: marquee.startX, y: marquee.startY }, { x: marquee.currentX, y: marquee.currentY });
        if (isMarqueeHit(rect)) onMarquee(findElementsInRect(elements, rect), marquee.additive);
        else if (!marquee.additive) onClearSelection();
      } else if (!marquee.additive) {
        // 没有真正拉开橡皮筋（点按 / 框选到一半就松开）：普通点击清空选区，不做意外改动
        onClearSelection();
      }
    }
    setMarquee(null);
  };

  const marqueeRect = marquee?.active ? normalizeRect({ x: marquee.startX, y: marquee.startY }, { x: marquee.currentX, y: marquee.currentY }) : null;
  const marqueePreviewIds = marqueeRect ? new Set(findElementsInRect(elements, marqueeRect)) : new Set<string>();

  const beginGroupDrag = (event: React.PointerEvent, elementId: string) => {
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    if (additive) {
      onSelect(elementId, true);
      return false;
    }
    if (!selectedIdSet.has(elementId)) {
      onSelect(elementId);
      return false;
    }
    if (selectedIds.length > 1) {
      setGroupDrag({ startClientX: event.clientX, startClientY: event.clientY, lastAppliedDx: 0, lastAppliedDy: 0, blocked: false });
      return true;
    }
    return false;
  };

  const onFieldPointerUp = () => {
    if (marquee) finishMarquee(true);
  };

  const pctX = (value: number) => value / field.width * 100;
  const pctY = (value: number) => value / field.height * 100;

  return <div className="canvas-wrap">
    <div className="canvas-ruler top-ruler"><span>0 m</span><span>{Math.round(field.width / 2)} m</span><span>{field.width} m</span></div>
    <div className="canvas-ruler side-ruler"><span>0</span><span>{Math.round(field.height / 2)} m</span><span>{field.height} m</span></div>
    {selectedIds.length > 0 ? <div className="selection-count-badge">已选 {selectedIds.length} 个{selectionBounds ? ` · 范围 ${selectionBounds.width.toFixed(1)} × ${selectionBounds.height.toFixed(1)} m` : ''}</div> : null}
    <div
      className={`field-canvas mode-${mode} ${marquee?.active ? 'is-marqueeing' : ''} ${groupDrag?.blocked ? 'is-drag-blocked' : ''}`}
      ref={canvasRef}
      style={{ width: `${Math.min(100, canvasWidth)}%`, aspectRatio: `${field.width} / ${field.height}` }}
      onPointerDown={onFieldPointerDown}
      onPointerMove={(event) => { onFieldPointerMove(event); }}
      onPointerUp={onFieldPointerUp}
      onPointerCancel={() => finishMarquee(false)}
    >
      <div className="grid-overlay" />
      <div className="field-label"><span>EXPO HALL A</span><strong>{field.width} × {field.height} m</strong></div>
      {path && mode === 'path' ? <svg className="path-layer" viewBox={`0 0 ${field.width} ${field.height}`} preserveAspectRatio="none"><polyline points={path.points.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#ef795f" strokeWidth="0.3" strokeDasharray="0.75 0.55" /><circle cx={path.points[0].x} cy={path.points[0].y} r="0.45" fill="#ef795f" /><circle cx={path.points[path.points.length - 1].x} cy={path.points[path.points.length - 1].y} r="0.45" fill="#ef795f" /></svg> : null}
      {selectionBounds && selectedIds.length > 1 ? <div className="selection-bounds" style={{ left: `${pctX(selectionBounds.left)}%`, top: `${pctY(selectionBounds.top)}%`, width: `${pctX(selectionBounds.right - selectionBounds.left)}%`, height: `${pctY(selectionBounds.bottom - selectionBounds.top)}%` }}><span className="selection-bounds-tag">{selectedIds.length}</span></div> : null}
      {elements.map((element) => {
        const spec = ELEMENT_SPECS[element.kind];
        const inMarquee = marqueePreviewIds.has(element.id);
        const classes = ['canvas-element', selectedIdSet.has(element.id) ? 'is-selected' : '', inMarquee ? 'is-marquee-hit' : '', issueIds.has(element.id) && mode !== 'edit' ? 'is-overlap' : '', channelIds.has(element.id) && mode !== 'edit' ? 'is-channel' : '', boundsIds.has(element.id) ? 'is-out' : ''].filter(Boolean).join(' ');
        return <button key={element.id} type="button" className={classes} style={{ left: `${pctX(element.x)}%`, top: `${pctY(element.y)}%`, width: `${pctX(element.displayWidth)}%`, height: `${pctY(element.displayHeight)}%`, background: spec.color, transform: `rotate(${element.rotation}deg)` }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.stopPropagation();
            const additive = event.shiftKey || event.ctrlKey || event.metaKey;
            beginGroupDrag(event, element.id);
            event.currentTarget.setPointerCapture(event.pointerId);
            const point = pointFromEvent(event);
            if (!additive) setDrag({ id: element.id, dx: point.x - element.x, dy: point.y - element.y });
          }}
          onPointerMove={(event) => {
            if (groupDrag && selectedIds.length > 1) {
              const box = canvasRef.current?.getBoundingClientRect();
              if (!box) return;
              const dx = (event.clientX - groupDrag.startClientX) * field.width / box.width - groupDrag.lastAppliedDx;
              const dy = (event.clientY - groupDrag.startClientY) * field.height / box.height - groupDrag.lastAppliedDy;
              if (dx === 0 && dy === 0) return;
              const applied = onGroupMove(Number(dx.toFixed(2)), Number(dy.toFixed(2)));
              if (applied) setGroupDrag({ ...groupDrag, lastAppliedDx: Number((groupDrag.lastAppliedDx + dx).toFixed(2)), lastAppliedDy: Number((groupDrag.lastAppliedDy + dy).toFixed(2)), blocked: false });
              else setGroupDrag({ ...groupDrag, blocked: true });
              return;
            }
            if (!drag || drag.id !== element.id) return;
            const point = pointFromEvent(event);
            onMove(element.id, point.x - drag.dx, point.y - drag.dy);
          }}
          onPointerUp={() => { setDrag(null); setGroupDrag(null); }}
          onPointerCancel={() => { setDrag(null); setGroupDrag(null); }}
        >
          <span className="element-icon">{spec.icon}</span><span className="element-name">{element.name}</span><small>{element.displayWidth.toFixed(1)} × {element.displayHeight.toFixed(1)} m</small>
          {issueIds.has(element.id) && mode !== 'edit' ? <span className="issue-dot">!</span> : null}
          {selectedIdSet.has(element.id) && selectedIds.length > 1 ? <span className="multi-select-mark">✓</span> : null}
        </button>;
      })}
      {marqueeRect ? <div className={`marquee-rect ${marquee?.additive ? 'is-additive' : ''}`} style={{ left: `${pctX(marqueeRect.left)}%`, top: `${pctY(marqueeRect.top)}%`, width: `${pctX(marqueeRect.right - marqueeRect.left)}%`, height: `${pctY(marqueeRect.bottom - marqueeRect.top)}%` }} /> : null}
      <div className="axis-hint">{marquee?.active ? '松开完成框选 · Esc 取消' : selectedIds.length > 1 ? `已选 ${selectedIds.length} 个：拖动可整体平移 · Shift/⌃ 点击加选` : '拖动元素 · 空白处框选 · Shift/⌃ 加选'}</div>
    </div>
    <div className="canvas-legend"><span><i className="legend-dot green" />可通行</span><span><i className="legend-dot coral" />需关注</span><span><i className="legend-line" />访问路径</span><span><i className="legend-marquee" />框选 / 加选</span></div>
  </div>;
}

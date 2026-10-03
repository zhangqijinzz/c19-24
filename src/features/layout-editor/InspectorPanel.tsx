import { useState } from 'react';
import type { AlignMode } from '../../domain';
import type { RenderElement } from '../../types';

interface InspectorPanelProps {
  selectedElements: RenderElement[];
  selectionCount: number;
  onRename: (name: string) => void;
  onResize: (width: number | null, height: number | null) => void;
  onResizeMany: (width: number | null, height: number | null) => void;
  onAlign: (mode: AlignMode) => void;
  onDistribute: (axis: 'x' | 'y') => void;
  onRotate: () => void;
  onDelete: () => void;
}

export function InspectorPanel({ selectedElements, selectionCount, onRename, onResize, onResizeMany, onAlign, onDistribute, onRotate, onDelete }: InspectorPanelProps) {
  const count = selectedElements.length;
  return <section className="panel inspector-panel">
    <div className="panel-heading"><div><span className="section-kicker">SELECTION</span><h2>属性面板</h2></div>{count ? <span className="count-badge selected-badge">{count}</span> : <span className="selection-indicator" />}</div>
    {count === 0 ? <div className="empty-inspector"><span>⌁</span><p>点击或框选场地中的元素<br />开始调整布局</p></div>
      : count === 1 ? <SelectedFields element={selectedElements[0]} onRename={onRename} onResize={onResize} onRotate={onRotate} onDelete={onDelete} />
        : <MultiSelectedFields elements={selectedElements} count={selectionCount} onResizeMany={onResizeMany} onAlign={onAlign} onDistribute={onDistribute} onRotate={onRotate} onDelete={onDelete} />}
  </section>;
}

interface SelectedFieldsProps { element: RenderElement; onRename: (name: string) => void; onResize: (width: number | null, height: number | null) => void; onRotate: () => void; onDelete: () => void; }

function SelectedFields({ element, onRename, onResize, onRotate, onDelete }: SelectedFieldsProps) {
  return <div className="selected-fields">
    <div className="selected-kind"><span className="selected-symbol">{element.kind === 'stage' ? '✦' : element.kind === 'entrance' ? '↗' : element.kind === 'seating' ? '▤' : '▦'}</span><div><strong>{element.kind.toUpperCase()}</strong><small>ID · {element.id.slice(0, 12)}</small></div></div>
    <label className="field-label-input">名称<input aria-label="元素名称" value={element.name} onChange={(event) => onRename(event.target.value)} /></label>
    <div className="dimension-grid"><label>宽度<input aria-label="元素宽度" type="number" min="1" step="0.5" value={element.width} onChange={(event) => onResize(Number(event.target.value), null)} /></label><label>深度<input aria-label="元素深度" type="number" min="1" step="0.5" value={element.height} onChange={(event) => onResize(null, Number(event.target.value))} /></label></div>
    <div className="transform-readout"><span>位置 <strong>{element.x.toFixed(1)}, {element.y.toFixed(1)}</strong></span><span>旋转 <strong>{element.rotation}°</strong></span><span>占地 <strong>{element.occupiedArea.toFixed(1)} m²</strong></span></div>
    <div className="inspector-actions"><button type="button" className="secondary-button" onClick={onRotate}>↻ 旋转 90°</button><button type="button" className="icon-button danger" aria-label="删除元素" onClick={onDelete}>⌫</button></div>
  </div>;
}

interface MultiSelectedFieldsProps {
  elements: RenderElement[];
  count: number;
  onResizeMany: (width: number | null, height: number | null) => void;
  onAlign: (mode: AlignMode) => void;
  onDistribute: (axis: 'x' | 'y') => void;
  onRotate: () => void;
  onDelete: () => void;
}

const MIXED = '混合';

const kindIcon = (kind: RenderElement['kind']) => kind === 'stage' ? '✦' : kind === 'entrance' ? '↗' : kind === 'seating' ? '▤' : '▦';

const alignButtons: Array<{ mode: AlignMode; icon: string; label: string }> = [
  { mode: 'left', icon: '⬅', label: '左对齐' },
  { mode: 'centerX', icon: '↔', label: '水平居中' },
  { mode: 'right', icon: '➡', label: '右对齐' },
  { mode: 'top', icon: '⬆', label: '顶对齐' },
  { mode: 'centerY', icon: '↕', label: '垂直居中' },
  { mode: 'bottom', icon: '⬇', label: '底对齐' },
];

function MultiSelectedFields({ elements, count, onResizeMany, onAlign, onDistribute, onRotate, onDelete }: MultiSelectedFieldsProps) {
  const [widthDraft, setWidthDraft] = useState('');
  const [heightDraft, setHeightDraft] = useState('');

  const widths = new Set(elements.map((element) => Number(element.width.toFixed(1))));
  const heights = new Set(elements.map((element) => Number(element.height.toFixed(1))));
  const rotations = new Set(elements.map((element) => element.rotation));
  const kinds = new Map<string, number>();
  elements.forEach((element) => kinds.set(element.kind, (kinds.get(element.kind) ?? 0) + 1));
  const kindLabel = [...kinds.entries()].map(([kind, amount]) => `${kind.toUpperCase()} ×${amount}`).join(' · ');
  const totalArea = elements.reduce((sum, element) => sum + element.occupiedArea, 0);
  const minX = Math.min(...elements.map((e) => e.x));
  const minY = Math.min(...elements.map((e) => e.y));
  const maxX = Math.max(...elements.map((e) => e.x + e.displayWidth));
  const maxY = Math.max(...elements.map((e) => e.y + e.displayHeight));

  // 批量统一：失焦/回车才提交；非法输入直接丢弃，避免出现"看似改了一半"的草稿
  const commitDimension = (axis: 'width' | 'height') => {
    const draft = axis === 'width' ? widthDraft : heightDraft;
    if (draft.trim() === '') return;
    const value = Number(draft);
    if (!Number.isFinite(value) || value <= 0) {
      if (axis === 'width') setWidthDraft('');
      else setHeightDraft('');
      return;
    }
    onResizeMany(axis === 'width' ? value : null, axis === 'height' ? value : null);
    // 草稿已完成提交：接受时输入框回到"当前值"，被校验拒绝时文档未变，
    // 输入框同样回到旧值/「混合」呈现，拒绝原因由状态栏提示，不会停留在半截状态。
    if (axis === 'width') setWidthDraft('');
    else setHeightDraft('');
  };

  return <div className="selected-fields multi-selected" key={elements.map((e) => e.id).join('-')}>
    <div className="multi-summary">
      <span className="multi-avatars">{[...new Set(elements.map((e) => kindIcon(e.kind)))].map((icon) => <i key={icon}>{icon}</i>)}</span>
      <div><strong>已选 {count} 个元素</strong><small>{kindLabel}</small></div>
    </div>

    <div className="multi-section-title">统一尺寸<small>留空表示不修改该维度；数值不一致时显示「混合」</small></div>
    <div className="dimension-grid">
      <label>宽度<input key={`w-${widths.size}`} aria-label="统一宽度" type="number" min="1" step="0.5" placeholder={widths.size > 1 ? MIXED : [...widths][0].toString()} value={widthDraft} onChange={(event) => setWidthDraft(event.target.value)} onBlur={() => commitDimension('width')} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>
      <label>深度<input key={`h-${heights.size}`} aria-label="统一深度" type="number" min="1" step="0.5" placeholder={heights.size > 1 ? MIXED : [...heights][0].toString()} value={heightDraft} onChange={(event) => setHeightDraft(event.target.value)} onBlur={() => commitDimension('height')} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>
    </div>

    <div className="multi-section-title">对齐</div>
    <div className="align-grid">
      {alignButtons.map((button) => <button key={button.mode} type="button" className="align-button" title={button.label} aria-label={button.label} onClick={() => onAlign(button.mode)}>{button.icon}</button>)}
    </div>

    <div className="multi-section-title">等距分布<small>至少 3 个元素，首尾位置固定</small></div>
    <div className="distribute-row">
      <button type="button" className="secondary-button" disabled={count < 3} onClick={() => onDistribute('x')}>↔ 水平等距</button>
      <button type="button" className="secondary-button" disabled={count < 3} onClick={() => onDistribute('y')}>↕ 垂直等距</button>
    </div>

    <div className="transform-readout">
      <span>选区范围 <strong>{(maxX - minX).toFixed(1)} × {(maxY - minY).toFixed(1)} m</strong></span>
      <span>旋转 <strong>{rotations.size > 1 ? '混合' : `${[...rotations][0]}°`}</strong></span>
      <span>总占地 <strong>{totalArea.toFixed(1)} m²</strong></span>
    </div>
    <div className="inspector-actions">
      <button type="button" className="secondary-button" onClick={onRotate}>↻ 全部旋转 90°</button>
      <button type="button" className="delete-many-button danger" onClick={onDelete}>⌫ 删除 {count} 个</button>
    </div>
  </div>;
}

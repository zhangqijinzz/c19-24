import { useMemo, useState } from 'react';
import { planDistribution } from '../../batchEditing';
import { MIN_CHANNEL } from '../../domain';
import type { AlignmentType, DistributionType, RenderElement, SelectionBounds } from '../../types';

interface InspectorPanelProps {
  selectedElements: RenderElement[];
  selectionBounds: SelectionBounds | null;
  onRename: (name: string) => void;
  onResize: (width: number, height: number) => void;
  onRotate: () => void;
  onDelete: () => void;
  onAlign: (alignment: AlignmentType) => void;
  onDistribute: (direction: DistributionType) => void;
  onUnifySize: (width?: number, height?: number) => void;
}

const KIND_ICON: Record<string, string> = { stage: '✦', entrance: '↗', seating: '▤', booth: '▦' };

const useUnifiedValue = (elements: RenderElement[], pick: (element: RenderElement) => number) => {
  const values = new Set(elements.map((element) => pick(element)));
  return values.size === 1 ? pick(elements[0]) : null;
};

export function InspectorPanel({ selectedElements, selectionBounds, onRename, onResize, onRotate, onDelete, onAlign, onDistribute, onUnifySize }: InspectorPanelProps) {
  const count = selectedElements.length;
  return <section className="panel inspector-panel">
    <div className="panel-heading"><div><span className="section-kicker">SELECTION</span><h2>属性面板</h2></div><span className={`selection-indicator ${count > 1 ? 'is-multi' : ''}`}>{count > 1 ? count : ''}</span></div>
    {count === 0 ? <div className="empty-inspector"><span>⌁</span><p>点击或框选场地中的元素<br />开始调整布局</p></div>
      : count === 1 ? <SelectedFields element={selectedElements[0]} onRename={onRename} onResize={onResize} onRotate={onRotate} onDelete={onDelete} />
        : <MultiSelectedFields elements={selectedElements} bounds={selectionBounds} onRotate={onRotate} onDelete={onDelete} onAlign={onAlign} onDistribute={onDistribute} onUnifySize={onUnifySize} />}
  </section>;
}

interface SelectedFieldsProps { element: RenderElement; onRename: (name: string) => void; onResize: (width: number, height: number) => void; onRotate: () => void; onDelete: () => void; }

function SelectedFields({ element, onRename, onResize, onRotate, onDelete }: SelectedFieldsProps) {
  return <div className="selected-fields">
    <div className="selected-kind"><span className="selected-symbol">{KIND_ICON[element.kind] ?? '▦'}</span><div><strong>{element.kind.toUpperCase()}</strong><small>ID · {element.id.slice(0, 12)}</small></div></div>
    <label className="field-label-input">名称<input aria-label="元素名称" value={element.name} onChange={(event) => onRename(event.target.value)} /></label>
    <div className="dimension-grid"><label>宽度<input aria-label="元素宽度" type="number" min="1" step="0.5" value={element.width} onChange={(event) => onResize(Number(event.target.value), element.height)} /></label><label>深度<input aria-label="元素深度" type="number" min="1" step="0.5" value={element.height} onChange={(event) => onResize(element.width, Number(event.target.value))} /></label></div>
    <div className="transform-readout"><span>位置 <strong>{element.x.toFixed(1)}, {element.y.toFixed(1)}</strong></span><span>旋转 <strong>{element.rotation}°</strong></span><span>占地 <strong>{element.occupiedArea.toFixed(1)} m²</strong></span></div>
    <div className="inspector-actions"><button type="button" className="secondary-button" onClick={onRotate}>↻ 旋转 90°</button><button type="button" className="icon-button danger" aria-label="删除元素" onClick={onDelete}>⌫</button></div>
  </div>;
}

interface MultiSelectedFieldsProps {
  elements: RenderElement[];
  bounds: SelectionBounds | null;
  onRotate: () => void;
  onDelete: () => void;
  onAlign: (alignment: AlignmentType) => void;
  onDistribute: (direction: DistributionType) => void;
  onUnifySize: (width?: number, height?: number) => void;
}

function MultiSelectedFields({ elements, bounds, onRotate, onDelete, onAlign, onDistribute, onUnifySize }: MultiSelectedFieldsProps) {
  const commonWidth = useUnifiedValue(elements, (element) => element.width);
  const commonHeight = useUnifiedValue(elements, (element) => element.height);
  const commonRotation = useUnifiedValue(elements, (element) => element.rotation);
  const kindSummary = useMemo(() => {
    const counts = new Map<string, number>();
    elements.forEach((element) => counts.set(element.kind, (counts.get(element.kind) ?? 0) + 1));
    return Array.from(counts.entries()).map(([kind, amount]) => `${KIND_ICON[kind] ?? ''} ×${amount}`).join('   ');
  }, [elements]);

  const [widthDraft, setWidthDraft] = useState('');
  const [heightDraft, setHeightDraft] = useState('');
  const selectedIds = elements.map((element) => element.id);
  const distributionH = planDistribution(elements, selectedIds, 'horizontal');
  const distributionV = planDistribution(elements, selectedIds, 'vertical');

  const submitWidth = () => {
    const value = Number(widthDraft);
    if (widthDraft !== '' && value > 0) onUnifySize(value, undefined);
    setWidthDraft('');
  };
  const submitHeight = () => {
    const value = Number(heightDraft);
    if (heightDraft !== '' && value > 0) onUnifySize(undefined, value);
    setHeightDraft('');
  };

  return <div className="selected-fields multi-fields">
    <div className="selected-kind multi-kind"><span className="selected-symbol">▣</span><div><strong>批量选择 · {elements.length} 个元素</strong><small>{kindSummary || '混合类型'}</small></div></div>

    <div className="batch-block">
      <span className="batch-title">统一尺寸</span>
      <div className="dimension-grid">
        <label>统一宽度<input aria-label="统一宽度" type="number" min="0.5" step="0.5" placeholder={commonWidth === null ? '多种宽度' : String(commonWidth)} value={widthDraft} onChange={(event) => setWidthDraft(event.target.value)} onBlur={submitWidth} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>
        <label>统一深度<input aria-label="统一深度" type="number" min="0.5" step="0.5" placeholder={commonHeight === null ? '多种深度' : String(commonHeight)} value={heightDraft} onChange={(event) => setHeightDraft(event.target.value)} onBlur={submitHeight} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>
      </div>
      <p className="batch-hint">{commonWidth !== null && commonHeight !== null ? `当前全部为 ${commonWidth} × ${commonHeight} m` : '留空表示该维度保持不变；越界或重叠时整批取消'}</p>
    </div>

    <div className="batch-block">
      <span className="batch-title">对齐</span>
      <div className="align-grid">
        <button type="button" title="左对齐" onClick={() => onAlign('left')}>⇤</button>
        <button type="button" title="水平居中" onClick={() => onAlign('center-h')}>↔</button>
        <button type="button" title="右对齐" onClick={() => onAlign('right')}>⇥</button>
        <button type="button" title="顶对齐" onClick={() => onAlign('top')}>⇧</button>
        <button type="button" title="垂直居中" onClick={() => onAlign('center-v')}>↕</button>
        <button type="button" title="底对齐" onClick={() => onAlign('bottom')}>⇩</button>
      </div>
    </div>

    <div className="batch-block">
      <span className="batch-title">等距分布 <small>至少 3 个元素 · 保持 ≥ {MIN_CHANNEL} m 通道</small></span>
      <div className="distribute-grid">
        <button type="button" disabled={!distributionH.feasible} title={distributionH.feasible ? '横向等距分布' : distributionH.reason === 'distribute-count' ? '至少需要 3 个元素' : '排布空间不足'} onClick={() => onDistribute('horizontal')}>⇆ 横向均布{distributionH.feasible && 'tight' in distributionH && distributionH.tight ? ' ⚠' : ''}</button>
        <button type="button" disabled={!distributionV.feasible} title={distributionV.feasible ? '纵向等距分布' : distributionV.reason === 'distribute-count' ? '至少需要 3 个元素' : '排布空间不足'} onClick={() => onDistribute('vertical')}>⇅ 纵向均布{distributionV.feasible && 'tight' in distributionV && distributionV.tight ? ' ⚠' : ''}</button>
      </div>
    </div>

    <div className="transform-readout">
      <span>影响范围 <strong>{bounds ? `${bounds.width.toFixed(1)} × ${bounds.height.toFixed(1)} m` : '—'}</strong></span>
      <span>包围盒起点 <strong>{bounds ? `${bounds.left.toFixed(1)}, ${bounds.top.toFixed(1)}` : '—'}</strong></span>
      <span>旋转 <strong>{commonRotation === null ? '多种角度' : `${commonRotation}°`}</strong></span>
    </div>
    <div className="inspector-actions"><button type="button" className="secondary-button" onClick={onRotate}>↻ 全部旋转 90°</button><button type="button" className="danger-button" onClick={onDelete}>⌫ 删除 {elements.length} 个</button></div>
  </div>;
}

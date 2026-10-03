import { useEffect, useState } from 'react';
import { AnalysisPanel } from './features/analysis-preview/AnalysisPanel';
import { StatusBar } from './features/analysis-preview/StatusBar';
import { ElementPalette } from './features/element-library/ElementPalette';
import { FieldSettingsPanel } from './features/field-setup/FieldSettingsPanel';
import { FieldCanvas } from './features/layout-editor/FieldCanvas';
import { InspectorPanel } from './features/layout-editor/InspectorPanel';
import { useExpoSketchViewModel } from './hooks/useExpoSketchViewModel';

function App() {
  const { state, vm } = useExpoSketchViewModel();
  const [projectTitle, setProjectTitle] = useState('');

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (typing) return;
      if ((event.key === 'Delete' || event.key === 'Backspace') && state.selectedIds.length) {
        event.preventDefault();
        vm.removeSelected();
      }
      if (event.key === 'Escape') vm.clearSelection();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [vm, state.selectedIds]);

  if (state.phase === 'loading') return <div className="loading-screen"><div className="loading-mark">✦</div><strong>正在打开 ExpoSketch</strong><span>恢复最近一次场地布局…</span></div>;

  return <div className="app-shell">
    <aside className="left-rail">
      <div className="brand"><div className="brand-mark">✦</div><div><strong>ExpoSketch</strong><span>SPACE PLANNER</span></div></div>
      <div className="project-heading"><span className="section-kicker">CURRENT PROJECT</span><input aria-label="项目名称" value={projectTitle || state.document.title} onChange={(event) => setProjectTitle(event.target.value)} onBlur={() => { if (projectTitle.trim()) { vm.renameProject(projectTitle); setProjectTitle(''); } }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></div>
      <div className="rail-divider" />
      <ElementPalette onAdd={vm.addElement.bind(vm)} />
      <div className="tips-card"><span className="tips-icon">⌘</span><div><strong>快速提示</strong><p>空白处拖动可框选多个元素<br />Shift / ⌃ 点击加选 · Delete 批量删除</p></div></div>
      <div className="rail-footer"><span className="online-dot" />本地工作区 <span className="version">v0.1</span></div>
    </aside>
    <main className="main-stage">
      <header className="topbar"><div className="breadcrumb"><span>我的项目</span><b>/</b><strong>{state.document.title}</strong></div><div className="top-actions"><span className="autosave-label"><i /> 自动保存已开启</span><button type="button" className="share-button">导出布局 <span>↗</span></button><button type="button" className="avatar-button">Z</button></div></header>
      <div className="workspace-heading"><div><span className="section-kicker">LAYOUT EDITOR / A-01</span><h1>场地布局编辑器</h1><p>用拖放方式规划区域，保持主要通道畅通。</p></div><div className="heading-stats"><div><strong>{state.document.elements.length}</strong><span>元素</span></div><div><strong>{state.document.field.width}×{state.document.field.height}</strong><span>场地尺寸</span></div>{state.selectedIds.length > 1 ? <div><strong>{state.selectedIds.length}</strong><span>已选中</span></div> : null}</div></div>
      <div className="editor-grid">
        <section className="canvas-panel"><div className="canvas-toolbar"><div className="toolbar-title"><span className="tool-grid">▦</span><div><strong>展厅平面图</strong><small>比例 1 : 100 · 单位：米</small></div></div><div className="toolbar-actions">{state.selectedIds.length > 1 ? <span className="selection-toolbar-chip">已选 {state.selectedIds.length} 个 · 可批量对齐 / 均布 / 删除</span> : null}<span className="zoom-label">⌕ 100%</span><button type="button" aria-label="更多布局选项">•••</button></div></div><FieldCanvas field={state.document.field} elements={state.renderElements} selectedIds={state.selectedIds} selectionBounds={state.selectionBounds} mode={state.mode} overlaps={state.analysis.overlaps} bounds={state.analysis.bounds} channels={state.analysis.channels} path={state.analysis.path} onSelect={vm.selectElement.bind(vm)} onMove={vm.moveElement.bind(vm)} onGroupMove={vm.moveGroup.bind(vm)} onMarquee={vm.selectInRect.bind(vm)} onClearSelection={() => vm.clearSelection()} /></section>
        <aside className="inspector"><InspectorPanel selectedElements={state.selectedElements} selectionBounds={state.selectionBounds} onRename={vm.renameSelected.bind(vm)} onResize={vm.resizeSelected.bind(vm)} onRotate={vm.rotateSelected.bind(vm)} onDelete={vm.removeSelected.bind(vm)} onAlign={vm.alignSelected.bind(vm)} onDistribute={vm.distributeSelected.bind(vm)} onUnifySize={vm.unifyDimensions.bind(vm)} /><FieldSettingsPanel document={state.document} onResizeField={vm.resizeField.bind(vm)} onReset={vm.resetExample.bind(vm)} /></aside>
      </div>
      <AnalysisPanel analysis={state.analysis} mode={state.mode} elementCount={state.document.elements.length} />
      <StatusBar mode={state.mode} analysis={state.analysis} notice={state.notice} elementCount={state.document.elements.length} selectedCount={state.selectedIds.length} lastSavedAt={state.lastSavedAt} onModeChange={vm.setMode.bind(vm)} />
    </main>
  </div>;
}

export default App;

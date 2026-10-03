import { createElement, createStarterDocument, analyzeLayout, getBoundingBox, normalizeRotation } from './domain';
import { getSelectionBounds, planBatchOperation, planGroupMove } from './batchEditing';
import type { LayoutRepository } from './repository';
import type {
  AlignmentType,
  Analysis,
  BatchOperation,
  DistributionType,
  ElementKind,
  LayoutDocument,
  LayoutMode,
  Notice,
  RenderElement,
  SelectionBounds,
  ViewPhase,
} from './types';

export interface ExpoSketchState {
  phase: ViewPhase;
  document: LayoutDocument;
  renderElements: RenderElement[];
  selectedId: string | null;
  selectedIds: string[];
  selectedElements: RenderElement[];
  selectedElement: RenderElement | null;
  selectionBounds: SelectionBounds | null;
  mode: LayoutMode;
  analysis: Analysis;
  notice: Notice;
  lastSavedAt: number | null;
}

const toRenderElements = (document: LayoutDocument): RenderElement[] => document.elements.map((element) => {
  const box = getBoundingBox(element);
  return { ...element, displayWidth: box.width, displayHeight: box.height, occupiedArea: Number((box.width * box.height).toFixed(1)) };
});

const starter = createStarterDocument();
const starterRenderElements = toRenderElements(starter);

type Listener = () => void;

export class ExpoSketchViewModel {
  private listeners = new Set<Listener>();
  private stateValue: ExpoSketchState = {
    phase: 'loading',
    document: starter,
    renderElements: starterRenderElements,
    selectedId: 'stage-1',
    selectedIds: ['stage-1'],
    selectedElements: starterRenderElements.filter((element) => element.id === 'stage-1'),
    selectedElement: starterRenderElements.find((element) => element.id === 'stage-1') ?? null,
    selectionBounds: getSelectionBounds(starter.elements, ['stage-1']),
    mode: 'edit',
    analysis: analyzeLayout(createStarterDocument()),
    notice: { tone: 'info', message: '正在恢复最近布局…' },
    lastSavedAt: null,
  };

  constructor(private readonly repository: LayoutRepository) {}

  get state() { return this.stateValue; }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async initialize() {
    try {
      const document = await this.repository.load();
      const selectedId = document.elements[0]?.id ?? null;
      this.commit({ document, selectedId, selectedIds: selectedId ? [selectedId] : [], phase: 'ready', notice: { tone: 'success', message: '布局已就绪，可开始编辑' } });
    } catch {
      this.commit({ phase: 'error', notice: { tone: 'error', message: '布局读取失败，已载入安全示例' } });
    }
  }

  selectElement(id: string, additive = false) {
    if (additive) {
      const exists = this.stateValue.selectedIds.includes(id);
      const nextIds = exists ? this.stateValue.selectedIds.filter((selected) => selected !== id) : [...this.stateValue.selectedIds, id];
      this.commit({ selectedIds: nextIds, selectedId: nextIds[nextIds.length - 1] ?? null });
      return;
    }
    this.commit({ selectedIds: [id], selectedId: id });
  }

  /** 框选结束提交；additive 时与当前选区求并集。选区里若带有已删除的 id 会自动剔除。 */
  selectInRect(ids: string[], additive = false) {
    const validIds = this.stateValue.document.elements.map((element) => element.id);
    const merged = additive ? Array.from(new Set([...this.stateValue.selectedIds, ...ids])) : ids;
    const nextIds = merged.filter((id) => validIds.includes(id));
    if (!nextIds.length) {
      this.clearSelection(additive ? undefined : '框选区域内没有可选元素');
      return;
    }
    this.commit({ selectedIds: nextIds, selectedId: nextIds[nextIds.length - 1], notice: { tone: 'info', message: `已框选 ${nextIds.length} 个元素` } });
  }

  clearSelection(message?: string) {
    this.commit({ selectedIds: [], selectedId: null, ...(message ? { notice: { tone: 'info' as const, message } } : {}) });
  }

  setMode(mode: LayoutMode) { this.commit({ mode, notice: { tone: 'info', message: mode === 'inspect' ? '检查模式已开启：拖动元素查看即时提示' : mode === 'path' ? '路径模式已开启：入口到重点区域的访问路线已生成' : '编辑模式已开启' } }); }

  addElement(kind: ElementKind) {
    const element = createElement(kind, this.stateValue.document.elements.length, this.stateValue.document.field);
    const document = { ...this.stateValue.document, elements: [...this.stateValue.document.elements, element] };
    this.commitAndPersist({ document, selectedId: element.id, selectedIds: [element.id], notice: { tone: 'success', message: `${element.name} 已加入场地` } });
  }

  removeSelected() {
    const ids = this.stateValue.selectedIds;
    if (!ids.length) return;
    const removedNames = this.stateValue.document.elements.filter((element) => ids.includes(element.id)).map((element) => element.name);
    const elements = this.stateValue.document.elements.filter((element) => !ids.includes(element.id));
    const fallbackId = elements[0]?.id ?? null;
    this.commitAndPersist({
      document: { ...this.stateValue.document, elements },
      selectedId: fallbackId,
      selectedIds: fallbackId ? [fallbackId] : [],
      notice: { tone: 'info', message: removedNames.length > 1 ? `已删除选中的 ${removedNames.length} 个元素` : `已移除「${removedNames[0] ?? '元素'}」` },
    });
  }

  moveElement(id: string, x: number, y: number) {
    const elements = this.stateValue.document.elements.map((element) => element.id === id ? { ...element, x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) } : element);
    this.commitAndPersist({ document: { ...this.stateValue.document, elements } });
  }

  /** 多选整体拖动：越界自动限位，碰到其它元素或压住通道则整组回退，绝不留下半个位移。 */
  moveGroup(dx: number, dy: number): boolean {
    const ids = this.stateValue.selectedIds;
    if (ids.length < 2) return false;
    const plan = planGroupMove(this.stateValue.document.field, this.stateValue.document.elements, ids, dx, dy);
    if (plan.clampedDx === 0 && plan.clampedDy === 0) {
      if (plan.reverts) {
        // 只更新提示，不触发持久化（文档没有任何变化）
        this.commit({ notice: { tone: 'warning', message: '整体移动会压住其它元素或通道，已回到拖动前的位置' } });
      }
      return false;
    }
    const shiftX = plan.clampedDx;
    const shiftY = plan.clampedDy;
    const idSet = new Set(ids);
    const elements = this.stateValue.document.elements.map((element) => idSet.has(element.id) ? { ...element, x: Number((element.x + shiftX).toFixed(1)), y: Number((element.y + shiftY).toFixed(1)) } : element);
    this.commitAndPersist({ document: { ...this.stateValue.document, elements } });
    return true;
  }

  resizeSelected(width: number, height: number) {
    const id = this.stateValue.selectedId;
    if (!id || width <= 0 || height <= 0) return;
    const elements = this.stateValue.document.elements.map((element) => element.id === id ? { ...element, width: Number(width.toFixed(1)), height: Number(height.toFixed(1)) } : element);
    this.commitAndPersist({ document: { ...this.stateValue.document, elements } });
  }

  rotateSelected() {
    const ids = this.stateValue.selectedIds;
    if (!ids.length) return;
    if (ids.length === 1) {
      const id = ids[0];
      const elements = this.stateValue.document.elements.map((element) => element.id === id ? { ...element, rotation: normalizeRotation(element.rotation + 90) } : element);
      this.commitAndPersist({ document: { ...this.stateValue.document, elements }, notice: { tone: 'info', message: '方向已旋转 90°' } });
      return;
    }
    this.applyBatch({ type: 'rotate' });
  }

  renameSelected(name: string) {
    const id = this.stateValue.selectedId;
    if (!id || !name.trim()) return;
    const elements = this.stateValue.document.elements.map((element) => element.id === id ? { ...element, name: name.trim() } : element);
    this.commitAndPersist({ document: { ...this.stateValue.document, elements } });
  }

  alignSelected(alignment: AlignmentType) {
    this.applyBatch({ type: 'align', alignment });
  }

  distributeSelected(direction: DistributionType) {
    this.applyBatch({ type: 'distribute', direction });
  }

  unifyDimensions(width?: number, height?: number) {
    this.applyBatch({ type: 'resize', width, height });
  }

  private applyBatch(operation: BatchOperation) {
    const plan = planBatchOperation(this.stateValue.document.field, this.stateValue.document.elements, this.stateValue.selectedIds, operation);
    if (!plan.outcome.ok) {
      this.commit({ notice: { tone: 'error', message: plan.outcome.message } });
      return;
    }
    const tone = plan.tightChannel ? 'warning' : 'success';
    this.commitAndPersist({
      document: { ...this.stateValue.document, elements: plan.outcome.elements },
      notice: { tone, message: plan.outcome.message },
    });
  }

  resizeField(width: number, height: number) {
    if (width < 12 || height < 10) return;
    this.commitAndPersist({ document: { ...this.stateValue.document, field: { width: Number(width.toFixed(1)), height: Number(height.toFixed(1)) } }, notice: { tone: 'success', message: '场地尺寸已更新' } });
  }

  /** 供外部存储同步 / 撤销恢复使用：换入新文档后选区会自动剔除已不存在的元素。 */
  replaceDocument(document: LayoutDocument) {
    this.commit({ document });
  }

  renameProject(title: string) {
    if (!title.trim()) return;
    this.commitAndPersist({ document: { ...this.stateValue.document, title: title.trim() } });
  }

  resetExample() {
    const document = createStarterDocument();
    this.commitAndPersist({ document, selectedId: 'stage-1', selectedIds: ['stage-1'], mode: 'edit', notice: { tone: 'success', message: '已恢复示例布局' } });
  }

  private commitAndPersist(patch: Partial<ExpoSketchState>) {
    this.commit(patch);
    void this.persist();
  }

  private async persist() {
    try {
      await this.repository.save(this.stateValue.document);
      this.commit({ lastSavedAt: Date.now() });
    } catch {
      this.commit({ notice: { tone: 'error', message: '本地保存失败，当前编辑仍保留在页面中' } });
    }
  }

  private commit(patch: Partial<ExpoSketchState>) {
    const next = { ...this.stateValue, ...patch };
    const renderElements = toRenderElements(next.document);
    const validIds = new Set(renderElements.map((element) => element.id));
    const selectedIds = (patch.selectedIds !== undefined ? next.selectedIds : this.stateValue.selectedIds).filter((id) => validIds.has(id));
    const selectedId: string | null = next.selectedId && selectedIds.includes(next.selectedId) ? next.selectedId : selectedIds[selectedIds.length - 1] ?? null;
    this.stateValue = {
      ...next,
      renderElements,
      selectedIds,
      selectedId,
      selectedElements: renderElements.filter((element) => selectedIds.includes(element.id)),
      selectedElement: renderElements.find((element) => element.id === selectedId) ?? null,
      selectionBounds: getSelectionBounds(next.document.elements, selectedIds),
      analysis: analyzeLayout(next.document),
    };
    this.listeners.forEach((listener) => listener());
  }
}

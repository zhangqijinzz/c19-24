import {
  alignElements,
  analyzeLayout,
  createElement,
  createStarterDocument,
  distributeElements,
  findPlanViolations,
  getBoundingBox,
  hitTestRect,
  normalizeRotation,
  unionBounds,
} from './domain';
import type {
  AlignMode,
  DistributeAxis,
  PlanViolation,
} from './domain';
import type { LayoutRepository } from './repository';
import type {
  Analysis,
  ElementKind,
  ExpoElement,
  LayoutDocument,
  LayoutMode,
  Notice,
  Rect,
  RenderElement,
  ViewPhase,
} from './types';

export interface ExpoSketchState {
  phase: ViewPhase;
  document: LayoutDocument;
  renderElements: RenderElement[];
  selectedIds: string[];
  selectedElements: RenderElement[];
  /** 多选时的整体包围盒；单选或无选中时为 null */
  selectionBounds: Rect | null;
  primaryId: string | null;
  primaryElement: RenderElement | null;
  /** 整组拖拽进行中的实时选区（未落盘），用于界面提示 */
  isGroupMoving: boolean;
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

/**
 * 框选最小尺寸（场地单位，米）。画布在典型缩放下约 3px/m，1.5m ≈ 5px，
 * 与画布的像素拖动阈值保持一致，避免"画布开始框选、VM 却忽略"的中间状态。
 */
const MARQUEE_MIN_SIZE = 1.5;

type Listener = () => void;

export class ExpoSketchViewModel {
  private listeners = new Set<Listener>();
  private stateValue: ExpoSketchState = {
    phase: 'loading',
    document: starter,
    renderElements: starterRenderElements,
    selectedIds: ['stage-1'],
    selectedElements: starterRenderElements.filter((element) => element.id === 'stage-1'),
    selectionBounds: null,
    primaryId: 'stage-1',
    primaryElement: starterRenderElements.find((element) => element.id === 'stage-1') ?? null,
    isGroupMoving: false,
    mode: 'edit',
    analysis: analyzeLayout(createStarterDocument()),
    notice: { tone: 'info', message: '正在恢复最近布局…' },
    lastSavedAt: null,
  };

  /** 整组拖拽开始时的快照，校验失败时整体回滚到这里 */
  private groupSnapshot: ExpoElement[] | null = null;
  private groupStartBounds: Rect | null = null;
  /** 拖拽开始时的分析快照：移动过程中 state.analysis 会不断变化，校验必须以起点为基线 */
  private groupBaselineAnalysis: Analysis | null = null;

  constructor(private readonly repository: LayoutRepository) {}

  get state() { return this.stateValue; }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async initialize() {
    try {
      const document = await this.repository.load();
      const firstId = document.elements[0]?.id ?? null;
      this.commit({ document, selectedIds: firstId ? [firstId] : [], phase: 'ready', notice: { tone: 'success', message: '布局已就绪，可开始编辑' } });
    } catch {
      this.commit({ phase: 'error', notice: { tone: 'error', message: '布局读取失败，已载入安全示例' } });
    }
  }

  // —— 选择 ——

  selectElement(id: string) { this.commit({ selectedIds: [id] }); }

  /** 按住 Shift/Ctrl 点击：在选区中切换该元素 */
  toggleSelection(id: string) {
    const ids = this.liveSelectedIds();
    const next = ids.includes(id) ? ids.filter((existing) => existing !== id) : [...ids, id];
    this.commit({ selectedIds: next });
  }

  /** Shift+拖拽元素时，把尚未选中的元素先并入选区 */
  addToSelection(id: string) {
    const ids = this.liveSelectedIds();
    if (ids.includes(id)) return;
    this.commit({ selectedIds: [...ids, id] });
  }

  clearSelection() {
    if (this.liveSelectedIds().length === 0) return;
    this.commit({ selectedIds: [] });
  }

  selectAll() {
    const ids = this.stateValue.document.elements.map((element) => element.id);
    this.commit({ selectedIds: ids, notice: { tone: 'info', message: `已选中全部 ${ids.length} 个元素` } });
  }

  /**
   * 框选松手：在指定矩形范围内命中的元素替换（或并入）选区。
   * 框选过程中不产生任何状态，松手时一次性提交，因此中途取消不会留下半选状态。
   */
  marqueeSelect(rect: Rect, additive: boolean) {
    if (rect.right - rect.left < MARQUEE_MIN_SIZE && rect.bottom - rect.top < MARQUEE_MIN_SIZE) return;
    const hitIds = this.stateValue.document.elements.filter((element) => hitTestRect(element, rect)).map((element) => element.id);
    if (!additive) {
      this.commit({ selectedIds: hitIds, notice: hitIds.length ? { tone: 'info', message: `框选命中 ${hitIds.length} 个元素` } : undefined });
      return;
    }
    const merged = new Set(this.liveSelectedIds());
    hitIds.forEach((id) => merged.add(id));
    const next = [...merged];
    this.commit({ selectedIds: next, notice: next.length ? { tone: 'info', message: `已加选，当前共选中 ${next.length} 个元素` } : undefined });
  }

  // —— 元素增删 ——

  addElement(kind: ElementKind) {
    const element = createElement(kind, this.stateValue.document.elements.length, this.stateValue.document.field);
    const document = { ...this.stateValue.document, elements: [...this.stateValue.document.elements, element] };
    this.commitAndPersist({ document, selectedIds: [element.id], notice: { tone: 'success', message: `${element.name} 已加入场地` } });
  }

  removeSelected() {
    const ids = new Set(this.liveSelectedIds());
    if (!ids.size) return;
    const removedNames = this.stateValue.document.elements.filter((element) => ids.has(element.id)).map((element) => element.name);
    const elements = this.stateValue.document.elements.filter((element) => !ids.has(element.id));
    const fallback = elements[0]?.id ?? null;
    this.commitAndPersist({
      document: { ...this.stateValue.document, elements },
      selectedIds: fallback ? [fallback] : [],
      notice: { tone: 'info', message: `已删除 ${removedNames.length} 个元素${removedNames.length === 1 ? `：${removedNames[0]}` : ''}` },
    });
  }

  // —— 单选编辑（保持原有行为）——

  moveElement(id: string, x: number, y: number) {
    const elements = this.stateValue.document.elements.map((element) => element.id === id ? { ...element, x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) } : element);
    this.commitAndPersist({ document: { ...this.stateValue.document, elements } });
  }

  resizeSelected(width: number | null, height: number | null, persist = true) {
    const id = this.stateValue.primaryId;
    if (!id) return;
    const nextWidth = width ?? this.stateValue.primaryElement?.width;
    const nextHeight = height ?? this.stateValue.primaryElement?.height;
    if (nextWidth === undefined || nextHeight === undefined || nextWidth <= 0 || nextHeight <= 0) return;
    const elements = this.stateValue.document.elements.map((element) => element.id === id ? { ...element, width: Number(nextWidth.toFixed(1)), height: Number(nextHeight.toFixed(1)) } : element);
    this.commitAndPersist({ document: { ...this.stateValue.document, elements } }, persist);
  }

  rotateSelected() {
    const ids = this.liveSelectedIds();
    if (!ids.length) return;
    const label = this.operationLabel('旋转');
    this.applyPlan(
      (element) => ({ rotation: normalizeRotation(element.rotation + 90) }),
      { success: { tone: 'info', message: `${label}：已旋转 90°` }, rejectAction: '旋转' },
    );
  }

  renameSelected(name: string) {
    const id = this.stateValue.primaryId;
    if (!id || !name.trim()) return;
    const elements = this.stateValue.document.elements.map((element) => element.id === id ? { ...element, name: name.trim() } : element);
    this.commitAndPersist({ document: { ...this.stateValue.document, elements } });
  }

  // —— 多选批量操作（原子：先整体校验，通过才提交）——

  resizeSelectedMany(width: number | null, height: number | null) {
    if ((width !== null && width <= 0) || (height !== null && height <= 0)) return;
    this.applyPlan(
      (element) => ({
        width: Number((width ?? element.width).toFixed(1)),
        height: Number((height ?? element.height).toFixed(1)),
      }),
      { success: { tone: 'success', message: `已统一 ${this.liveSelectedIds().length} 个元素的尺寸` }, rejectAction: '统一尺寸' },
    );
  }

  alignSelected(mode: AlignMode) {
    if (this.liveSelectedIds().length < 2) return;
    const labels: Record<AlignMode, string> = { left: '左对齐', centerX: '水平居中', right: '右对齐', top: '顶对齐', centerY: '垂直居中', bottom: '底对齐' };
    const selected = this.selectedSourceElements();
    const moves = alignElements(selected, mode);
    this.applyPlan(
      (element) => {
        const move = moves.get(element.id);
        return move ? { x: move.x, y: move.y } : {};
      },
      { success: { tone: 'success', message: `已完成${labels[mode]}（${selected.length} 个元素）` }, rejectAction: labels[mode] },
    );
  }

  distributeSelected(axis: DistributeAxis) {
    const selected = this.selectedSourceElements();
    if (selected.length < 3) return;
    const label = axis === 'x' ? '水平等距分布' : '垂直等距分布';
    const moves = distributeElements(selected, axis);
    this.applyPlan(
      (element) => {
        const move = moves.get(element.id);
        return move ? { x: move.x, y: move.y } : {};
      },
      { success: { tone: 'success', message: `已完成${label}（${selected.length} 个元素）` }, rejectAction: label },
    );
  }

  // —— 整组平移：拖拽中只更新不落盘，松手校验，失败回滚快照 ——

  startGroupMove() {
    const ids = this.liveSelectedIds();
    if (ids.length < 2 || this.groupSnapshot) return;
    this.groupSnapshot = this.stateValue.document.elements.map((element) => ({ ...element }));
    this.groupStartBounds = unionBounds(this.selectedSourceElements());
    this.groupBaselineAnalysis = this.stateValue.analysis;
    this.commit({ isGroupMoving: true });
  }

  /** 拖动过程中整体平移；delta 由当前指针位置直接计算，并对边界做钳制，保证不越界 */
  groupMoveBy(deltaX: number, deltaY: number) {
    const snapshot = this.groupSnapshot;
    const startBounds = this.groupStartBounds;
    if (!snapshot || !startBounds) return;
    const { field } = this.stateValue.document;
    const clampedX = Math.min(Math.max(deltaX, -startBounds.left), field.width - startBounds.right);
    const clampedY = Math.min(Math.max(deltaY, -startBounds.top), field.height - startBounds.bottom);
    const ids = new Set(this.liveSelectedIds());
    const elements = snapshot.map((element) => ids.has(element.id)
      ? { ...element, x: Number((element.x + clampedX).toFixed(1)), y: Number((element.y + clampedY).toFixed(1)) }
      : element);
    // 仅提交到界面，不落盘；松手校验通过后再持久化
    this.commit({ document: { ...this.stateValue.document, elements }, isGroupMoving: true });
  }

  /** 松手：无新增问题则确认落盘，否则整体回滚到拖拽前的快照 */
  finishGroupMove() {
    if (!this.groupSnapshot) return;
    const snapshot = this.groupSnapshot;
    const baseline = this.groupBaselineAnalysis ?? this.stateValue.analysis;
    this.groupSnapshot = null;
    this.groupStartBounds = null;
    this.groupBaselineAnalysis = null;
    const affected = new Set(this.liveSelectedIds());
    const violations = findPlanViolations(this.stateValue.document.field, this.stateValue.document.elements, baseline, affected);
    if (violations.length) {
      this.commitAndPersist({
        document: { ...this.stateValue.document, elements: snapshot },
        isGroupMoving: false,
        notice: { tone: 'warning', message: `整体移动已取消：会${this.summarizeViolations(violations)}，${affected.size} 个元素已回到原位` },
      });
      return;
    }
    this.commitAndPersist({ isGroupMoving: false, notice: { tone: 'success', message: `已整体移动 ${affected.size} 个元素` } });
  }

  /** 框选到一半松开以外的中断（Esc / 指针丢失）：不保留任何移动 */
  cancelGroupMove() {
    if (!this.groupSnapshot) {
      this.commit({ isGroupMoving: false });
      return;
    }
    const snapshot = this.groupSnapshot;
    this.groupSnapshot = null;
    this.groupStartBounds = null;
    this.groupBaselineAnalysis = null;
    this.commitAndPersist({ document: { ...this.stateValue.document, elements: snapshot }, isGroupMoving: false, notice: { tone: 'info', message: '移动已取消，元素回到拖拽前的位置' } });
  }

  // —— 场地与项目 ——

  resizeField(width: number, height: number) {
    if (width < 12 || height < 10) return;
    this.commitAndPersist({ document: { ...this.stateValue.document, field: { width: Number(width.toFixed(1)), height: Number(height.toFixed(1)) } }, notice: { tone: 'success', message: '场地尺寸已更新' } });
  }

  renameProject(title: string) {
    if (!title.trim()) return;
    this.commitAndPersist({ document: { ...this.stateValue.document, title: title.trim() } });
  }

  resetExample() {
    const document = createStarterDocument();
    this.commitAndPersist({ document, selectedIds: ['stage-1'], isGroupMoving: false, mode: 'edit', notice: { tone: 'success', message: '已恢复示例布局' } });
  }

  setMode(mode: LayoutMode) { this.commit({ mode, notice: { tone: 'info', message: mode === 'inspect' ? '检查模式已开启：拖动元素查看即时提示' : mode === 'path' ? '路径模式已开启：入口到重点区域的访问路线已生成' : '编辑模式已开启' } }); }

  // —— 内部 ——

  private liveSelectedIds(): string[] {
    const valid = new Set(this.stateValue.document.elements.map((element) => element.id));
    return this.stateValue.selectedIds.filter((id) => valid.has(id));
  }

  private selectedSourceElements(): ExpoElement[] {
    const ids = new Set(this.liveSelectedIds());
    return this.stateValue.document.elements.filter((element) => ids.has(element.id));
  }

  private operationLabel(action: string) {
    const count = this.liveSelectedIds().length;
    return count > 1 ? `批量${action}` : action;
  }

  /**
   * 离散批量操作的统一事务入口：
   * 1) 基于当前文档生成完整候选文档；2) 在候选文档上整体校验；
   * 3) 有任何越界/新增重叠/窄通道则整单拒绝，文档保持原状（不会只改一部分）。
   */
  private applyPlan(patch: (element: ExpoElement) => Partial<ExpoElement>, outcome: { success: Notice; rejectAction: string }) {
    const ids = new Set(this.liveSelectedIds());
    if (!ids.size) return;
    const candidate = this.stateValue.document.elements.map((element) => ids.has(element.id) ? { ...element, ...patch(element) } : element);
    const violations = findPlanViolations(this.stateValue.document.field, candidate, this.stateValue.analysis, ids);
    if (violations.length) {
      this.commit({ notice: { tone: 'warning', message: `${outcome.rejectAction}未执行：会${this.summarizeViolations(violations)}，请调整后重试（${ids.size} 个元素均未改动）` } });
      return;
    }
    this.commitAndPersist({ document: { ...this.stateValue.document, elements: candidate }, notice: outcome.success });
  }

  private summarizeViolations(violations: PlanViolation[]): string {
    const parts: string[] = [];
    const boundsCount = new Set(violations.filter((v) => v.type === 'bounds').map((v) => v.elementId)).size;
    const pairCount = new Set(violations.filter((v) => v.type !== 'bounds').map((v) => `${v.firstId}|${v.secondId}`)).size;
    if (boundsCount) parts.push(`导致 ${boundsCount} 个元素超出场地边界`);
    if (pairCount) parts.push(`让 ${pairCount} 对元素发生重叠或通道窄于 1.2 m`);
    return parts.join('，');
  }

  private commitAndPersist(patch: Partial<ExpoSketchState>, persist = true) {
    this.commit(patch);
    if (persist) void this.persist();
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
    // 选区始终以文档中真实存在的元素为准：已删除元素会被自动剔除，绝不残留
    const validIds = new Set(renderElements.map((element) => element.id));
    const selectedIds = (patch.selectedIds === undefined ? next.selectedIds : next.selectedIds ?? []).filter((id) => validIds.has(id));
    const selectedElements = renderElements.filter((element) => selectedIds.includes(element.id));
    const sourceSelected = next.document.elements.filter((element) => selectedIds.includes(element.id));
    const primaryId = selectedIds.includes(next.primaryId ?? '') ? next.primaryId : selectedIds[0] ?? null;
    this.stateValue = {
      ...next,
      renderElements,
      selectedIds,
      selectedElements,
      selectionBounds: selectedIds.length >= 2 ? unionBounds(sourceSelected) : null,
      primaryId,
      primaryElement: renderElements.find((element) => element.id === primaryId) ?? null,
      analysis: analyzeLayout(next.document),
    };
    this.listeners.forEach((listener) => listener());
  }
}

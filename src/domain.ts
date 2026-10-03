import type {
  Analysis,
  BoundsIssue,
  ChannelIssue,
  ElementKind,
  ElementSpec,
  ExpoElement,
  FieldSize,
  LayoutDocument,
  PathPreview,
  OverlapIssue,
  Rect,
} from './types';

export const MIN_CHANNEL = 1.2;

export const ELEMENT_SPECS: Record<ElementKind, ElementSpec> = {
  booth: { kind: 'booth', label: '标准展位', eyebrow: 'BOOTH', icon: '▦', color: '#e7f0ff', width: 5, height: 3.5 },
  stage: { kind: 'stage', label: '主舞台', eyebrow: 'STAGE', icon: '✦', color: '#f2e9ff', width: 8, height: 4 },
  seating: { kind: 'seating', label: '观众座席', eyebrow: 'SEATING', icon: '▤', color: '#e6f7f2', width: 6, height: 3 },
  entrance: { kind: 'entrance', label: '入口', eyebrow: 'ENTRY', icon: '↗', color: '#fff2d8', width: 2.5, height: 1.5 },
};

export const createStarterDocument = (): LayoutDocument => ({
  version: 1,
  title: '春日创意市集 · A 区',
  field: { width: 28, height: 18 },
  elements: [
    { id: 'entry-1', kind: 'entrance', name: '主入口', x: 1, y: 8.25, width: 2.5, height: 1.5, rotation: 0 },
    { id: 'stage-1', kind: 'stage', name: '分享舞台', x: 10, y: 1.5, width: 8, height: 4, rotation: 0 },
    { id: 'booth-1', kind: 'booth', name: '香氛展位', x: 4, y: 2, width: 5, height: 3.5, rotation: 0 },
    { id: 'booth-2', kind: 'booth', name: '手作展位', x: 19, y: 2, width: 5, height: 3.5, rotation: 0 },
    { id: 'seating-1', kind: 'seating', name: '休息座席', x: 10, y: 11, width: 6, height: 3, rotation: 0 },
  ],
});

export const createElement = (kind: ElementKind, index: number, field: FieldSize): ExpoElement => {
  const spec = ELEMENT_SPECS[kind];
  const offset = Math.min(index * 0.65, 4);
  return {
    id: `${kind}-${Date.now()}-${index}`,
    kind,
    name: `${spec.label} ${index + 1}`,
    x: Math.max(0.5, Math.min(field.width - spec.width - 0.5, (field.width - spec.width) / 2 + offset)),
    y: Math.max(0.5, Math.min(field.height - spec.height - 0.5, (field.height - spec.height) / 2 + offset)),
    width: spec.width,
    height: spec.height,
    rotation: 0,
  };
};

export const normalizeRotation = (rotation: number): number => ((Math.round(rotation / 90) * 90) % 360 + 360) % 360;

export const getBoundingBox = (element: ExpoElement) => {
  const isQuarterTurn = normalizeRotation(element.rotation) % 180 !== 0;
  const width = isQuarterTurn ? element.height : element.width;
  const height = isQuarterTurn ? element.width : element.height;
  return { left: element.x, top: element.y, right: element.x + width, bottom: element.y + height, width, height };
};

const intersectionSize = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
  Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));

export const findOverlaps = (elements: ExpoElement[]): OverlapIssue[] => {
  const issues: OverlapIssue[] = [];
  for (let i = 0; i < elements.length; i += 1) {
    const first = getBoundingBox(elements[i]);
    for (let j = i + 1; j < elements.length; j += 1) {
      const second = getBoundingBox(elements[j]);
      const overlapX = intersectionSize(first.left, first.right, second.left, second.right);
      const overlapY = intersectionSize(first.top, first.bottom, second.top, second.bottom);
      if (overlapX > 0 && overlapY > 0) {
        issues.push({ firstId: elements[i].id, secondId: elements[j].id, amount: Number((overlapX * overlapY).toFixed(1)) });
      }
    }
  }
  return issues;
};

export const findBoundsIssues = (field: FieldSize, elements: ExpoElement[]): BoundsIssue[] =>
  elements.flatMap((element) => {
    const box = getBoundingBox(element);
    const overflow = Math.max(0, -box.left, -box.top, box.right - field.width, box.bottom - field.height);
    return overflow > 0 ? [{ elementId: element.id, overflow: Number(overflow.toFixed(1)) }] : [];
  });

export const findNarrowChannels = (elements: ExpoElement[]): ChannelIssue[] => {
  const issues: ChannelIssue[] = [];
  for (let i = 0; i < elements.length; i += 1) {
    const first = getBoundingBox(elements[i]);
    for (let j = i + 1; j < elements.length; j += 1) {
      const second = getBoundingBox(elements[j]);
      const verticalOverlap = intersectionSize(first.top, first.bottom, second.top, second.bottom);
      const horizontalOverlap = intersectionSize(first.left, first.right, second.left, second.right);
      const horizontalGap = first.right <= second.left ? second.left - first.right : second.right <= first.left ? first.left - second.right : 0;
      const verticalGap = first.bottom <= second.top ? second.top - first.bottom : second.bottom <= first.top ? first.top - second.bottom : 0;
      const gap = verticalOverlap > 0 ? horizontalGap : horizontalOverlap > 0 ? verticalGap : 0;
      if (gap > 0 && gap < MIN_CHANNEL) issues.push({ firstId: elements[i].id, secondId: elements[j].id, gap: Number(gap.toFixed(1)) });
    }
  }
  return issues;
};

const distance = (first: { x: number; y: number }, second: { x: number; y: number }) => Math.hypot(second.x - first.x, second.y - first.y);

export const createPathPreview = (elements: ExpoElement[]): PathPreview | null => {
  const entrance = elements.find((element) => element.kind === 'entrance');
  const target = elements.find((element) => element.kind === 'stage') ?? elements.find((element) => element.kind !== 'entrance');
  if (!entrance || !target) return null;
  const startBox = getBoundingBox(entrance);
  const targetBox = getBoundingBox(target);
  const start = { x: startBox.left + startBox.width / 2, y: startBox.top + startBox.height / 2 };
  const end = { x: targetBox.left + targetBox.width / 2, y: targetBox.top + targetBox.height / 2 };
  const elbow = { x: end.x, y: start.y };
  return { points: [start, elbow, end], distance: Number((distance(start, elbow) + distance(elbow, end)).toFixed(1)), fromName: entrance.name, toName: target.name };
};

export const analyzeLayout = (document: LayoutDocument): Analysis => ({
  overlaps: findOverlaps(document.elements),
  bounds: findBoundsIssues(document.field, document.elements),
  channels: findNarrowChannels(document.elements),
  path: createPathPreview(document.elements),
});

export const findElement = (document: LayoutDocument, id: string | null) => document.elements.find((element) => element.id === id) ?? null;

export const formatArea = (field: FieldSize) => `${field.width} × ${field.height} m`;

export type AlignMode = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom';
export type DistributeAxis = 'x' | 'y';

const rectsIntersect = (a: Rect, b: Rect) => !(a.right < b.left || b.right < a.left || a.bottom < b.top || b.bottom < a.top);

/** 包围盒相交判定（含边界相切视为相交，用于框选命中） */
export const hitTestRect = (element: ExpoElement, rect: Rect) => rectsIntersect(getBoundingBox(element), rect);

/** 多个元素包围盒的并集；空数组返回 null */
export const unionBounds = (elements: ExpoElement[]): Rect | null => {
  if (!elements.length) return null;
  const bounds = elements.map(getBoundingBox);
  const left = Math.min(...bounds.map((box) => box.left));
  const top = Math.min(...bounds.map((box) => box.top));
  const right = Math.max(...bounds.map((box) => box.right));
  const bottom = Math.max(...bounds.map((box) => box.bottom));
  return { left, top, right, bottom };
};

/**
 * 对齐：每个元素沿对齐轴整体平移，另一轴保持不变。
 * 返回 id -> 新坐标 的规划表，由调用方原子地套用或拒绝。
 */
export const alignElements = (elements: ExpoElement[], mode: AlignMode): Map<string, { x: number; y: number }> => {
  const bounds = unionBounds(elements);
  if (!bounds) return new Map();
  const moves = new Map<string, { x: number; y: number }>();
  elements.forEach((element) => {
    const box = getBoundingBox(element);
    let { x, y } = element;
    if (mode === 'left') x = bounds.left;
    else if (mode === 'right') x = bounds.right - box.width;
    else if (mode === 'centerX') x = bounds.left + (bounds.right - bounds.left) / 2 - box.width / 2;
    else if (mode === 'top') y = bounds.top;
    else if (mode === 'bottom') y = bounds.bottom - box.height;
    else if (mode === 'centerY') y = bounds.top + (bounds.bottom - bounds.top) / 2 - box.height / 2;
    moves.set(element.id, { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) });
  });
  return moves;
};

/**
 * 等距分布：沿 x/y 轴，首尾元素固定，中间元素按等间距排列。
 * 由 p_{n-1} = p_0 + Σw_0..w_{n-2} + (n-1)·g 反解间距 g；
 * 空间不足时 g 为负（中间元素会重叠），交由调用方校验拒绝。元素少于 3 个时不产生规划。
 */
export const distributeElements = (elements: ExpoElement[], axis: DistributeAxis): Map<string, { x: number; y: number }> => {
  const moves = new Map<string, { x: number; y: number }>();
  if (elements.length < 3) return moves;
  const ordered = [...elements].sort((a, b) => axis === 'x' ? a.x - b.x : a.y - b.y);
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const spanOf = (element: ExpoElement) => axis === 'x' ? getBoundingBox(element).width : getBoundingBox(element).height;
  const startEdge = axis === 'x' ? first.x : first.y;
  const endEdge = axis === 'x' ? last.x : last.y;
  // 参与累计的是首个元素和所有中间元素的尺寸（末个元素不参与）
  const usedSize = spanOf(first) + ordered.slice(1, -1).reduce((sum, element) => sum + spanOf(element), 0);
  const gap = (endEdge - startEdge - usedSize) / (ordered.length - 1);
  let cursor = startEdge + spanOf(first) + gap;
  ordered.slice(1, -1).forEach((element) => {
    moves.set(element.id, {
      x: Number((axis === 'x' ? cursor : element.x).toFixed(1)),
      y: Number((axis === 'y' ? cursor : element.y).toFixed(1)),
    });
    cursor += spanOf(element) + gap;
  });
  return moves;
};

export type PlanViolation =
  | { type: 'bounds'; elementId: string }
  | { type: 'overlap'; firstId: string; secondId: string }
  | { type: 'channel'; firstId: string; secondId: string; gap: number };

/**
 * 以基线问题为参照，校验候选文档相对基线"新增"了哪些问题。
 * 只针对候选中与 affectedIds 相关的元素与元素对，预先存在的问题不会阻塞本次批量操作。
 */
export const findPlanViolations = (field: FieldSize, candidate: ExpoElement[], baseline: Analysis, affectedIds: ReadonlySet<string>): PlanViolation[] => {
  const violations: PlanViolation[] = [];
  const baselineBounds = new Set(baseline.bounds.map((issue) => issue.elementId));
  const pairKey = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`;
  const baselineOverlaps = new Set(baseline.overlaps.map((issue) => pairKey(issue.firstId, issue.secondId)));
  const baselineChannels = new Set(baseline.channels.map((issue) => pairKey(issue.firstId, issue.secondId)));

  candidate.forEach((element) => {
    if (!affectedIds.has(element.id)) return;
    const box = getBoundingBox(element);
    const overflow = Math.max(0, -box.left, -box.top, box.right - field.width, box.bottom - field.height);
    if (overflow > 0 && !baselineBounds.has(element.id)) violations.push({ type: 'bounds', elementId: element.id });
  });

  for (let i = 0; i < candidate.length; i += 1) {
    for (let j = i + 1; j < candidate.length; j += 1) {
      const a = candidate[i];
      const b = candidate[j];
      if (!affectedIds.has(a.id) && !affectedIds.has(b.id)) continue;
      const key = pairKey(a.id, b.id);
      const first = getBoundingBox(a);
      const second = getBoundingBox(b);
      const overlapX = intersectionSize(first.left, first.right, second.left, second.right);
      const overlapY = intersectionSize(first.top, first.bottom, second.top, second.bottom);
      if (overlapX > 0 && overlapY > 0) {
        if (!baselineOverlaps.has(key)) violations.push({ type: 'overlap', firstId: a.id, secondId: b.id });
        continue;
      }
      const verticalOverlap = intersectionSize(first.top, first.bottom, second.top, second.bottom);
      const horizontalOverlap = intersectionSize(first.left, first.right, second.left, second.right);
      const horizontalGap = first.right <= second.left ? second.left - first.right : second.right <= first.left ? first.left - second.right : 0;
      const verticalGap = first.bottom <= second.top ? second.top - first.bottom : second.bottom <= first.top ? first.top - second.bottom : 0;
      const gap = verticalOverlap > 0 ? horizontalGap : horizontalOverlap > 0 ? verticalGap : 0;
      if (gap > 0 && gap < MIN_CHANNEL && !baselineChannels.has(key)) {
        violations.push({ type: 'channel', firstId: a.id, secondId: b.id, gap: Number(gap.toFixed(1)) });
      }
    }
  }
  return violations;
};

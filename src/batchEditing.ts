import { getBoundingBox, MIN_CHANNEL } from './domain';
import type {
  AlignmentType,
  BatchOperation,
  BatchOutcome,
  DistributionType,
  ExpoElement,
  FieldSize,
  OverlapIssue,
  SelectionBounds,
} from './types';

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const round1 = (value: number) => Number(value.toFixed(1));

const intersectsRect = (element: ExpoElement, rect: Rect): boolean => {
  const box = getBoundingBox(element);
  return box.left < rect.right && box.right > rect.left && box.top < rect.bottom && box.bottom > rect.top;
};

/** 找出被框选矩形（场地坐标系）覆盖的元素；只按面积相交，点在边上不算。 */
export const findElementsInRect = (elements: ExpoElement[], rect: Rect): string[] =>
  elements.filter((element) => intersectsRect(element, rect)).map((element) => element.id);

export const normalizeRect = (start: { x: number; y: number }, end: { x: number; y: number }): Rect => ({
  left: Math.min(start.x, end.x),
  top: Math.min(start.y, end.y),
  right: Math.max(start.x, end.x),
  bottom: Math.max(start.y, end.y),
});

/** 选中集合的外接包围盒（考虑旋转后的实际占位）。 */
export const getSelectionBounds = (elements: ExpoElement[], ids: string[]): SelectionBounds | null => {
  const picked = elements.filter((element) => ids.includes(element.id));
  if (!picked.length) return null;
  const boxes = picked.map(getBoundingBox);
  const left = Math.min(...boxes.map((box) => box.left));
  const top = Math.min(...boxes.map((box) => box.top));
  const right = Math.max(...boxes.map((box) => box.right));
  const bottom = Math.max(...boxes.map((box) => box.bottom));
  return { left, top, right, bottom, width: round1(right - left), height: round1(bottom - top) };
};

/** 只改变旋转后的包围盒左上角，保持原 x/y 基点语义不变。 */
const withBoxOrigin = (element: ExpoElement, left: number, top: number): ExpoElement => {
  const box = getBoundingBox(element);
  return { ...element, x: round1(element.x + left - box.left), y: round1(element.y + top - box.top) };
};

const alignElements = (elements: ExpoElement[], ids: string[], bounds: SelectionBounds, alignment: AlignmentType): ExpoElement[] =>
  elements.map((element) => {
    if (!ids.includes(element.id)) return element;
    const box = getBoundingBox(element);
    if (alignment === 'left') return withBoxOrigin(element, bounds.left, box.top);
    if (alignment === 'right') return withBoxOrigin(element, bounds.right - box.width, box.top);
    if (alignment === 'top') return withBoxOrigin(element, box.left, bounds.top);
    if (alignment === 'bottom') return withBoxOrigin(element, box.left, bounds.bottom - box.height);
    if (alignment === 'center-h') return withBoxOrigin(element, bounds.left + (bounds.width - box.width) / 2, box.top);
    return withBoxOrigin(element, box.left, bounds.top + (bounds.height - box.height) / 2);
  });

const axisGeometry = (ids: string[], boxes: Map<string, ReturnType<typeof getBoundingBox>>, direction: DistributionType) => {
  const ordered = [...ids].sort((a, b) => {
    const first = boxes.get(a)!;
    const second = boxes.get(b)!;
    return direction === 'horizontal' ? first.left - second.left : first.top - second.top;
  });
  const span = (id: string) => (direction === 'horizontal' ? boxes.get(id)!.width : boxes.get(id)!.height);
  const startId = ordered[0];
  const endId = ordered[ordered.length - 1];
  const startEdge = direction === 'horizontal' ? boxes.get(startId)!.left : boxes.get(startId)!.top;
  const endEdge = direction === 'horizontal' ? boxes.get(endId)!.right : boxes.get(endId)!.bottom;
  const totalSize = ordered.reduce((sum, id) => sum + span(id), 0);
  return { ordered, span, startEdge, endEdge, totalSize, available: endEdge - startEdge };
};

/** 分布前先算一遍：元素能不能等距铺开，供 UI 置灰与校验共用。 */
export const planDistribution = (elements: ExpoElement[], ids: string[], direction: DistributionType) => {
  if (ids.length < 3) return { feasible: false as const, reason: 'distribute-count' as const };
  const boxes = new Map(elements.filter((element) => ids.includes(element.id)).map((element) => [element.id, getBoundingBox(element)]));
  const geometry = axisGeometry(ids, boxes, direction);
  const gap = (geometry.available - geometry.totalSize) / (ids.length - 1);
  if (gap < 0) return { feasible: false as const, reason: 'spacing' as const, gap: round1(gap) };
  // gap 为 0 表示首尾相接、没有通道，也按窄通道提示
  if (gap < MIN_CHANNEL) return { feasible: true as const, gap: round1(gap), tight: true as const };
  return { feasible: true as const, gap: round1(gap), tight: false as const };
};

const distributeElements = (elements: ExpoElement[], ids: string[], direction: DistributionType): ExpoElement[] => {
  const boxes = new Map(elements.filter((element) => ids.includes(element.id)).map((element) => [element.id, getBoundingBox(element)]));
  const geometry = axisGeometry(ids, boxes, direction);
  const gap = (geometry.available - geometry.totalSize) / (ids.length - 1);
  const next = new Map<string, number>();
  let cursor = geometry.startEdge;
  geometry.ordered.forEach((id) => {
    next.set(id, cursor);
    cursor += geometry.span(id) + gap;
  });
  return elements.map((element) => {
    if (!ids.includes(element.id)) return element;
    const box = boxes.get(element.id)!;
    const edge = next.get(element.id)!;
    return direction === 'horizontal' ? withBoxOrigin(element, edge, box.top) : withBoxOrigin(element, box.left, edge);
  });
};

const resizeElements = (elements: ExpoElement[], ids: string[], width?: number, height?: number): ExpoElement[] =>
  elements.map((element) => {
    if (!ids.includes(element.id)) return element;
    return { ...element, width: width !== undefined ? round1(width) : element.width, height: height !== undefined ? round1(height) : element.height };
  });

const rotateElements = (elements: ExpoElement[], ids: string[]): ExpoElement[] =>
  elements.map((element) => (ids.includes(element.id) ? { ...element, rotation: (((Math.round(element.rotation / 90) * 90 + 90) % 360) + 360) % 360 } : element));

const isInsideField = (field: FieldSize, element: ExpoElement): boolean => {
  const box = getBoundingBox(element);
  return box.left >= -1e-6 && box.top >= -1e-6 && box.right <= field.width + 1e-6 && box.bottom <= field.height + 1e-6;
};

const buildOverlapIndex = (elements: ExpoElement[]): OverlapIssue[] => {
  const issues: OverlapIssue[] = [];
  for (let i = 0; i < elements.length; i += 1) {
    const first = getBoundingBox(elements[i]);
    for (let j = i + 1; j < elements.length; j += 1) {
      const second = getBoundingBox(elements[j]);
      const overlapX = Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left));
      const overlapY = Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
      if (overlapX > 1e-6 && overlapY > 1e-6) issues.push({ firstId: elements[i].id, secondId: elements[j].id, amount: overlapX * overlapY });
    }
  }
  return issues;
};

const pairKey = (firstId: string, secondId: string) => [firstId, secondId].sort().join('|');

const gapBetween = (first: ReturnType<typeof getBoundingBox>, second: ReturnType<typeof getBoundingBox>) => {
  const verticalOverlap = Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
  const horizontalOverlap = Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left));
  const horizontalGap = first.right <= second.left ? second.left - first.right : second.right <= first.left ? first.left - second.right : 0;
  const verticalGap = first.bottom <= second.top ? second.top - first.bottom : second.bottom <= first.top ? first.top - second.bottom : 0;
  return verticalOverlap > 0 ? horizontalGap : horizontalOverlap > 0 ? verticalGap : null;
};

export interface BatchPlan {
  outcome: BatchOutcome;
  tightChannel: boolean;
}

const ALIGN_LABEL: Record<AlignmentType, string> = {
  left: '左对齐', 'center-h': '水平居中', right: '右对齐', top: '顶对齐', 'center-v': '垂直居中', bottom: '底对齐',
};

/**
 * 批量操作的统一入口：先算出完整的候选布局，再一次性校验越界 / 新增重叠 / 新增窄通道。
 * 任何一项不通过都返回原布局，绝不留下“改了一半”的中间状态。
 */
export const planBatchOperation = (
  field: FieldSize,
  elements: ExpoElement[],
  idsInput: string[],
  operation: BatchOperation,
): BatchPlan => {
  const ids = elements.map((element) => element.id).filter((id) => idsInput.includes(id));
  const countLabel = `${ids.length} 个元素`;

  const reject = (reason: BatchOutcome['reason'], message: string): BatchPlan => ({
    tightChannel: false,
    outcome: { ok: false, elements, affectedIds: ids, reason, message },
  });

  if (!ids.length) return reject('empty-selection', '当前没有选中任何元素');
  if (operation.type === 'resize') {
    const width = operation.width;
    const height = operation.height;
    if (width === undefined && height === undefined) {
      return reject('invalid-size', '没有需要统一的尺寸，本次操作未生效');
    }
    if ((width !== undefined && (!Number.isFinite(width) || width <= 0)) || (height !== undefined && (!Number.isFinite(height) || height <= 0))) {
      return reject('invalid-size', '尺寸必须为大于 0 的数值，本次修改未生效');
    }
  }

  const bounds = getSelectionBounds(elements, ids)!;
  const distribution = operation.type === 'distribute' ? planDistribution(elements, ids, operation.direction) : null;
  if (distribution && !distribution.feasible) {
    if (distribution.reason === 'distribute-count') return reject('distribute-count', '至少选中 3 个元素才能等距分布');
    return reject('spacing', '排布空间不足：元素总尺寸超过当前跨度，未做任何改动');
  }

  let candidate: ExpoElement[];
  if (operation.type === 'align') candidate = alignElements(elements, ids, bounds, operation.alignment);
  else if (operation.type === 'distribute') candidate = distributeElements(elements, ids, operation.direction);
  else if (operation.type === 'resize') candidate = resizeElements(elements, ids, operation.width, operation.height);
  else candidate = rotateElements(elements, ids);

  const overflow = candidate.find((element) => ids.includes(element.id) && !isInsideField(field, element));
  if (overflow) return reject('bounds', `会让「${overflow.name}」超出场地边界，整批操作已取消`);

  const beforePairs = new Set(buildOverlapIndex(elements).map((issue) => pairKey(issue.firstId, issue.secondId)));
  const afterOverlaps = buildOverlapIndex(candidate);
  const introducedOverlap = afterOverlaps.find((issue) => {
    if (beforePairs.has(pairKey(issue.firstId, issue.secondId))) return false;
       return ids.includes(issue.firstId) || ids.includes(issue.secondId);
  });
  if (introducedOverlap) {
    const firstName = candidate.find((element) => element.id === introducedOverlap.firstId)?.name ?? introducedOverlap.firstId;
    const secondName = candidate.find((element) => element.id === introducedOverlap.secondId)?.name ?? introducedOverlap.secondId;
    return reject('overlap', `「${firstName}」会与「${secondName}」重叠，整批操作已取消`);
  }

  // 只把“新出现”的窄通道视为阻断项；操作前就存在的告警不归本次操作负责。
  const beforeChannels = new Set<string>();
  for (let i = 0; i < elements.length; i += 1) {
    for (let j = i + 1; j < elements.length; j += 1) {
      const gap = gapBetween(getBoundingBox(elements[i]), getBoundingBox(elements[j]));
      if (gap !== null && gap > 0 && gap < MIN_CHANNEL) beforeChannels.add(pairKey(elements[i].id, elements[j].id));
    }
  }
  // 等距分布的间隙是按排布轴精确算出来的，直接采用预检结论；逐对扫描只覆盖非选中元素。
  let tightChannel = operation.type === 'distribute' && distribution?.feasible === true && distribution.tight === true;
  for (let i = 0; i < candidate.length; i += 1) {
    if (!ids.includes(candidate[i].id)) continue;
    for (let j = 0; j < candidate.length; j += 1) {
      if (i === j || ids.includes(candidate[j].id)) continue;
      const key = pairKey(candidate[i].id, candidate[j].id);
      if (beforeChannels.has(key)) continue;
      const gap = gapBetween(getBoundingBox(candidate[i]), getBoundingBox(candidate[j]));
      if (gap !== null && gap > 0 && gap < MIN_CHANNEL) {
        // 等距分布是用户主动重排，与周边元素通道偏窄只警告；对齐 / 改尺寸会“压住通道”，直接拦截。
        if (operation.type === 'distribute') tightChannel = true;
        else {
          const firstName = candidate[i].name;
          const secondName = candidate[j].name;
          return reject('channel', `「${firstName}」与「${secondName}」之间通道不足 ${MIN_CHANNEL} m，整批操作已取消`);
        }
      }
    }
  }

  const message = operation.type === 'align'
    ? `已按${ALIGN_LABEL[operation.alignment]}排列 ${countLabel}`
    : operation.type === 'distribute'
      ? `已沿${operation.direction === 'horizontal' ? '横向' : '纵向'}等距分布 ${countLabel}`
      : operation.type === 'resize'
        ? `已统一 ${countLabel} 的尺寸`
        : `已旋转 ${countLabel}`;

  return {
    tightChannel,
    outcome: {
      ok: true,
      elements: candidate,
      affectedIds: ids,
      message: tightChannel && operation.type === 'distribute'
        ? `${message}，但间距小于建议通道 ${MIN_CHANNEL} m，请留意通行`
        : message,
    },
  };
};

export interface GroupMoveCheck {
  clampedDx: number;
  clampedDy: number;
  reverts: boolean;
}

/** 整体拖动时的可用位移：先限制在场地内，再判断是否产生新的重叠/窄通道。 */
export const planGroupMove = (
  field: FieldSize,
  elements: ExpoElement[],
  ids: string[],
  requestedDx: number,
  requestedDy: number,
): GroupMoveCheck => {
  if (!ids.length) return { clampedDx: 0, clampedDy: 0, reverts: false };
  const picked = elements.filter((element) => ids.includes(element.id));
  const boxes = picked.map(getBoundingBox);
  const minLeft = Math.min(...boxes.map((box) => box.left));
  const minTop = Math.min(...boxes.map((box) => box.top));
  const maxRight = Math.max(...boxes.map((box) => box.right));
  const maxBottom = Math.max(...boxes.map((box) => box.bottom));
  const dx = round1(Math.max(-minLeft, Math.min(requestedDx, field.width - maxRight)));
  const dy = round1(Math.max(-minTop, Math.min(requestedDy, field.height - maxBottom)));

  const movedIds = new Set(ids);
  const candidate = elements.map((element) => (movedIds.has(element.id) ? { ...element, x: round1(element.x + dx), y: round1(element.y + dy) } : element));
  const candidateById = new Map(candidate.map((element) => [element.id, element]));

  for (const moved of picked) {
    const first = getBoundingBox(candidateById.get(moved.id)!);
    for (const other of candidate) {
      if (movedIds.has(other.id)) continue;
      const second = getBoundingBox(other);
      const overlapX = Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left));
      const overlapY = Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
      if (overlapX > 1e-6 && overlapY > 1e-6) return { clampedDx: 0, clampedDy: 0, reverts: true };
      const gap = gapBetween(first, second);
      if (gap !== null && gap > 0 && gap < MIN_CHANNEL) return { clampedDx: 0, clampedDy: 0, reverts: true };
    }
  }
  return { clampedDx: dx, clampedDy: dy, reverts: false };
};

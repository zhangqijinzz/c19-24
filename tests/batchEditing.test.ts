import { describe, expect, it } from 'vitest';
import { findElementsInRect, getSelectionBounds, normalizeRect, planBatchOperation, planDistribution, planGroupMove } from '../src/batchEditing';
import type { ExpoElement, FieldSize } from '../src/types';

const field: FieldSize = { width: 30, height: 20 };

const item = (id: string, x: number, y: number, width = 3, height = 2, kind: ExpoElement['kind'] = 'booth'): ExpoElement =>
  ({ id, kind, name: id, x, y, width, height, rotation: 0 });

describe('marquee helpers', () => {
  it('returns only elements intersected by the rubber-band rect', () => {
    const elements = [item('a', 1, 1), item('b', 10, 10), item('c', 5, 5)];
    const rect = normalizeRect({ x: 0, y: 0 }, { x: 6, y: 6 });
    expect(findElementsInRect(elements, rect)).toEqual(['a', 'c']);
  });

  it('does not include elements only touching the rect edge', () => {
    const elements = [item('a', 4, 1)];
    const rect = normalizeRect({ x: 0, y: 0 }, { x: 4, y: 4 });
    expect(findElementsInRect(elements, rect)).toEqual([]);
  });

  it('computes the combined selection bounds', () => {
    const bounds = getSelectionBounds([item('a', 1, 1, 3, 2), item('b', 8, 6, 2, 4)], ['a', 'b']);
    expect(bounds).toMatchObject({ left: 1, top: 1, right: 10, bottom: 10, width: 9, height: 9 });
    expect(getSelectionBounds([item('a', 0, 0)], ['missing'])).toBeNull();
  });
});

describe('batch alignment', () => {
  it('left-aligns every selected element onto the shared edge', () => {
    const elements = [item('a', 2, 1, 3, 2), item('b', 7, 5, 4, 3)];
    const { outcome } = planBatchOperation(field, elements, ['a', 'b'], { type: 'align', alignment: 'left' });
    expect(outcome.ok).toBe(true);
    const boxes = outcome.elements.map(getBox);
    expect(boxes.map((box) => box.left)).toEqual([2, 2]);
  });

  it('rejects the whole batch when a rotation pushes an element out of the field', () => {
    // b 旋转后占位变为 5 宽，右边界 12+5=17 原本没事；这里把它放到场地右缘附近再旋转
    const elements = [item('a', 1, 1, 3, 2), item('b', 28, 1, 2, 3)];
    const { outcome } = planBatchOperation(field, elements, ['a', 'b'], { type: 'rotate' });
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('bounds');
    // 原子性：任何元素都没有被改动
    expect(outcome.elements).toBe(elements);
  });

  it('rejects alignment that newly overlaps an unselected element', () => {
    // a 与 c 对齐后会压到 b
    const elements = [item('a', 1, 1), item('b', 1, 8, 3, 2), item('c', 9, 8, 3, 2)];
    const { outcome } = planBatchOperation(field, elements, ['b', 'c'], { type: 'align', alignment: 'left' });
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('overlap');
    expect(outcome.message).toContain('重叠');
  });

  it('allows pre-existing overlaps that the operation does not introduce', () => {
    const elements = [item('a', 1, 1), item('b', 1.5, 1.5)];
    const { outcome } = planBatchOperation(field, elements, ['a', 'b'], { type: 'align', alignment: 'left' });
    expect(outcome.ok).toBe(true);
  });

  it('rejects a size change that squeezes the channel below the minimum', () => {
    // b 加宽后，与右侧未选中的 d 之间水平间距只剩 0.5 m；初始间距 1.5 m 是合规的
    const elements = [item('a', 1, 1), item('b', 1, 5, 3, 2), item('c', 12, 1), item('d', 5.5, 5, 3, 2)];
    const { outcome } = planBatchOperation(field, elements, ['b'], { type: 'resize', width: 4 });
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('channel');
    expect(outcome.elements).toBe(elements);
  });
});

describe('batch resize unification', () => {
  it('applies one width to every selected element', () => {
    const elements = [item('a', 1, 1, 3, 2), item('b', 10, 1, 5, 4)];
    const { outcome } = planBatchOperation(field, elements, ['a', 'b'], { type: 'resize', width: 4 });
    expect(outcome.ok).toBe(true);
    expect(outcome.elements.map((element) => [element.width, element.height])).toEqual([[4, 2], [4, 4]]);
  });

  it('rejects non-positive dimensions atomically', () => {
    const elements = [item('a', 1, 1), item('b', 5, 1)];
    const { outcome } = planBatchOperation(field, elements, ['a', 'b'], { type: 'resize', width: 0 });
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('invalid-size');
    expect(outcome.elements).toBe(elements);
  });

  it('rejects when the unified size makes an element overflow the field', () => {
    const elements = [item('a', 1, 1), item('b', 28, 1, 2, 2)];
    const { outcome } = planBatchOperation(field, elements, ['a', 'b'], { type: 'resize', width: 6 });
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('bounds');
    expect(outcome.elements).toBe(elements);
  });
});

describe('equal distribution', () => {
  it('requires at least three selected elements', () => {
    const plan = planDistribution([item('a', 0, 0), item('b', 5, 0)], ['a', 'b'], 'horizontal');
    expect(plan.feasible).toBe(false);
    if (!plan.feasible) expect(plan.reason).toBe('distribute-count');

    const { outcome } = planBatchOperation(field, [item('a', 0, 0), item('b', 5, 0)], ['a', 'b'], { type: 'distribute', direction: 'horizontal' });
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('distribute-count');
  });

  it('distributes three booths with equal gaps', () => {
    const elements = [item('a', 1, 1, 2, 2), item('b', 4, 1, 2, 2), item('c', 14, 1, 2, 2)];
    const { outcome } = planBatchOperation(field, elements, ['a', 'b', 'c'], { type: 'distribute', direction: 'horizontal' });
    expect(outcome.ok).toBe(true);
    const boxes = outcome.elements.map(getBox).sort((first, second) => first.left - second.left);
    const gap1 = boxes[1].left - boxes[0].right;
    const gap2 = boxes[2].left - boxes[1].right;
    expect(gap1).toBeCloseTo(gap2, 5);
  });

  it('refuses distribution when elements do not fit in the current span', () => {
    // 三个宽 4 的元素挤在总跨度 6 内
    const elements = [item('a', 0, 1, 4, 2), item('b', 1, 1, 4, 2), item('c', 2, 1, 4, 2)];
    const plan = planDistribution(elements, ['a', 'b', 'c'], 'horizontal');
    expect(plan.feasible).toBe(false);
    if (!plan.feasible) expect(plan.reason).toBe('spacing');
    const { outcome } = planBatchOperation(field, elements, ['a', 'b', 'c'], { type: 'distribute', direction: 'horizontal' });
    expect(outcome.ok).toBe(false);
    expect(outcome.elements).toBe(elements);
  });

  it('warns (but succeeds) when the equal gap is narrower than the recommended channel', () => {
    // 跨度 = 8.5-1 = 7.5，总宽 3+3+1 = 7，等距间隙 = 0.25 m < 1.2 m
    const elements = [item('a', 1, 1, 3, 2), item('b', 5, 4, 3, 2), item('c', 7.5, 1, 1, 2)];
    const result = planBatchOperation(field, elements, ['a', 'b', 'c'], { type: 'distribute', direction: 'horizontal' });
    expect(result.outcome.ok).toBe(true);
    expect(result.tightChannel).toBe(true);
  });
});

describe('stale and empty selections', () => {
  it('ignores ids that no longer exist in the document', () => {
    const elements = [item('a', 1, 1)];
    const { outcome } = planBatchOperation(field, elements, ['a', 'ghost-id'], { type: 'align', alignment: 'left' });
    expect(outcome.affectedIds).toEqual(['a']);
  });

  it('rejects an empty selection', () => {
    const { outcome } = planBatchOperation(field, [item('a', 1, 1)], [], { type: 'rotate' });
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('empty-selection');
  });
});

describe('group move', () => {
  it('clamps the translation so the group never leaves the field', () => {
    const elements = [item('a', 1, 1), item('b', 1, 4)];
    const plan = planGroupMove(field, elements, ['a', 'b'], -50, -50);
    expect(plan.clampedDx).toBe(-1);
    expect(plan.clampedDy).toBe(-1);
    expect(plan.reverts).toBe(false);
  });

  it('reverts (zero delta) when the move would overlap an unselected element', () => {
    const elements = [item('a', 1, 1), item('b', 1, 4), item('c', 1, 7)];
    const plan = planGroupMove(field, elements, ['a', 'b'], 0, 4);
    expect(plan.reverts).toBe(true);
    expect(plan.clampedDx).toBe(0);
    expect(plan.clampedDy).toBe(0);
  });

  it('allows a free move and reports the delta', () => {
    const elements = [item('a', 1, 1), item('b', 1, 4), item('c', 20, 20, 2, 2)];
    const plan = planGroupMove(field, elements, ['a', 'b'], 3, 0);
    expect(plan.reverts).toBe(false);
    expect(plan.clampedDx).toBe(3);
  });
});

function getBox(element: ExpoElement) {
  const rotated = ((Math.round(element.rotation / 90) * 90) % 360 + 360) % 360;
  const isQuarterTurn = rotated % 180 !== 0;
  const width = isQuarterTurn ? element.height : element.width;
  const height = isQuarterTurn ? element.width : element.height;
  return { left: element.x, top: element.y, right: element.x + width, bottom: element.y + height, width, height };
}

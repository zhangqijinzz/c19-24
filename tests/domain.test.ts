import { describe, expect, it } from 'vitest';
import { alignElements, analyzeLayout, distributeElements, findBoundsIssues, findNarrowChannels, findOverlaps, findPlanViolations, hitTestRect, unionBounds } from '../src/domain';
import type { ExpoElement } from '../src/types';

const item = (id: string, x: number, y: number, width = 4, height = 3): ExpoElement => ({ id, kind: 'booth', name: id, x, y, width, height, rotation: 0 });

describe('layout domain rules', () => {
  it('detects overlap area between two elements', () => {
    expect(findOverlaps([item('a', 1, 1), item('b', 3, 2)])).toEqual([{ firstId: 'a', secondId: 'b', amount: 4 }]);
  });

  it('detects field overflow and rotated bounds', () => {
    const rotated = { ...item('rotated', 8, 2, 2, 5), rotation: 90 };
    expect(findBoundsIssues({ width: 10, height: 10 }, [rotated])).toEqual([{ elementId: 'rotated', overflow: 3 }]);
  });

  it('flags a pass narrower than the minimum channel', () => {
    expect(findNarrowChannels([item('a', 1, 1), item('b', 5.5, 1)])).toEqual([{ firstId: 'a', secondId: 'b', gap: 0.5 }]);
  });

  it('returns a path when entrance and focus area exist', () => {
    const analysis = analyzeLayout({ version: 1, title: 'x', field: { width: 20, height: 12 }, elements: [{ ...item('entry', 1, 5, 2, 1), kind: 'entrance' }, { ...item('stage', 10, 2, 5, 3), kind: 'stage' }] });
    expect(analysis.path?.points).toHaveLength(3);
    expect(analysis.path?.distance).toBeGreaterThan(0);
  });

  it('marquee hit-tests elements whose bounds intersect the drag rect', () => {
    expect(hitTestRect(item('a', 1, 1, 4, 3), { left: 4, top: 3, right: 6, bottom: 5 })).toBe(true);
    expect(hitTestRect(item('b', 1, 1, 4, 3), { left: 5.5, top: 3.5, right: 8, bottom: 6 })).toBe(false);
  });

  it('computes union bounds across several elements', () => {
    expect(unionBounds([item('a', 1, 1, 4, 3), item('b', 10, 8, 2, 2)])).toEqual({ left: 1, top: 1, right: 12, bottom: 10 });
    expect(unionBounds([])).toBeNull();
  });

  it('aligns every element to the shared left edge without touching y', () => {
    const moves = alignElements([item('a', 2, 1), item('b', 7, 4)], 'left');
    expect(moves.get('a')).toEqual({ x: 2, y: 1 });
    expect(moves.get('b')).toEqual({ x: 2, y: 4 });
  });

  it('distributes middle elements evenly while pinning the first and last', () => {
    const row = [item('a', 0, 0, 2, 2), item('b', 5, 0, 2, 2), item('c', 6, 0, 2, 2), item('d', 12, 0, 2, 2)];
    const moves = distributeElements(row, 'x');
    expect(moves.get('a')).toBeUndefined();
    expect(moves.get('d')).toBeUndefined();
    // p_d - p_a = 12，已占宽度 2(a)+2(b)+2(c) = 6，间距 = (12 - 6) / 3 = 2
    expect(moves.get('b')).toEqual({ x: 4, y: 0 });
    expect(moves.get('c')).toEqual({ x: 8, y: 0 });
  });

  it('needs at least three elements for distribution', () => {
    expect(distributeElements([item('a', 0, 0), item('b', 5, 0)], 'x').size).toBe(0);
  });

  it('flags only newly introduced bounds, overlap and narrow-channel problems', () => {
    const field = { width: 20, height: 12 };
    const elements = [item('a', 1, 1, 4, 3), item('b', 8, 1, 4, 3), item('c', 6, 8, 2, 2)];
    const baseline = analyzeLayout({ version: 1, title: 'x', field, elements });
    // 把 a 推到与 b 重叠：新增重叠应被检出
    const overlapCandidate = elements.map((element) => element.id === 'a' ? { ...element, x: 6 } : element);
    const overlapViolations = findPlanViolations(field, overlapCandidate, baseline, new Set(['a']));
    expect(overlapViolations.some((v) => v.type === 'overlap')).toBe(true);
    // 把 c 推出场地：新增越界应被检出
    const boundsCandidate = elements.map((element) => element.id === 'c' ? { ...element, y: 11 } : element);
    const boundsViolations = findPlanViolations(field, boundsCandidate, baseline, new Set(['c']));
    expect(boundsViolations).toContainEqual({ type: 'bounds', elementId: 'c' });
    // 基线中已存在的问题不算新增
    const unchanged = findPlanViolations(field, elements, baseline, new Set(['a']));
    expect(unchanged).toEqual([]);
    // 把 b 移到与 a 间距 0.5：新增窄通道应被检出
    const channelCandidate = elements.map((element) => element.id === 'b' ? { ...element, x: 5.5 } : element);
    const channelViolations = findPlanViolations(field, channelCandidate, baseline, new Set(['b']));
    expect(channelViolations.some((v) => v.type === 'channel')).toBe(true);
  });
});

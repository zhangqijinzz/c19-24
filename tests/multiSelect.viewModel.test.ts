import { describe, expect, it, vi } from 'vitest';
import { createStarterDocument } from '../src/domain';
import type { LayoutRepository } from '../src/repository';
import type { ExpoElement, LayoutDocument } from '../src/types';
import { ExpoSketchViewModel } from '../src/viewModel';
import { findElementsInRect } from '../src/batchEditing';

const fakeRepository = (initial: LayoutDocument): LayoutRepository => ({
  load: vi.fn(async () => initial),
  save: vi.fn(async () => {}),
});

const booth = (id: string, x: number, y: number, width = 3, height = 2): ExpoElement =>
  ({ id, kind: 'booth', name: id, x, y, width, height, rotation: 0 });

const docWith = (elements: ExpoElement[]): LayoutDocument =>
  ({ version: 1, title: 't', field: { width: 30, height: 20 }, elements });

const createVm = async (elements: ExpoElement[]) => {
  const vm = new ExpoSketchViewModel(fakeRepository(docWith(elements)));
  await vm.initialize();
  return vm;
};

describe('multi-selection ViewModel', () => {
  it('supports additive toggling and clears on empty marquee', async () => {
    const vm = await createVm([booth('a', 1, 1), booth('b', 8, 1), booth('c', 15, 1)]);
    vm.selectElement('a');
    vm.selectElement('b', true);
    expect(vm.state.selectedIds).toEqual(['a', 'b']);
    vm.selectElement('a', true);
    expect(vm.state.selectedIds).toEqual(['b']);
    vm.selectInRect([]);
    expect(vm.state.selectedIds).toEqual([]);
    expect(vm.state.selectedId).toBeNull();
    expect(vm.state.selectionBounds).toBeNull();
  });

  it('marquees only elements covered by the rect and unions with shift-add', async () => {
    const doc = docWith([booth('a', 1, 1), booth('b', 5, 1), booth('c', 20, 1)]);
    const vm = new ExpoSketchViewModel(fakeRepository(doc));
    await vm.initialize();
    vm.selectInRect(findElementsInRect(doc.elements, { left: 0, top: 0, right: 10, bottom: 5 }));
    expect(vm.state.selectedIds).toEqual(['a', 'b']);
    vm.selectInRect(findElementsInRect(doc.elements, { left: 19, top: 0, right: 24, bottom: 5 }), true);
    expect(vm.state.selectedIds).toEqual(['a', 'b', 'c']);
  });

  it('deletes every selected element atomically and falls back to a valid selection', async () => {
    const vm = await createVm([booth('a', 1, 1), booth('b', 8, 1), booth('c', 15, 1)]);
    vm.selectInRect(['a', 'b']);
    expect(vm.state.selectedIds).toEqual(['a', 'b']);
    vm.removeSelected();
    expect(vm.state.document.elements.map((element) => element.id)).toEqual(['c']);
    expect(vm.state.selectedIds).toEqual(['c']);
    expect(vm.state.notice.message).toContain('2 个元素');
  });

  it('prunes selected ids that reference elements removed from the document', async () => {
    const vm = await createVm([booth('a', 1, 1), booth('b', 8, 1)]);
    vm.selectInRect(['a', 'b']);
    expect(vm.state.selectedIds).toEqual(['a', 'b']);
    // 模拟外部（撤销 / storage 同步）直接换入文档：b 已不存在，选区必须被裁剪而不是残留
    vm.replaceDocument(docWith([booth('a', 1, 1)]));
    expect(vm.state.document.elements.map((element) => element.id)).toEqual(['a']);
    expect(vm.state.selectedIds).toEqual(['a']);
    expect(vm.state.selectionBounds).not.toBeNull();
  });

  it('blocks an align batch that would overlap and leaves the document untouched', async () => {
    const vm = await createVm([booth('a', 1, 1), booth('b', 9, 1), booth('blocker', 1, 4, 3, 2)]);
    vm.selectInRect(['a', 'b']);
    const before = vm.state.document.elements.map((element) => ({ ...element }));
    vm.alignSelected('left');
    expect(vm.state.document.elements).toEqual(before);
    expect(vm.state.notice.tone).toBe('error');
    expect(vm.state.notice.message).toContain('重叠');
  });

  it('applies a valid alignment and reports the affected count', async () => {
    const vm = await createVm([booth('a', 1, 1), booth('b', 9, 8), booth('c', 20, 4)]);
    vm.selectInRect(['a', 'b', 'c']);
    vm.alignSelected('left');
    expect(vm.state.renderElements.map((element) => element.x)).toEqual([1, 1, 1]);
    expect(vm.state.notice.message).toContain('3 个元素');
  });

  it('unifies width in one atomic commit when it fits', async () => {
    const vm = await createVm([booth('a', 1, 1, 2, 2), booth('b', 10, 1, 4, 3)]);
    vm.selectInRect(['a', 'b']);
    vm.unifyDimensions(5, undefined);
    expect(vm.state.document.elements.map((element) => element.width)).toEqual([5, 5]);
  });

  it('group drag clamps to the field and reverts on collision without partial moves', async () => {
    const vm = await createVm([booth('a', 1, 1), booth('b', 1, 4), booth('wall', 1, 8)]);
    vm.selectInRect(['a', 'b']);
    vm.moveGroup(-50, 0);
    expect(vm.state.document.elements[0].x).toBe(0); // 被限位到左缘，而不是 -49
    vm.moveGroup(0, 4); // 会撞上 wall
    expect(vm.state.document.elements[0].x).toBe(0);
    expect(vm.state.document.elements[0].y).toBe(1); // 没有留下半截位移
    expect(vm.state.document.elements[1].y).toBe(4);
    expect(vm.state.notice.tone).toBe('warning');
  });

  it('distributes three booths with equal gaps', async () => {
    const vm = await createVm([booth('a', 1, 10, 2, 2), booth('b', 6, 10, 2, 2), booth('c', 16, 10, 2, 2)]);
    vm.selectInRect(['a', 'b', 'c']);
    vm.distributeSelected('horizontal');
    const xs = vm.state.document.elements.map((element) => element.x);
    const gap1 = xs[1] - (xs[0] + 2);
    const gap2 = xs[2] - (xs[1] + 2);
    expect(gap1).toBeCloseTo(gap2, 5);
  });

  it('still works with the starter document repository shape', async () => {
    const repository: LayoutRepository = { load: vi.fn(async () => createStarterDocument()), save: vi.fn(async () => {}) };
    const vm = new ExpoSketchViewModel(repository);
    await vm.initialize();
    expect(vm.state.selectedIds).toEqual([vm.state.document.elements[0].id]);
  });
});

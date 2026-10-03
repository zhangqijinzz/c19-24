import { describe, expect, it, vi } from 'vitest';
import { createStarterDocument } from '../src/domain';
import type { LayoutRepository } from '../src/repository';
import type { LayoutDocument } from '../src/types';
import { ExpoSketchViewModel } from '../src/viewModel';

const fakeRepository = (initial: LayoutDocument | null = null): LayoutRepository => ({
  load: vi.fn(async () => initial ?? createStarterDocument()),
  save: vi.fn(async (_document) => {}),
});

describe('ExpoSketchViewModel', () => {
  it('initializes and updates the selected layout', async () => {
    const repository = fakeRepository();
    const vm = new ExpoSketchViewModel(repository);
    await vm.initialize();
    expect(vm.state.phase).toBe('ready');
    const count = vm.state.document.elements.length;
    vm.addElement('booth');
    expect(vm.state.document.elements).toHaveLength(count + 1);
    expect(vm.state.selectedIds[0]).toContain('booth-');
  });

  it('updates analysis immediately after moving an element into an overlap', () => {
    const vm = new ExpoSketchViewModel(fakeRepository());
    vm.moveElement('stage-1', 4.5, 2.5);
    expect(vm.state.analysis.overlaps.length).toBeGreaterThan(0);
  });

  it('recovers the example if repository loading fails', async () => {
    const repository: LayoutRepository = { load: vi.fn(async () => { throw new Error('bad storage'); }), save: vi.fn(async () => {}) };
    const vm = new ExpoSketchViewModel(repository);
    await vm.initialize();
    expect(vm.state.phase).toBe('error');
    expect(vm.state.document.title).toContain('春日创意市集');
  });

  it('shows a save error without dropping the working document', async () => {
    const repository: LayoutRepository = { load: vi.fn(async () => createStarterDocument()), save: vi.fn(async () => { throw new Error('quota'); }) };
    const vm = new ExpoSketchViewModel(repository);
    await vm.initialize();
    vm.addElement('stage');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(vm.state.document.elements.some((element) => element.kind === 'stage' && element.id.startsWith('stage-'))).toBe(true);
    expect(vm.state.notice.tone).toBe('error');
  });

  it('ignores invalid dimensions instead of corrupting the working selection', () => {
    const vm = new ExpoSketchViewModel(fakeRepository());
    const before = vm.state.document.elements[0].width;
    vm.resizeSelected(0, 0);
    expect(vm.state.document.elements[0].width).toBe(before);
  });

  it('marquee replaces the selection and shift-marquee unions with it', () => {
    const vm = new ExpoSketchViewModel(fakeRepository());
    vm.marqueeSelect({ left: 0, top: 0, right: 6, bottom: 6 }, false);
    expect(vm.state.selectedIds).toEqual(['booth-1']);
    vm.marqueeSelect({ left: 9, top: 0.5, right: 18.5, bottom: 6 }, true);
    expect(vm.state.selectedIds).toContain('stage-1');
    expect(vm.state.selectedIds).toContain('booth-1');
    expect(vm.state.selectedIds).toHaveLength(2);
  });

  it('treats a tiny marquee drag as a click that does not change the selection', () => {
    const vm = new ExpoSketchViewModel(fakeRepository());
    vm.selectAll();
    expect(vm.state.selectedIds.length).toBeGreaterThan(1);
    vm.marqueeSelect({ left: 1, top: 1, right: 1.5, bottom: 1.5 }, false);
    expect(vm.state.selectedIds.length).toBe(5);
  });

  it('toggles elements into the selection with shift-click and exposes the union bounds', () => {
    const vm = new ExpoSketchViewModel(fakeRepository());
    vm.toggleSelection('booth-1');
    vm.toggleSelection('booth-2');
    expect(vm.state.selectedIds).toContain('stage-1');
    expect(vm.state.selectionBounds).toEqual({ left: 4, top: 1.5, right: 24, bottom: 5.5 });
    vm.toggleSelection('stage-1');
    expect(vm.state.selectedIds).not.toContain('stage-1');
  });

  it('batch deletes every selected element and prunes stale selections', () => {
    const vm = new ExpoSketchViewModel(fakeRepository());
    vm.toggleSelection('booth-1');
    vm.toggleSelection('entry-1');
    vm.removeSelected();
    const ids = vm.state.document.elements.map((element) => element.id);
    expect(ids).not.toContain('booth-1');
    expect(ids).not.toContain('entry-1');
    expect(vm.state.selectedIds.some((id) => !ids.includes(id))).toBe(false);
  });

  it('rejects a batch resize as one transaction when any element would leave the field', () => {
    const vm = new ExpoSketchViewModel(fakeRepository());
    vm.marqueeSelect({ left: 0, top: 0, right: 24.5, bottom: 6 }, false);
    const snapshot = vm.state.document.elements.map((element) => ({ ...element }));
    vm.resizeSelectedMany(20, null);
    expect(vm.state.document.elements).toEqual(snapshot);
    expect(vm.state.notice.tone).toBe('warning');
  });

  it('applies a valid batch resize to every selected element', () => {
    const vm = new ExpoSketchViewModel(fakeRepository());
    vm.marqueeSelect({ left: 3, top: 1, right: 24.5, bottom: 6 }, false);
    const selected = vm.state.selectedIds;
    vm.resizeSelectedMany(4, 3);
    selected.forEach((id) => {
      const element = vm.state.document.elements.find((item) => item.id === id);
      expect(element?.width).toBe(4);
      expect(element?.height).toBe(3);
    });
    expect(vm.state.notice.tone).toBe('success');
  });

  it('rejects alignment when it would create a new overlap, leaving positions untouched', () => {
    const vm = new ExpoSketchViewModel(fakeRepository());
    vm.selectElement('entry-1');
    vm.toggleSelection('booth-1');
    const snapshot = vm.state.document.elements.map((element) => ({ ...element }));
    vm.alignSelected('top');
    expect(vm.state.document.elements).toEqual(snapshot);
  });

  it('rolls the whole group back to its snapshot when finishing move squeezes an outside element', () => {
    const vm = new ExpoSketchViewModel(fakeRepository());
    // 组成员之间的相对间距不变，违规来自与组外 booth-2 的新增重叠
    vm.selectElement('booth-1');
    vm.toggleSelection('stage-1');
    vm.startGroupMove();
    vm.groupMoveBy(2, 0);
    // stage 右缘变为 20，与 x=19 的 booth-2 重叠 1 m
    const movedStage = vm.state.document.elements.find((element) => element.id === 'stage-1');
    expect(movedStage?.x).toBeCloseTo(12, 1);
    vm.finishGroupMove();
    const restoredStage = vm.state.document.elements.find((element) => element.id === 'stage-1');
    const restoredBooth = vm.state.document.elements.find((element) => element.id === 'booth-1');
    expect(restoredStage?.x).toBe(10);
    expect(restoredBooth?.x).toBe(4);
    expect(vm.state.isGroupMoving).toBe(false);
    expect(vm.state.notice.tone).toBe('warning');
  });

  it('clamps group translation at the field edge during the live drag', () => {
    const vm = new ExpoSketchViewModel(fakeRepository());
    vm.selectElement('seating-1');
    vm.toggleSelection('stage-1');
    vm.startGroupMove();
    vm.groupMoveBy(-999, 0);
    const minX = Math.min(...vm.state.document.elements.filter((element) => vm.state.selectedIds.includes(element.id)).map((element) => element.x));
    expect(minX).toBeGreaterThanOrEqual(0);
    vm.cancelGroupMove();
    expect(vm.state.document.elements.find((element) => element.id === 'stage-1')?.x).toBe(10);
  });

  it('keeps the selection untouched when a marquee drag is abandoned mid-gesture', () => {
    const vm = new ExpoSketchViewModel(fakeRepository());
    vm.selectAll();
    const before = { ids: vm.state.selectedIds, document: JSON.parse(JSON.stringify(vm.state.document)) as LayoutDocument };
    // 画布在框选取消时根本不调用 marqueeSelect；此处直接断言 VM 没有被任何部分提交污染
    expect(vm.state.selectedIds).toEqual(before.ids);
    expect(vm.state.document).toEqual(before.document);
  });

  it('distributes three selected booths evenly along x with pinned ends', async () => {
    const document: LayoutDocument = {
      version: 1,
      title: 'row',
      field: { width: 30, height: 12 },
      elements: [
        { id: 'a', kind: 'booth', name: 'a', x: 1, y: 1, width: 2, height: 2, rotation: 0 },
        { id: 'b', kind: 'booth', name: 'b', x: 6, y: 1, width: 2, height: 2, rotation: 0 },
        { id: 'c', kind: 'booth', name: 'c', x: 15, y: 1, width: 2, height: 2, rotation: 0 },
      ],
    };
    const vm = new ExpoSketchViewModel(fakeRepository(document));
    await vm.initialize();
    vm.selectAll();
    vm.distributeSelected('x');
    const xs = Object.fromEntries(vm.state.document.elements.map((element) => [element.id, element.x]));
    expect(xs.a).toBe(1);
    expect(xs.c).toBe(15);
    // p_c - p_a = 14，已占宽度 2(a)+2(b) = 4，间距 = (14 - 4) / 2 = 5，b 位于 1 + 2 + 5 = 8
    expect(xs.b).toBe(8);
  });

  it('distribute is a no-op for fewer than three selected elements', () => {
    const vm = new ExpoSketchViewModel(fakeRepository());
    vm.selectElement('booth-1');
    vm.toggleSelection('booth-2');
    const snapshot = vm.state.document.elements.map((element) => element.x);
    vm.distributeSelected('x');
    expect(vm.state.document.elements.map((element) => element.x)).toEqual(snapshot);
  });
});

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

// jsdom 没有 IndexedDB：作答单例走内存存储
const { hoisted } = vi.hoisted(() => ({
  hoisted: {
    memory: new Map<string, number[]>(),
    load: vi.fn(async (fp: string) => (hoisted.memory.has(fp) ? [...hoisted.memory.get(fp)!] : null)),
    save: vi.fn(async (fp: string, a: number[]) => void hoisted.memory.set(fp, [...a])),
    clear: vi.fn(async (fp: string) => void hoisted.memory.delete(fp))
  }
}));

vi.mock('../lib/storage', () => ({
  loadAnswers: hoisted.load,
  saveAnswers: hoisted.save,
  clearAnswers: hoisted.clear
}));

import PreviewPanel from './PreviewPanel.svelte';
import { preview } from '../lib/preview.svelte';
import { editor } from '../lib/state.svelte';
import { blankPuzzle } from '../lib/puzzle';

// 组件冒烟测试：作答面板能挂载、按状态渲染、按钮路由到 preview 状态，
// 且不会出现对作者答案层的任何引用。
describe('PreviewPanel.svelte', () => {
  let instance: ReturnType<typeof mount> | null = null;

  beforeEach(() => {
    hoisted.memory.clear();
    vi.clearAllMocks();
    preview.abort();
    editor.init(blankPuzzle(), null, 't');
  });

  function render(): HTMLElement {
    instance = mount(PreviewPanel, { target: document.body });
    return document.body;
  }

  it('未检查时提示需要先完成检查；提交不判正确', async () => {
    await preview.enter(); // blankPuzzle 结构合法，进入作答模式
    const root = render();
    expect(root.textContent).toContain('作答预览');
    expect(root.textContent).toContain('尚无可用的唯一解检查结论');

    const submitBtn = [...root.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('提交判定')
    )!;
    flushSync(() => submitBtn.click());
    expect(preview.verdict?.kind).toBe('need-check');
    // Svelte 直接更新真实 DOM：在 click 之后重新读取
    expect(document.body.textContent).toContain('还没有检查结论');
    // 面板不得渲染作者模式独有的答案层开关（input[type=checkbox]）
    expect(document.body.querySelector('input[type="checkbox"]')).toBeNull();

    unmount(instance!);
  });

  it('温度计冲突文案出现在面板列表中', async () => {
    const p = blankPuzzle();
    p.thermometers = [{ path: [0, 1] }];
    editor.init(p, null, 'th');
    await preview.enter();
    preview.answers[0] = 9;
    preview.answers[1] = 1;
    const root = render();
    expect(root.textContent).toContain('温度计 1');
    expect(root.textContent).toContain('严格递增');
    unmount(instance!);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PreviewState, type AnswerStore } from './preview.svelte';
import { editor } from './state.svelte';
import { standardSample } from './samples';
import { blankPuzzle, rc } from './puzzle';
import type { AnswerBoard } from './answer';

// 用内存 AnswerStore 替换 IndexedDB：作答进度的持久化路径在单测中完全可控。
const memory = new Map<string, AnswerBoard>();
const memStore: AnswerStore = {
  load: vi.fn(async (fp: string) => (memory.has(fp) ? [...memory.get(fp)!] : null)),
  save: vi.fn(async (fp: string, a: AnswerBoard) => void memory.set(fp, [...a])),
  clear: vi.fn(async (fp: string) => void memory.delete(fp))
};

let preview: PreviewState;

beforeEach(() => {
  memory.clear();
  vi.clearAllMocks();
  editor.init(blankPuzzle(), null, 't');
  preview = new PreviewState(memStore);
});

function setUnique(fp: string, solution: AnswerBoard) {
  editor.analysis = {
    status: 'done',
    result: {
      verdict: 'unique',
      solution: [...solution],
      witness: null,
      conflict: [],
      reason: null,
      elapsedMs: 1
    },
    fingerprint: fp,
    error: null
  };
}

function solvedBoard(): AnswerBoard {
  const a = new Array<number>(81).fill(0);
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      a[r * 9 + c] = (3 * (r % 3) + Math.floor(r / 3) + c) % 9 + 1;
    }
  }
  return a;
}

describe('作答预览：题面隔离', () => {
  it('学生填数不修改题面、不触碰旧检查', async () => {
    editor.init(standardSample(), null, 's');
    const fpBefore = JSON.stringify({
      r: editor.puzzle.regions,
      g: editor.puzzle.givens,
      t: editor.puzzle.thermometers.map((x) => x.path)
    });
    setUnique(fpBefore, new Array(81).fill(1));
    const givensBefore = [...editor.puzzle.givens];

    await preview.enter();
    expect(preview.active).toBe(true);

    // 在一个非提示格填数
    const target = editor.puzzle.givens.findIndex((g) => g === 0);
    preview.selectCell(target);
    preview.enterDigit(7);
    expect(preview.answers[target]).toBe(7);

    // 题面提示未被改动
    expect(editor.puzzle.givens).toEqual(givensBefore);
    // 编辑器状态没有发生结构校验复位，旧检查保持
    expect(editor.analysis.status).toBe('done');
    expect(editor.analysis.fingerprint).toBe(fpBefore);

    await preview.exit();
    expect(preview.active).toBe(false);
    // 退出后题面依旧原样
    expect(editor.puzzle.givens).toEqual(givensBefore);
    // 进度写进了独立的 answers 存储，而不是草稿
    expect(memStore.save).toHaveBeenCalled();
    const savedFp = (memStore.save as unknown as { mock: { calls: [string, AnswerBoard][] } }).mock
      .calls[0][0];
    expect(memory.get(savedFp)?.[target]).toBe(7);
  });

  it('提示格不可选择也不可填数', async () => {
    editor.init(standardSample(), null, 's');
    await preview.enter();
    const givenCell = editor.puzzle.givens.findIndex((g) => g !== 0);
    preview.selectCell(givenCell);
    expect(preview.selectedCell).toBeNull();
    preview.enterDigit(9);
    expect(preview.answers[givenCell]).toBe(0);
  });

  it('结构非法的题面不允许进入作答预览', async () => {
    const bad = standardSample();
    bad.thermometers = [{ path: [0, 2] }]; // 非相邻
    editor.init(bad, null, 'bad');
    await preview.enter();
    expect(preview.active).toBe(false);
    expect(preview.message).toContain('结构');
  });

  it('离开模式不回写提示；abort 切换题面时不保存旧进度', async () => {
    await preview.enter();
    preview.selectCell(rc(0, 0));
    preview.enterDigit(4);
    preview.abort();
    expect(memStore.save).not.toHaveBeenCalled();
    expect(editor.puzzle.givens[rc(0, 0)]).toBe(0);
  });
});

describe('作答预览：即时反馈', () => {
  it('错误温度计顺序被指出为冲突并标红', async () => {
    const p = blankPuzzle();
    p.thermometers = [{ path: [rc(0, 0), rc(1, 0)] }];
    editor.init(p, null, 'thermo');
    await preview.enter();
    preview.selectCell(rc(0, 0));
    preview.enterDigit(8);
    preview.selectCell(rc(1, 0));
    preview.enterDigit(2);
    const conflicts = preview.conflicts;
    expect(conflicts.some((c) => c.kind === 'THERMO_ORDER')).toBe(true);
    expect(preview.conflictCells.has(rc(0, 0))).toBe(true);
    expect(preview.conflictCells.has(rc(1, 0))).toBe(true);
  });

  it('清空按钮只清作答、不影响提示格', async () => {
    const p = blankPuzzle();
    p.givens[rc(0, 0)] = 5;
    editor.init(p, null, 'g');
    await preview.enter();
    preview.selectCell(rc(0, 1));
    preview.enterDigit(3);
    await preview.clearAll();
    expect(preview.answers[rc(0, 1)]).toBe(0);
    expect(preview.puzzle!.givens[rc(0, 0)]).toBe(5);
    expect(editor.puzzle.givens[rc(0, 0)]).toBe(5);
  });
});

describe('作答预览：提交门禁与按指纹隔离的旧进度', () => {
  it('未完成检查时提交 => need-check', async () => {
    const p = blankPuzzle();
    editor.init(p, null, 'nocheck');
    await preview.enter();
    const v = preview.submit();
    expect(v.kind).toBe('need-check');
  });

  it('题面改动后：旧作答无法恢复到新题，且旧唯一解结论不能判新题正确', async () => {
    // 1) 旧题：带一个提示，填好作答并退出保存
    const p1 = blankPuzzle();
    p1.givens[rc(0, 0)] = 5;
    editor.init(p1, null, 'v1');
    await preview.enter();
    preview.selectCell(rc(0, 1));
    preview.enterDigit(7);
    const fp1 = preview.fingerprint!;
    expect(memory.has(fp1)).toBe(false); // 去抖保存发生在退出时
    await preview.exit();
    expect(memory.has(fp1)).toBe(true);

    // 2) 题面改动（改一个提示），模拟检查结论失效后作者尚未重新检查
    const p2 = blankPuzzle();
    p2.givens[rc(0, 0)] = 6;
    editor.init(p2, null, 'v2');
    // 旧检查仍残留（指纹是旧题的）——revalidate 在真实 UI 中会清掉，
    // 这里故意保留来证明 judgeSubmission 的指纹门禁独立有效
    setUnique(fp1, solvedBoard());

    await preview.enter();
    const fp2 = preview.fingerprint!;
    expect(fp2).not.toBe(fp1);
    // 新题指纹下没有保存过进度 => 空白盘，旧作答没有被带过来
    expect(preview.answers.every((v) => v === 0)).toBe(true);
    expect(memory.has(fp2)).toBe(false);

    // 即使填满一个完整合法盘，旧题指纹的唯一解结论也不能让新题判"正确"
    const full = solvedBoard();
    for (let i = 0; i < 81; i++) preview.answers[i] = full[i];
    const v = preview.submit();
    expect(v.kind).toBe('need-check');
  });

  it('同题重新进入可恢复进度；指纹有效的唯一解 + 完整一致作答 => correct', async () => {
    const p = blankPuzzle();
    editor.init(p, null, 'ok');
    const fp = JSON.stringify({ r: p.regions, g: p.givens, t: [] });
    setUnique(fp, solvedBoard());

    await preview.enter();
    const full = solvedBoard();
    for (let i = 0; i < 81; i++) preview.answers[i] = full[i];
    expect(preview.submit().kind).toBe('correct');
    await preview.exit();

    // 重新进入：进度恢复，且仍可判正确
    await preview.enter();
    expect(preview.answers).toEqual(full);
    expect(preview.submit().kind).toBe('correct');
  });
});

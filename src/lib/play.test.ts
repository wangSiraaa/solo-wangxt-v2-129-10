import { describe, expect, it } from 'vitest';
import { EditorState } from './state.svelte';
import { blankEntries, evaluatePlay, gradePlay, mergedGrid, type PlayEntries } from './play';
import { playRecordFor } from './storage';
import { blankPuzzle, puzzleFingerprint, rc, type Puzzle } from './puzzle';
import { standardSample, unsatSample } from './samples';
import type { SolveResult, Verdict } from './solver';

function resultWith(verdict: Verdict, solution: number[] | null): SolveResult {
  return { verdict, solution, witness: null, conflict: [], reason: null, elapsedMs: 1 };
}

/** 构造一个与题面提示一致的"唯一解"（空格用确定性的占位数字填满） */
function fakeSolutionFor(givens: number[]): number[] {
  return givens.map((g, i) => (g >= 1 && g <= 9 ? g : (i % 9) + 1));
}

/** 只填空位的作答（提示格留 0，由合并盘以题面为准） */
function entriesMatching(puzzle: Puzzle, solution: number[]): PlayEntries {
  return solution.map((v, i) => (puzzle.givens[i] >= 1 ? 0 : v));
}

function firstBlank(puzzle: Puzzle): number {
  const i = puzzle.givens.findIndex((g) => g === 0);
  expect(i).toBeGreaterThanOrEqual(0);
  return i;
}

describe('作答盘合并与即时冲突反馈（行/列/宫/温度计）', () => {
  it('mergedGrid：提示格以题面为准，作答只填空位', () => {
    const p = blankPuzzle();
    p.givens[0] = 5;
    const entries = blankEntries();
    entries[0] = 9; // 试图覆盖提示：无效
    entries[1] = 7;
    const grid = mergedGrid(p, entries);
    expect(grid[0]).toBe(5);
    expect(grid[1]).toBe(7);
  });

  it('行内数字重复被指出', () => {
    const p = blankPuzzle();
    const entries = blankEntries();
    entries[rc(0, 0)] = 4;
    entries[rc(0, 5)] = 4;
    const conflicts = evaluatePlay(p, entries);
    expect(
      conflicts.some(
        (c) => c.code === 'ROW_DUP' && c.cells.includes(rc(0, 0)) && c.cells.includes(rc(0, 5))
      )
    ).toBe(true);
  });

  it('列内数字重复被指出', () => {
    const p = blankPuzzle();
    const entries = blankEntries();
    entries[rc(0, 0)] = 4;
    entries[rc(5, 0)] = 4;
    const conflicts = evaluatePlay(p, entries);
    expect(conflicts.some((c) => c.code === 'COL_DUP')).toBe(true);
  });

  it('宫内数字重复被指出', () => {
    const p = blankPuzzle(); // 标准 3x3 宫：rc(0,0) 与 rc(1,1) 同属宫 1
    const entries = blankEntries();
    entries[rc(0, 0)] = 4;
    entries[rc(1, 1)] = 4;
    const conflicts = evaluatePlay(p, entries);
    expect(conflicts.some((c) => c.code === 'REGION_DUP' && c.region === 0)).toBe(true);
  });

  it('合法填写无任何冲突', () => {
    const p = blankPuzzle();
    p.thermometers = [{ path: [rc(0, 0), rc(1, 0), rc(1, 1)] }];
    const entries = blankEntries();
    entries[rc(0, 0)] = 3;
    entries[rc(1, 0)] = 5;
    entries[rc(1, 1)] = 9;
    expect(evaluatePlay(p, entries)).toEqual([]);
  });

  it('温度计顺序错误被指出（点名温度计、格子与当前数字）', () => {
    const p = blankPuzzle();
    p.thermometers = [{ path: [rc(0, 0), rc(0, 1), rc(0, 2)] }];
    const entries = blankEntries();
    entries[rc(0, 0)] = 5;
    entries[rc(0, 1)] = 3; // 泡端 5 > 3，倒挂
    const thermo = evaluatePlay(p, entries).filter((c) => c.code === 'THERMO_ORDER');
    expect(thermo.length).toBe(1);
    expect(thermo[0].thermometer).toBe(0);
    expect(thermo[0].cells).toEqual([rc(0, 0), rc(0, 1)]);
    expect(thermo[0].message).toContain('温度计 1');
    expect(thermo[0].message).toContain('R1C1');
    expect(thermo[0].message).toContain('R1C2');
  });

  it('温度计上数字相等也算顺序错误（必须严格递增）', () => {
    const p = blankPuzzle();
    p.thermometers = [{ path: [rc(0, 0), rc(1, 0)] }];
    const entries = blankEntries();
    entries[rc(0, 0)] = 4;
    entries[rc(1, 0)] = 4;
    expect(evaluatePlay(p, entries).some((c) => c.code === 'THERMO_ORDER')).toBe(true);
  });

  it('提示与作答造成的温度计倒挂也被指出', () => {
    const p = unsatSample(); // bulb R1C1 有提示 9，温度计自泡端要求递增
    const t = p.thermometers[0];
    const a = t.path[0];
    const b = t.path[1];
    expect(p.givens[a]).toBe(9);
    const entries = blankEntries();
    if (p.givens[b] === 0) entries[b] = 5; // 学生在水银柱第二格填 5：9 > 5 倒挂
    const conflicts = evaluatePlay(p, entries);
    expect(
      conflicts.some(
        (c) => c.code === 'THERMO_ORDER' && c.cells.includes(a) && c.cells.includes(b)
      )
    ).toBe(true);
  });
});

describe('提交判定：只有指纹有效的唯一解结论才算数', () => {
  it('没有任何检查结论时：提示需要先完成检查', () => {
    const p = standardSample();
    expect(gradePlay(p, blankEntries(), null, null).kind).toBe('needs-check');
  });

  it('结论不是唯一解（multiple/unsat/unknown）时：需要先完成检查', () => {
    const p = standardSample();
    const fp = puzzleFingerprint(p);
    for (const verdict of ['multiple', 'unsat', 'unknown'] as const) {
      const check = resultWith(verdict, verdict === 'unsat' ? null : fakeSolutionFor(p.givens));
      expect(gradePlay(p, blankEntries(), check, fp).kind).toBe('needs-check');
    }
  });

  it('唯一解结论的指纹与当前题面不符时：旧答案不能当作新题的正确结果', () => {
    const p1 = standardSample();
    const solution = fakeSolutionFor(p1.givens);
    const check = resultWith('unique', solution);
    const fp1 = puzzleFingerprint(p1);
    // 题面改动：新增一个提示
    const p2 = standardSample();
    p2.givens[firstBlank(p2)] = 5;
    const entries = entriesMatching(p2, solution);
    expect(gradePlay(p2, entries, check, fp1).kind).toBe('needs-check');
  });

  it('唯一解有效但未填满：提示还有空格', () => {
    const p = standardSample();
    const solution = fakeSolutionFor(p.givens);
    const check = resultWith('unique', solution);
    const grade = gradePlay(p, blankEntries(), check, puzzleFingerprint(p));
    expect(grade.kind).toBe('incomplete');
    if (grade.kind === 'incomplete') {
      expect(grade.empty).toBe(p.givens.filter((g) => g === 0).length);
    }
  });

  it('填满且与唯一解一致：完整正确', () => {
    const p = standardSample();
    const solution = fakeSolutionFor(p.givens);
    const check = resultWith('unique', solution);
    const grade = gradePlay(p, entriesMatching(p, solution), check, puzzleFingerprint(p));
    expect(grade.kind).toBe('correct');
  });

  it('填满但有错格：指出错格位置', () => {
    const p = standardSample();
    const solution = fakeSolutionFor(p.givens);
    const check = resultWith('unique', solution);
    const entries = entriesMatching(p, solution);
    const blank = firstBlank(p);
    entries[blank] = solution[blank] === 9 ? 8 : solution[blank] + 1;
    const grade = gradePlay(p, entries, check, puzzleFingerprint(p));
    expect(grade.kind).toBe('incorrect');
    if (grade.kind === 'incorrect') {
      expect(grade.wrongCells).toEqual([blank]);
    }
  });
});

describe('作答进度按题面指纹归档（与作者草稿分离）', () => {
  it('记录主键即题面指纹；题面一改，旧作答不再是新题的进度', () => {
    const p1 = standardSample();
    const rec = playRecordFor(p1, [1, 2, 3]);
    expect(rec.id).toBe(puzzleFingerprint(p1));
    expect(rec.puzzleFingerprint).toBe(puzzleFingerprint(p1));
    expect(rec.entries).toEqual([1, 2, 3]);

    const p2 = standardSample();
    p2.givens[firstBlank(p2)] = 5;
    // 新题面的指纹不同 => 按主键查找时不会命中旧记录
    expect(puzzleFingerprint(p2)).not.toBe(rec.id);
  });
});

describe('作答预览模式（EditorState）', () => {
  it('学生填数不会修改题面或旧检查', async () => {
    const ed = new EditorState();
    ed.init(standardSample(), null, 't');
    const fp = puzzleFingerprint(ed.puzzle);
    const givensBefore = [...ed.puzzle.givens];
    ed.analysis = {
      status: 'done',
      result: resultWith('unique', fakeSolutionFor(ed.puzzle.givens)),
      fingerprint: fp,
      error: null
    };

    await ed.enterPlay();
    const blank = firstBlank(ed.puzzle);
    ed.selectedCell = blank;
    ed.pressDigit(7);
    ed.pressDigit(0); // 清空
    ed.pressDigit(3);

    expect(ed.playEntries[blank]).toBe(3);
    // 题面与旧检查结论原封不动
    expect(ed.puzzle.givens).toEqual(givensBefore);
    expect(puzzleFingerprint(ed.puzzle)).toBe(fp);
    expect(ed.analysis.status).toBe('done');
    expect(ed.analysis.fingerprint).toBe(fp);
    expect(ed.analysis.result?.verdict).toBe('unique');
  });

  it('提示格不可被作答覆盖', async () => {
    const ed = new EditorState();
    ed.init(standardSample(), null, 't');
    await ed.enterPlay();
    const givenCell = ed.puzzle.givens.findIndex((g) => g >= 1);
    expect(givenCell).toBeGreaterThanOrEqual(0);
    const givenVal = ed.puzzle.givens[givenCell];
    ed.selectedCell = givenCell;
    ed.pressDigit(givenVal === 9 ? 8 : 9);
    expect(ed.playEntries[givenCell]).toBe(0);
    expect(ed.puzzle.givens[givenCell]).toBe(givenVal);
  });

  it('离开模式不回写提示', async () => {
    const ed = new EditorState();
    ed.init(standardSample(), null, 't');
    const fp = puzzleFingerprint(ed.puzzle);
    await ed.enterPlay();
    const blank = firstBlank(ed.puzzle);
    ed.playSetCell(blank, 4);
    ed.exitPlay();
    expect(ed.mode).toBe('edit');
    expect(ed.puzzle.givens[blank]).toBe(0);
    expect(puzzleFingerprint(ed.puzzle)).toBe(fp);
  });

  it('作答冲突在状态层即时可见', async () => {
    const ed = new EditorState();
    ed.init(standardSample(), null, 't');
    await ed.enterPlay();
    expect(ed.playConflicts).toEqual([]);
    // 找同一行里的两个空格，填相同数字
    const p = ed.puzzle;
    let pair: [number, number] | null = null;
    for (let r = 0; r < 9 && !pair; r++) {
      const blanks: number[] = [];
      for (let c = 0; c < 9; c++) if (p.givens[rc(r, c)] === 0) blanks.push(rc(r, c));
      if (blanks.length >= 2) pair = [blanks[0], blanks[1]];
    }
    if (!pair) throw new Error('样例中找不到同一行的两个空格');
    const [c1, c2] = pair;
    ed.playSetCell(c1, 6);
    ed.playSetCell(c2, 6);
    expect(ed.playConflicts.some((c) => c.code === 'ROW_DUP')).toBe(true);
    // 改掉其中一个，冲突消失
    ed.playSetCell(c2, 0);
    expect(ed.playConflicts).toEqual([]);
  });

  it('提交：无有效唯一解结论时提示需要先完成检查', async () => {
    const ed = new EditorState();
    ed.init(standardSample(), null, 't');
    await ed.enterPlay();
    ed.submitPlay();
    expect(ed.playGrade?.kind).toBe('needs-check');
  });

  it('提交：指纹有效的唯一解结论下判定完整正确', async () => {
    const ed = new EditorState();
    ed.init(standardSample(), null, 't');
    const solution = fakeSolutionFor(ed.puzzle.givens);
    ed.analysis = {
      status: 'done',
      result: resultWith('unique', solution),
      fingerprint: puzzleFingerprint(ed.puzzle),
      error: null
    };
    await ed.enterPlay();
    ed.playEntries = entriesMatching(ed.puzzle, solution);
    ed.submitPlay();
    expect(ed.playGrade?.kind).toBe('correct');
  });

  it('题面改动后：旧作答清空、旧答案不能判定新题', async () => {
    const ed = new EditorState();
    ed.init(standardSample(), null, 't');
    const solution = fakeSolutionFor(ed.puzzle.givens);
    ed.analysis = {
      status: 'done',
      result: resultWith('unique', solution),
      fingerprint: puzzleFingerprint(ed.puzzle),
      error: null
    };
    await ed.enterPlay();
    ed.playEntries = entriesMatching(ed.puzzle, solution);
    ed.submitPlay();
    expect(ed.playGrade?.kind).toBe('correct');

    // 作者退出作答并改动题面（新增一个提示）
    ed.exitPlay();
    ed.setGiven(firstBlank(ed.puzzle), 5);
    expect(ed.analysis.result).toBeNull(); // 旧检查结论已失效

    await ed.enterPlay();
    // 旧作答不会被当作新题的进度
    expect(ed.playEntries.every((v) => v === 0)).toBe(true);
    // 旧答案也不能判定新题
    ed.submitPlay();
    expect(ed.playGrade?.kind).toBe('needs-check');
  });
});

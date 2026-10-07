import { describe, expect, it } from 'vitest';
import { blankPuzzle, rc, type Puzzle } from './puzzle';
import {
  blankAnswers,
  canEnterAt,
  countEmpty,
  findAnswerConflicts,
  judgeSubmission,
  mergedValues,
  type AnswerBoard
} from './answer';
import type { AnalysisState } from './state.svelte';

function validPuzzle(mut?: (p: Puzzle) => void): Puzzle {
  const p = blankPuzzle();
  mut?.(p);
  return p;
}

/** 经典合法数独解：v(r,c) = (3*(r%3) + floor(r/3) + c) % 9 + 1 */
function solvedBoard(): AnswerBoard {
  const a = blankAnswers();
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      a[r * 9 + c] = (3 * (r % 3) + Math.floor(r / 3) + c) % 9 + 1;
    }
  }
  return a;
}

function uniqueAnalysis(fp: string, solution: AnswerBoard): AnalysisState {
  return {
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

describe('作答盘即时冲突检测', () => {
  it('空盘无冲突，待填 81 格', () => {
    const p = validPuzzle();
    expect(findAnswerConflicts(p, blankAnswers())).toEqual([]);
    expect(countEmpty(p, blankAnswers())).toBe(81);
  });

  it('同行重复数字被指出', () => {
    const p = validPuzzle();
    const a = blankAnswers();
    a[rc(0, 0)] = 5;
    a[rc(0, 5)] = 5;
    const conflicts = findAnswerConflicts(p, a);
    expect(conflicts.some((c) => c.kind === 'ROW_DUPLICATE')).toBe(true);
    expect(conflicts[0].cells).toContain(rc(0, 0));
  });

  it('同列、同宫重复数字被指出', () => {
    const p = validPuzzle();
    let a = blankAnswers();
    a[rc(0, 0)] = 3;
    a[rc(5, 0)] = 3;
    expect(findAnswerConflicts(p, a).some((c) => c.kind === 'COL_DUPLICATE')).toBe(true);

    a = blankAnswers();
    a[rc(0, 0)] = 7;
    a[rc(1, 1)] = 7;
    expect(findAnswerConflicts(p, a).some((c) => c.kind === 'REGION_DUPLICATE')).toBe(true);
  });

  it('温度计递增方向错误（泡端 >= 后段）被指出，并点名温度计与两格', () => {
    const p = validPuzzle((x) => {
      x.thermometers = [{ path: [rc(0, 0), rc(0, 1), rc(0, 2)] }];
    });
    const a = blankAnswers();
    a[rc(0, 0)] = 4;
    a[rc(0, 1)] = 4; // 相等即违反严格递增
    const conflicts = findAnswerConflicts(p, a);
    const thermo = conflicts.filter((c) => c.kind === 'THERMO_ORDER');
    expect(thermo.length).toBe(1);
    expect(thermo[0].message).toContain('温度计 1');
    expect(thermo[0].cells).toEqual([rc(0, 0), rc(0, 1)]);

    // 泡端更大也违规
    a[rc(0, 1)] = 2;
    const again = findAnswerConflicts(p, a);
    expect(again.some((c) => c.kind === 'THERMO_ORDER')).toBe(true);

    // 严格递增则放行
    a[rc(0, 0)] = 2;
    a[rc(0, 1)] = 5;
    a[rc(0, 2)] = 9;
    expect(findAnswerConflicts(p, a).some((c) => c.kind === 'THERMO_ORDER')).toBe(false);
  });

  it('温度计只有一端填写时不报错（即时反馈不误伤）', () => {
    const p = validPuzzle((x) => {
      x.thermometers = [{ path: [rc(0, 0), rc(0, 1)] }];
    });
    const a = blankAnswers();
    a[rc(0, 0)] = 9;
    expect(findAnswerConflicts(p, a)).toEqual([]);
  });

  it('提示格不可作答；脏作答落在提示格时以提示为准', () => {
    const p = validPuzzle((x) => {
      x.givens[rc(0, 0)] = 9;
    });
    expect(canEnterAt(p, rc(0, 0))).toBe(false);
    const dirty = blankAnswers();
    dirty[rc(0, 0)] = 1; // 不应出现的学生数据
    expect(mergedValues(p, dirty)[rc(0, 0)]).toBe(9);
  });
});

describe('提交判定：只有指纹有效的唯一解结论才能判完整正确', () => {
  const fp = JSON.stringify({
    r: validPuzzle().regions,
    g: new Array(81).fill(0),
    t: []
  });

  it('没有检查结论 => need-check（不能猜判）', () => {
    const p = validPuzzle();
    const analysis: AnalysisState = { status: 'idle', result: null, fingerprint: null, error: null };
    const v = judgeSubmission(p, solvedBoard(), analysis);
    expect(v.kind).toBe('need-check');
  });

  it('检查进行中 => need-check', () => {
    const p = validPuzzle();
    const analysis: AnalysisState = { status: 'checking', result: null, fingerprint: null, error: null };
    expect(judgeSubmission(p, solvedBoard(), analysis).kind).toBe('need-check');
  });

  it('结论为多解/无解/未判定 => 一律 need-check', () => {
    const p = validPuzzle();
    for (const verdict of ['multiple', 'unsat', 'unknown'] as const) {
      const analysis: AnalysisState = {
        status: 'done',
        result: {
          verdict,
          solution: verdict === 'multiple' || verdict === 'unknown' ? solvedBoard() : null,
          witness: null,
          conflict: [],
          reason: null,
          elapsedMs: 1
        },
        fingerprint: fp,
        error: null
      };
      expect(judgeSubmission(p, solvedBoard(), analysis).kind).toBe('need-check');
    }
  });

  it('唯一解结论指纹与当前题面不一致（题面已改）=> need-check，旧答案不能判正确', () => {
    const p = validPuzzle();
    const analysis = uniqueAnalysis('stale-fingerprint', solvedBoard());
    const v = judgeSubmission(p, solvedBoard(), analysis);
    expect(v.kind).toBe('need-check');
    expect(v.kind === 'need-check' && v.message).toContain('改动');
  });

  it('未填满 => incomplete', () => {
    const p = validPuzzle();
    const a = solvedBoard();
    a[rc(8, 8)] = 0;
    const v = judgeSubmission(p, a, uniqueAnalysis(fp, solvedBoard()));
    expect(v.kind).toBe('incomplete');
    if (v.kind === 'incomplete') expect(v.empty).toBe(1);
  });

  it('填满但有冲突 => conflicts（即使存在指纹有效的唯一解）', () => {
    const p = validPuzzle();
    const a = solvedBoard();
    a[rc(0, 1)] = a[rc(0, 0)]; // 制造行重复
    const v = judgeSubmission(p, a, uniqueAnalysis(fp, solvedBoard()));
    expect(v.kind).toBe('conflicts');
  });

  it('完整且与指纹有效的唯一解一致 => correct', () => {
    const p = validPuzzle();
    const v = judgeSubmission(p, solvedBoard(), uniqueAnalysis(fp, solvedBoard()));
    expect(v.kind).toBe('correct');
  });

  it('完整无冲突但与唯一解不一致 => incorrect', () => {
    // 同一 band 内交换第 0、1 行仍是合法数独盘，但不是记录的那份唯一解。
    const p = validPuzzle();
    const ref = solvedBoard();
    const other = [...ref];
    for (let c = 0; c < 9; c++) {
      other[c] = ref[9 + c];
      other[9 + c] = ref[c];
    }
    expect(findAnswerConflicts(p, other)).toEqual([]);
    const v = judgeSubmission(p, other, uniqueAnalysis(fp, ref));
    expect(v.kind).toBe('incorrect');
  });
});

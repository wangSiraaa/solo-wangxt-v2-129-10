// 作答盘（学生视角）纯逻辑：
//  - 学生在题面快照上填数，提示格不可填；
//  - 即时冲突检测：与提示冲突、行/列/宫重复、温度计沿水银泡方向必须严格递增；
//  - 提交判定：只有"题稿已有、指纹与当前题面一致、结论为唯一解"时才允许判完整正确，
//    其他情况（未检查 / 检查过期 / 多解 / 无解 / 未判定）一律要求先完成检查。
// 本模块不含任何 DOM / Svelte / 存储依赖，便于单测。
import {
  CELL_COUNT,
  N,
  coordLabel,
  puzzleFingerprint,
  rc,
  type CellIndex,
  type Puzzle
} from './puzzle';
import type { AnalysisState } from './state.svelte';

/** 作答盘：answers[i] = 0 表示未填，1..9 表示学生填的数字（提示格恒为 0） */
export type AnswerBoard = number[];

export type AnswerConflictKind =
  | 'ROW_DUPLICATE'
  | 'COL_DUPLICATE'
  | 'REGION_DUPLICATE'
  | 'THERMO_ORDER';

export interface AnswerConflict {
  kind: AnswerConflictKind;
  message: string;
  /** 涉及的格子（用于在作答盘上标红） */
  cells: CellIndex[];
  thermometer?: number;
}

export function blankAnswers(): AnswerBoard {
  return new Array<number>(CELL_COUNT).fill(0);
}

/** 提示格不允许填数；学生只能在空格作答 */
export function canEnterAt(puzzle: Puzzle, cell: CellIndex): boolean {
  return (puzzle.givens[cell] ?? 0) === 0;
}

/**
 * 把提示与学生填的数合并成"当前盘面上每个格子的值"（0 = 空）。
 * 学生数据只允许出现在非提示格；若脏数据落在提示格上，以提示为准。
 */
export function mergedValues(puzzle: Puzzle, answers: AnswerBoard): number[] {
  const values = new Array<number>(CELL_COUNT).fill(0);
  for (let i = 0; i < CELL_COUNT; i++) {
    const g = puzzle.givens[i] ?? 0;
    values[i] = g !== 0 ? g : answers[i] ?? 0;
  }
  return values;
}

function findDuplicateConflicts(
  label: (idx0: number) => string,
  kind: AnswerConflictKind,
  units: CellIndex[][],
  values: number[]
): AnswerConflict[] {
  const out: AnswerConflict[] = [];
  units.forEach((cells, idx0) => {
    const byDigit = new Map<number, CellIndex[]>();
    for (const cell of cells) {
      const v = values[cell];
      if (v >= 1 && v <= 9) {
        const list = byDigit.get(v);
        if (list) list.push(cell);
        else byDigit.set(v, [cell]);
      }
    }
    for (const [digit, dc] of byDigit) {
      if (dc.length > 1) {
        out.push({
          kind,
          message: `${label(idx0)}：数字 ${digit} 重复（${dc.map(coordLabel).join('、')}）`,
          cells: [...dc]
        });
      }
    }
  });
  return out;
}

/**
 * 即时冲突检测。只检查"当前已填数字"之间的规则冲突，空格不参与
 * （因此边填边标红，而不是整盘完成后才报错）。
 */
export function findAnswerConflicts(puzzle: Puzzle, answers: AnswerBoard): AnswerConflict[] {
  const values = mergedValues(puzzle, answers);
  const conflicts: AnswerConflict[] = [];

  // 行
  const rows: CellIndex[][] = [];
  const cols: CellIndex[][] = [];
  for (let k = 0; k < N; k++) {
    const rowCells: CellIndex[] = [];
    const colCells: CellIndex[] = [];
    for (let j = 0; j < N; j++) {
      rowCells.push(rc(k, j));
      colCells.push(rc(j, k));
    }
    rows.push(rowCells);
    cols.push(colCells);
  }
  conflicts.push(
    ...findDuplicateConflicts((k) => `第 ${k + 1} 行`, 'ROW_DUPLICATE', rows, values)
  );
  conflicts.push(
    ...findDuplicateConflicts((k) => `第 ${k + 1} 列`, 'COL_DUPLICATE', cols, values)
  );

  // 宫
  const members: CellIndex[][] = Array.from({ length: N }, () => []);
  puzzle.regions.forEach((region, i) => {
    if (Number.isInteger(region) && region >= 0 && region < N) members[region].push(i);
  });
  conflicts.push(
    ...findDuplicateConflicts((k) => `宫 ${k + 1}`, 'REGION_DUPLICATE', members, values)
  );

  // 温度计：沿路径（bulb -> 顶端）每个相邻段都必须严格递增。
  // 只比较两端都已填的段；任何一端为空时尚无法判定。
  puzzle.thermometers.forEach((t, ti) => {
    for (let s = 1; s < t.path.length; s++) {
      const ca = t.path[s - 1];
      const cb = t.path[s];
      const va = values[ca];
      const vb = values[cb];
      if (va >= 1 && va <= 9 && vb >= 1 && vb <= 9 && va >= vb) {
        conflicts.push({
          kind: 'THERMO_ORDER',
          message:
            `温度计 ${ti + 1}：${coordLabel(ca)} = ${va} → ${coordLabel(cb)} = ${vb}，` +
            `水银柱自泡端必须严格递增（${coordLabel(ca)} 应小于 ${coordLabel(cb)}）`,
          cells: [ca, cb],
          thermometer: ti
        });
      }
    }
  });

  return conflicts;
}

/** 未填格数量（提示与学生填数合并后仍为 0 的格子） */
export function countEmpty(puzzle: Puzzle, answers: AnswerBoard): number {
  const values = mergedValues(puzzle, answers);
  return values.filter((v) => v === 0).length;
}

// ---------------------------------------------------------------------------
// 提交判定
// ---------------------------------------------------------------------------

export type SubmitVerdict =
  | { kind: 'structure-invalid'; message: string }
  | { kind: 'need-check'; message: string }
  | { kind: 'incomplete'; message: string; empty: number }
  | { kind: 'conflicts'; message: string; conflicts: AnswerConflict[] }
  | { kind: 'correct'; message: string }
  | { kind: 'incorrect'; message: string; mismatches: number };

/**
 * 判定一次提交。关键安全规则：
 * 完整正确只能在"当前题面已有检查结论、结论指纹与当前题面一致、verdict 为 unique、
 * 且唯一解在手"时给出；否则一律返回 need-check，绝不拿旧题/他题的结论判新题。
 *
 * @param expectedFingerprint 作答盘快照的指纹（学生作答所基于的题面）。
 *   给定后还会要求检查结论与该快照一致；不传则只与当前题面指纹比对。
 */
export function judgeSubmission(
  puzzle: Puzzle,
  answers: AnswerBoard,
  analysis: AnalysisState,
  expectedFingerprint?: string
): SubmitVerdict {
  const fp = puzzleFingerprint(puzzle);

  // 结构校验在进入作答预览前已做；这里再兜底一次。
  const values = mergedValues(puzzle, answers);
  if (values.some((v, i) => !Number.isInteger(v) || v < 0 || v > 9)) {
    return {
      kind: 'structure-invalid',
      message: '作答数据损坏，请退出作答预览后重新进入。'
    };
  }

  const result = analysis.status === 'done' ? analysis.result : null;
  if (
    !result ||
    analysis.fingerprint !== fp ||
    (expectedFingerprint !== undefined && expectedFingerprint !== fp) ||
    result.verdict !== 'unique' ||
    !result.solution
  ) {
    let message: string;
    if (analysis.status === 'checking') {
      message = '题稿检查尚在进行中，请等待检查完成后再提交判定。';
    } else if (!result) {
      message = '这份题稿还没有检查结论。请先回到作者模式运行检查，确认存在唯一解后再提交。';
    } else if (analysis.fingerprint !== fp) {
      message = '题面在上次检查之后被改动过，旧结论已失效。请重新运行检查后再提交。';
    } else if (result.verdict === 'unsat') {
      message = '当前题稿的检查结论是"无解"，无法据此判定作答完整正确。';
    } else if (result.verdict === 'multiple') {
      message = '当前题稿的检查结论是"多解"。只有唯一解结论才能判定完整正确，请先加固题面后重新检查。';
    } else if (result.verdict === 'unknown') {
      message = '当前题稿的检查结论是"未判定"（求解器超时），尚未确认唯一解。请重新检查后再提交。';
    } else {
      message = '缺少可用的唯一解结论，请先回到作者模式完成检查。';
    }
    return { kind: 'need-check', message };
  }

  const conflicts = findAnswerConflicts(puzzle, answers);
  if (conflicts.length > 0) {
    return {
      kind: 'conflicts',
      message: `存在 ${conflicts.length} 处规则冲突，按标红位置修改后再提交。`,
      conflicts
    };
  }

  const empty = countEmpty(puzzle, answers);
  if (empty > 0) {
    return {
      kind: 'incomplete',
      message: `还有 ${empty} 格未填，填满后才能提交。`,
      empty
    };
  }

  // 完整且无冲突：与指纹有效的唯一解逐格比对。
  // （唯一解 + 满足全部规则时二者必然相同；逐格比对是显式兜底。）
  let mismatches = 0;
  for (let i = 0; i < CELL_COUNT; i++) {
    if (values[i] !== result.solution[i]) mismatches++;
  }
  if (mismatches === 0) {
    return { kind: 'correct', message: '完整正确！作答与该题的唯一解一致。' };
  }
  return {
    kind: 'incorrect',
    message: `填法满足已填规则，但与唯一解有 ${mismatches} 格不一致。`,
    mismatches
  };
}

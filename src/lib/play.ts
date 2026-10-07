// 作答预览（学生视角试做）的纯逻辑：合并题面与作答、即时冲突反馈、提交判定。
// 不依赖 DOM/Svelte，便于单测。作答数据与作者题面严格分离：
// 这里的函数只读 puzzle，绝不修改它。
import {
  CELL_COUNT,
  N,
  coordLabel,
  puzzleFingerprint,
  rc,
  type CellIndex,
  type Puzzle
} from './puzzle';
import type { SolveResult } from './solver';

/** 学生的作答盘：entries[i] = 0 表示未填，1..9 表示学生填入的数字 */
export type PlayEntries = number[];

export type PlayConflictCode = 'ROW_DUP' | 'COL_DUP' | 'REGION_DUP' | 'THERMO_ORDER';

export interface PlayConflict {
  code: PlayConflictCode;
  message: string;
  /** 冲突涉及的格子（画布高亮用） */
  cells: CellIndex[];
  thermometer?: number;
  region?: number;
}

export function blankEntries(): PlayEntries {
  return new Array<number>(CELL_COUNT).fill(0);
}

/**
 * 合并题面提示与学生作答：提示格永远以题面为准（学生不能覆盖提示），
 * 非法作答值（越界/非整数）按未填处理。
 */
export function mergedGrid(puzzle: Puzzle, entries: PlayEntries): number[] {
  const grid = new Array<number>(CELL_COUNT).fill(0);
  for (let i = 0; i < CELL_COUNT; i++) {
    const g = puzzle.givens[i];
    if (Number.isInteger(g) && g >= 1 && g <= 9) {
      grid[i] = g;
      continue;
    }
    const e = entries[i] ?? 0;
    grid[i] = Number.isInteger(e) && e >= 1 && e <= 9 ? e : 0;
  }
  return grid;
}

function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i < b; i++) out.push(i);
  return out;
}

/**
 * 即时反馈：按行、列、宫、温度计规则检查"题面 + 当前作答"的合并盘。
 * 只报告规则冲突，不调用求解器，也不要求题目本身可解。
 */
export function evaluatePlay(puzzle: Puzzle, entries: PlayEntries): PlayConflict[] {
  const conflicts: PlayConflict[] = [];
  const grid = mergedGrid(puzzle, entries);

  const collectDup = (
    cells: CellIndex[],
    code: PlayConflictCode,
    describe: (digit: number) => string,
    extra: Partial<PlayConflict> = {}
  ) => {
    const byDigit = new Map<number, CellIndex[]>();
    for (const i of cells) {
      const v = grid[i];
      if (v < 1 || v > 9) continue;
      const arr = byDigit.get(v);
      if (arr) arr.push(i);
      else byDigit.set(v, [i]);
    }
    for (const [digit, idxs] of byDigit) {
      if (idxs.length > 1) {
        conflicts.push({ code, message: describe(digit), cells: idxs, ...extra });
      }
    }
  };

  // 行、列：每个数字在同一行/列至多出现一次
  for (let k = 0; k < N; k++) {
    collectDup(
      range(0, N).map((j) => rc(k, j)),
      'ROW_DUP',
      (d) => `第 ${k + 1} 行数字 ${d} 重复`
    );
    collectDup(
      range(0, N).map((j) => rc(j, k)),
      'COL_DUP',
      (d) => `第 ${k + 1} 列数字 ${d} 重复`
    );
  }

  // 宫（不规则宫）：同一宫内数字不得重复
  const members: CellIndex[][] = Array.from({ length: N }, () => []);
  puzzle.regions.forEach((r, i) => {
    if (Number.isInteger(r) && r >= 0 && r < N) members[r].push(i);
  });
  members.forEach((cells, k) => {
    collectDup(cells, 'REGION_DUP', (d) => `宫 ${k + 1} 数字 ${d} 重复`, { region: k });
  });

  // 温度计：自泡端沿路径严格递增；相邻两格都已有数字时立即可判
  puzzle.thermometers.forEach((t, ti) => {
    for (let s = 1; s < t.path.length; s++) {
      const a = t.path[s - 1];
      const b = t.path[s];
      const va = grid[a];
      const vb = grid[b];
      if (va >= 1 && vb >= 1 && va >= vb) {
        conflicts.push({
          code: 'THERMO_ORDER',
          message: `温度计 ${ti + 1}：${coordLabel(a)}（${va}）必须小于 ${coordLabel(b)}（${vb}），水银柱自泡端严格递增`,
          cells: [a, b],
          thermometer: ti
        });
      }
    }
  });

  return conflicts;
}

export type PlayGrade =
  | { kind: 'needs-check' }
  | { kind: 'incomplete'; empty: number }
  | { kind: 'correct' }
  | { kind: 'incorrect'; wrongCells: CellIndex[] };

/**
 * 提交判定。只有"题稿已有且指纹有效的唯一解结论"才允许判定完整正确：
 * 题面一旦改动，旧结论的指纹与当前题面不符，一律要求先重新完成检查，
 * 旧答案绝不能被当作新题的正确结果。
 */
export function gradePlay(
  puzzle: Puzzle,
  entries: PlayEntries,
  check: SolveResult | null,
  checkFingerprint: string | null
): PlayGrade {
  if (
    check === null ||
    check.verdict !== 'unique' ||
    check.solution === null ||
    checkFingerprint === null ||
    checkFingerprint !== puzzleFingerprint(puzzle)
  ) {
    return { kind: 'needs-check' };
  }

  const grid = mergedGrid(puzzle, entries);
  let empty = 0;
  for (let i = 0; i < CELL_COUNT; i++) if (grid[i] < 1) empty++;
  if (empty > 0) return { kind: 'incomplete', empty };

  const solution = check.solution;
  const wrongCells: CellIndex[] = [];
  for (let i = 0; i < CELL_COUNT; i++) {
    if (grid[i] !== solution[i]) wrongCells.push(i);
  }
  return wrongCells.length ? { kind: 'incorrect', wrongCells } : { kind: 'correct' };
}

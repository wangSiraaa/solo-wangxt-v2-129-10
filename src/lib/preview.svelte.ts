// 作答预览模式（学生视角）的状态。
//
// 隔离原则：
//  - enter() 时对"当前题面"做深拷贝快照，作答全程只读写快照与 answers，
//    绝不调用 editor 的任何题面变更方法 => 学生填数不会修改题面或旧检查；
//  - 作答进度通过 AnswerStore 按"题面指纹"独立持久化，与作者草稿（drafts）分库存储；
//  - exit() 只做一次保存然后丢弃快照，不向 editor 回写任何提示/答案；
//  - 题面在进入后若被改动（正常 UI 不会发生），submit 用当前 editor.puzzle 判定，
//    judgeSubmission 会因指纹与唯一解结论不一致而拒绝判正确。
import {
  clonePuzzle,
  puzzleFingerprint,
  validateStructure,
  type CellIndex,
  type Puzzle
} from './puzzle';
import {
  blankAnswers,
  canEnterAt,
  countEmpty,
  findAnswerConflicts,
  judgeSubmission,
  type AnswerBoard,
  type AnswerConflict,
  type SubmitVerdict
} from './answer';
import { editor } from './state.svelte';
import {
  clearAnswers as idbClearAnswers,
  loadAnswers as idbLoadAnswers,
  saveAnswers as idbSaveAnswers
} from './storage';

/** 存储端口：单测可注入内存实现，避免依赖 IndexedDB */
export interface AnswerStore {
  load(fingerprint: string): Promise<AnswerBoard | null>;
  save(fingerprint: string, answers: AnswerBoard): Promise<void>;
  clear(fingerprint: string): Promise<void>;
}

export const idbAnswerStore: AnswerStore = {
  load: idbLoadAnswers,
  save: idbSaveAnswers,
  clear: idbClearAnswers
};

export class PreviewState {
  active = $state(false);
  /** 进入时题面的深拷贝快照；作答全程只读 */
  puzzle = $state<Puzzle | null>(null);
  /** 快照对应的题面指纹（存储主键 + 判定凭据） */
  fingerprint = $state<string | null>(null);
  answers = $state<AnswerBoard>(blankAnswers());
  selectedCell = $state<CellIndex | null>(null);
  message = $state<string | null>(null);
  /** 最近一次提交判定（用于面板展示） */
  verdict = $state<SubmitVerdict | null>(null);
  busy = $state(false);

  #store: AnswerStore;

  constructor(store: AnswerStore = idbAnswerStore) {
    this.#store = store;
  }

  /** 结构合法的题面才允许进入作答预览 */
  canEnter(): { ok: true } | { ok: false; reason: string } {
    const p = editor.puzzle;
    if (!p) return { ok: false, reason: '还没有题面。' };
    const issues = validateStructure(p);
    if (issues.length) {
      return {
        ok: false,
        reason: `题面结构不合法，无法作答：${issues[0].message}`
      };
    }
    return { ok: true };
  }

  async enter(): Promise<void> {
    const gate = this.canEnter();
    if (!gate.ok) {
      this.message = gate.reason;
      return;
    }
    const snapshot = clonePuzzle(editor.puzzle as Puzzle);
    const fp = puzzleFingerprint(snapshot);
    this.busy = true;
    let saved: AnswerBoard | null = null;
    try {
      saved = await this.#store.load(fp);
    } catch {
      saved = null; // 存储不可用时降级为空白作答盘
    } finally {
      this.busy = false;
    }
    this.puzzle = snapshot;
    this.fingerprint = fp;
    this.answers = saved ?? blankAnswers();
    // 提示格恒不可作答：脏数据里落在提示格的数字一律丢弃
    for (let i = 0; i < this.answers.length; i++) {
      if (!canEnterAt(snapshot, i)) this.answers[i] = 0;
    }
    this.selectedCell = null;
    this.verdict = null;
    this.message = saved ? '已恢复本题上次的作答进度。' : '作答盘已生成：提示不可修改，其余格可填数。';
    this.#generation++; // 作废旧的去抖保存
    this.active = true;
    // 作答期间绝不显示作者答案层，离开时也不改变其原有开关
    editor.showSolution = false;
  }

  /** 离开模式：保存进度，不回写任何题面/提示/答案层 */
  async exit(): Promise<void> {
    if (!this.active || !this.fingerprint) {
      this.reset();
      return;
    }
    this.busy = true;
    try {
      await this.#store.save(this.fingerprint, this.answers);
    } catch {
      // 进度保存失败不阻断退出（内存中的作答随关闭丢弃，与"不回写"原则一致）
    } finally {
      this.busy = false;
    }
    this.reset();
  }

  private reset() {
    this.#generation++; // 任何排队中的去抖自动保存立即作废
    this.active = false;
    this.puzzle = null;
    this.fingerprint = null;
    this.answers = blankAnswers();
    this.selectedCell = null;
    this.verdict = null;
    this.message = null;
  }

  /**
   * 外部切换了题面（载入样例 / 打开草稿 / 导入）时无条件离开模式：
   * 不保存、不回写——快照本就基于旧题面，其进度仍按旧指纹留在独立存储中。
   */
  abort() {
    this.reset();
  }

  selectCell(cell: CellIndex) {
    if (!this.active || !this.puzzle) return;
    this.selectedCell = canEnterAt(this.puzzle, cell) ? cell : null;
  }

  /** 填数：d=0 清空当前格。提示格与非选中格一律忽略 */
  enterDigit(d: number) {
    if (!this.active || !this.puzzle || this.selectedCell === null) return;
    if (!Number.isInteger(d) || d < 0 || d > 9) return;
    const cell = this.selectedCell;
    if (!canEnterAt(this.puzzle, cell)) return;
    if (this.answers[cell] === d) {
      this.answers[cell] = 0; // 再按同数字清空，与编辑器手感一致
    } else {
      this.answers[cell] = d;
    }
    this.verdict = null;
    void this.persist();
  }

  clearSelected() {
    if (this.selectedCell !== null) this.enterDigit(0);
  }

  /** 清空全部作答（保留提示格），并删除该题保存的进度 */
  async clearAll() {
    this.answers = blankAnswers();
    this.verdict = null;
    this.message = '作答盘已清空。';
    if (this.fingerprint) {
      try {
        await this.#store.clear(this.fingerprint);
      } catch {
        // 忽略存储错误
      }
    }
  }

  #persistQueued = false;
  /** 每次进入模式换一代；旧的去抖保存跨代后丢弃，避免 abort/重入后的陈旧写入 */
  #generation = 0;
  /** 自动保存（去抖、失败静默） */
  private persist(): Promise<void> {
    if (!this.fingerprint) return Promise.resolve();
    if (this.#persistQueued) return Promise.resolve();
    this.#persistQueued = true;
    const gen = this.#generation;
    const fp = this.fingerprint;
    const snapshot = [...this.answers];
    return new Promise((resolve) => {
      setTimeout(() => {
        this.#persistQueued = false;
        if (gen !== this.#generation) return resolve(); // 已离开或重入：丢弃陈旧写入
        this.#store
          .save(fp, snapshot)
          .catch(() => undefined)
          .then(() => resolve());
      }, 250);
    });
  }

  /** 当前即时冲突（行/列/宫/温度计），驱动画布标红与面板列表 */
  get conflicts(): AnswerConflict[] {
    if (!this.active || !this.puzzle) return [];
    return findAnswerConflicts(this.puzzle, this.answers);
  }

  get emptyCount(): number {
    if (!this.active || !this.puzzle) return 0;
    return countEmpty(this.puzzle, this.answers);
  }

  /** 冲突格集合（供画布高亮） */
  get conflictCells(): Set<CellIndex> {
    const set = new Set<CellIndex>();
    for (const c of this.conflicts) c.cells.forEach((i) => set.add(i));
    return set;
  }

  /**
   * 提交判定。完整正确只在 editor.analysis 为"当前题面指纹 + unique"时给出；
   * 否则返回 need-check，要求先完成检查。
   */
  submit(): SubmitVerdict {
    if (!this.active || !this.puzzle) {
      return { kind: 'need-check', message: '当前不在作答模式。' };
    }
    const verdict = judgeSubmission(
      this.puzzle,
      this.answers,
      editor.analysis,
      this.fingerprint ?? undefined
    );
    this.verdict = verdict;
    // need-check / 错误结论把原因提到消息位；correct 的祝贺也展示；
    // incomplete / conflicts 等盘面状态由面板的统计与冲突列表呈现
    if (verdict.kind !== 'incomplete' && verdict.kind !== 'conflicts') {
      this.message = verdict.message;
    }
    return verdict;
  }
}

export const preview = new PreviewState();

// IndexedDB 题稿存储（纯前端，无后台）。
// 存的是作者工作区：题面 + 最近一次检查结论（含首解，属于作者私有数据）。
// 导出题面走 exportPuzzle()，只含题面，绝不带这里的检查结论/答案。
import {
  clonePuzzle,
  type Puzzle,
  validateStructure
} from './puzzle';
import type { AnswerBoard } from './answer';
import type { SolveResult } from './solver';

const DB_NAME = 'thermo-jigsaw-studio';
const DB_VERSION = 2;
const STORE = 'drafts';
/**
 * 作答进度独立存储：主键是"题面指纹"而不是草稿 id。
 *  - 与作者草稿（drafts）物理隔离：填数永远不会写回题稿/答案层；
 *  - 题面一改指纹即变，旧作答天然取不到，不可能被当成新题的结果。
 */
const ANSWER_STORE = 'answers';

export interface AnswerRecord {
  /** 主键：作答所基于的题面指纹（puzzleFingerprint） */
  fingerprint: string;
  updatedAt: number;
  /** 学生填数（长度 81；提示格恒为 0） */
  answers: AnswerBoard;
}

export interface DraftRecord {
  id: string;
  name: string;
  updatedAt: number;
  puzzle: Puzzle;
  /** 最近一次检查结果（可能含首解），仅保存在本地作者库中 */
  lastCheck: SolveResult | null;
  /** 上次检查时题面的指纹；题面一变即判定结论过期 */
  checkFingerprint: string | null;
}

export interface DraftSummary {
  id: string;
  name: string;
  updatedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(ANSWER_STORE)) {
        db.createObjectStore(ANSWER_STORE, { keyPath: 'fingerprint' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
  mode: IDBTransactionMode,
  storeName: string,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(storeName, mode);
        const store = t.objectStore(storeName);
        const req = fn(store);
        t.oncomplete = () => resolve(req.result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

export async function saveDraft(rec: DraftRecord): Promise<void> {
  // 保存前做一次结构完整性校验，避免把坏数据写进库
  validateStructure(rec.puzzle);
  await tx('readwrite', STORE, (store) =>
    store.put(structuredClone(rec)) as IDBRequest
  );
}

export async function loadDraft(id: string): Promise<DraftRecord | null> {
  const rec = await tx<DraftRecord | undefined>('readonly', STORE, (store) =>
    store.get(id) as IDBRequest<DraftRecord | undefined>
  );
  return rec ?? null;
}

export async function listDrafts(): Promise<DraftSummary[]> {
  const all = await tx<DraftRecord[]>('readonly', STORE, (store) =>
    store.getAll() as IDBRequest<DraftRecord[]>
  );
  return (all ?? [])
    .map(({ id, name, updatedAt }) => ({ id, name, updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteDraft(id: string): Promise<void> {
  await tx('readwrite', STORE, (store) => store.delete(id) as IDBRequest);
}

export function newDraftId(): string {
  return (
    Date.now().toString(36) +
    '-' +
    (globalThis.crypto?.getRandomValues(new Uint32Array(1))[0]?.toString(36) ??
      Math.random().toString(36).slice(2))
  );
}

export function draftFromPuzzle(name: string, puzzle: Puzzle): DraftRecord {
  return {
    id: newDraftId(),
    name,
    updatedAt: Date.now(),
    puzzle: clonePuzzle(puzzle),
    lastCheck: null,
    checkFingerprint: null
  };
}

// ---------------------------------------------------------------------------
// 作答进度（独立于题稿；按题面指纹存取，绝不回写题面/答案层）
// ---------------------------------------------------------------------------

export async function loadAnswers(fingerprint: string): Promise<AnswerBoard | null> {
  const rec = await tx<AnswerRecord | undefined>('readonly', ANSWER_STORE, (store) =>
    store.get(fingerprint) as IDBRequest<AnswerRecord | undefined>
  );
  if (!rec || !Array.isArray(rec.answers) || rec.answers.length !== 81) return null;
  // 只接受 0..9 的整数，避免脏数据污染作答盘
  if (rec.answers.some((v) => !Number.isInteger(v) || v < 0 || v > 9)) return null;
  return [...rec.answers];
}

export async function saveAnswers(fingerprint: string, answers: AnswerBoard): Promise<void> {
  const rec: AnswerRecord = {
    fingerprint,
    updatedAt: Date.now(),
    answers: [...answers]
  };
  await tx('readwrite', ANSWER_STORE, (store) =>
    store.put(structuredClone(rec)) as IDBRequest
  );
}

export async function clearAnswers(fingerprint: string): Promise<void> {
  await tx('readwrite', ANSWER_STORE, (store) =>
    store.delete(fingerprint) as IDBRequest
  );
}

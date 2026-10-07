// IndexedDB 本地存储（纯前端，无后台）。两个完全分离的对象库：
//   drafts —— 作者工作区：题面 + 最近一次检查结论（含首解，属于作者私有数据）。
//   plays  —— 作答预览进度：以学生视角试做的作答盘，按题面指纹归档。
// 导出题面走 exportPuzzle()，只含题面，绝不带这里的检查结论/答案/作答。
import {
  clonePuzzle,
  puzzleFingerprint,
  type Puzzle,
  validateStructure
} from './puzzle';
import type { SolveResult } from './solver';

const DB_NAME = 'thermo-jigsaw-studio';
const DB_VERSION = 2; // v2：新增 plays 库（作答预览进度，与作者草稿分离）
const STORE_DRAFTS = 'drafts';
const STORE_PLAYS = 'plays';

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
      if (!db.objectStoreNames.contains(STORE_DRAFTS)) {
        db.createObjectStore(STORE_DRAFTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_PLAYS)) {
        db.createObjectStore(STORE_PLAYS, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | IDBRequest<T>[]
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(storeName, mode);
        const store = t.objectStore(storeName);
        const reqs = fn(store);
        t.oncomplete = () => {
          const r = Array.isArray(reqs) ? reqs[0] : reqs;
          resolve(r.result);
        };
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

export async function saveDraft(rec: DraftRecord): Promise<void> {
  // 保存前做一次结构完整性校验，避免把坏数据写进库
  validateStructure(rec.puzzle);
  await tx(STORE_DRAFTS, 'readwrite', (store) => store.put(structuredClone(rec)) as IDBRequest);
}

export async function loadDraft(id: string): Promise<DraftRecord | null> {
  const rec = await tx<DraftRecord | undefined>(STORE_DRAFTS, 'readonly', (store) =>
    store.get(id) as IDBRequest<DraftRecord | undefined>
  );
  return rec ? (rec as DraftRecord) : null;
}

export async function listDrafts(): Promise<DraftSummary[]> {
  const all = await tx<DraftRecord[]>(STORE_DRAFTS, 'readonly', (store) =>
    store.getAll() as IDBRequest<DraftRecord[]>
  );
  return (all ?? [])
    .map(({ id, name, updatedAt }) => ({ id, name, updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteDraft(id: string): Promise<void> {
  await tx(STORE_DRAFTS, 'readwrite', (store) => store.delete(id) as IDBRequest);
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
// 作答预览进度（学生视角试做）。与作者草稿完全分离：
// 以题面指纹为主键 —— 题面一旦改动，旧作答记录的主键与新题面指纹不同，
// 自然不会被当作新题的进度；旧记录留在库里也无害。
// ---------------------------------------------------------------------------

export interface PlayRecord {
  /** 主键：题面指纹（puzzleFingerprint） */
  id: string;
  puzzleFingerprint: string;
  /** 学生作答：0 未填，1..9 填入数字；不含题面提示，更不是作者答案层 */
  entries: number[];
  updatedAt: number;
}

/** 由当前题面 + 作答构造存储记录（主键 = 题面指纹） */
export function playRecordFor(puzzle: Puzzle, entries: number[]): PlayRecord {
  const fp = puzzleFingerprint(puzzle);
  return {
    id: fp,
    puzzleFingerprint: fp,
    entries: [...entries],
    updatedAt: Date.now()
  };
}

export async function savePlay(rec: PlayRecord): Promise<void> {
  await tx(STORE_PLAYS, 'readwrite', (store) => store.put(structuredClone(rec)) as IDBRequest);
}

export async function loadPlay(fingerprint: string): Promise<PlayRecord | null> {
  const rec = await tx<PlayRecord | undefined>(STORE_PLAYS, 'readonly', (store) =>
    store.get(fingerprint) as IDBRequest<PlayRecord | undefined>
  );
  return rec ? (rec as PlayRecord) : null;
}

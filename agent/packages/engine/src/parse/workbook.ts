import { Worker } from 'node:worker_threads';
import { makeIssue } from '../issues.js';
import { FileProcessingError, type FileLimits, type RawSheet } from './types.js';

interface WorkerResult {
  sheets: RawSheet[];
  date1904: boolean;
  nulCount: number;
}

const WORKER_URL = new URL('./xlsx-worker.cjs', import.meta.url);

/** Extracts the original cell matrix of an XLSX/XLS file inside a resource-limited worker thread. */
export function extractWorkbook(buffer: Uint8Array, limits: FileLimits): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const copy = new Uint8Array(buffer); // detach from the caller's buffer
    const worker = new Worker(WORKER_URL, {
      workerData: { buffer: copy, maxRows: limits.maxRows, maxCols: limits.maxColumns, maxSheets: limits.maxSheets },
      resourceLimits: { maxOldGenerationSizeMb: limits.parseMemoryMb },
    });
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      fn();
    };
    const timer = setTimeout(
      () => done(() => reject(new FileProcessingError(makeIssue('FILE_UNREADABLE', { detail: 'انتهت مهلة قراءة الملف.' })))),
      limits.parseTimeoutMs,
    );
    worker.once('message', (msg: { ok: boolean; result?: WorkerResult; code?: string; message?: string }) => {
      done(() => {
        if (msg.ok && msg.result) return resolve(msg.result);
        const code = (msg.code ?? 'FILE_UNREADABLE') as Parameters<typeof makeIssue>[0];
        const known = [
          'FILE_TOO_MANY_ROWS', 'FILE_TOO_MANY_COLUMNS', 'FILE_TOO_MANY_SHEETS',
        ].includes(code) ? code : 'FILE_UNREADABLE';
        reject(new FileProcessingError(makeIssue(known, { detail: msg.message })));
      });
    });
    worker.once('error', (err) =>
      done(() => reject(new FileProcessingError(makeIssue('FILE_UNREADABLE', { detail: err.message })))),
    );
    worker.once('exit', (code) => {
      if (code !== 0) done(() => reject(new FileProcessingError(makeIssue('FILE_UNREADABLE', { detail: `توقف معالج القراءة (${code}).` }))));
    });
  });
}

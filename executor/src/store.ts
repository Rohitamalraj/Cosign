import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Receipt } from './receipt';
import type { ReleaseRecord } from './types';

export interface Store {
  getRecord(invoiceHash: string): Promise<ReleaseRecord | null>;
  putRecord(rec: ReleaseRecord): Promise<void>;
  getReceipt(invoiceHash: string): Promise<Receipt | null>;
  putReceipt(invoiceHash: string, receipt: Receipt): Promise<void>;
}

export class MemoryStore implements Store {
  private records = new Map<string, ReleaseRecord>();
  private receipts = new Map<string, Receipt>();
  async getRecord(h: string) { return this.records.get(h.toLowerCase()) ?? null; }
  async putRecord(r: ReleaseRecord) { this.records.set(r.invoiceHash.toLowerCase(), structuredClone(r)); }
  async getReceipt(h: string) { return this.receipts.get(h.toLowerCase()) ?? null; }
  async putReceipt(h: string, r: Receipt) { this.receipts.set(h.toLowerCase(), structuredClone(r)); }
}

const HASH_RE = /^0x[0-9a-f]{64}$/;

/** One JSON file per invoice. Writes are atomic (temp file then rename) so a crash never leaves half a record. */
export class FileStore implements Store {
  constructor(private readonly dir: string) {
    mkdirSync(join(dir, 'records'), { recursive: true });
    mkdirSync(join(dir, 'receipts'), { recursive: true });
  }

  private path(kind: 'records' | 'receipts', hash: string): string {
    const h = hash.toLowerCase();
    if (!HASH_RE.test(h)) throw new Error('invalid invoice hash'); // also blocks path traversal
    return join(this.dir, kind, `${h}.json`);
  }

  private read<T>(p: string): T | null {
    return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : null;
  }

  private write(p: string, value: unknown): void {
    const tmp = `${p}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(value, null, 2));
    renameSync(tmp, p);
  }

  async getRecord(h: string) { return this.read<ReleaseRecord>(this.path('records', h)); }
  async putRecord(r: ReleaseRecord) { this.write(this.path('records', r.invoiceHash), r); }
  async getReceipt(h: string) { return this.read<Receipt>(this.path('receipts', h)); }
  async putReceipt(h: string, r: Receipt) { this.write(this.path('receipts', h), r); }
}

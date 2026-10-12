import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { ZodError } from 'zod';
import type { Executor } from './executor';
import { toJson } from './types';

const MAX_BODY = 256 * 1024;
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

export interface ServerOptions {
  executor: Executor;
  /** Shared secret callers must send as `Authorization: Bearer <token>`. At least 16 characters. */
  apiToken: string;
}

function send(res: ServerResponse, code: number, body: unknown): void {
  const text = JSON.stringify(toJson(body));
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

function authorized(req: IncomingMessage, token: string): boolean {
  const header = req.headers.authorization ?? '';
  const given = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '');
  const want = Buffer.from(token);
  return given.length === want.length && timingSafeEqual(given, want);
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { req.pause(); reject(Object.assign(new Error('body too large'), { code: 413 })); return; }
      if (size <= MAX_BODY) chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('body must be JSON'), { code: 400 })); }
    });
    req.on('error', reject);
  });
}

/**
 * Minimal HTTP API:
 *   POST /release           body = release package          -> outcome
 *   GET  /releases/:hash    -> { record, receipt }
 *   GET  /receipts/:hash    -> receipt
 *   POST /reconcile/:hash   -> outcome of an in-flight payment
 *   GET  /healthz           -> { ok: true }   (no auth)
 */
export function createExecutorServer(opts: ServerOptions): Server {
  if (opts.apiToken.length < 16) throw new Error('apiToken must be at least 16 characters');

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/healthz') return send(res, 200, { ok: true });
      if (!authorized(req, opts.apiToken)) return send(res, 401, { error: 'unauthorized' });

      if (req.method === 'POST' && url.pathname === '/release') {
        if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return send(res, 415, { error: 'content-type must be application/json' });
        return send(res, 200, await opts.executor.release(await readBody(req)));
      }

      const m = url.pathname.match(/^\/(releases|receipts|reconcile)\/(0x[0-9a-fA-F]{64})$/);
      if (m && HASH_RE.test(m[2])) {
        if (m[1] === 'reconcile' && req.method === 'POST') {
          const out = await opts.executor.reconcile(m[2]);
          return out ? send(res, 200, out) : send(res, 404, { error: 'nothing in flight for that invoice' });
        }
        if (req.method === 'GET') {
          const s = await opts.executor.status(m[2]);
          if (m[1] === 'releases') return s.record ? send(res, 200, { record: { ...s.record, package: undefined }, receipt: s.receipt }) : send(res, 404, { error: 'unknown invoice' });
          return s.receipt ? send(res, 200, s.receipt) : send(res, 404, { error: 'no receipt' });
        }
      }
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      if (e instanceof ZodError) return send(res, 400, { error: 'invalid package', issues: e.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
      const code = (e as { code?: number }).code;
      if (code === 413) {
        // Answer first, then drop the connection so the rest of an oversized body is never read.
        res.setHeader('connection', 'close');
        res.once('finish', () => req.destroy());
        return send(res, 413, { error: (e as Error).message });
      }
      if (code === 400) return send(res, 400, { error: (e as Error).message });
      console.error('executor error:', e instanceof Error ? e.message : e); // never print keys or full requests
      return send(res, 500, { error: 'internal error' });
    }
  });
}

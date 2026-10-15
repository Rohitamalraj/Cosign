/**
 * The app's database. One Postgres dialect everywhere:
 *   - DATABASE_URL set  -> a real Postgres server (Render, Neon, Supabase, local), through `pg`.
 *   - otherwise         -> PGlite, a real Postgres engine that runs in-process and keeps its files on disk
 *                          (COSIGN_DB_DIR, default ./.data/pg). Same SQL, so development and tests exercise what production runs.
 * No framework imports here, so plain `node --test` can use it.
 */

export interface Db {
  readonly kind: 'pg' | 'pglite';
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  /** Run `fn` inside one transaction (all or nothing). */
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface OpenOptions {
  url?: string;
  /** PGlite data directory. Omit for an in-memory database (tests). */
  dir?: string;
}

export async function openDb(opts: OpenOptions = {}): Promise<Db> {
  const url = opts.url ?? process.env.DATABASE_URL;
  const db = url ? await openPg(url) : await openPglite(opts.dir);
  await migrate(db);
  return db;
}

async function openPg(url: string): Promise<Db> {
  const { Pool: PgPool } = await import('pg');
  type Pool = InstanceType<typeof PgPool>;
  const ssl = process.env.DATABASE_SSL === '0' ? false : /sslmode=require|\.render\.com|\.neon\.tech|supabase\.co/.test(url) ? { rejectUnauthorized: false } : undefined;
  const pool = new PgPool({ connectionString: url, ssl, max: 5 });
  const wrap = (q: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }, root: Pool | null): Db => ({
    kind: 'pg',
    query: async <T>(sql: string, params: unknown[] = []) => (await q.query(sql, params)).rows as T[],
    exec: async (sql) => { await q.query(sql); },
    tx: async <T>(fn: (db: Db) => Promise<T>) => {
      if (!root) return fn(wrap(q, null)); // already inside a transaction
      const client = await root.connect();
      try {
        await client.query('begin');
        const out = await fn(wrap(client, null));
        await client.query('commit');
        return out;
      } catch (e) {
        await client.query('rollback').catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    },
    close: async () => { if (root) await root.end(); },
  });
  return wrap(pool, pool);
}

async function openPglite(dir?: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = dir ? new PGlite(dir) : new PGlite();
  const wrap = (q: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>; exec: (sql: string) => Promise<unknown> }, inTx: boolean): Db => ({
    kind: 'pglite',
    query: async <T>(sql: string, params: unknown[] = []) => (await q.query(sql, params)).rows as T[],
    exec: async (sql) => { await q.exec(sql); },
    tx: async <T>(fn: (db: Db) => Promise<T>) => {
      if (inTx) return fn(wrap(q, true));
      return pg.transaction(async (t) => fn(wrap(t as never, true)));
    },
    close: async () => { await pg.close(); },
  });
  return wrap(pg as never, false);
}

// ---- Schema ----

const MIGRATIONS: { id: number; sql: string }[] = [
  {
    id: 1,
    sql: `
    create table vendors (
      id text primary key,
      name text not null,
      aliases jsonb not null default '[]',
      email_domain text not null,
      wallet text not null,
      wallet_since timestamptz not null default now(),
      category text not null,
      chains jsonb not null default '["arc"]',
      paid_count integer not null default 0,
      onchain jsonb not null default '{}',
      created_by text,
      created_at timestamptz not null default now()
    );
    create table agreements (
      ref text primary key,
      vendor_id text not null references vendors(id) on delete cascade,
      description text not null default '',
      lines jsonb not null default '[]',
      expected_total_micro numeric(38,0),
      remaining_micro numeric(38,0)
    );
    create table payments (
      id bigserial primary key,
      number text not null,
      vendor_id text not null,
      total_micro numeric(38,0) not null,
      issued text not null,
      payee text not null,
      line_signature text not null,
      hash text,
      status text not null check (status in ('paid','held','open')),
      created_at timestamptz not null default now()
    );
    create index payments_vendor on payments(vendor_id);
    create unique index payments_hash on payments(hash) where hash is not null;
    create table invoices (
      uid text primary key,
      hash text,
      status text not null,
      decision text,
      vendor text,
      amount_micro numeric(38,0),
      payee text,
      destination_domain integer not null default 26,
      created_by text,
      view jsonb not null,
      package jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create index invoices_created on invoices(created_at desc);
    create index invoices_hash on invoices(hash);
    create table users (
      address text primary key,
      role text not null check (role in ('admin','operator')),
      created_at timestamptz not null default now()
    );
    create table sessions (
      token_hash text primary key,
      address text not null,
      expires_at timestamptz not null
    );
    create table auth_nonces (
      nonce text primary key,
      expires_at timestamptz not null
    );
    create table outcomes (
      id bigserial primary key,
      invoice_uid text not null,
      invoice_hash text,
      kind text not null,
      note text not null default '',
      reporter text not null,
      effects jsonb not null default '[]',
      created_at timestamptz not null default now()
    );
    create index outcomes_invoice on outcomes(invoice_uid);
    create table release_records (invoice_hash text primary key, data jsonb not null, updated_at timestamptz not null default now());
    create table receipts (invoice_hash text primary key, data jsonb not null);
    create table settlements (invoice_hash text primary key, data jsonb not null);
    create table settings (key text primary key, value jsonb not null);
    `,
  },
  {
    id: 2,
    sql: `
    alter table invoices add column source_text text;
    alter table invoices add column history jsonb;
    `,
  },
];

export async function migrate(db: Db): Promise<void> {
  await db.exec('create table if not exists schema_migrations (id integer primary key, applied_at timestamptz not null default now())');
  const done = new Set((await db.query<{ id: number }>('select id from schema_migrations')).map((r) => Number(r.id)));
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    await db.tx(async (t) => {
      await t.exec(m.sql);
      await t.query('insert into schema_migrations(id) values ($1)', [m.id]);
    });
  }
}

import { join } from 'node:path';
import { Executor, FileStore, connectPolicy, createExecutorServer } from '../src';

/**
 * Required env: RPC_URL, POLICY_ADDRESS, EXECUTOR_PRIVATE_KEY, EXECUTOR_API_TOKEN (16+ chars).
 * Optional: PORT (8787), HOST (127.0.0.1), STORE_DIR (./store).
 * The Executor key must be a dedicated wallet: it can only call release(), and only the contract decides what it may pay.
 */
function need(name: string): string {
  const v = process.env[name];
  if (!v) { console.error(`${name} is required`); process.exit(1); }
  return v;
}

const policy = connectPolicy({ rpcUrl: need('RPC_URL'), policyAddress: need('POLICY_ADDRESS'), privateKey: need('EXECUTOR_PRIVATE_KEY') });
const executor = new Executor({ policy, store: new FileStore(process.env.STORE_DIR ?? join(process.cwd(), 'store')) });
const server = createExecutorServer({ executor, apiToken: need('EXECUTOR_API_TOKEN') });

// Loopback by default. Put a real gateway and TLS in front before exposing this anywhere else.
const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 8787);
server.listen(port, host, () => console.log(`executor listening on http://${host}:${port}`));

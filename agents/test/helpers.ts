import { ledgerFromJson, type Ledger } from '../src/ledger';
import type { LLM } from '../src/llm';
import type { PipelineConfig } from '../src/pipeline';
import { loadAgentKeys } from '../src/keys';
import { DEMO_CASES, loadDemoLedger, readDemoInvoice } from '../src';

export const keys = loadAgentKeys({});
export const agentIds = { READER: 1, VERIFIER: 2, MATCHER: 3, SENTINEL: 4, TREASURER: 5 };

export const baseCfg = (over: Partial<PipelineConfig> = {}): PipelineConfig => ({
  chainId: 31337,
  policyAddress: '0x0000000000000000000000000000000000000001',
  agentIds,
  now: () => new Date('2026-10-15T12:00:00Z'),
  ...over,
});

export const freshLedger = (): Ledger => loadDemoLedger();
export const invoiceText = (id: 'A' | 'B' | 'C' | 'D' | 'E') => readDemoInvoice(DEMO_CASES.find((c) => c.id === id)!.file);
export { ledgerFromJson };

/** Replays canned replies, or throws. Lets tests drive the model path with no network. */
export class ScriptedLLM implements LLM {
  calls: { system: string; user: string }[] = [];
  constructor(readonly id: string, private readonly reply: string | ((user: string) => string) | Error) {}
  async complete(args: { system: string; user: string }): Promise<string> {
    this.calls.push(args);
    if (this.reply instanceof Error) throw this.reply;
    return typeof this.reply === 'function' ? this.reply(args.user) : this.reply;
  }
}

export const json = (o: unknown) => JSON.stringify(o);

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ARC_DOMAIN, chainDomain } from './chains';
import { runMatcher, runReader, runSentinel, runTreasurer, runVerifier, type AgentContext } from './agents';
import { signAttestation, domainFor, type Attestation, type TypedDataSigner } from './eip712';
import { canonicalJson, invoiceHash, keccak } from './hash';
import { findVendorByDomain, findVendorByName, type Ledger } from './ledger';
import { assertDistinctModels, type LlmConfig } from './llm';
import { deepFreeze } from './parse';
import { ROLE_INDEX, ROLE_ORDER, VERDICT_CODE, type AgentResult, type ParsedInvoice, type RoleName } from './types';

export interface PipelineConfig {
  chainId: bigint | number;
  policyAddress: string;
  agentIds: Record<RoleName, number>;
  llm?: Partial<LlmConfig>;
  now?: () => Date;
  ttlSeconds?: number;
  /** If set, each evidence bundle is written to <dir>/<evidenceHash>.json. */
  evidenceDir?: string;
}

export type Decision = 'READY' | 'NEEDS_HUMAN' | 'HOLD';

export interface ReleasePackage {
  req: { invoiceHash: string; payee: string; amount: bigint; category: string; destinationDomain: number };
  atts: Attestation[]; // ROLE_ORDER
  sigs: string[];
  humanSig: string;
}

export interface ProcessResult {
  parsed: ParsedInvoice;
  invoiceHash: string | null;
  results: Partial<Record<RoleName, AgentResult>>;
  decision: Decision;
  reasons: string[];
  /** null when the invoice could not even be parsed into a payee and amount. */
  package: ReleasePackage | null;
  evidence: Partial<Record<RoleName, { hash: string; bundle: unknown }>>;
}

let nonceCounter = 0n;
const nextNonce = () => BigInt(Date.now()) * 1_000_000n + nonceCounter++;

/**
 * Run all five agents on one invoice and sign their verdicts.
 *
 * Independence: only the Reader sees raw text first. Verifier, Matcher, Sentinel and Treasurer then run in
 * parallel, each handed a frozen copy of the parsed invoice and a read-only ledger. None receives another
 * agent's result, so none can anchor on it.
 */
export async function processInvoice(
  sourceText: string,
  ledger: Ledger,
  cfg: PipelineConfig,
  keys: Record<RoleName, TypedDataSigner>,
): Promise<ProcessResult> {
  const llm = { reader: cfg.llm?.reader ?? null, matcher: cfg.llm?.matcher ?? null, sentinel: cfg.llm?.sentinel ?? null };
  assertDistinctModels(llm);

  const now = (cfg.now ?? (() => new Date()))();
  const ctx: AgentContext = { now, ledger: deepFreeze(structuredClone(ledger)) };

  const { parsed, result: reader } = await runReader(sourceText, llm.reader);
  const results: ProcessResult['results'] = { READER: reader };
  const frozen = deepFreeze(structuredClone(parsed));

  const [verifier, matcher, sentinel, treasurer] = await Promise.all([
    Promise.resolve(runVerifier(frozen, ctx)),
    runMatcher(frozen, ctx, llm.matcher),
    runSentinel(frozen, sourceText, ctx, llm.sentinel),
    Promise.resolve(runTreasurer(frozen, ctx)),
  ]);
  Object.assign(results, { VERIFIER: verifier, MATCHER: matcher, SENTINEL: sentinel, TREASURER: treasurer });

  const reasons = ROLE_ORDER.filter((r) => results[r]!.verdict !== 'PASS').map((r) => `${r} ${results[r]!.verdict}: ${results[r]!.note}`);

  // An attestation must bind a payee and amount. Without them nothing can be signed, so nothing can be released.
  if (!parsed.payee || parsed.totalMicro === null) {
    return { parsed, invoiceHash: null, results, decision: 'HOLD', reasons, package: null, evidence: {} };
  }

  // The destination chain is signed too. A chain we cannot name cannot be signed, so nothing can be released.
  const destinationDomain = parsed.chain ? chainDomain(parsed.chain) : ARC_DOMAIN;
  if (destinationDomain === null) {
    return { parsed, invoiceHash: null, results, decision: 'HOLD', reasons: [...reasons, `Unsupported settlement chain "${parsed.chain}".`], package: null, evidence: {} };
  }

  const hash = invoiceHash(parsed);
  const expiry = Math.floor(now.getTime() / 1000) + (cfg.ttlSeconds ?? 3_600);
  const domain = domainFor(cfg.chainId, cfg.policyAddress);
  const vendor = findVendorByName(ledger, parsed.vendorName) ?? findVendorByDomain(ledger, parsed.senderEmail);

  const atts: Attestation[] = [];
  const sigs: string[] = [];
  const evidence: ProcessResult['evidence'] = {};

  for (const role of ROLE_ORDER) {
    const r = results[role]!;
    const bundle = {
      role, invoiceHash: hash, createdAt: now.toISOString(), verdict: r.verdict, confidence: r.confidence,
      note: r.note, checks: r.checks, extra: r.extra ?? null, llm: r.llm ?? null,
      parsed: { ...parsed, lineItems: parsed.lineItems }, // document facts only; the source file is referenced by hash
    };
    const evidenceHash = keccak(canonicalJson(bundle));
    if (cfg.evidenceDir) {
      mkdirSync(cfg.evidenceDir, { recursive: true });
      writeFileSync(join(cfg.evidenceDir, `${evidenceHash}.json`), canonicalJson(bundle));
    }
    evidence[role] = { hash: evidenceHash, bundle };

    const att: Attestation = {
      invoiceHash: hash, payee: parsed.payee, amount: parsed.totalMicro, role: ROLE_INDEX[role],
      verdict: VERDICT_CODE[r.verdict], confidenceBps: Math.round(r.confidence * 10_000), evidenceHash,
      agentId: cfg.agentIds[role], expiry, nonce: nextNonce(), destinationDomain,
    };
    atts.push(att);
    sigs.push(await signAttestation(keys[role], domain, att));
  }

  const category = keccak((vendor?.category ?? 'uncategorized').toLowerCase());
  const pkg: ReleasePackage = {
    req: { invoiceHash: hash, payee: parsed.payee, amount: parsed.totalMicro, category, destinationDomain },
    atts, sigs, humanSig: '0x',
  };

  let decision: Decision = 'READY';
  if (reasons.length) decision = 'HOLD';
  else if (parsed.totalMicro > ledger.perTxLimitMicro) {
    decision = 'NEEDS_HUMAN';
    reasons.push(`Amount exceeds the per-transaction limit; a human signature is required.`);
  }
  return { parsed, invoiceHash: hash, results, decision, reasons, package: pkg, evidence };
}

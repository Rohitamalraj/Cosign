/**
 * The Auditor: turns a human's verdict on what really happened into reputation changes on-chain.
 *
 * It does not guess. A person (an operator or admin) reports what was true about an invoice, and this module decides
 * which agents were right or wrong and by how much. The registry only lets the Auditor wallet change scores, and the
 * app only lets signed-in operators trigger it, once per invoice.
 *
 * Why these rules: an agent that signs PASS on something that turned out wrong is blamed most when the problem was in
 * its own job (the Sentinel for a duplicate, the Verifier for a wrong wallet, the Matcher for a wrong amount), a little
 * when it was somebody else's job, and an agent that flagged a bad invoice is rewarded. Amounts are testnet scale:
 * bonds are 1 USDC, so a slash is 0.1 USDC.
 */
import type { RoleName } from '../../../agents/src/types';

export type OutcomeKind = 'confirmed_correct' | 'duplicate' | 'wrong_wallet' | 'wrong_amount' | 'other_problem' | 'rejected_bad' | 'blocked_wrongly';
export type Verdict = 'PASS' | 'ESCALATE' | 'FAIL';

export const OUTCOME_KINDS: { kind: OutcomeKind; label: string; needs: 'paid' | 'unpaid'; help: string }[] = [
  { kind: 'confirmed_correct', label: 'The payment was correct', needs: 'paid', help: 'The vendor confirmed it, or you checked it. Agents that signed PASS gain a little reputation.' },
  { kind: 'duplicate', label: 'It was a duplicate', needs: 'paid', help: 'We paid something we had already paid. The Sentinel is blamed most.' },
  { kind: 'wrong_wallet', label: 'It went to the wrong wallet', needs: 'paid', help: 'The money should have gone elsewhere. The Verifier is blamed most.' },
  { kind: 'wrong_amount', label: 'The amount was wrong', needs: 'paid', help: 'The invoice did not match the agreement. The Matcher is blamed most.' },
  { kind: 'other_problem', label: 'Another problem', needs: 'paid', help: 'Something else was wrong. Every agent that signed PASS loses a little.' },
  { kind: 'rejected_bad', label: 'Holding it was right: the invoice was bad', needs: 'unpaid', help: 'Agents that flagged it gain reputation; agents that passed it lose a little.' },
  { kind: 'blocked_wrongly', label: 'Holding it was wrong: the invoice was fine', needs: 'unpaid', help: 'Agents that flagged it lose a little.' },
];

export interface Effect {
  role: RoleName;
  agentId: number;
  scoreDelta: number;
  slashMicro: bigint;
  reason: string;
}

const RESPONSIBLE: Partial<Record<OutcomeKind, RoleName>> = { duplicate: 'SENTINEL', wrong_wallet: 'VERIFIER', wrong_amount: 'MATCHER' };
export const SLASH_MICRO = 100_000n; // 0.1 USDC of a 1 USDC bond (testnet scale)

export class OutcomeError extends Error {
  status = 400;
}

export function effectsFor(kind: OutcomeKind, ctx: { verdicts: Record<RoleName, Verdict>; paid: boolean; agentIds: Record<RoleName, number> }): Effect[] {
  const def = OUTCOME_KINDS.find((k) => k.kind === kind);
  if (!def) throw new OutcomeError('unknown outcome');
  if (def.needs === 'paid' && !ctx.paid) throw new OutcomeError('this outcome only applies to an invoice that was paid');
  if (def.needs === 'unpaid' && ctx.paid) throw new OutcomeError('this outcome only applies to an invoice that was not paid');

  const roles = Object.keys(ctx.verdicts) as RoleName[];
  const eff = (role: RoleName, scoreDelta: number, slashMicro: bigint, reason: string): Effect => ({ role, agentId: ctx.agentIds[role], scoreDelta, slashMicro, reason });
  const passed = roles.filter((r) => ctx.verdicts[r] === 'PASS');
  const flagged = roles.filter((r) => ctx.verdicts[r] !== 'PASS');
  const out: Effect[] = [];

  switch (kind) {
    case 'confirmed_correct':
      for (const r of passed) out.push(eff(r, 1, 0n, 'signed PASS on a payment that was confirmed correct'));
      break;
    case 'duplicate':
    case 'wrong_wallet':
    case 'wrong_amount': {
      const owner = RESPONSIBLE[kind]!;
      for (const r of passed) {
        if (r === owner) out.push(eff(r, -10, SLASH_MICRO, `signed PASS although this was its own check (${kind.replace('_', ' ')})`));
        else out.push(eff(r, -2, 0n, `signed PASS on a payment later reported as ${kind.replace('_', ' ')}`));
      }
      break;
    }
    case 'other_problem':
      for (const r of passed) out.push(eff(r, -3, 0n, 'signed PASS on a payment later reported as problematic'));
      break;
    case 'rejected_bad':
      if (!flagged.length) throw new OutcomeError('no agent flagged this invoice, so there is nothing to confirm');
      for (const r of flagged) out.push(eff(r, 3, 0n, 'flagged an invoice that was confirmed bad'));
      for (const r of passed) out.push(eff(r, -2, 0n, 'signed PASS on an invoice that was confirmed bad'));
      break;
    case 'blocked_wrongly':
      if (!flagged.length) throw new OutcomeError('no agent flagged this invoice, so there is nothing to overturn');
      for (const r of flagged) out.push(eff(r, -2, 0n, 'flagged an invoice that turned out fine'));
      break;
  }
  return out;
}

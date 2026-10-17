/**
 * Automatic payment. The agents and the contract run the treasury: when all five agents sign PASS and the contract says it
 * will release (every one of the eight rules, including the per-transaction limit), the invoice is paid without anyone
 * pressing a button. A person is only needed above the limit (the approver signs) or when something is held.
 *
 * This never loosens a rule: the Executor still asks the contract first and the contract still decides. It only removes
 * the manual click for invoices that are already fully cleared. Set COSIGN_AUTO_PAY=0 to go back to pressing "Pay now".
 */
export const autoPayEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => !/^(0|false|off|no)$/i.test((env.COSIGN_AUTO_PAY ?? '1').trim());

export interface AutoPayInput {
  enabled: boolean;
  /** The submitter is a signed-in operator or admin (a guest, or an anonymous check, never triggers a payment). */
  canRelease: boolean;
  /** A chain is connected. */
  live: boolean;
  /** The contract's own answer is "releasable now": status is `ready` only when all five signed PASS and the eight rules pass. */
  status: string;
  /** The agents built a payment (they could read enough of the invoice). */
  hasPackage: boolean;
  /** Callers that must never pay on their own (inbound email) pass false. */
  allowed: boolean;
}

export function shouldAutoPay(i: AutoPayInput): boolean {
  return i.enabled && i.allowed && i.canRelease && i.live && i.hasPackage && i.status === 'ready';
}

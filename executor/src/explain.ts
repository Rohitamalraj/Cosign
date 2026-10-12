const ROLES = ['Reader', 'Verifier', 'Matcher', 'Sentinel', 'Treasurer'];

export const RULE_TITLES: Record<number, string> = {
  1: 'Every required role must attest',
  2: 'Signers must be registered, accountable agents with valid signatures',
  3: 'Attestations must match on invoice, payee and amount',
  4: 'Every verdict must be PASS',
  5: 'Payee must be allowlisted and past cooling-off',
  6: 'Amount must be within the limit (or human-signed) and the category budget',
  7: 'Invoice must not have been paid before',
  8: 'Attestations must be fresh',
};

/** Turn the contract's (rule, detail) into a sentence a human can act on. */
export function explainRule(rule: number, detail: number): string {
  const title = RULE_TITLES[rule] ?? `Unknown rule ${rule}`;
  const role = ROLES[detail] ?? `attestation ${detail}`;
  switch (rule) {
    case 1: return detail === 255 ? `${title}: the package does not hold exactly five attestations.` : `${title}: no attestation from the ${role}.`;
    case 2: return `${title}: the ${role}'s attestation was rejected (unregistered, below the reputation or bond threshold, or a bad signature).`;
    case 3: return `${title}: the ${role}'s attestation does not match the release request.`;
    case 4: return `${title}: the ${role} did not sign PASS. A human must decide.`;
    case 5: return `${title}: ${['payee is not on the allowlist', 'payee is blocked or under challenge', 'payee is still in its cooling-off period'][detail] ?? 'payee check failed'}.`;
    case 6: return `${title}: ${['above the limit and no human signature was supplied', 'the human signature is invalid or expired', 'the category budget is exhausted'][detail] ?? 'limit check failed'}.`;
    case 7: return `${title}: ${['this invoice hash is already in the paid set', 'an attestation nonce was already used'][detail] ?? 'replay detected'}.`;
    case 8: return `${title}: the ${role}'s attestation has expired.`;
    default: return title;
  }
}

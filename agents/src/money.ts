/** USDC has 6 decimals. All money is handled as integer micro-units (bigint), never floats. */

const AMOUNT_RE = /^(\d{1,3}(,\d{3})+|\d+)(\.\d{1,6})?$/;

/** Parse "1,250.00" into 1250000000n. Returns null for anything that is not a plain non-negative amount. */
export function parseMicro(input: string): bigint | null {
  const s = input.trim();
  if (!AMOUNT_RE.test(s)) return null;
  const [whole, frac = ''] = s.replace(/,/g, '').split('.');
  return BigInt(whole) * 1_000_000n + BigInt(frac.padEnd(6, '0'));
}

export function fmtMicro(micro: bigint): string {
  const whole = micro / 1_000_000n;
  // Exact, not truncated: keep at least two decimals and drop only trailing zeros, so 0.125 stays 0.125. A model shown
  // "0.12" will rightly say that 10 x 0.12 is not 1.25.
  const frac = (micro % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '').padEnd(2, '0');
  return `${whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac}`;
}

/** Absolute difference between two amounts in basis points of `base`. */
export function diffBps(actual: bigint, base: bigint): bigint {
  if (base === 0n) return actual === 0n ? 0n : 1_000_000n;
  const d = actual > base ? actual - base : base - actual;
  return (d * 10_000n) / base;
}

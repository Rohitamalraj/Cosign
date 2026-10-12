'use client';

import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';

const ease = [0.22, 1, 0.36, 1] as const;

const chips: [string, 'ok' | 'bad'][] = [['R', 'ok'], ['V', 'ok'], ['M', 'ok'], ['S', 'bad'], ['T', 'ok']];

/** Tilted invoice + payment cards for the hero's right edge. Mock data. */
export function HeroCards() {
  const reduce = useReducedMotion();
  const { scrollY } = useScroll();
  const lift = useTransform(scrollY, [0, 700], [0, reduce ? 0 : -30]);

  const float = (d: number, amp: number) =>
    reduce ? {} : { y: [0, -amp, 0], transition: { duration: d, repeat: Infinity, ease: 'easeInOut' as const } };

  return (
    <motion.div
      aria-hidden
      style={{ y: lift }}
      className="pointer-events-none relative z-10 hidden h-[520px] w-[310px] select-none justify-self-center min-[1200px]:block"
    >
      {/* Invoice card, held by the contract */}
      <motion.div
        initial={reduce ? false : { opacity: 0, x: 60, rotate: 0 }}
        animate={{ opacity: 1, x: 0, rotate: -3.5 }}
        transition={{ duration: 0.9, ease, delay: 0.5 }}
        className="absolute right-0 top-0 w-[270px]"
      >
        <motion.div animate={float(5.5, 7)} className="relative border border-ink/15 bg-white p-4 text-left shadow-[0_24px_50px_-22px_rgba(8,7,32,0.4)]">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-cement">Invoice · INV-1042</span>
            <span className="font-mono text-[10px] text-cement">Oct 13</span>
          </div>
          <p className="mt-2 text-[13px] font-semibold leading-tight">Northwind Design Co.</p>
          <p className="mt-1 font-display text-[30px] font-extrabold leading-none tracking-h3">
            1,237.50 <span className="font-mono text-[11px] font-medium tracking-normal text-cement">USDC</span>
          </p>
          <p className="mt-2 font-mono text-[10px] text-ink/55">due Oct 20 · payee 0x71C4…9aE2</p>

          <div className="mt-3 flex items-center gap-1.5 border-t border-ink/10 pt-3">
            {chips.map(([l, s]) => (
              <span
                key={l}
                className={`grid h-5 w-5 place-items-center border font-mono text-[10px] ${
                  s === 'ok' ? 'border-jade/70 bg-jade/15 text-[#2c6b57]' : 'border-[#b4443f]/70 bg-[#b4443f]/10 text-[#8e2e2a]'
                }`}
              >
                {l}
              </span>
            ))}
            <span className="ml-1 font-mono text-[10px] text-ink/55">4 of 5 signed PASS</span>
          </div>
          <p className="mt-2 text-[11px] leading-snug text-ink/60">Sentinel: near-duplicate of INV-1041, same payee and line items.</p>

          {/* Stamp */}
          <motion.div
            initial={reduce ? false : { opacity: 0, scale: 1.8, rotate: -2 }}
            animate={{ opacity: 0.92, scale: 1, rotate: -9 }}
            transition={{ duration: 0.45, ease: 'easeOut', delay: 1.5 }}
            className="absolute -bottom-3 -right-3 border-[3px] border-[#b4443f] bg-white/70 px-3 py-0.5 text-center text-[#b4443f]"
          >
            <span className="block font-display text-[26px] font-black uppercase leading-none tracking-[-0.02em]">Held</span>
            <span className="block font-mono text-[8px] uppercase tracking-[0.14em]">rule 4 · nothing moved</span>
          </motion.div>
        </motion.div>
      </motion.div>

      {/* Payment card, released after quorum */}
      <motion.div
        initial={reduce ? false : { opacity: 0, x: 60, rotate: 0 }}
        animate={{ opacity: 1, x: 0, rotate: 2.5 }}
        transition={{ duration: 0.9, ease, delay: 0.8 }}
        className="absolute left-0 top-[290px] w-[262px]"
      >
        <motion.div animate={float(6.5, 6)} className="relative border border-ink/15 bg-white p-4 text-left shadow-[0_24px_50px_-22px_rgba(8,7,32,0.4)]">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[#2c6b57]">
              <span className="h-1.5 w-1.5 rounded-full bg-jade" /> Released · Arc
            </span>
            <span className="font-mono text-[10px] text-cement">R-0004</span>
          </div>
          <p className="mt-2 font-display text-[30px] font-extrabold leading-none tracking-h3">
            1,250.00 <span className="font-mono text-[11px] font-medium tracking-normal text-cement">USDC</span>
          </p>
          <p className="mt-1 text-[12px] text-ink/65">to Northwind Design Co.</p>

          <div className="mt-3 space-y-1.5">
            <div className="flex items-center justify-between font-mono text-[10px]"><span className="text-cement">attestations</span><span>5 / 5</span></div>
            <div className="h-1 bg-lilac/40"><div className="h-full w-full bg-violet" /></div>
            <div className="flex items-center justify-between font-mono text-[10px]"><span className="text-cement">contract rules</span><span>8 / 8</span></div>
            <div className="h-1 bg-lilac/40"><div className="h-full w-full bg-jade" /></div>
          </div>
          <p className="mt-3 border-t border-ink/10 pt-2 font-mono text-[10px] text-ink/55">tx 0x9f3a…c21e · settled in 0.4s</p>

          {/* Seal */}
          <motion.div
            initial={reduce ? false : { opacity: 0, scale: 0.4, rotate: -40 }}
            animate={{ opacity: 1, scale: 1, rotate: 12 }}
            transition={{ duration: 0.6, ease: 'backOut', delay: 1.8 }}
            className="absolute -right-5 -top-6 grid h-[64px] w-[64px] place-items-center rounded-full border-2 border-dashed border-violet bg-white"
          >
            <span className="text-center font-display text-[11px] font-black uppercase leading-[1.05] tracking-[-0.01em] text-violet">
              Co<br />signed
            </span>
          </motion.div>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

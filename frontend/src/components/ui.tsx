import type { ReactNode } from 'react';
import type { Status, Verdict, RuleState } from '@/lib/data';

export function PageHeader({ eyebrow, title, sub, right }: { eyebrow: string; title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
      <div className="max-w-3xl">
        <p className="eyebrow mb-3">{eyebrow}</p>
        <h1 className="h1">{title}</h1>
        {sub && <p className="mt-4 max-w-2xl text-[16px] text-ink/70">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`card p-5 sm:p-6 ${className}`}>{children}</section>;
}

const verdictStyle: Record<Verdict, string> = {
  PASS: 'border-jade/70 bg-jade/15 text-[#2c6b57]',
  FAIL: 'border-[#b4443f]/60 bg-[#b4443f]/10 text-[#8e2e2a]',
  ESCALATE: 'border-citrine/70 bg-sand/40 text-[#7a5a14]',
};

export function VerdictPill({ v }: { v: Verdict }) {
  return <span className={`inline-block border px-2 py-0.5 font-mono text-[11px] font-medium tracking-[0.06em] ${verdictStyle[v]}`}>{v}</span>;
}

const statusStyle: Record<Status, { cls: string; label: string }> = {
  released: { cls: 'border-jade/70 bg-jade/15 text-[#2c6b57]', label: 'Released' },
  held: { cls: 'border-[#b4443f]/60 bg-[#b4443f]/10 text-[#8e2e2a]', label: 'Held' },
  escalated: { cls: 'border-citrine/70 bg-sand/40 text-[#7a5a14]', label: 'Needs human' },
  pending: { cls: 'border-lilac bg-lilac/25 text-minsk', label: 'In review' },
};

export function StatusPill({ s }: { s: Status }) {
  const { cls, label } = statusStyle[s];
  return <span className={`inline-block border px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-[0.06em] ${cls}`}>{label}</span>;
}

export function RuleDot({ s }: { s: RuleState }) {
  const map: Record<RuleState, string> = { pass: 'bg-jade', fail: 'bg-[#b4443f]', wait: 'bg-citrine' };
  return <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${map[s]}`} aria-label={s} />;
}

export function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div>
      <p className="eyebrow">{label}</p>
      <p className={`mt-2 font-display text-[34px] font-extrabold leading-none tracking-h3 ${accent ? 'text-violet' : ''}`}>{value}</p>
      {sub && <p className="mt-2 text-[13px] text-ink/60">{sub}</p>}
    </div>
  );
}

export function Sparkline({ data, className = '' }: { data: number[]; className?: string }) {
  const w = 120, h = 32;
  const min = Math.min(...data), max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((d, i) => `${(i / (data.length - 1)) * w},${h - 3 - ((d - min) / span) * (h - 6)}`);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={`h-8 w-[120px] ${className}`} role="img" aria-label="Score trend">
      <polyline points={pts.join(' ')} fill="none" stroke="#5F509D" strokeWidth="1.5" />
      <circle cx={pts[pts.length - 1].split(',')[0]} cy={pts[pts.length - 1].split(',')[1]} r="2.5" fill="#5F509D" />
    </svg>
  );
}

export const usd = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

import { NextResponse } from 'next/server';
import { can } from '@/server/auth';
import { CATEGORIES, addVendor, listVendorViews } from '@/server/engine';
import { fail, rateLimited, readJson, tooMany } from '@/server/guard';
import { assertSameOrigin, requireSession, sessionFrom } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** GET: the vendor ledger with what the contract says about each wallet. Operators and admins only. */
export async function GET(req: Request) {
  try {
    const s = requireSession(await sessionFrom(req));
    if (!can.seeAllInvoices(s)) throw Object.assign(new Error('only operators and admins can see the vendor ledger'), { status: 403 });
    return NextResponse.json({ vendors: await listVendorViews(), categories: CATEGORIES });
  } catch (e) { return fail(e); }
}

/** POST: add a vendor (admin). The wallet is allowlisted on-chain by the screener wallet and starts a cooling-off period. */
export async function POST(req: Request) {
  if (rateLimited(req, 10)) return tooMany();
  try {
    assertSameOrigin(req);
    const s = requireSession(await sessionFrom(req));
    const b = (await readJson(req)) as Record<string, unknown>;
    const str = (k: string) => (typeof b[k] === 'string' ? (b[k] as string) : '');
    const agr = b.agreement as { ref?: unknown; description?: unknown; lines?: { match?: unknown; rateUsdc?: unknown }[]; remainingUsdc?: unknown } | undefined;
    const vendor = await addVendor({
      name: str('name'), emailDomain: str('emailDomain'), wallet: str('wallet'), category: str('category'),
      chains: Array.isArray(b.chains) ? (b.chains as unknown[]).map(String) : ['arc'],
      agreement: agr?.ref ? {
        ref: String(agr.ref), description: typeof agr.description === 'string' ? agr.description : '',
        lines: (agr.lines ?? []).map((l) => ({ match: String(l.match ?? ''), rateUsdc: String(l.rateUsdc ?? '') })),
        remainingUsdc: agr.remainingUsdc ? String(agr.remainingUsdc) : undefined,
      } : undefined,
    }, s);
    return NextResponse.json({ vendor });
  } catch (e) { return fail(e); }
}

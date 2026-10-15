import { NextResponse } from 'next/server';
import { can, listUsers, setUserRole, adminAddresses } from '@/server/auth';
import { getDb } from '@/server/engine';
import { fail, rateLimited, readJson, tooMany } from '@/server/guard';
import { assertSameOrigin, requireSession, sessionFrom } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: who has a role (admin only). Admins named in the environment are listed first. */
export async function GET(req: Request) {
  try {
    const s = requireSession(await sessionFrom(req));
    if (!can.manageVendors(s)) throw Object.assign(new Error('admins only'), { status: 403 });
    return NextResponse.json({ envAdmins: adminAddresses(), users: await listUsers(await getDb()) });
  } catch (e) { return fail(e); }
}

/** POST { address, role }: role is "operator", "admin" or null to remove (admin only). */
export async function POST(req: Request) {
  if (rateLimited(req, 10)) return tooMany();
  try {
    assertSameOrigin(req);
    const s = requireSession(await sessionFrom(req));
    if (!can.manageVendors(s)) throw Object.assign(new Error('admins only'), { status: 403 });
    const b = (await readJson(req)) as { address?: unknown; role?: unknown };
    if (typeof b?.address !== 'string') throw Object.assign(new Error('address is required'), { status: 400 });
    if (b.role !== null && b.role !== 'operator' && b.role !== 'admin') throw Object.assign(new Error('role must be operator, admin or null'), { status: 400 });
    try { await setUserRole(await getDb(), b.address, b.role as 'operator' | 'admin' | null); }
    catch { throw Object.assign(new Error('that is not a valid address'), { status: 400 }); }
    return NextResponse.json({ users: await listUsers(await getDb()) });
  } catch (e) { return fail(e); }
}

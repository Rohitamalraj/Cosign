import { NextResponse } from 'next/server';
import { resolve } from 'node:path';

process.env.COSIGN_AGENTS_DATA ??= resolve(process.cwd(), '..', 'agents', 'data-testnet');

import { DEMO_CASES, readDemoInvoice } from '../../../../../agents/src';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Example invoices we wrote, as plain text, to paste into the form. They are inputs, not stored results: running one
 * sends it through the real agents like any other invoice, and nothing is run until you press the button.
 */
export async function GET() {
  return NextResponse.json({ samples: DEMO_CASES.map((c) => ({ id: c.id, title: c.title, text: readDemoInvoice(c.file) })) });
}

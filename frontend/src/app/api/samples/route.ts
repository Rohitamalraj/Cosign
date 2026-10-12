import { NextResponse } from 'next/server';
import { getEngine } from '@/server/engine';
import { DEMO_CASES, readDemoInvoice } from '../../../../../agents/src';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The five demo invoices as plain text, so the UI can load one into the form. */
export async function GET() {
  await getEngine(); // makes sure the agents' data path is configured
  return NextResponse.json({ samples: DEMO_CASES.map((c) => ({ id: c.id, title: c.title, text: readDemoInvoice(c.file) })) });
}

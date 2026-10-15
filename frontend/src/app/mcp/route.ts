import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createCosignMcpServer } from '@/server/mcp';
import { rateLimited, tooMany } from '@/server/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_BODY = 64 * 1024;

/**
 * Remote MCP endpoint (stateless Streamable HTTP): POST JSON-RPC to /mcp.
 * Add it to any MCP client as a remote server. Tools: check_invoice, demo_invoices, onchain_proof.
 */
export async function POST(req: Request) {
  if (rateLimited(req, 30)) return tooMany();
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY) return Response.json({ jsonrpc: '2.0', error: { code: -32600, message: 'request too large' }, id: null }, { status: 413 });
  const server = createCosignMcpServer();
  // One transport per request: no session state to leak between callers, and nothing to clean up.
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    await transport.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}

const notAllowed = () => Response.json({ jsonrpc: '2.0', error: { code: -32000, message: 'use POST' }, id: null }, { status: 405, headers: { Allow: 'POST' } });
export const GET = notAllowed;
export const DELETE = notAllowed;

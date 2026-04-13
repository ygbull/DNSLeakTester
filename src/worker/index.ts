import type { Env } from './types';
import { handleAnalyze } from './handlers/analyze';
import { handleDnsStart, handleDnsCheck } from './handlers/dns-proxy';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      const corsHeaders: Record<string, string> = {
        'Access-Control-Allow-Origin': env.CORS_ORIGIN,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      };

      if (request.method === 'OPTIONS') {
        return addSecurityHeaders(new Response(null, { status: 204 }), corsHeaders);
      }

      let response: Response;
      try {
        if (url.pathname === '/api/analyze' && request.method === 'GET') {
          response = await handleAnalyze(request, env);
        } else if (url.pathname === '/api/dns/start' && request.method === 'POST') {
          response = await handleDnsStart(request, env);
        } else if (url.pathname.startsWith('/api/dns/check/') && request.method === 'GET') {
          const testId = url.pathname.split('/').pop()!;
          if (!UUID_RE.test(testId)) {
            response = new Response(JSON.stringify({ error: 'Invalid test ID' }), {
              status: 400, headers: { 'Content-Type': 'application/json' },
            });
          } else {
            response = await handleDnsCheck(testId, env);
          }
        } else {
          response = new Response('Not Found', { status: 404 });
        }
      } catch (err) {
        console.error('Worker request failed:', err);
        response = new Response(
          JSON.stringify({ error: 'Internal error' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return addSecurityHeaders(response, corsHeaders);
    }

    // Static assets
    const assetResponse = await env.ASSETS.fetch(request);
    return addSecurityHeaders(assetResponse);
  },
} satisfies ExportedHandler<Env>;

function addSecurityHeaders(response: Response, extraHeaders?: Record<string, string>): Response {
  const headers = new Headers(response.headers);
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) {
      headers.set(k, v);
    }
  }
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

  if (response.headers.get('content-type')?.includes('text/html')) {
    headers.set('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "font-src 'self'",
      "img-src 'self' https://*.bash.ws data:",
      "connect-src 'self'",
      "frame-src 'none'",
      "object-src 'none'",
      "base-uri 'self'",
    ].join('; '));
  }

  return new Response(response.body, { status: response.status, headers });
}

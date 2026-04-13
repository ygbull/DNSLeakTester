import type { Env, DnsStartResponse, DnsCheckResponse, DnsProbeSession } from '../types';
import { BashWsBackend } from '../services/dns-backend';

const backend = new BashWsBackend();

export async function handleDnsStart(_request: Request, env: Env): Promise<Response> {
  try {
    const init = await backend.startTest();
    const testId = crypto.randomUUID();

    const session: DnsProbeSession = {
      bashWsId: init.backendTestId,
      status: 'probing',
      startedAt: Date.now(),
    };

    await env.LEAK_STORE.put(`dns:${testId}`, JSON.stringify(session), {
      expirationTtl: 60,
    });

    const body: DnsStartResponse = {
      testId,
      probeCount: init.probeCount,
      probeHostnames: init.probeHostnames,
      delayBetweenProbesMs: init.delayBetweenProbesMs,
      waitAfterProbesMs: init.waitAfterProbesMs,
    };

    return new Response(JSON.stringify(body), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    const body = { error: 'DNS test service temporarily unavailable' };
    return new Response(JSON.stringify(body), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export async function handleDnsCheck(testId: string, env: Env): Promise<Response> {
  const raw = await env.LEAK_STORE.get(`dns:${testId}`);
  if (!raw) {
    return new Response(JSON.stringify({ status: 'error', resolvers: [], message: 'Test session not found or expired' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const session: DnsProbeSession = JSON.parse(raw);

  try {
    const result = await backend.getResults(session.bashWsId);

    if (!result.ready) {
      const body: DnsCheckResponse = {
        status: 'pending',
        resolvers: [],
        message: 'Waiting for DNS probe results...',
      };
      return new Response(JSON.stringify(body), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    const body: DnsCheckResponse = {
      status: 'complete',
      resolvers: result.resolvers,
      message: null,
    };
    return new Response(JSON.stringify(body), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    const body: DnsCheckResponse = {
      status: 'error',
      resolvers: [],
      message: 'DNS test service temporarily unavailable',
    };
    return new Response(JSON.stringify(body), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

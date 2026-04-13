export interface DnsTestInit {
  backendTestId: string;
  probeHostnames: string[];
  probeCount: number;
  delayBetweenProbesMs: number;
  waitAfterProbesMs: number;
}

export interface DnsLeakApiResult {
  resolvers: Array<{ ip: string; country: string; countryCode: string }>;
  ready: boolean;
}

export interface DnsTestBackend {
  startTest(): Promise<DnsTestInit>;
  getResults(testId: string): Promise<DnsLeakApiResult>;
}

const PROBE_COUNT = 10;
const DELAY_MS = 200;
const WAIT_MS = 3000;
const FETCH_TIMEOUT_MS = 10000;

function fetchWithTimeout(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

export class BashWsBackend implements DnsTestBackend {
  async startTest(): Promise<DnsTestInit> {
    const resp = await fetchWithTimeout('https://bash.ws/id');
    if (!resp.ok) throw new Error('bash.ws unreachable');
    const bashId = (await resp.text()).trim();
    if (!/^[a-zA-Z0-9]+$/.test(bashId)) {
      throw new Error('Invalid bash.ws test ID');
    }

    const probeHostnames: string[] = [];
    for (let i = 1; i <= PROBE_COUNT; i++) {
      probeHostnames.push(`${i}.${bashId}.bash.ws`);
    }

    return {
      backendTestId: bashId,
      probeHostnames,
      probeCount: PROBE_COUNT,
      delayBetweenProbesMs: DELAY_MS,
      waitAfterProbesMs: WAIT_MS,
    };
  }

  async getResults(testId: string): Promise<DnsLeakApiResult> {
    const resp = await fetchWithTimeout(`https://bash.ws/dnsleak/test/${testId}?json`);
    if (!resp.ok) {
      throw new Error(`bash.ws returned HTTP ${resp.status}`);
    }

    const raw: unknown = await resp.json();
    if (!Array.isArray(raw) || raw.length === 0) {
      return { resolvers: [], ready: false };
    }

    // bash.ws returns array of objects with ip, country_name, country fields
    // filter out type: "conclusion" entries
    const resolvers = raw
      .filter((entry: Record<string, unknown>) => entry.type !== 'conclusion' && entry.ip)
      .map((entry: Record<string, unknown>) => ({
        ip: String(entry.ip),
        country: String(entry.country_name ?? 'Unknown'),
        countryCode: String(entry.country ?? ''),
      }));

    const hasConclusion = raw.some(
      (entry: Record<string, unknown>) => entry.type === 'conclusion'
    );
    return { resolvers, ready: resolvers.length > 0 || hasConclusion };
  }
}

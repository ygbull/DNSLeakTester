import { describe, it, expect } from 'vitest';
import { handleAnalyze } from './analyze';
import type { Env } from '../types';

function makeRequest(cfOverrides: Record<string, unknown> = {}): Request {
  const cfProps = {
    country: 'US',
    city: 'Dallas',
    region: 'Texas',
    regionCode: 'TX',
    timezone: 'America/Chicago',
    continent: 'NA',
    postalCode: '75001',
    latitude: '32.78',
    longitude: '-96.80',
    asn: 7922,
    asOrganization: 'Comcast Cable',
    colo: 'DFW',
    httpProtocol: 'HTTP/2',
    isEUCountry: '0',
    tlsVersion: 'TLSv1.3',
    tlsCipher: 'AEAD-AES256-GCM-SHA384',
    ...cfOverrides,
  };

  const req = new Request('https://example.com/api/analyze', {
    headers: { 'CF-Connecting-IP': '1.2.3.4' },
  });
  Object.defineProperty(req, 'cf', { value: cfProps, writable: false });
  return req;
}

const mockEnv = {} as Env;

describe('handleAnalyze', () => {
  it('returns full country name, not just ISO code', async () => {
    const req = makeRequest({ country: 'US' });
    const resp = await handleAnalyze(req, mockEnv);
    const body = await resp.json();

    expect(body.geo.country).toBe('United States');
    expect(body.geo.countryCode).toBe('US');
    expect(body.geo.country).not.toBe(body.geo.countryCode);
  });

  it('returns correct name for non-US countries', async () => {
    const req = makeRequest({ country: 'DE' });
    const resp = await handleAnalyze(req, mockEnv);
    const body = await resp.json();

    expect(body.geo.country).toBe('Germany');
    expect(body.geo.countryCode).toBe('DE');
  });

  it('falls back to ISO code for unknown country codes', async () => {
    const req = makeRequest({ country: 'ZZ' });
    const resp = await handleAnalyze(req, mockEnv);
    const body = await resp.json();

    expect(body.geo.countryCode).toBe('ZZ');
    // Should fall back to the code itself
    expect(body.geo.country).toBe('ZZ');
  });

  it('returns null for missing country', async () => {
    const req = makeRequest({ country: undefined });
    const resp = await handleAnalyze(req, mockEnv);
    const body = await resp.json();

    expect(body.geo.country).toBeNull();
    expect(body.geo.countryCode).toBeNull();
  });
});

describe('VPN detection', () => {
  it('does not flag "American Express Corp" as VPN', async () => {
    const resp = await handleAnalyze(makeRequest({ asn: 99999, asOrganization: 'American Express Corp' }), mockEnv);
    const body = await resp.json();
    expect(body.network.isVpnLikely).toBe(false);
  });

  it('does not flag "Private Ocean Limited" as VPN', async () => {
    const resp = await handleAnalyze(makeRequest({ asn: 99999, asOrganization: 'Private Ocean Limited' }), mockEnv);
    const body = await resp.json();
    expect(body.network.isVpnLikely).toBe(false);
  });

  it('does not flag "Proton Communications" as VPN', async () => {
    const resp = await handleAnalyze(makeRequest({ asn: 99999, asOrganization: 'Proton Communications' }), mockEnv);
    const body = await resp.json();
    expect(body.network.isVpnLikely).toBe(false);
  });

  it('does not flag "Nord Utilities GmbH" as VPN', async () => {
    const resp = await handleAnalyze(makeRequest({ asn: 99999, asOrganization: 'Nord Utilities GmbH' }), mockEnv);
    const body = await resp.json();
    expect(body.network.isVpnLikely).toBe(false);
  });

  it('does not flag "Express Broadband" as VPN', async () => {
    const resp = await handleAnalyze(makeRequest({ asn: 99999, asOrganization: 'Express Broadband' }), mockEnv);
    const body = await resp.json();
    expect(body.network.isVpnLikely).toBe(false);
  });

  it('flags "Mullvad VPN AB"', async () => {
    const resp = await handleAnalyze(makeRequest({ asn: 99999, asOrganization: 'Mullvad VPN AB' }), mockEnv);
    const body = await resp.json();
    expect(body.network.isVpnLikely).toBe(true);
  });

  it('flags "NordVPN S.A."', async () => {
    const resp = await handleAnalyze(makeRequest({ asn: 99999, asOrganization: 'NordVPN S.A.' }), mockEnv);
    const body = await resp.json();
    expect(body.network.isVpnLikely).toBe(true);
  });

  it('flags "Secure VPN Services LLC"', async () => {
    const resp = await handleAnalyze(makeRequest({ asn: 99999, asOrganization: 'Secure VPN Services LLC' }), mockEnv);
    const body = await resp.json();
    expect(body.network.isVpnLikely).toBe(true);
  });

  it('flags known VPN ASN regardless of org name', async () => {
    const resp = await handleAnalyze(makeRequest({ asn: 39351, asOrganization: 'Random Name' }), mockEnv);
    const body = await resp.json();
    expect(body.network.isVpnLikely).toBe(true);
  });

  it('flags datacenter ASN as VPN-likely', async () => {
    const resp = await handleAnalyze(makeRequest({ asn: 16509, asOrganization: 'Amazon.com Inc.' }), mockEnv);
    const body = await resp.json();
    expect(body.network.isVpnLikely).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regression: the TLS CA chain embedded in lms-gateway MUST match the
 * known-good chain in vtop-gateway. Both hosts are *.vit.ac.in and both send
 * ONLY the leaf in the handshake (verified live 2026-09-21 with `openssl
 * s_client -showcerts`: one certificate, issuer "Sectigo Public Server
 * Authentication CA DV R36"), so Deno has to be told the rest of the chain.
 *
 * Two distinct failures have been seen live:
 *  1. A truncated/corrupt PEM makes Deno.createHttpClient throw, the gateway
 *     silently falls back to standard fetch, and every LMS request fails with
 *     "invalid peer certificate: UnknownIssuer" (the USERTRUST root was 1861
 *     chars vs the valid 2093).
 *  2. VIT ROTATED its certificate. lms-gateway pinned only the pre-rotation
 *     chain (Sectigo RSA DV → USERTrust), so the new DV R36 chain had no
 *     trusted path and the LMS was dead end to end while VTOP kept working.
 *
 * These tests fail the build instead of shipping either broken bundle.
 */

const CA_PEMS = [
  'SECTIGO_DV_R36_INTERMEDIATE_CA',
  'SECTIGO_ROOT_R46_CA',
  'SECTIGO_INTERMEDIATE_CA',
  'USERTRUST_ROOT_CA',
] as const;

function extractBlock(source: string, name: string): string {
  const m = source.match(new RegExp(`const ${name} = \`([\\s\\S]*?)\`;`));
  if (!m) throw new Error(`${name} block not found`);
  return m[1];
}

function norm(pem: string): string {
  return pem.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
}

describe('lms-gateway embedded CA chain (TLS regression)', () => {
  const lmsSrc = readFileSync(resolve(__dirname, 'index.ts'), 'utf-8');
  const vtopSrc = readFileSync(resolve(__dirname, '../vtop-gateway/index.ts'), 'utf-8');

  it('pins every CA that vtop-gateway pins, byte-for-byte', () => {
    for (const name of CA_PEMS) {
      expect(norm(extractBlock(lmsSrc, name)), name).toBe(norm(extractBlock(vtopSrc, name)));
    }
  });

  it('USERTRUST_ROOT_CA is not truncated (the 1861-char regression)', () => {
    const lms = extractBlock(lmsSrc, 'USERTRUST_ROOT_CA');
    // The valid USERTrust RSA root is ~2090 chars PEM; a truncation would be
    // far shorter (the bug was 1861) — guard the exact length too.
    expect(lms.length).toBeGreaterThanOrEqual(2000);
  });

  it('passes all four PEMs to Deno.createHttpClient (not just the old chain)', () => {
    const call = lmsSrc.match(/caCerts:\s*\[([\s\S]*?)\]/);
    expect(call, 'caCerts array not found').toBeTruthy();
    for (const name of CA_PEMS) {
      expect(call![1], name).toContain(name);
    }
  });

  it('every pinned PEM is structurally complete (BEGIN/END + non-trivial body)', () => {
    for (const name of CA_PEMS) {
      const pem = extractBlock(lmsSrc, name);
      expect(pem).toContain('-----BEGIN CERTIFICATE-----');
      expect(pem).toContain('-----END CERTIFICATE-----');
      const body = pem.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----/g, '')
        .split('\n').map((l) => l.trim()).filter(Boolean).join('');
      // Base64 body length: valid USERTrust root = 2061, Sectigo int = 2134.
      expect(body.length).toBeGreaterThanOrEqual(1500);
    }
  });

  it('falls back to the default verified client when the pinned chain rejects', () => {
    // A rotation must degrade to Deno's platform trust store, never to
    // acceptInvalidCerts. Same recovery vtop-gateway uses.
    expect(lmsSrc).toMatch(/function isTlsTrustError/);
    const retry = lmsSrc.match(/if \(httpClient && opts\.client && isTlsTrustError\(err\)\)\s*\{([\s\S]*?)\n  \}/);
    expect(retry, 'TLS-trust retry not found').toBeTruthy();
    expect(retry![1]).toContain('delete retry.client');
    // The escape hatches must never be *used* (a comment may name them).
    expect(lmsSrc).not.toMatch(/acceptInvalidCerts\s*:|unsafelyIgnoreCertificateErrors\s*:/);
  });
});

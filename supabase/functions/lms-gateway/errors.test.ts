import { describe, it, expect } from 'vitest';
import { describeUpstreamFailure, isTlsTrustFailure, isConnectFailure } from './errors';

/**
 * The LMS gateway is the only place that sees Moodle's raw failures. What it
 * answers the browser with must be honest AND human (brief §6): no TLS
 * chatter, no URLs, no function names, no HTTP status strings — and never a
 * message that reads like success.
 */

describe('isTlsTrustFailure', () => {
  it('recognises the failure that killed LMS in production', () => {
    const live =
      'error sending request for url (https://lms.vit.ac.in/login/index.php): client error (Connect): invalid peer certificate: UnknownIssuer';
    expect(isTlsTrustFailure(live)).toBe(true);
  });

  it('does not misclassify a plain timeout', () => {
    expect(isTlsTrustFailure('LMS upstream request timed out after 20000ms')).toBe(false);
  });
});

describe('isConnectFailure', () => {
  it('covers DNS/reset/timeout shapes', () => {
    for (const raw of ['connection refused', 'dns error', 'read error: Connection reset by peer', 'timed out']) {
      expect(isConnectFailure(raw), raw).toBe(true);
    }
  });
});

describe('describeUpstreamFailure', () => {
  it('answers the live TLS failure with a human, non-technical sentence', () => {
    const copy = describeUpstreamFailure(
      'error sending request for url (https://lms.vit.ac.in/login/index.php): client error (Connect): invalid peer certificate: UnknownIssuer'
    );
    expect(copy).toMatch(/temporarily unavailable/i);
    expect(copy).not.toMatch(/https?:|issuer|certificate|lms-gateway|error sending/i);
    expect(copy.length).toBeLessThan(180);
  });

  it('distinguishes "too slow" from "unreachable"', () => {
    expect(describeUpstreamFailure('LMS upstream request timed out after 20000ms')).toMatch(/too long/i);
    expect(describeUpstreamFailure('error sending request for url: dns error')).toMatch(/could not be reached/i);
  });

  it('never returns an empty or generic-success string for an unknown failure', () => {
    for (const raw of ['', 'something we have never seen', 'UnexpectedHeaderWhileReadingBody']) {
      const copy = describeUpstreamFailure(raw);
      expect(copy.trim().length).toBeGreaterThan(20);
      expect(copy).not.toMatch(/success|synced|complete/i);
    }
  });

  it('mentions the LMS, so students know which feature is affected', () => {
    expect(describeUpstreamFailure('anything')).toMatch(/LMS/);
  });
});

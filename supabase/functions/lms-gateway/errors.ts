/**
 * Upstream failure copy for lms-gateway.
 *
 * The gateway's own responses (`sessionExpired`, `parseFailed`, per-dataset
 * `unavailable`) already carry curated, human sentences. Everything else that
 * can kill a request is a raw Deno/reqwest string —
 * "error sending request for url (https://lms.vit.ac.in/login/index.php):
 * client error (Connect): invalid peer certificate: UnknownIssuer" — which is
 * accurate for a developer and meaningless (and leaky) to a student.
 *
 * This module classifies those failures so the browser gets an honest,
 * domain-specific sentence and the raw detail stays in the function logs.
 * Nothing here hides a failure: every path answers `ok: false`.
 */

/** True when the TLS handshake itself was rejected (untrusted/rotated chain). */
export function isTlsTrustFailure(message: string): boolean {
  return /invalid peer certificate|unknown issuer|certificate (?:revoked|expired|verify failed)|handshake|tls/i.test(
    message || ''
  );
}

/** True when the request never completed because of the network. */
export function isConnectFailure(message: string): boolean {
  return /connect|connection|dns|resolve|eof|reset by peer|timed? out|timeout|unreachable/i.test(
    message || ''
  );
}

/**
 * Student-facing explanation for an unexpected upstream failure.
 * Short, no URLs, no function names, no protocol chatter.
 */
export function describeUpstreamFailure(message: string): string {
  const raw = (message || '').trim();
  if (isTlsTrustFailure(raw)) {
    return 'The VIT LMS could not be reached securely, so nothing was loaded. This service is temporarily unavailable — try again in a little while.';
  }
  if (/timed? out|timeout|abort/i.test(raw)) {
    return 'The VIT LMS took too long to respond. Try again in a moment.';
  }
  if (/redirect(?:ed)? .*(?:too many|maximum)|maximum redirect/i.test(raw)) {
    return 'The VIT LMS kept sending us in circles instead of answering. Try again in a moment.';
  }
  if (isConnectFailure(raw)) {
    return 'The VIT LMS could not be reached. It may be down or slow — try again in a moment.';
  }
  return 'The VIT LMS is temporarily unavailable. Your other data is unaffected — try again in a moment.';
}

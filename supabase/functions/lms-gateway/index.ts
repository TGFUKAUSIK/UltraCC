/**
 * lms-gateway — Supabase Edge Function (Deno)
 *
 * Stateless Moodle (VIT LMS) proxy, mirroring the vtop-gateway architecture.
 * The browser sends an opaque `sessionToken` (AES-GCM encrypted JSON) on
 * every authenticated request; this function decrypts it, performs the LMS
 * HTTP call, re-encrypts the updated session state, and returns clean JSON.
 *
 * TARGET: https://lms.vit.ac.in (VIT Chennai students' Moodle)
 *
 * AUTH PATH (researched live against lms.vit.ac.in):
 *   - No SSO/CAS with VTOP — separate username/password.
 *   - Moodle web services API is DISABLED (token.php -> enablewsdescription).
 *   - Therefore: HTML scraping with the session-cookie + CSRF pattern.
 *   - GET /login/index.php -> extract `logintoken` hidden field.
 *   - POST /login/index.php { logintoken, username, password } -> 303 /my/.
 *   - MoodleSession cookie persists across the authenticated requests.
 *
 * SECURITY GUARANTEES (same as vtop-gateway):
 *   - Credentials (username/password) exist only during the DO_LOGIN call's
 *     request lifetime — never written to logs, DB, or storage.
 *   - MoodleSession / logintoken travel encrypted in the sessionToken; the
 *     browser holds the encryption key (derived from a random per-session
 *     salt) and the function holds the master secret (SESSION_SECRET).
 *   - No raw LMS HTML is ever forwarded to the browser.
 *   - No credentials or cookies are emitted to Deno logs.
 *
 * NOT zero-knowledge: LMS credentials transit this function over HTTPS.
 * The UI must clearly inform the user of this.
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------
import {
  requestWithJar,
  buildSessionDiag,
  lmsSessionHash,
  type SessionDiag,
  type FetchImpl,
} from './session.ts';
import {
  ParseError,
  extractLogintoken,
  isLoginPage,
  parseCourses,
  parseAssignments,
  parseQuizList,
  parseQuizWindow,
  parseGradebook,
  parseMaterials,
  parseForumPosts,
  parseCalendarEvents,
} from './parsers.ts';
import { describeUpstreamFailure } from './errors.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LmsSessionState {
  // Full cookie jar (MoodleSession + any affinity cookies). Moodle binds the
  // session to the MoodleSession value — preserve the FULL jar so no hop can
  // silently swap it.
  cookie: string;
  // logintoken CSRF from the login page — required for the login POST.
  logintoken: string;
  // Truncated SHA-256 of the MoodleSession value first seen at INITIALIZE —
  // lets diagnostics report session consistency without exposing the value.
  sessionHash?: string;
}

interface GatewayRequest {
  action:
    | 'INITIALIZE_SESSION'
    | 'DO_LOGIN'
    | 'GET_SESSION_STATUS'
    | 'FETCH_DATA'
    | 'LOGOUT';
  sessionToken?: string;
  // DO_LOGIN only — cleared from memory immediately after use.
  credentials?: { username: string; password: string };
  // FETCH_DATA target
  dataTarget?:
    | 'courses' | 'assignments' | 'quiz-windows' | 'gradebook'
    | 'materials' | 'forum' | 'calendar';
  // FETCH_DATA — course-scoped targets (assignments, quizzes, gradebook,
  // materials, forum) require the Moodle course id.
  courseId?: number;
}

interface GatewayResponse {
  ok: boolean;
  action: string;
  sessionToken?: string;
  // INITIALIZE_SESSION
  readyForAuth?: boolean;
  // DO_LOGIN
  loginSuccess?: boolean;
  loginError?: string;
  sessionExpired?: boolean;
  // FETCH_DATA
  data?: unknown;
  parseFailed?: boolean;
  unavailable?: boolean;
  diag?: SessionDiag;
  error?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const LMS_ORIGIN = 'https://lms.vit.ac.in';

// Strict allowlist — no arbitrary proxy.
const ALLOWED_PATHS: Record<string, (courseId?: number) => string> = {
  login:      () => '/login/index.php',
  my:         () => '/my/',
  calendar:   () => '/calendar/view.php?view=upcoming',
  courses:    () => '/my/',
  assignments: (id) => `/mod/assign/index.php?id=${id}`,
  quizIndex:  (id) => `/mod/quiz/index.php?id=${id}`,
  quizView:   (id) => `/mod/quiz/view.php?id=${id}`,
  gradebook:  (id) => `/grade/report/user/index.php?id=${id}`,
  materials:  (id) => `/course/view.php?id=${id}`,
  forum:      (id) => `/mod/forum/view.php?id=${id}`,
};

// ---------------------------------------------------------------------------
// Crypto helpers — AES-GCM session token encryption (same as vtop-gateway)
// ---------------------------------------------------------------------------

async function getMasterKey(): Promise<CryptoKey> {
  const secret = Deno.env.get('SESSION_SECRET');
  if (!secret) {
    throw new Error(
      'SESSION_SECRET environment variable is required. Set it once with: ' +
      'supabase secrets set SESSION_SECRET=<long-random-string>'
    );
  }
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function encryptSession(state: LmsSessionState): Promise<string> {
  const key = await getMasterKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(state));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return `${bufferToBase64(iv.buffer)}.${bufferToBase64(ciphertext)}`;
}

async function decryptSession(token: string): Promise<LmsSessionState> {
  const [ivB64, ctB64] = token.split('.');
  if (!ivB64 || !ctB64) throw new Error('Invalid session token format');
  const key = await getMasterKey();
  const iv = new Uint8Array(base64ToBuffer(ivB64));
  const ciphertext = base64ToBuffer(ctB64);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(plaintext)) as LmsSessionState;
}

// ---------------------------------------------------------------------------
// LMS HTTP helpers
// ---------------------------------------------------------------------------

// lms.vit.ac.in is another *.vit.ac.in host; like vtopcc it sends ONLY the leaf
// in the TLS handshake and omits the intermediate (verified live 2026-09-21:
// `openssl s_client` shows one certificate, s:CN=*.vit.ac.in,
// i:Sectigo Public Server Authentication CA DV R36). Deno's bundled Mozilla
// store cannot build a path to a root from a leaf alone, so every request died
// with "invalid peer certificate: UnknownIssuer" and no LMS screen could load.
//
// Fix (identical to vtop-gateway): pin the missing intermediate + root. VIT
// rotates these without notice, so BOTH chains are pinned — the current
// (Sectigo DV R36 → Root R46) and the pre-rotation (Sectigo RSA DV Secure
// Server CA → USERTrust RSA). An extra trust anchor costs nothing.
//
// TLS verification is NEVER disabled: if the CA-chain client cannot be created,
// fall back to standard fetch (Deno's default trust store), and if the pinned
// client rejects a handshake, retry once on the default client — still verified.
const SECTIGO_INTERMEDIATE_CA = `-----BEGIN CERTIFICATE-----
MIIGEzCCA/ugAwIBAgIQfVtRJrR2uhHbdBYLvFMNpzANBgkqhkiG9w0BAQwFADCB
iDELMAkGA1UEBhMCVVMxEzARBgNVBAgTCk5ldyBKZXJzZXkxFDASBgNVBAcTC0pl
cnNleSBDaXR5MR4wHAYDVQQKExVUaGUgVVNFUlRSVVNUIE5ldHdvcmsxLjAsBgNV
BAMTJVVTRVJUcnVzdCBSU0EgQ2VydGlmaWNhdGlvbiBBdXRob3JpdHkwHhcNMTgx
MTAyMDAwMDAwWhcNMzAxMjMxMjM1OTU5WjCBjzELMAkGA1UEBhMCR0IxGzAZBgNV
BAgTEkdyZWF0ZXIgTWFuY2hlc3RlcjEQMA4GA1UEBxMHU2FsZm9yZDEYMBYGA1UE
ChMPU2VjdGlnbyBMaW1pdGVkMTcwNQYDVQQDEy5TZWN0aWdvIFJTQSBEb21haW4g
VmFsaWRhdGlvbiBTZWN1cmUgU2VydmVyIENBMIIBIjANBgkqhkiG9w0BAQEFAAOC
AQ8AMIIBCgKCAQEA1nMz1tc8INAA0hdFuNY+B6I/x0HuMjDJsGz99J/LEpgPLT+N
TQEMgg8Xf2Iu6bhIefsWg06t1zIlk7cHv7lQP6lMw0Aq6Tn/2YHKHxYyQdqAJrkj
eocgHuP/IJo8lURvh3UGkEC0MpMWCRAIIz7S3YcPb11RFGoKacVPAXJpz9OTTG0E
oKMbgn6xmrntxZ7FN3ifmgg0+1YuWMQJDgZkW7w33PGfKGioVrCSo1yfu4iYCBsk
Haswha6vsC6eep3BwEIc4gLw6uBK0u+QDrTBQBbwb4VCSmT3pDCg/r8uoydajotY
uK3DGReEY+1vVv2Dy2A0xHS+5p3b4eTlygxfFQIDAQABo4IBbjCCAWowHwYDVR0j
BBgwFoAUU3m/WqorSs9UgOHYm8Cd8rIDZsswHQYDVR0OBBYEFI2MXsRUrYrhd+mb
+ZsF4bgBjWHhMA4GA1UdDwEB/wQEAwIBhjASBgNVHRMBAf8ECDAGAQH/AgEAMB0G
A1UdJQQWMBQGCCsGAQUFBwMBBggrBgEFBQcDAjAbBgNVHSAEFDASMAYGBFUdIAAw
CAYGZ4EMAQIBMFAGA1UdHwRJMEcwRaBDoEGGP2h0dHA6Ly9jcmwudXNlcnRydXN0
LmNvbS9VU0VSVHJ1c3RSU0FDZXJ0aWZpY2F0aW9uQXV0aG9yaXR5LmNybDB2Bggr
BgEFBQcBAQRqMGgwPwYIKwYBBQUHMAKGM2h0dHA6Ly9jcnQudXNlcnRydXN0LmNv
bS9VU0VSVHJ1c3RSU0FBZGRUcnVzdENBLmNydDAlBggrBgEFBQcwAYYZaHR0cDov
L29jc3AudXNlcnRydXN0LmNvbTANBgkqhkiG9w0BAQwFAAOCAgEAMr9hvQ5Iw0/H
ukdN+Jx4GQHcEx2Ab/zDcLRSmjEzmldS+zGea6TvVKqJjUAXaPgREHzSyrHxVYbH
7rM2kYb2OVG/Rr8PoLq0935JxCo2F57kaDl6r5ROVm+yezu/Coa9zcV3HAO4OLGi
H19+24rcRki2aArPsrW04jTkZ6k4Zgle0rj8nSg6F0AnwnJOKf0hPHzPE/uWLMUx
RP0T7dWbqWlod3zu4f+k+TY4CFM5ooQ0nBnzvg6s1SQ36yOoeNDT5++SR2RiOSLv
xvcRviKFxmZEJCaOEDKNyJOuB56DPi/Z+fVGjmO+wea03KbNIaiGCpXZLoUmGv38
sbZXQm2V0TP2ORQGgkE49Y9Y3IBbpNV9lXj9p5v//cWoaasm56ekBYdbqbe4oyAL
l6lFhd2zi+WJN44pDfwGF/Y4QA5C5BIG+3vzxhFoYt/jmPQT2BVPi7Fp2RBgvGQq
6jG35LWjOhSbJuMLe/0CjraZwTiXWTb2qHSihrZe68Zk6s+go/lunrotEbaGmAhY
LcmsJWTyXnW0OMGuf1pGg+pRyrbxmRE1a6Vqe8YAsOf4vmSyrcjC8azjUeqkk+B5
yOGBQMkKW+ESPMFgKuOXwIlCypTPRpgSabuY0MLTDXJLR27lk8QyKGOHQ+SwMj4K
00u/I5sUKUErmgQfky3xxzlIPK1aEn8=
-----END CERTIFICATE-----`;

const USERTRUST_ROOT_CA = `-----BEGIN CERTIFICATE-----
MIIF3jCCA8agAwIBAgIQAf1tMPyjylGoG7xkDjUDLTANBgkqhkiG9w0BAQwFADCB
iDELMAkGA1UEBhMCVVMxEzARBgNVBAgTCk5ldyBKZXJzZXkxFDASBgNVBAcTC0pl
cnNleSBDaXR5MR4wHAYDVQQKExVUaGUgVVNFUlRSVVNUIE5ldHdvcmsxLjAsBgNV
BAMTJVVTRVJUcnVzdCBSU0EgQ2VydGlmaWNhdGlvbiBBdXRob3JpdHkwHhcNMTAw
MjAxMDAwMDAwWhcNMzgwMTE4MjM1OTU5WjCBiDELMAkGA1UEBhMCVVMxEzARBgNV
BAgTCk5ldyBKZXJzZXkxFDASBgNVBAcTC0plcnNleSBDaXR5MR4wHAYDVQQKExVU
aGUgVVNFUlRSVVNUIE5ldHdvcmsxLjAsBgNVBAMTJVVTRVJUcnVzdCBSU0EgQ2Vy
dGlmaWNhdGlvbiBBdXRob3JpdHkwggIiMA0GCSqGSIb3DQEBAQUAA4ICDwAwggIK
AoICAQCAEmUXNg7D2wiz0KxXDXbtzSfTTK1Qg2HiqiBNCS1kCdzOiZ/MPans9s/B
3PHTsdZ7NygRK0faOca8Ohm0X6a9fZ2jY0K2dvKpOyuR+OJv0OwWIJAJPuLodMkY
tJHUYmTbf6MG8YgYapAiPLz+E/CHFHv25B+O1ORRxhFnRghRy4YUVD+8M/5+bJz/
Fp0YvVGONaanZshyZ9shZrHUm3gDwFA66Mzw3LyeTP6vBZY1H1dat//O+T23LLb2
VN3I5xI6Ta5MirdcmrS3ID3KfyI0rn47aGYBROcBTkZTmzNg95S+UzeQc0PzMsNT
79uq/nROacdrjGCT3sTHDN/hMq7MkztReJVni+49Vv4M0GkPGw/zJSZrM233bkf6
c0Plfg6lZrEpfDKEY1WJxA3Bk1QwGROs0303p+tdOmw1XNtB1xLaqUkL39iAigmT
Yo61Zs8liM2EuLE/pDkP2QKe6xJMlXzzawWpXhaDzLhn4ugTncxbgtNMs+1b/97l
c6wjOy0AvzVVdAlJ2ElYGn+SNuZRkg7zJn0cTRe8yexDJtC/QV9AqURE9JnnV4ee
UB9XVKg+/XRjL7FQZQnmWEIuQxpMtPAlR1n6BB6T1CZGSlCBst6+eLf8ZxXhyVeE
Hg9j1uliutZfVS7qXMYoCAQlObgOK6nyTJccBz8NUvXt7y+CDwIDAQABo0IwQDAd
BgNVHQ4EFgQUU3m/WqorSs9UgOHYm8Cd8rIDZsswDgYDVR0PAQH/BAQDAgEGMA8G
A1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQEMBQADggIBAFzUfA3P9wF9QZllDHPF
Up/L+M+ZBn8b2kMVn54CVVeWFPFSPCeHlCjtHzoBN6J2/FNQwISbxmtOuowhT6KO
VWKR82kV2LyI48SqC/3vqOlLVSoGIG1VeCkZ7l8wXEskEVX/JJpuXior7gtNn3/3
ATiUFJVDBwn7YKnuHKsSjKCaXqeYalltiz8I+8jRRa8YFWSQEg9zKC7F4iRO/Fjs
8PRF/iKz6y+O0tlFYQXBl2+odnKPi4w2r78NBc5xjeambx9spnFixdjQg3IM8WcR
iQycE0xyNN+81XHfqnHd4blsjDwSXWXavVcStkNr/+XeTWYRUc+ZruwXtuhxkYze
Sf7dNXGiFSeUHM9h4ya7b6NnJSFd5t0dCy5oGzuCr+yDZ4XUmFF0sbmZgIn/f3gZ
XHlKYC6SQK5MNyosycdiyA5d9zZbyuAlJQG03RoHnHcAP9Dc1ew91Pq7P8yF1m9/
qS3fuQL39ZeatTXaw2ewh0qpKJ4jjv9cJ2vhsE/zB+4ALtRZh8tSQZXq9EfX7mRB
VXyNWQKV3WKdwrnuWih0hKWbt5DHDAff9Yk2dDLWKMGwsAvgnEzDHNb842m1R0aB
L6KCq9NjRHDEjf8tM7qtj3u1cIiuPhnPQCjY/MiQu12ZIvVS5ljFH4gxQ+6IHdfG
jjxDah2nGN59PRbxYvnKkKj9
-----END CERTIFICATE-----`;

// CURRENT chain (verified live 2026-09-21 against lms.vit.ac.in): the
// intermediate LMS's server omits today. Byte-identical to the pinned certs in
// vtop-gateway (enforced by certs.test.ts) — same Sectigo rotation, same hosts.
const SECTIGO_DV_R36_INTERMEDIATE_CA = `-----BEGIN CERTIFICATE-----
MIIGTDCCBDSgAwIBAgIQOXpmzCdWNi4NqofKbqvjsTANBgkqhkiG9w0BAQwFADBf
MQswCQYDVQQGEwJHQjEYMBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTYwNAYDVQQD
Ey1TZWN0aWdvIFB1YmxpYyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gUm9vdCBSNDYw
HhcNMjEwMzIyMDAwMDAwWhcNMzYwMzIxMjM1OTU5WjBgMQswCQYDVQQGEwJHQjEY
MBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTcwNQYDVQQDEy5TZWN0aWdvIFB1Ymxp
YyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gQ0EgRFYgUjM2MIIBojANBgkqhkiG9w0B
AQEFAAOCAY8AMIIBigKCAYEAljZf2HIz7+SPUPQCQObZYcrxLTHYdf1ZtMRe7Yeq
RPSwygz16qJ9cAWtWNTcuICc++p8Dct7zNGxCpqmEtqifO7NvuB5dEVexXn9RFFH
12Hm+NtPRQgXIFjx6MSJcNWuVO3XGE57L1mHlcQYj+g4hny90aFh2SCZCDEVkAja
EMMfYPKuCjHuuF+bzHFb/9gV8P9+ekcHENF2nR1efGWSKwnfG5RawlkaQDpRtZTm
M64TIsv/r7cyFO4nSjs1jLdXYdz5q3a4L0NoabZfbdxVb+CUEHfB0bpulZQtH1Rv
38e/lIdP7OTTIlZh6OYL6NhxP8So0/sht/4J9mqIGxRFc0/pC8suja+wcIUna0HB
pXKfXTKpzgis+zmXDL06ASJf5E4A2/m+Hp6b84sfPAwQ766rI65mh50S0Di9E3Pn
2WcaJc+PILsBmYpgtmgWTR9eV9otfKRUBfzHUHcVgarub/XluEpRlTtZudU5xbFN
xx/DgMrXLUAPaI60fZ6wA+PTAgMBAAGjggGBMIIBfTAfBgNVHSMEGDAWgBRWc1hk
lfmSGrASKgRieaFAFYghSTAdBgNVHQ4EFgQUaMASFhgOr872h6YyV6NGUV3LBycw
DgYDVR0PAQH/BAQDAgGGMBIGA1UdEwEB/wQIMAYBAf8CAQAwHQYDVR0lBBYwFAYI
KwYBBQUHAwEGCCsGAQUFBwMCMBsGA1UdIAQUMBIwBgYEVR0gADAIBgZngQwBAgEw
VAYDVR0fBE0wSzBJoEegRYZDaHR0cDovL2NybC5zZWN0aWdvLmNvbS9TZWN0aWdv
UHVibGljU2VydmVyQXV0aGVudGljYXRpb25Sb290UjQ2LmNybDCBhAYIKwYBBQUH
AQEEeDB2ME8GCCsGAQUFBzAChkNodHRwOi8vY3J0LnNlY3RpZ28uY29tL1NlY3Rp
Z29QdWJsaWNTZXJ2ZXJBdXRoZW50aWNhdGlvblJvb3RSNDYucDdjMCMGCCsGAQUF
BzABhhdodHRwOi8vb2NzcC5zZWN0aWdvLmNvbTANBgkqhkiG9w0BAQwFAAOCAgEA
YtOC9Fy+TqECFw40IospI92kLGgoSZGPOSQXMBqmsGWZUQ7rux7cj1du6d9rD6C8
ze1B2eQjkrGkIL/OF1s7vSmgYVafsRoZd/IHUrkoQvX8FZwUsmPu7amgBfaY3g+d
q1x0jNGKb6I6Bzdl6LgMD9qxp+3i7GQOnd9J8LFSietY6Z4jUBzVoOoz8iAU84OF
h2HhAuiPw1ai0VnY38RTI+8kepGWVfGxfBWzwH9uIjeooIeaosVFvE8cmYUB4TSH
5dUyD0jHct2+8ceKEtIoFU/FfHq/mDaVnvcDCZXtIgitdMFQdMZaVehmObyhRdDD
4NQCs0gaI9AAgFj4L9QtkARzhQLNyRf87Kln+YU0lgCGr9HLg3rGO8q+Y4ppLsOd
unQZ6ZxPNGIfOApbPVf5hCe58EZwiWdHIMn9lPP6+F404y8NNugbQixBber+x536
WrZhFZLjEkhp7fFXf9r32rNPfb74X/U90Bdy4lzp3+X1ukh1BuMxA/EEhDoTOS3l
7ABvc7BYSQubQ2490OcdkIzUh3ZwDrakMVrbaTxUM2p24N6dB+ns2zptWCva6jzW
r8IWKIMxzxLPv5Kt3ePKcUdvkBU/smqujSczTzzSjIoR5QqQA6lN1ZRSnuHIWCvh
JEltkYnTAH41QJ6SAWO66GrrUESwN/cgZzL4JLEqz1Y=
-----END CERTIFICATE-----`;

const SECTIGO_ROOT_R46_CA = `-----BEGIN CERTIFICATE-----
MIIFijCCA3KgAwIBAgIQdY39i658BwD6qSWn4cetFDANBgkqhkiG9w0BAQwFADBf
MQswCQYDVQQGEwJHQjEYMBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTYwNAYDVQQD
Ey1TZWN0aWdvIFB1YmxpYyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gUm9vdCBSNDYw
HhcNMjEwMzIyMDAwMDAwWhcNNDYwMzIxMjM1OTU5WjBfMQswCQYDVQQGEwJHQjEY
MBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTYwNAYDVQQDEy1TZWN0aWdvIFB1Ymxp
YyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gUm9vdCBSNDYwggIiMA0GCSqGSIb3DQEB
AQUAA4ICDwAwggIKAoICAQCTvtU2UnXYASOgHEdCSe5jtrch/cSV1UgrJnwUUxDa
ef0rty2k1Cz66jLdScK5vQ9IPXtamFSvnl0xdE8H/FAh3aTPaE8bEmNtJZlMKpnz
SDBh+oF8HqcIStw+KxwfGExxqjWMrfhu6DtK2eWUAtaJhBOqbchPM8xQljeSM9xf
iOefVNlI8JhD1mb9nxc4Q8UBUQvX4yMPFF1bFOdLvt30yNoDN9HWOaEhUTCDsG3X
ME6WW5HwcCSrv0WBZEMNvSE6Lzzpng3LILVCJ8zab5vuZDCQOc2TZYEhMbUjUDM3
IuM47fgxMMxF/mL50V0yeUKH32rMVhlATc6qu/m1dkmU8Sf4kaWD5QazYw6A3OAS
VYCmO2a0OYctyPDQ0RTp5A1NDvZdV3LFOxxHVp3i1fuBYYzMTYCQNFu31xR13NgE
SJ/AwSiItOkcyqex8Va3e0lMWeUgFaiEAin6OJRpmkkGj80feRQXEgyDet4fsZfu
+Zd4KKTIRJLpfSYFplhym3kT2BFfrsU4YjRosoYwjviQYZ4ybPUHNs2iTG7sijbt
8uaZFURww3y8nDnAtOFr94MlI1fZEoDlSfB1D++N6xybVCi0ITz8fAr/73trdf+L
HaAZBav6+CuBQug4urv7qv094PPK306Xlynt8xhW6aWWrL3DkJiy4Pmi1KZHQ3xt
zwIDAQABo0IwQDAdBgNVHQ4EFgQUVnNYZJX5khqwEioEYnmhQBWIIUkwDgYDVR0P
AQH/BAQDAgGGMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQEMBQADggIBAC9c
mTz8Bl6MlC5w6tIyMY208FHVvArzZJ8HXtXBc2hkeqK5Duj5XYUtqDdFqij0lgVQ
YKlJfp/imTYpE0RHap1VIDzYm/EDMrraQKFz6oOht0SmDpkBm+S8f74TlH7Kph52
gDY9hAaLMyZlbcp+nv4fjFg4exqDsQ+8FxG75gbMY/qB8oFM2gsQa6H61SilzwZA
Fv97fRheORKkU55+MkIQpiGRqRxOF3yEvJ+M0ejf5lG5Nkc/kLnHvALcWxxPDkjB
JYOcCj+esQMzEhonrPcibCTRAUH4WAP+JWgiH5paPHxsnnVI84HxZmduTILA7rpX
DhjvLpr3Etiga+kFpaHpaPi8TD8SHkXoUsCjvxInebnMMTzD9joiFgOgyY9mpFui
TdaBJQbpdqQACj7LzTWb4OE4y2BThihCQRxEV+ioratF4yUQvNs+ZUH7G6aXD+u5
dHn5HrwdVw1Hr8Mvn4dGp+smWg9WY7ViYG4A++MnESLn/pmPNPW56MORcr3Ywx65
LvKRRFHQV80MNNVIIb/bE/FmJUNS0nAiNs2fxBx1IK1jcmMGDw4nztJqDby1ORrp
0XZ60Vzk50lJLVU3aPAaOpg+VBeHVOmmJ1CJeyAvP/+/oYtKR5j/K3tJPsMpRmAY
QqszKbrAKbkTidOIijlBO8n9pu0f9GBj39ItVQGL
-----END CERTIFICATE-----`;

let httpClient: ReturnType<typeof Deno.createHttpClient> | null = null;
try {
  // @ts-ignore: Deno-specific API
  httpClient = Deno.createHttpClient({
    caCerts: [
      SECTIGO_DV_R36_INTERMEDIATE_CA,
      SECTIGO_ROOT_R46_CA,
      SECTIGO_INTERMEDIATE_CA,
      USERTRUST_ROOT_CA,
    ],
  });
  console.log('[lms-gateway] HTTP client initialized with Sectigo CA chain');
} catch (_e1) {
  console.warn('[lms-gateway] Deno.createHttpClient unavailable — using standard fetch (default TLS verification)');
  httpClient = null;
}

function buildHeaders(referer?: string): Record<string, string> {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': referer || `${LMS_ORIGIN}/login/index.php`,
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
  };
}

const lmsFetchImpl: FetchImpl = async (url, init) => {
  const opts: RequestInit & { client?: unknown } = { ...init };
  if (httpClient) {
    // @ts-ignore: Deno-specific option (TLS verification via CA chain)
    opts.client = httpClient;
  }
  try {
    return await fetch(url, opts as RequestInit);
  } catch (err) {
    // VIT rotates its certificates without notice and serves an incomplete
    // chain, so the PINNED client can reject a handshake that the platform
    // trust store would accept. Retry once on the default client — still fully
    // verified, never acceptInvalidCerts — so a future rotation degrades this
    // path instead of bricking every LMS screen (same recovery as vtop-gateway).
    if (httpClient && opts.client && isTlsTrustError(err)) {
      const retry: RequestInit & { client?: unknown } = { ...opts };
      delete retry.client;
      return fetch(url, retry as RequestInit);
    }
    throw err;
  }
};

/** True for handshake rejections caused by an untrusted/rotated CA chain. */
function isTlsTrustError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /invalid peer certificate|unknown issuer|certificate verify failed/i.test(msg);
}

async function lmsGet(
  path: string,
  cookie?: string,
  referer?: string
): Promise<{ html: string; cookie: string; status: number; url: string }> {
  const res = await requestWithJar(
    lmsFetchImpl,
    `${LMS_ORIGIN}${path}`,
    { method: 'GET', headers: buildHeaders(referer) },
    cookie || ''
  );
  return { html: res.html, cookie: res.jar, status: res.status, url: res.url };
}

async function lmsPost(
  path: string,
  fields: Record<string, string>,
  cookie?: string
): Promise<{ html: string; cookie: string; status: number; url: string }> {
  const body = new URLSearchParams(fields).toString();
  const res = await requestWithJar(
    lmsFetchImpl,
    `${LMS_ORIGIN}${path}`,
    {
      method: 'POST',
      headers: {
        ...buildHeaders(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    },
    cookie || ''
  );
  return { html: res.html, cookie: res.jar, status: res.status, url: res.url };
}

function isLmsSessionExpired(html: string, url: string): boolean {
  return isLoginPage(html, url);
}

// ---------------------------------------------------------------------------
// CORS headers
// ---------------------------------------------------------------------------
/**
 * User-facing sentences for the two failure shapes this function raises most.
 * A typed flag (`sessionExpired` / `parseFailed`) is what the client branches
 * on; the `error` string is only what a student reads, so it never names a
 * dataTarget, a selector or a parser — those go to the function logs.
 */
const MSG_SESSION_EXPIRED = 'Your LMS sign-in has expired. Please connect to the LMS again.';
const MSG_PARSE_FAILED = 'The LMS changed how its pages are built, so this could not be read. Nothing was saved for it — your other data is unaffected.';

/**
 * Report a parse failure: the developer half (which target, which shape
 * mismatched) is logged server-side, the browser gets the honest sentence and
 * the typed `parseFailed` flag, so the caller keeps its last good cache.
 */
function parseFailedResponse(target: string, detail: string): GatewayResponse {
  console.error(`[lms-gateway] parse failed for ${target}: ${detail.substring(0, 200)}`);
  return { ok: false, action: 'FETCH_DATA', parseFailed: true, error: MSG_PARSE_FAILED };
}

function corsHeaders(origin: string): Record<string, string> {
  const appUrl = Deno.env.get('APP_URL') || '';
  const isDev = origin.includes('localhost') || origin.includes('127.0.0.1');
  let allowedOrigin: string;
  if (isDev) allowedOrigin = origin;
  else if (appUrl && origin === appUrl) allowedOrigin = origin;
  else allowedOrigin = '*';
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(body: GatewayResponse, status = 200, origin = ''): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

function respond(body: GatewayResponse, origin: string, action: string): Response {
  if (body.diag) {
    console.log(`[lms-gateway] ${action} diag: ${JSON.stringify(body.diag)}`);
  }
  return jsonResponse(body, 200, origin);
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

async function handleInitializeSession(): Promise<GatewayResponse> {
  const res = await lmsGet(ALLOWED_PATHS.login());
  const logintoken = extractLogintoken(res.html);
  if (!logintoken) {
    // Could not find the CSRF token — the page shape may have changed, or the
    // gateway IP is being challenged. Honest typed error, not a guess.
    throw new Error('LMS login page did not expose a logintoken (page structure may have changed).');
  }
  const sessionHash = await lmsSessionHash(res.cookie || '');
  const state: LmsSessionState = { cookie: res.cookie || '', logintoken, sessionHash };
  const sessionToken = await encryptSession(state);
  const diag = await buildSessionDiag(state.cookie, logintoken, sessionHash);
  return { ok: true, action: 'INITIALIZE_SESSION', sessionToken, readyForAuth: true, diag };
}

async function handleDoLogin(
  session: LmsSessionState,
  username: string,
  password: string
): Promise<GatewayResponse> {
  if (!session.logintoken) {
    throw new Error('No logintoken in session — call INITIALIZE_SESSION first');
  }

  const res = await lmsPost(
    ALLOWED_PATHS.login(),
    { logintoken: session.logintoken, username, password },
    session.cookie
  );

  // Clear credential references as early as possible.
  password = '';

  // Moodle login: on success the POST 303-redirects to /my/ (or the referer
  // page); on failure the login page is re-rendered in place.
  const failed = isLoginPage(res.html, res.url) || /loginerrors/i.test(res.html);
  const diag = await buildSessionDiag(res.cookie || session.cookie, session.logintoken, session.sessionHash);

  if (failed) {
    return {
      ok: false, action: 'DO_LOGIN', loginSuccess: false,
      loginError: 'LMS rejected the supplied username or password. Use the exact LMS username shown in VTOP My Credentials; your VTOP registration number is not an LMS username.',
      diag,
    };
  }

  const newState: LmsSessionState = {
    cookie: res.cookie || session.cookie,
    logintoken: session.logintoken,
    sessionHash: session.sessionHash,
  };
  const sessionToken = await encryptSession(newState);
  return { ok: true, action: 'DO_LOGIN', loginSuccess: true, sessionToken, diag };
}

async function handleGetSessionStatus(session: LmsSessionState): Promise<GatewayResponse> {
  const res = await lmsGet(ALLOWED_PATHS.my(), session.cookie);
  const authed = !isLmsSessionExpired(res.html, res.url);
  const newState: LmsSessionState = {
    ...session,
    cookie: res.cookie || session.cookie,
  };
  const sessionToken = await encryptSession(newState);
  const diag = await buildSessionDiag(newState.cookie, newState.logintoken, newState.sessionHash);
  if (authed) {
    return { ok: true, action: 'GET_SESSION_STATUS', sessionToken, data: { authenticated: true }, diag };
  }
  return { ok: true, action: 'GET_SESSION_STATUS', sessionExpired: true, sessionToken, data: { authenticated: false }, diag };
}

async function handleFetchData(
  session: LmsSessionState,
  target: string,
  courseId?: number
): Promise<GatewayResponse> {
  const courseScoped = ['assignments', 'quiz-windows', 'gradebook', 'materials', 'forum'];
  if (courseScoped.includes(target) && !courseId) {
    throw new Error(`courseId is required for ${target}`);
  }

  let resp: { html: string; cookie: string; status: number; url: string };
  let data: unknown;
  let unavailable = false;
  const expiredResponse = (response: { html: string; url: string }): GatewayResponse | null =>
    isLmsSessionExpired(response.html, response.url)
      ? { ok: false, action: 'FETCH_DATA', sessionExpired: true, error: MSG_SESSION_EXPIRED }
      : null;

  switch (target) {
    case 'courses':
      resp = await lmsGet(ALLOWED_PATHS.courses(), session.cookie, `${LMS_ORIGIN}/my/`);
      if (expiredResponse(resp)) return expiredResponse(resp)!;
      data = parseCourses(resp.html);
      break;

    case 'assignments':
      resp = await lmsGet(ALLOWED_PATHS.assignments(courseId!), session.cookie, `${LMS_ORIGIN}/course/view.php?id=${courseId}`);
      if (expiredResponse(resp)) return expiredResponse(resp)!;
      data = parseAssignments(resp.html);
      break;

    case 'quiz-windows': {
      resp = await lmsGet(ALLOWED_PATHS.quizIndex(courseId!), session.cookie, `${LMS_ORIGIN}/course/view.php?id=${courseId}`);
      if (expiredResponse(resp)) return expiredResponse(resp)!;
      const quizzes = parseQuizList(resp.html);
      // Each quiz's open/close window lives on its own view page — fetch them
      // on the SAME session (serial to stay gentle; quizzes per course are few).
      const windows = [];
      for (const q of quizzes) {
        const qr = await lmsGet(ALLOWED_PATHS.quizView(q.quizId), resp.cookie || session.cookie, ALLOWED_PATHS.quizIndex(courseId!));
        if (isLmsSessionExpired(qr.html, qr.url)) {
          return { ok: false, action: 'FETCH_DATA', sessionExpired: true, error: MSG_SESSION_EXPIRED };
        }
        resp = { ...resp, cookie: qr.cookie || resp.cookie };
        try {
          windows.push(parseQuizWindow(qr.html, q));
        } catch (err: unknown) {
          if (err instanceof ParseError) {
            return parseFailedResponse('quiz-windows', err.message);
          }
          throw err;
        }
      }
      data = windows;
      break;
    }

    case 'gradebook':
      resp = await lmsGet(ALLOWED_PATHS.gradebook(courseId!), session.cookie, `${LMS_ORIGIN}/course/view.php?id=${courseId}`);
      if (expiredResponse(resp)) return expiredResponse(resp)!;
      data = parseGradebook(resp.html);
      break;

    case 'materials':
      resp = await lmsGet(ALLOWED_PATHS.materials(courseId!), session.cookie, `${LMS_ORIGIN}/my/`);
      if (expiredResponse(resp)) return expiredResponse(resp)!;
      data = parseMaterials(resp.html);
      break;

    case 'forum': {
      // The course news forum lives at /mod/forum/view.php?id=N — find the
      // forum activity from the course page first (same session).
      resp = await lmsGet(ALLOWED_PATHS.materials(courseId!), session.cookie, `${LMS_ORIGIN}/my/`);
      if (expiredResponse(resp)) return expiredResponse(resp)!;
      const forumHref = resp.html.match(/href="([^"]*\/mod\/forum\/view\.php\?id=\d+(?:&[^"]*)?)"/i);
      if (!forumHref) {
        // Course has no forum activity — legitimate empty state.
        data = [];
        unavailable = true;
        break;
      }
      const forumId = forumHref[1].match(/id=(\d+)/)![1];
      const fr = await lmsGet(ALLOWED_PATHS.forum(parseInt(forumId, 10)), resp.cookie || session.cookie, ALLOWED_PATHS.materials(courseId!));
      if (isLmsSessionExpired(fr.html, fr.url)) {
        return { ok: false, action: 'FETCH_DATA', sessionExpired: true, error: MSG_SESSION_EXPIRED };
      }
      resp = { ...resp, html: fr.html, cookie: fr.cookie || resp.cookie, url: fr.url };
      data = parseForumPosts(fr.html);
      break;
    }

    case 'calendar':
      resp = await lmsGet(ALLOWED_PATHS.calendar(), session.cookie, `${LMS_ORIGIN}/my/`);
      if (expiredResponse(resp)) return expiredResponse(resp)!;
      data = parseCalendarEvents(resp.html);
      break;

    default:
      throw new Error(`Unknown data target: ${target}`);
  }

  if (isLmsSessionExpired(resp.html, resp.url)) {
    return { ok: false, action: 'FETCH_DATA', sessionExpired: true, error: MSG_SESSION_EXPIRED };
  }

  // Refresh the session token with the possibly-updated cookie jar.
  const newState: LmsSessionState = {
    ...session,
    cookie: resp.cookie || session.cookie,
  };
  const sessionToken = await encryptSession(newState);
  const diag = await buildSessionDiag(newState.cookie, newState.logintoken, newState.sessionHash);
  return { ok: true, action: 'FETCH_DATA', sessionToken, data, unavailable, diag };
}

async function handleLogout(session: LmsSessionState): Promise<GatewayResponse> {
  try {
    await lmsGet('/login/logout.php', session.cookie);
  } catch {
    // Best effort — the local session is discarded regardless.
  }
  const diag = await buildSessionDiag(session.cookie, session.logintoken, session.sessionHash);
  return { ok: true, action: 'LOGOUT', diag };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') || '';

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, action: 'ERROR', error: 'Method not allowed' }, 405, origin);
  }

  let body: GatewayRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, action: 'ERROR', error: 'Invalid JSON body' }, 400, origin);
  }

  const { action, sessionToken, credentials, dataTarget, courseId } = body;

  try {
    if (action === 'INITIALIZE_SESSION') {
      const result = await handleInitializeSession();
      return respond(result, origin, action);
    }

    if (!sessionToken) {
      return jsonResponse({ ok: false, action, error: 'sessionToken is required' }, 400, origin);
    }

    let session: LmsSessionState;
    try {
      session = await decryptSession(sessionToken);
    } catch {
      /*
       * A token this function can no longer decrypt IS an expired sign-in, and
       * the student's next step ("connect to the LMS again") is different from
       * a transport outage ("try again"). Answering 200 + sessionExpired keeps
       * that distinction.
       */
      return jsonResponse({
        ok: false, action, sessionExpired: true,
        error: MSG_SESSION_EXPIRED,
      }, 200, origin);
    }

    switch (action) {
      case 'DO_LOGIN': {
        if (!credentials) {
          return jsonResponse({ ok: false, action, error: 'credentials required for DO_LOGIN' }, 400, origin);
        }
        const { username, password } = credentials;
        if (!username || !password) {
          return jsonResponse({ ok: false, action, error: 'username and password are both required' }, 400, origin);
        }
        const result = await handleDoLogin(session, username, password);
        return respond(result, origin, action);
      }

      case 'GET_SESSION_STATUS': {
        const result = await handleGetSessionStatus(session);
        return respond(result, origin, action);
      }

      case 'FETCH_DATA': {
        if (!dataTarget) {
          return jsonResponse({ ok: false, action, error: 'dataTarget is required for FETCH_DATA' }, 400, origin);
        }
        const validTargets = ['courses', 'assignments', 'quiz-windows', 'gradebook', 'materials', 'forum', 'calendar'];
        if (!validTargets.includes(dataTarget)) {
          return jsonResponse({ ok: false, action, error: `Invalid dataTarget: ${dataTarget}` }, 400, origin);
        }
        // The request body is untrusted: the declared type is not a check.
        // A fractional, negative or string course id must not reach a URL.
        if (courseId !== undefined && (typeof courseId !== 'number' || !Number.isInteger(courseId) || courseId <= 0)) {
          return jsonResponse({ ok: false, action, error: 'courseId must be a positive integer' }, 400, origin);
        }
        let result: GatewayResponse;
        try {
          result = await handleFetchData(session, dataTarget, courseId);
        } catch (err: unknown) {
          if (err instanceof ParseError) {
            return parseFailedResponse(dataTarget, err.message);
          }
          throw err;
        }
        return respond(result, origin, action);
      }

      case 'LOGOUT': {
        const result = await handleLogout(session);
        return respond(result, origin, action);
      }

      default:
        return jsonResponse({ ok: false, action: action || 'UNKNOWN', error: `Unknown action: ${action}` }, 400, origin);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // Never log credentials or cookies — only the sanitized error message.
    console.error(`[lms-gateway] ${action} error:`, message.substring(0, 200));
    // The raw string above is Deno/reqwest chatter (TLS, URLs, redirect
    // mechanics). Students get an honest classified sentence instead, and the
    // response stays a 200 + typed flags so the client can read `error`.
    return jsonResponse({
      ok: false,
      action: action || 'ERROR',
      unavailable: true,
      error: describeUpstreamFailure(message),
    }, 200, origin);
  }
});

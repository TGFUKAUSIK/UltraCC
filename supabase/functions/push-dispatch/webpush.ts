/**
 * webpush.ts — dependency-free Web Push for the push-dispatch edge function.
 *
 * Implements the two standards a push message needs, using only WebCrypto so
 * the same code runs in the Deno edge runtime and in Node (for the tests):
 *
 *   RFC 8291 — Message Encryption for Web Push (aes128gcm content encoding)
 *              ephemeral ECDH P-256 -> HKDF-SHA256 -> AES-128-GCM, with the
 *              auth secret mixed in, exactly as browsers decrypt it.
 *   RFC 8292 — VAPID (ES256 JWT proving the sender to the push service)
 *
 * No secrets live here: VAPID keys arrive as environment variables, and the
 * receiver keys come from each browser's own PushSubscription.
 */

export interface VapidConfig {
  /** Uncompressed P-256 point, base64url (the browser subscribes with this). */
  publicKey: string;
  /** 32-byte P-256 scalar, base64url. */
  privateKey: string;
  /** Contact for the push service: "mailto:you@example.com" or an https URL. */
  subject: string;
}

export interface PushSubscriptionRecord {
  endpoint: string;
  /** Receiver public key (browser: subscription.getKey('p256dh')), base64url. */
  p256dh: string;
  /** Receiver auth secret, base64url (16 bytes). */
  auth: string;
}

export interface WebPushResult {
  ok: boolean;
  status: number;
  /** True when the push service says the subscription is gone (404/410). */
  expired: boolean;
  error?: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ---------------------------------------------------------------------------
// base64url
// ---------------------------------------------------------------------------

export function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** HKDF-Expand+Extract in one shot (WebCrypto's HKDF deriveBits). */
async function hkdf(
  cryptoImpl: Crypto,
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  lengthBytes: number,
): Promise<Uint8Array> {
  const key = await cryptoImpl.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await cryptoImpl.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    key,
    lengthBytes * 8,
  );
  return new Uint8Array(bits);
}

// ---------------------------------------------------------------------------
// RFC 8291 — payload encryption
// ---------------------------------------------------------------------------

export interface EncryptedPayload {
  /** Full request body: salt | rs | idlen | keyid | ciphertext. */
  body: Uint8Array;
  salt: Uint8Array;
  /** Ephemeral public key sent as the key id (uncompressed P-256 point). */
  serverPublicKey: Uint8Array;
}

/**
 * Encrypt a payload for one subscription. The output layout is fixed by
 * RFC 8188 (aes128gcm): 16-byte salt, 4-byte record size, 1-byte key-id
 * length, the 65-byte key id (our ephemeral public key), then ciphertext.
 */
export async function encryptWebPushPayload(
  subscription: Pick<PushSubscriptionRecord, 'p256dh' | 'auth'>,
  payload: unknown,
  options: { crypto?: Crypto; recordSize?: number } = {},
): Promise<EncryptedPayload> {
  const cryptoImpl = options.crypto ?? globalThis.crypto;
  const recordSize = options.recordSize ?? 4096;

  const receiverPublicKey = base64UrlToBytes(subscription.p256dh);
  const authSecret = base64UrlToBytes(subscription.auth);
  if (receiverPublicKey.length !== 65 || receiverPublicKey[0] !== 0x04) {
    throw new Error('p256dh must be an uncompressed P-256 public key (65 bytes)');
  }
  if (authSecret.length !== 16) throw new Error('auth secret must be 16 bytes');

  const ephemeral = await cryptoImpl.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );
  const serverPublicKey = new Uint8Array(
    await cryptoImpl.subtle.exportKey('raw', ephemeral.publicKey),
  );

  const receiverKey = await cryptoImpl.subtle.importKey(
    'raw',
    receiverPublicKey,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const sharedSecret = new Uint8Array(
    await cryptoImpl.subtle.deriveBits(
      { name: 'ECDH', public: receiverKey },
      ephemeral.privateKey,
      256,
    ),
  );

  // Mix the auth secret and both public keys into the input keying material.
  const keyInfo = concat(encoder.encode('WebPush: info'), new Uint8Array([0]), receiverPublicKey, serverPublicKey);
  const ikm = await hkdf(cryptoImpl, sharedSecret, authSecret, keyInfo, 32);

  const salt = cryptoImpl.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(cryptoImpl, ikm, salt, concat(encoder.encode('Content-Encoding: aes128gcm'), new Uint8Array([0])), 16);
  const nonce = await hkdf(cryptoImpl, ikm, salt, concat(encoder.encode('Content-Encoding: nonce'), new Uint8Array([0])), 12);

  const plaintext = concat(encoder.encode(typeof payload === 'string' ? payload : JSON.stringify(payload)), new Uint8Array([0x02]));
  const aesKey = await cryptoImpl.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(
    await cryptoImpl.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, plaintext),
  );

  // RFC 8188 header: salt(16) | record size(4) | key id length(1) | key id(65).
  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, recordSize, false);
  header[20] = 65;
  header.set(serverPublicKey, 21);

  return { body: concat(header, ciphertext), salt, serverPublicKey };
}

// ---------------------------------------------------------------------------
// RFC 8292 — VAPID
// ---------------------------------------------------------------------------

function originOf(endpoint: string): string {
  try {
    return new URL(endpoint).origin;
  } catch {
    return '';
  }
}

async function importVapidSigningKey(cryptoImpl: Crypto, vapid: VapidConfig): Promise<CryptoKey> {
  const publicKey = base64UrlToBytes(vapid.publicKey);
  const privateScalar = base64UrlToBytes(vapid.privateKey);
  if (publicKey.length !== 65 || publicKey[0] !== 0x04) {
    throw new Error('VAPID public key must be an uncompressed P-256 point');
  }
  if (privateScalar.length !== 32) throw new Error('VAPID private key must be a 32-byte scalar');
  // The JWK needs x/y alongside d — they are simply the halves of the public point.
  try {
    return await cryptoImpl.subtle.importKey(
      'jwk',
      {
        kty: 'EC',
        crv: 'P-256',
        d: bytesToBase64Url(privateScalar),
        x: bytesToBase64Url(publicKey.slice(1, 33)),
        y: bytesToBase64Url(publicKey.slice(33, 65)),
        ext: true,
      },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    );
  } catch {
    // The opaque platform error here means one thing in practice: the two keys
    // are not a matching pair (usually pasted from two different runs).
    throw new Error('VAPID_PAIR_MISMATCH: VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are not a matching P-256 pair — regenerate both together');
  }
}

/** The `Authorization: vapid t=…, k=…` header value for one endpoint. */
export async function buildVapidHeader(
  endpoint: string,
  vapid: VapidConfig,
  options: { crypto?: Crypto; now?: number; lifetimeSeconds?: number } = {},
): Promise<string> {
  const cryptoImpl = options.crypto ?? globalThis.crypto;
  const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000);
  const header = bytesToBase64Url(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = bytesToBase64Url(
    encoder.encode(
      JSON.stringify({
        aud: originOf(endpoint),
        exp: nowSeconds + (options.lifetimeSeconds ?? 12 * 60 * 60),
        sub: vapid.subject,
      }),
    ),
  );
  const signingInput = encoder.encode(`${header}.${claims}`);
  const key = await importVapidSigningKey(cryptoImpl, vapid);
  const signature = new Uint8Array(
    await cryptoImpl.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, signingInput),
  );
  return `vapid t=${header}.${claims}.${bytesToBase64Url(signature)}, k=${vapid.publicKey}`;
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

export interface SendOptions {
  crypto?: Crypto;
  fetchImpl?: typeof fetch;
  /** How long the push service may hold the message, in seconds. */
  ttlSeconds?: number;
  now?: number;
}

/**
 * Deliver one push message. Reminders are time-sensitive, so the default TTL is
 * one hour: a class reminder that could not be delivered within the hour is
 * stale and better dropped than shown late.
 */
export async function sendWebPush(
  subscription: PushSubscriptionRecord,
  payload: unknown,
  vapid: VapidConfig,
  options: SendOptions = {},
): Promise<WebPushResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const [{ body }, authorization] = await Promise.all([
      encryptWebPushPayload(subscription, payload, { crypto: options.crypto }),
      buildVapidHeader(subscription.endpoint, vapid, { crypto: options.crypto, now: options.now }),
    ]);

    const response = await fetchImpl(subscription.endpoint, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(options.ttlSeconds ?? 3600),
        Urgency: 'normal',
      },
      body,
    });

    return {
      ok: response.ok || response.status === 201 || response.status === 202,
      status: response.status,
      expired: response.status === 404 || response.status === 410,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      expired: false,
      error: error instanceof Error ? error.message : 'push failed',
    };
  }
}

/** VAPID key pair generator used by scripts/generate-vapid-keys.mjs. */
export async function generateVapidKeys(cryptoImpl: Crypto = globalThis.crypto): Promise<{ publicKey: string; privateKey: string }> {
  const pair = await cryptoImpl.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = (await cryptoImpl.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  const raw = new Uint8Array(await cryptoImpl.subtle.exportKey('raw', pair.publicKey));
  return {
    publicKey: bytesToBase64Url(raw),
    privateKey: bytesToBase64Url(base64UrlToBytes(jwk.d as string)),
  };
}

export { decoder as textDecoder };

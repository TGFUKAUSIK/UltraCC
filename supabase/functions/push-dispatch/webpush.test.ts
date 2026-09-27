/**
 * webpush tests — the sender side is proven against a receiver implemented
 * from the same RFCs, because a Web Push bug is silent: the push service
 * accepts the request and the browser simply never shows anything.
 *
 * Covered:
 *   - RFC 8291 round trip: our aes128gcm body decrypts back to the payload
 *     using only the subscription keys (exactly what a browser does).
 *   - The auth secret and both public keys really do feed the key derivation
 *     (wrong auth secret must fail authentication).
 *   - RFC 8292: the VAPID header is a verifiable ES256 JWT with the right
 *     audience/subject, and the k= parameter is the public key.
 *   - sendWebPush wires the headers correctly and reports gone subscriptions.
 */

import { describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import {
  base64UrlToBytes, bytesToBase64Url, buildVapidHeader, encryptWebPushPayload,
  generateVapidKeys, sendWebPush, type PushSubscriptionRecord, type VapidConfig,
} from './webpush';

const nodeCrypto = webcrypto as unknown as Crypto;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await nodeCrypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await nodeCrypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

/** A browser-like receiver: its own ECDH pair, exposed as a subscription. */
async function makeReceiver() {
  const pair = await nodeCrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const publicKey = new Uint8Array(await nodeCrypto.subtle.exportKey('raw', pair.publicKey));
  const auth = nodeCrypto.getRandomValues(new Uint8Array(16));
  const subscription: PushSubscriptionRecord = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
    p256dh: bytesToBase64Url(publicKey),
    auth: bytesToBase64Url(auth),
  };
  return { pair, publicKey, auth, subscription };
}

/** The receiver half of RFC 8291, written independently of the sender code. */
async function decryptAsReceiver(
  body: Uint8Array,
  receiver: { pair: CryptoKeyPair; publicKey: Uint8Array; auth: Uint8Array },
  authOverride?: Uint8Array,
): Promise<string> {
  const salt = body.slice(0, 16);
  const keyIdLength = body[20];
  const serverPublicKey = body.slice(21, 21 + keyIdLength);
  const ciphertext = body.slice(21 + keyIdLength);

  const serverKey = await nodeCrypto.subtle.importKey('raw', serverPublicKey, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const sharedSecret = new Uint8Array(
    await nodeCrypto.subtle.deriveBits({ name: 'ECDH', public: serverKey }, receiver.pair.privateKey, 256),
  );

  const keyInfo = concat(encoder.encode('WebPush: info'), new Uint8Array([0]), receiver.publicKey, serverPublicKey);
  const ikm = await hkdf(sharedSecret, authOverride ?? receiver.auth, keyInfo, 32);
  const cek = await hkdf(ikm, salt, concat(encoder.encode('Content-Encoding: aes128gcm'), new Uint8Array([0])), 16);
  const nonce = await hkdf(ikm, salt, concat(encoder.encode('Content-Encoding: nonce'), new Uint8Array([0])), 12);

  const aesKey = await nodeCrypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['decrypt']);
  const plaintext = new Uint8Array(
    await nodeCrypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, ciphertext),
  );
  // Strip the RFC 8188 padding delimiter: trailing zeros then a 0x02 octet.
  let end = plaintext.length - 1;
  expect(plaintext[end]).toBe(0x02);
  end -= 1;
  while (end >= 0 && plaintext[end] === 0x00) end -= 1;
  return decoder.decode(plaintext.slice(0, end + 1));
}

/** A real generated pair — the same thing scripts/generate-vapid-keys.mjs prints. */
const vapid: VapidConfig = { ...(await generateVapidKeys(nodeCrypto)), subject: 'mailto:admin@ultracc.app' };

describe('RFC 8291 payload encryption', () => {
  it('round-trips a JSON reminder through a browser-style receiver', async () => {
    const receiver = await makeReceiver();
    const payload = { title: 'CSE1012 starts in 10 min', body: 'AB1-301 · until 9:45 AM', url: '/?tab=timetable' };

    const { body, salt, serverPublicKey } = await encryptWebPushPayload(receiver.subscription, payload, { crypto: nodeCrypto });

    expect(body[20]).toBe(65);
    expect(salt).toHaveLength(16);
    expect(serverPublicKey).toHaveLength(65);
    expect(serverPublicKey[0]).toBe(0x04);
    await expect(decryptAsReceiver(body, receiver)).resolves.toEqual(JSON.stringify(payload));
  });

  it('uses the auth secret as real key material', async () => {
    const receiver = await makeReceiver();
    const { body } = await encryptWebPushPayload(receiver.subscription, { hello: 'world' }, { crypto: nodeCrypto });

    // A receiver with the wrong auth secret must not be able to authenticate.
    const wrongAuth = nodeCrypto.getRandomValues(new Uint8Array(16));
    await expect(decryptAsReceiver(body, receiver, wrongAuth)).rejects.toThrow();
  });

  it('rejects subscription keys that are not usable', async () => {
    await expect(
      encryptWebPushPayload({ p256dh: bytesToBase64Url(new Uint8Array(10)), auth: bytesToBase64Url(new Uint8Array(16)) }, 'x', { crypto: nodeCrypto }),
    ).rejects.toThrow(/p256dh/);
    const validPoint = new Uint8Array(65);
    validPoint[0] = 0x04;
    await expect(
      encryptWebPushPayload({ p256dh: bytesToBase64Url(validPoint), auth: bytesToBase64Url(new Uint8Array(3)) }, 'x', { crypto: nodeCrypto }),
    ).rejects.toThrow(/auth/);
  });
});

describe('RFC 8292 VAPID', () => {
  it('signs a JWT the push service can verify', async () => {
    const header = await buildVapidHeader('https://fcm.googleapis.com/fcm/send/abc', vapid, { crypto: nodeCrypto, now: 1_700_000_000_000 });

    const match = header.match(/^vapid t=([^,]+), k=(.+)$/);
    expect(match).toBeTruthy();
    const [headerPart, claimsPart, signaturePart] = (match as RegExpMatchArray)[1].split('.');
    expect(match![2]).toBe(vapid.publicKey);

    const claims = JSON.parse(decoder.decode(base64UrlToBytes(claimsPart)));
    expect(claims.aud).toBe('https://fcm.googleapis.com');
    expect(claims.sub).toBe(vapid.subject);
    expect(claims.exp).toBe(1_700_000_000 + 12 * 60 * 60);

    const publicKey = base64UrlToBytes(vapid.publicKey);
    const verifyKey = await nodeCrypto.subtle.importKey(
      'jwk',
      {
        kty: 'EC', crv: 'P-256', ext: true,
        x: bytesToBase64Url(publicKey.slice(1, 33)),
        y: bytesToBase64Url(publicKey.slice(33, 65)),
      },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const valid = await nodeCrypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      verifyKey,
      base64UrlToBytes(signaturePart),
      encoder.encode(`${headerPart}.${claimsPart}`),
    );
    expect(valid).toBe(true);
  });

  it('generates a usable key pair (the script the operator runs)', async () => {
    const generated = await generateVapidKeys(nodeCrypto);
    expect(base64UrlToBytes(generated.publicKey)).toHaveLength(65);
    expect(base64UrlToBytes(generated.privateKey)).toHaveLength(32);
    await expect(buildVapidHeader('https://push.example.com/x', { ...generated, subject: 'mailto:a@b.c' }, { crypto: nodeCrypto })).resolves.toContain('vapid t=');
  });

  it('explains a mismatched key pair instead of failing opaquely', async () => {
    const other = await generateVapidKeys(nodeCrypto);
    await expect(
      buildVapidHeader('https://fcm.googleapis.com/x', { ...vapid, privateKey: other.privateKey }, { crypto: nodeCrypto }),
    ).rejects.toThrow(/VAPID_PAIR_MISMATCH/);
  });
});

describe('sendWebPush', () => {
  it('posts an aes128gcm body with the VAPID authorization header', async () => {
    const receiver = await makeReceiver();
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;

    const result = await sendWebPush(receiver.subscription, { title: 'Quiz closes soon' }, vapid, {
      crypto: nodeCrypto, fetchImpl, now: 1_700_000_000_000,
    });

    expect(result).toMatchObject({ ok: true, status: 201, expired: false });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(receiver.subscription.endpoint);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['Content-Encoding']).toBe('aes128gcm');
    expect(headers.Authorization).toContain('vapid t=');
    expect(headers.TTL).toBe('3600');
    expect(calls[0].init.body).toBeInstanceOf(Uint8Array);
  });

  it('flags a gone subscription so the dispatcher can prune it', async () => {
    const receiver = await makeReceiver();
    const fetchImpl = (async () => new Response('gone', { status: 410 })) as unknown as typeof fetch;
    const result = await sendWebPush(receiver.subscription, { title: 'x' }, vapid, { crypto: nodeCrypto, fetchImpl });
    expect(result).toMatchObject({ ok: false, status: 410, expired: true });
  });

  it('never throws when the push service is unreachable', async () => {
    const receiver = await makeReceiver();
    const fetchImpl = (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
    const result = await sendWebPush(receiver.subscription, { title: 'x' }, vapid, { crypto: nodeCrypto, fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('ECONNRESET');
  });
});

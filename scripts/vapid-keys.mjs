#!/usr/bin/env node
/**
 * vapid-keys — generate the VAPID keypair background notifications need.
 *
 *   npm run vapid
 *
 * Two values come out, and they always go to different places:
 *
 *   PUBLIC  → the browser subscribes with it. It is public by design (every
 *             PushSubscription echoes it back), so it lives in the app.
 *   PRIVATE → proves to the push service that the sender is us. It is a
 *             server-side SECRET and must never be committed:
 *
 *               supabase secrets set VAPID_PUBLIC_KEY="…" \
 *                                    VAPID_PRIVATE_KEY="…" \
 *                                    VAPID_SUBJECT="mailto:you@example.com"
 *
 * Rotating the pair invalidates every existing subscription, so each student
 * simply re-toggles background notifications once.
 */

import { webcrypto } from 'node:crypto';

const keyPair = await webcrypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify'],
);

const publicBytes = new Uint8Array(await webcrypto.subtle.exportKey('raw', keyPair.publicKey));
const jwk = await webcrypto.subtle.exportKey('jwk', keyPair.privateKey);

const publicKey = Buffer.from(publicBytes).toString('base64url');
const privateKey = Buffer.from(jwk.d, 'base64url').toString('base64url');

console.log('');
console.log('VAPID keys generated (P-256).');
console.log('');
console.log('PUBLIC KEY  → put it in VITE_VAPID_PUBLIC_KEY and rebuild the app:');
console.log('');
console.log(`  VITE_VAPID_PUBLIC_KEY="${publicKey}"`);
console.log('');
console.log('PRIVATE KEY → keep it secret, set it only as an edge-function secret:');
console.log('');
console.log(`  supabase secrets set VAPID_PUBLIC_KEY="${publicKey}" \\`);
console.log(`                       VAPID_PRIVATE_KEY="${privateKey}" \\`);
console.log('                       VAPID_SUBJECT="mailto:you@example.com"');
console.log('');
console.log(`  ${publicBytes.length}-byte public point, ${new Uint8Array(Buffer.from(privateKey, 'base64url')).length}-byte private scalar.`);
console.log('');

/**
 * push-dispatch — Supabase Edge Function (Deno).
 *
 * Sends UltraCC's background notifications: the class reminders and LMS quiz
 * warnings that must arrive even when the browser is closed. It holds no
 * schedule logic of its own — the app uploads a reminder plan (absolute epoch
 * seconds + text) and this function simply claims what is due now and pushes it.
 *
 * RUNTIME:
 *   - Trigger: every minute by pg_cron (installed by migration
 *     20260915000004_push_cron_schedule.sql), or Supabase → Integrations → Cron.
 *   - Authorization (see auth.ts): the platform service-role key, an optional
 *     CRON_SECRET, or — by default — the generated secret held in
 *     public.push_cron_config, which never appears in the repository.
 *   - Every run is recorded so Settings can show whether delivery is actually
 *     alive (`public.push_dispatch_health()`).
 *
 * SECRETS (supabase secrets set …):
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY  — generated once, never rotated per user
 *   VAPID_SUBJECT                        — mailto:you@example.com or an https URL
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — provided by the platform
 *
 * PRIVACY: logs counts and status codes only. Reminder text is the student's
 * own course/quiz titles and never appears in logs or error messages.
 */

import { decideCallerAuth } from './auth.ts';
import { sendWebPush, type PushSubscriptionRecord, type VapidConfig } from './webpush.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

interface Reminder {
  id: string;
  at: number;
  title: string;
  body?: string;
  url?: string;
  tag?: string;
}

interface ClaimedPush {
  deviceCode: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  reminder: Reminder;
}

interface RunOutcome {
  authorized: boolean;
  claimed: number;
  sent: number;
  failed: number;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function envOrNull(name: string): string | null {
  const value = Deno.env.get(name);
  return value && value.trim() ? value.trim() : null;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const vapidPublicKey = envOrNull('VAPID_PUBLIC_KEY');
  const vapidPrivateKey = envOrNull('VAPID_PRIVATE_KEY');
  if (!vapidPublicKey || !vapidPrivateKey) {
    return json({
      error: 'push_not_configured',
      detail: 'Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY as function secrets (see README → Background notifications).',
    }, 503);
  }

  const supabaseUrl = envOrNull('SUPABASE_URL');
  const serviceKey = envOrNull('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return json({ error: 'missing_platform_env' }, 500);
  }

  const serviceHeaders = {
    'Content-Type': 'application/json',
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
  };

  /** Record the run (best effort — health reporting must never break delivery). */
  const recordRun = async (outcome: RunOutcome): Promise<void> => {
    try {
      await fetch(`${supabaseUrl}/rest/v1/rpc/record_push_dispatch_run`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          p_authorized: outcome.authorized,
          p_claimed: outcome.claimed,
          p_sent: outcome.sent,
          p_failed: outcome.failed,
        }),
      });
    } catch {
      /* ignore */
    }
  };

  // --- Authorization --------------------------------------------------------
  const bearer = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '') || null;
  const decision = decideCallerAuth({
    cronSecret: envOrNull('CRON_SECRET'),
    provided: request.headers.get('x-cron-secret'),
    bearer,
    serviceKey,
  });

  let authorized = decision.kind === 'authorized';
  if (decision.kind === 'ask-database') {
    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/rpc/authorize_push_dispatch`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({ p_secret: decision.secret }),
      });
      authorized = response.ok && (await response.json()) === true;
    } catch {
      authorized = false;
    }
  }
  if (!authorized) {
    await recordRun({ authorized: false, claimed: 0, sent: 0, failed: 0 });
    return json({ error: 'unauthorized', detail: decision.kind === 'denied' ? decision.reason : 'Secret does not match.' }, 401);
  }

  const url = new URL(request.url);
  const windowSeconds = Math.min(Math.max(Number(url.searchParams.get('window') ?? 90) || 90, 10), 900);
  const dryRun = url.searchParams.get('dry') === '1';

  let due: ClaimedPush[];
  try {
    const claimResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/claim_due_pushes`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({ p_window_seconds: windowSeconds, p_grace_seconds: 3600 }),
    });
    if (!claimResponse.ok) {
      const detail = await claimResponse.text().catch(() => '');
      console.error('claim_due_pushes failed', claimResponse.status);
      await recordRun({ authorized: true, claimed: 0, sent: 0, failed: 0 });
      return json({ error: 'claim_failed', status: claimResponse.status, detail: detail.slice(0, 200) }, 502);
    }
    due = (await claimResponse.json()) as ClaimedPush[];
  } catch (error) {
    console.error('claim_due_pushes unreachable', error instanceof Error ? error.message : 'unknown');
    await recordRun({ authorized: true, claimed: 0, sent: 0, failed: 0 });
    return json({ error: 'claim_unreachable' }, 502);
  }

  if (dryRun) return json({ due: due.length, dryRun: true });

  const vapid: VapidConfig = {
    publicKey: vapidPublicKey,
    privateKey: vapidPrivateKey,
    subject: envOrNull('VAPID_SUBJECT') ?? 'mailto:admin@example.com',
  };

  let sent = 0;
  let failed = 0;
  const expired: string[] = [];
  const failures: { status: number; error?: string }[] = [];

  for (const item of due) {
    const subscription: PushSubscriptionRecord = {
      endpoint: item.endpoint,
      p256dh: item.p256dh,
      auth: item.auth,
    };
    const reminder = item.reminder ?? ({} as Reminder);
    const result = await sendWebPush(subscription, {
      id: reminder.id,
      title: reminder.title,
      body: reminder.body ?? '',
      url: reminder.url ?? '/?tab=dashboard',
      tag: reminder.tag ?? reminder.id,
    }, vapid);

    if (result.ok) {
      sent += 1;
      continue;
    }
    failed += 1;
    failures.push({ status: result.status, error: result.error });
    // A gone subscription is permanent: forget it so it never blocks the loop.
    if (result.expired) {
      expired.push(item.deviceCode);
      await fetch(`${supabaseUrl}/rest/v1/rpc/delete_push_subscription`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({ p_device_code: item.deviceCode }),
      }).catch(() => undefined);
    }
  }

  await recordRun({ authorized: true, claimed: due.length, sent, failed });

  // Counts only — reminder text stays out of logs.
  return json({ claimed: due.length, sent, failed, expired: expired.length, failures: failures.slice(0, 5) });
});

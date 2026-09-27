/**
 * compute_grade_stats — Supabase Edge Function (Deno)
 *
 * Returns empirical mean (μ) and std dev (σ) for a course's grade
 * submissions when >=15 anonymous submissions exist; otherwise null so the
 * client falls back to the community default estimate.
 *
 * Reads ONLY the grade_stats aggregate view via PostgREST (plain fetch, no
 * npm client). Individual rows are never exposed (RLS denies select on
 * grade_predictions for anon).
 */

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const courseId = url.searchParams.get('courseId') || '';

  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: cors });

  if (!courseId) {
    return new Response(JSON.stringify({ error: 'courseId is required' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: 'Supabase env not configured' }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/grade_stats?course_id=eq.${encodeURIComponent(courseId)}&select=submission_count,mean_total,stddev_total`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    if (!res.ok) throw new Error(`PostgREST ${res.status}`);
    const rows = await res.json() as { submission_count: number; mean_total: number | null; stddev_total: number | null }[];
    const row = rows[0];

    if (!row || !row.submission_count || row.submission_count < 15 || row.mean_total == null || row.stddev_total == null) {
      return new Response(JSON.stringify({ courseId, count: row?.submission_count ?? 0, mu: null, sigma: null }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      courseId,
      count: row.submission_count,
      mu: Number(row.mean_total),
      sigma: Number(row.stddev_total),
    }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[compute_grade_stats] error:', message.substring(0, 200));
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});

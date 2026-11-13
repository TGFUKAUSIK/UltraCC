/**
 * The web app's view of the CAPTCHA solver.
 *
 * The engine itself lives in `supabase/functions/vtop-gateway/captchaTemplate.ts`,
 * because that is the copy that has to be inside the edge function's upload
 * directory — Supabase ships `supabase/functions/<name>/` and nothing else, so
 * a shared module cannot live under `src/`. Vite resolves the path below just
 * fine, which means there is ONE implementation: the browser template solver
 * and the server-side one cannot drift apart, and a fix to the geometry or the
 * weights lands for both clients at once.
 *
 * What the two clients then differ in is only how the CAPTCHA reaches pixels:
 * the browser paints the data URI onto a canvas (`loadImageToPixels`, exported
 * from the shared module), the gateway decodes the JPEG with its own client.
 */

export * from '../../../supabase/functions/vtop-gateway/captchaTemplate';

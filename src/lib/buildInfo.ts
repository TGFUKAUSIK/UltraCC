/**
 * Short identifier of the frontend build running in this tab. On Vercel this is
 * the deployed commit SHA (VITE_VERCEL_GIT_COMMIT_SHA); locally it is 'dev'.
 *
 * Its only job is the service-worker registration query in main.tsx, so every
 * deploy gets a fresh worker. It is not shown in the UI — a commit SHA means
 * nothing to a student. The dev console in main.tsx logs the same `?v=<BUILD_ID>`.
 */
export const BUILD_ID: string =
  ((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 8) ||
  'dev';

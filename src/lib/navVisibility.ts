/**
 * Which destinations normal navigation offers.
 *
 * UltraCC withdraws a feature from sight without deleting it by listing its tab
 * id here. The route, view, gateway target, parser, cache and tests all stay in
 * the build — a student who already knows the deep link (`?tab=syllabus`) still
 * lands on the real page — but the rail, the services / "More" menu, Student
 * Tools and ⌘K stop pointing at it. Removing the id from the set brings the
 * navigation back with no other edit; that is the whole point of a flag instead
 * of deleted JSX.
 *
 * SYLLABUS: withdrawn on 2026-09-21 while VTOP's own course-file source is
 * settled. It is a temporary product decision, not a code removal.
 */
export const NAV_HIDDEN_TABS: ReadonlySet<string> = new Set(['syllabus']);

/** True when a destination must not appear in navigation. */
export function isNavHidden(tab: string): boolean {
  return NAV_HIDDEN_TABS.has(tab);
}

// ---------------------------------------------------------------------------
// Feature modes — minimal vs complete
// ---------------------------------------------------------------------------

/** How much of UltraCC the navigation offers. */
export type FeatureMode = 'minimal' | 'complete';

/**
 * Destinations that stay visible in minimal mode — the daily essentials a
 * student actually reaches on a phone between classes. 'settings' is not a
 * destination but must stay reachable (it is the only way back to complete
 * mode on mobile, where the rail that carries the Settings button is hidden).
 */
export const MINIMAL_TABS: ReadonlySet<string> = new Set([
  'dashboard', 'timetable', 'academics', 'exams', 'grades', 'settings',
]);

/**
 * Navigation visibility under a chosen feature mode. Complete mode shows every
 * destination except those withdrawn by NAV_HIDDEN_TABS; minimal mode shows
 * only the daily essentials. Deep links still land on hidden pages — this is a
 * preference about what the nav points at, not a hard block.
 */
export function isNavHiddenInMode(tab: string, mode: FeatureMode): boolean {
  if (isNavHidden(tab)) return true;
  return mode === 'minimal' && !MINIMAL_TABS.has(tab);
}

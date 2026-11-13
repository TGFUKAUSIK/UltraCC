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
 * Destinations that stay visible in minimal mode.
 *
 * Five, in the order a student reaches for them: the Dashboard ('dashboard',
 * the same home complete mode opens on), Attendance ('academics'), Marks &
 * Grades ('grades'), the proctor ('faculty') and Settings. 'settings' is not a
 * route — it is a sheet — but it has to be in the set because it is the only
 * way back to complete mode once the rail, the tab bar and the services sheet
 * have all narrowed to the others.
 *
 * Five and not four is deliberate, and it is the phone tab bar's own number:
 * the bar lays its destinations out as a full-width row, so a set of four left
 * a hole where the fifth column was and read as a broken bar rather than as a
 * smaller app. Minimal mode is the same app with fewer rooms — it keeps the
 * room the student starts their day in — so the bar looks like a bar.
 *
 * The labels are the services-menu ones, so this set and the navigation can
 * never drift: Attendance is the 'academics' route, Marks & Grades is 'grades',
 * and the proctor lives on the 'faculty' route beside the course teachers.
 */
export const MINIMAL_TABS: ReadonlySet<string> = new Set([
  'dashboard', 'academics', 'grades', 'faculty', 'settings',
]);

/** Where minimal mode lands: the Dashboard — the screen every mode opens on, so
 *  flipping the mode never moves a student off their home screen, and a deep
 *  link to a room the mode does not have lands somewhere they can act from. */
export const MINIMAL_LANDING = 'dashboard';

/**
 * Navigation visibility under a chosen feature mode. Complete mode shows every
 * destination except those withdrawn by NAV_HIDDEN_TABS; minimal mode shows
 * only the five destinations above.
 *
 * In complete mode this stays a preference about what the nav *points at* —
 * deep links still land on withdrawn pages like 'syllabus'. Minimal mode is
 * stricter on purpose: a screen the navigation no longer offers must not be
 * reachable by URL either, or the mode would be a coat of paint.
 */
export function isNavHiddenInMode(tab: string, mode: FeatureMode): boolean {
  if (isNavHidden(tab)) return true;
  return mode === 'minimal' && !MINIMAL_TABS.has(tab);
}

/**
 * The destination a tab resolves to under a mode — the one rule behind both the
 * landing screen and the deep-link redirect, so a shared `?tab=qbank` link and a
 * cold start on the last-visited tab can never disagree about where a minimal
 * student ends up. Complete mode resolves to the tab itself, unchanged.
 */
export function resolveTabForMode(tab: string, mode: FeatureMode): string {
  if (mode !== 'minimal') return tab;
  return isNavHiddenInMode(tab, mode) ? MINIMAL_LANDING : tab;
}

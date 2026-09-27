/**
 * UltraCC LMS (Moodle lms.vit.ac.in) types — normalized client-side models
 * produced by the lms-gateway Edge Function parsers.
 *
 * Never fabricated: absent fields stay null/'' and the UI renders honest
 * "not available" states instead of fake defaults.
 */

export interface LmsCourse {
  courseId: number;
  name: string;
  shortName: string;
  url: string;
}

export interface LmsAssignment {
  assignmentId: number;
  name: string;
  /** ISO-8601 due instant (or null when VTOP/LMS shows no due date). */
  dueDate: string | null;
  url: string;
  /** Owner course — added when persisted to IndexedDB. */
  courseId?: number;
}

export interface LmsQuizWindow {
  quizId: number;
  name: string;
  /** ISO-8601 open instant — feeds the quiz-window notifications. */
  openTime: string | null;
  /** ISO-8601 close instant — feeds the quiz-window notifications. */
  closeTime: string | null;
  attemptLimit: number | null;
  timeLimitMins: number | null;
  submissionStatus: string | null;
  url: string;
  /** Owner course — added when persisted to IndexedDB. */
  courseId?: number;
}

export interface LmsGradeItem {
  itemName: string;
  itemType: 'assignment' | 'quiz' | 'manual' | 'unknown';
  score: number | null;
  maxScore: number | null;
  percentage: number | null;
  feedback: string | null;
}

export interface LmsMaterial {
  materialId: number;
  name: string;
  fileType: string | null;
  downloadUrl: string | null;
  postedDate: string | null;
  /** Owner course — added when persisted to IndexedDB. */
  courseId?: number;
}

export interface LmsForumPost {
  postId: number;
  title: string;
  author: string;
  postedDate: string | null;
  bodyText: string;
}

export interface LmsCalendarEvent {
  eventId: number;
  name: string;
  eventType: 'course' | 'user' | 'site' | 'unknown';
  courseId: number | null;
  date: string | null;
}

/** Per-course LMS bundle (all course-scoped datasets fetched together). */
export interface LmsCourseData {
  courseId: number;
  assignments: LmsAssignment[];
  quizzes: LmsQuizWindow[];
  gradebook: LmsGradeItem[];
  materials: LmsMaterial[];
  forum: LmsForumPost[];
  /** ISO timestamp of the last successful course sync. */
  syncedAt: string;
}

/** One dataset's outcome — mirrors SyncDatasetResult in syncSemester. */
export interface LmsSyncDatasetResult {
  key: string;
  label: string;
  ok: boolean;
  error?: string;
}

export interface LmsSyncMetadata {
  /** Last run that returned at least one usable LMS dataset. */
  lastSyncedAt: number;
  /** Last time a sync was attempted, including failed/partial runs. */
  lastAttemptedAt?: number;
  /** Explicit state for honest offline/stale/partial UI. */
  lastSyncStatus?: 'synced' | 'partial' | 'failed';
  /** Username hash (first 4 chars) — never the full username in logs/UI. */
  usernameHint: string;
  coursesSynced: number;
}

/** A notification trigger we have already fired (prevents duplicates). */
export interface QuizNotificationRecord {
  id: string; // `${quizId}:${triggerKey}`
  quizId: number;
  triggerKey: 'opened' | 'close-15min' | 'close-5min';
  firedAt: number;
}

/** Offline-cached material blob metadata. */
export interface CachedMaterial {
  materialId: number;
  courseId: number;
  fileName: string;
  sizeBytes: number;
  blob: Blob;
  cachedAt: number;
}

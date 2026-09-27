/**
 * syllabusDiagnostics — the reader for the gateway's structured failure fields.
 *
 * The point of these tests: the line a developer captures names the failing
 * STAGE, and nothing else can get into it. A malformed, hostile or outdated
 * response must degrade to "no stage" or "UNKNOWN_REASON" — never to free text,
 * a course code, a cookie or a status line.
 */

import { describe, it, expect } from 'vitest';
import {
  syllabusFailureInfo,
  syllabusFailureLine,
  SYLLABUS_FAILURE_STAGES,
} from '../syllabusDiagnostics';

describe('syllabusFailureInfo', () => {
  it('reads the gateway’s stage, reason and status', () => {
    expect(syllabusFailureInfo({
      syllabusStage: 'COURSE', syllabusReason: 'COURSE_NOT_FOUND', syllabusStatus: 200,
    })).toEqual({ stage: 'COURSE', reason: 'COURSE_NOT_FOUND', status: 200 });
  });

  it('accepts every stage the brief names, and drops anything else', () => {
    for (const stage of SYLLABUS_FAILURE_STAGES) {
      expect(syllabusFailureInfo({ syllabusStage: stage, syllabusReason: 'X' })?.stage).toBe(stage);
    }
    // A success, an older gateway, a typo or an injection attempt: no stage.
    expect(syllabusFailureInfo({})).toBeNull();
    expect(syllabusFailureInfo({ syllabusStage: 'COURSEISH' })).toBeNull();
    expect(syllabusFailureInfo({ syllabusStage: '<script>' })).toBeNull();
    expect(syllabusFailureInfo({ syllabusStage: 42 })).toBeNull();
    expect(syllabusFailureInfo(null)).toBeNull();
    expect(syllabusFailureInfo(undefined)).toBeNull();
  });

  it('degrades a malformed reason to UNKNOWN_REASON instead of printing it', () => {
    expect(syllabusFailureInfo({ syllabusStage: 'COURSE', syllabusReason: 'cookie JSESSIONID=abc' }))
      .toEqual({ stage: 'COURSE', reason: 'UNKNOWN_REASON' });
    expect(syllabusFailureInfo({ syllabusStage: 'COURSE', syllabusReason: 'lower_case' }))
      .toEqual({ stage: 'COURSE', reason: 'UNKNOWN_REASON' });
    expect(syllabusFailureInfo({ syllabusStage: 'COURSE', syllabusReason: 'x'.repeat(41) }))
      .toEqual({ stage: 'COURSE', reason: 'UNKNOWN_REASON' });
    expect(syllabusFailureInfo({ syllabusStage: 'COURSE' }))
      .toEqual({ stage: 'COURSE', reason: 'UNKNOWN_REASON' });
  });

  it('keeps a real HTTP status and drops anything that is not one', () => {
    expect(syllabusFailureInfo({ syllabusStage: 'SLOT', syllabusReason: 'R', syllabusStatus: 404 })?.status).toBe(404);
    // 0 means "no status answered"; a non-integer or out-of-range value is not
    // a status anyone can look up, so it is omitted rather than printed.
    for (const bad of [0, 99, 600, 200.5, '200', null, NaN, Infinity]) {
      expect(syllabusFailureInfo({ syllabusStage: 'SLOT', syllabusReason: 'R', syllabusStatus: bad }))
        .toEqual({ stage: 'SLOT', reason: 'R' });
    }
  });
});

describe('syllabusFailureLine', () => {
  it('is one fixed-shape line', () => {
    expect(syllabusFailureLine({ stage: 'DETAIL', reason: 'SYLLABUS_ACTION_NOT_FOUND', status: 200 }))
      .toBe('stage=DETAIL reason=SYLLABUS_ACTION_NOT_FOUND status=200');
    expect(syllabusFailureLine({ stage: 'SESSION', reason: 'SESSION_EXPIRED' }))
      .toBe('stage=SESSION reason=SESSION_EXPIRED');
  });

  it('carries nothing but the three fields', () => {
    const line = syllabusFailureLine(syllabusFailureInfo({
      syllabusStage: 'UPSTREAM', syllabusReason: 'COURSE_PAGE_ROUTE_NOT_FOUND', syllabusStatus: 404,
    })!);
    expect(line).toMatch(/^stage=[A-Z]+ reason=[A-Z0-9_]+ status=\d+$/);
    expect(line).not.toContain('<');
    expect(line).not.toContain('://');
  });
});

/**
 * lms-gateway parser tests — the strict Moodle parsers in parsers.ts.
 * Run against realistic Moodle 3.x HTML shapes (as served by lms.vit.ac.in).
 *
 * Structural mismatches must THROW ParseError (the gateway answers
 * PARSE_FAILED) instead of silently returning empty/fabricated data; pages
 * that explicitly say "no data" are legitimate empty states -> [].
 */

import { describe, it, expect } from 'vitest';
import {
  ParseError,
  extractLogintoken,
  parseMoodleDate,
  parseCourses,
  parseAssignments,
  parseQuizList,
  parseQuizWindow,
  parseGradebook,
  parseMaterials,
  parseForumPosts,
  parseCalendarEvents,
  isLoginPage,
} from './parsers';

const LOGIN_PAGE = `<html><body>
<form class="login-form" action="https://lms.vit.ac.in/login/index.php" method="post" id="login">
  <input type="hidden" name="logintoken" value="iKQVlRqsYJF1JKOa7EIlQsjhwBEzHYJm">
  <input type="text" name="username" id="username" class="form-control form-control-lg" value="" placeholder="Username">
  <input type="password" name="password" id="password" value="" class="form-control form-control-lg" placeholder="Password">
  <button type="submit">Log in</button>
</form>
</body></html>`;

describe('lms login parsing', () => {
  it('extracts the logintoken CSRF', () => {
    expect(extractLogintoken(LOGIN_PAGE)).toBe('iKQVlRqsYJF1JKOa7EIlQsjhwBEzHYJm');
  });

  it('detects a login page (and session expiry)', () => {
    expect(isLoginPage(LOGIN_PAGE)).toBe(true);
    expect(isLoginPage('<html><body><div id="page">my courses</div></body></html>', 'https://lms.vit.ac.in/my/')).toBe(false);
    expect(isLoginPage('<html><body>x</body></html>', 'https://lms.vit.ac.in/login/index.php')).toBe(true);
  });

  it('returns empty when the login page has no logintoken', () => {
    expect(extractLogintoken('<html><body>no form</body></html>')).toBe('');
  });
});

describe('parseMoodleDate', () => {
  it('parses the long Moodle date format with year', () => {
    const iso = parseMoodleDate('Tuesday, 25 August 2026, 10:00 AM');
    expect(iso).not.toBeNull();
    // 10:00 IST == 04:30 UTC
    expect(new Date(iso!).toISOString()).toBe('2026-08-25T04:30:00.000Z');
  });

  it('parses PM times correctly', () => {
    const iso = parseMoodleDate('Tuesday, 25 August 2026, 11:59 PM');
    expect(new Date(iso!).toISOString()).toBe('2026-08-25T18:29:00.000Z');
  });

  it('parses year-less dates (calendar page) into the near future', () => {
    const iso = parseMoodleDate('25 August, 10:00 AM');
    if (iso) {
      const d = new Date(iso).getTime();
      expect(d).toBeGreaterThan(Date.now() - 40 * 24 * 3600 * 1000);
      expect(d).toBeLessThan(Date.now() + 400 * 24 * 3600 * 1000);
    }
  });

  it('returns null for garbage', () => {
    expect(parseMoodleDate('not a date')).toBeNull();
    expect(parseMoodleDate('')).toBeNull();
  });
});

describe('parseCourses', () => {
  const DASHBOARD = `<html><body>
<div id="page">
  <div class="course_box" data-course-id="101">
    <a href="https://lms.vit.ac.in/course/view.php?id=101"><div class="coursename">Probability and Statistics</div></a>
  </div>
  <div class="course_box" data-course-id="102">
    <a href="https://lms.vit.ac.in/course/view.php?id=102"><div class="coursename">Operating Systems</div></a>
  </div>
  <div class="course_box" data-course-id="101">
    <a href="https://lms.vit.ac.in/course/view.php?id=101"><div class="coursename">Probability and Statistics</div></a>
  </div>
</div>
</body></html>`;

  it('parses enrolled courses and dedupes by id', () => {
    const courses = parseCourses(DASHBOARD);
    expect(courses).toHaveLength(2);
    expect(courses[0].courseId).toBe(101);
    expect(courses[0].name).toContain('Probability');
    expect(courses[1].name).toContain('Operating Systems');
  });

  it('throws ParseError on a structural mismatch (no course links)', () => {
    expect(() => parseCourses('<html><body><div>weird page</div></body></html>')).toThrow(ParseError);
  });

  it('returns [] for the no-courses empty state', () => {
    expect(parseCourses('<html><body>You are not enrolled in any courses</body></html>')).toEqual([]);
  });
});

describe('parseAssignments', () => {
  const ASSIGN_INDEX = `<html><body>
<h2>Assignments</h2>
<table class="generaltable mod_index">
  <thead><tr><th>Assignment</th><th>Due date</th></tr></thead>
  <tbody>
    <tr class=""><td class="cell c0"><a href="https://lms.vit.ac.in/mod/assign/view.php?id=456">DA Round 1</a></td>
      <td class="cell c1">Tuesday, 25 August 2026, 11:59 PM</td></tr>
    <tr class=""><td class="cell c0"><a href="https://lms.vit.ac.in/mod/assign/view.php?id=457">Weekly Problem Set 3</a></td>
      <td class="cell c1">Friday, 4 September 2026, 11:59 PM</td></tr>
  </tbody>
</table>
</body></html>`;

  it('parses assignments with due dates', () => {
    const rows = parseAssignments(ASSIGN_INDEX);
    expect(rows).toHaveLength(2);
    expect(rows[0].assignmentId).toBe(456);
    expect(rows[0].name).toBe('DA Round 1');
    expect(rows[0].dueDate).not.toBeNull();
    expect(new Date(rows[0].dueDate!).toISOString()).toBe('2026-08-25T18:29:00.000Z');
    expect(rows[1].name).toBe('Weekly Problem Set 3');
  });

  it('handles a missing due date cell (null, never fabricated)', () => {
    const html = `<html><body><table class="generaltable mod_index"><tbody>
      <tr><td class="cell c0"><a href="https://lms.vit.ac.in/mod/assign/view.php?id=458">No due date</a></td><td class="cell c1">N/A</td></tr>
    </tbody></table></body></html>`;
    const rows = parseAssignments(html);
    expect(rows).toHaveLength(1);
    expect(rows[0].dueDate).toBeNull();
  });

  it('throws on structural mismatch', () => {
    expect(() => parseAssignments('<html><body>no table here</body></html>')).toThrow(ParseError);
  });
});

describe('parseQuizList + parseQuizWindow', () => {
  const QUIZ_INDEX = `<html><body>
<h2>Quizzes</h2>
<table class="generaltable">
  <tbody>
    <tr class=""><td class="cell c0"><a href="https://lms.vit.ac.in/mod/quiz/view.php?id=789">Unit 1 Quiz</a></td></tr>
    <tr class=""><td class="cell c0"><a href="https://lms.vit.ac.in/mod/quiz/view.php?id=790">Unit 2 Quiz</a></td></tr>
  </tbody>
</table>
</body></html>`;

  it('parses the quiz index', () => {
    const quizzes = parseQuizList(QUIZ_INDEX);
    expect(quizzes).toHaveLength(2);
    expect(quizzes[0].quizId).toBe(789);
    expect(quizzes[0].name).toBe('Unit 1 Quiz');
  });

  it('parses a quiz view page with open/close windows', () => {
    const QUIZ_VIEW = `<html><body>
<div class="quizinfo">
  <h2>Unit 1 Quiz</h2>
  <table class="generaltable quizreviewsummary">
    <tr><th class="cell">Opens</th><td class="cell">Tuesday, 25 August 2026, 10:00 AM</td></tr>
    <tr><th class="cell">Closes</th><td class="cell">Tuesday, 25 August 2026, 10:30 AM</td></tr>
    <tr><th class="cell">Time limit</th><td class="cell">30 mins</td></tr>
    <tr><th class="cell">Attempts allowed</th><td class="cell">2</td></tr>
  </table>
</div>
</body></html>`;
    const w = parseQuizWindow(QUIZ_VIEW, { quizId: 789, name: 'Unit 1 Quiz', url: 'https://lms.vit.ac.in/mod/quiz/view.php?id=789' });
    expect(w.openTime).not.toBeNull();
    expect(w.closeTime).not.toBeNull();
    expect(new Date(w.openTime!).toISOString()).toBe('2026-08-25T04:30:00.000Z');
    expect(new Date(w.closeTime!).toISOString()).toBe('2026-08-25T05:00:00.000Z');
    expect(w.timeLimitMins).toBe(30);
    expect(w.attemptLimit).toBe(2);
  });

  it('keeps timings null when the summary table is absent (never fabricated)', () => {
    const w = parseQuizWindow('<html><body>quiz no summary</body></html>', { quizId: 1, name: 'Q', url: 'u' });
    expect(w.openTime).toBeNull();
    expect(w.closeTime).toBeNull();
  });
});

describe('parseGradebook', () => {
  const GRADEBOOK = `<html><body>
<h1>User report</h1>
<table class="generaltable boxaligncenter">
  <tr class="heading"><th>Grade item</th><th>Grade</th><th>Range</th><th>Percentage</th><th>Feedback</th></tr>
  <tr class=""><td class="cell c0">Assignment 1</td><td class="cell c1">8.00</td><td class="cell c2">0–10</td><td class="cell c3">80.00 %</td><td class="cell c4">Good work</td></tr>
  <tr class=""><td class="cell c0">Quiz 1</td><td class="cell c1">18.00</td><td class="cell c2">0-20</td><td class="cell c3">90.00 %</td><td class="cell c4"></td></tr>
  <tr class=""><td class="cell c0">CAT 1</td><td class="cell c1">-</td><td class="cell c2">0–50</td><td class="cell c3">-</td><td class="cell c4"></td></tr>
</table>
</body></html>`;

  it('parses grade items with scores and ranges', () => {
    const items = parseGradebook(GRADEBOOK);
    expect(items).toHaveLength(3);
    expect(items[0].itemName).toBe('Assignment 1');
    expect(items[0].score).toBe(8);
    expect(items[0].maxScore).toBe(10);
    expect(items[0].percentage).toBe(80);
    expect(items[0].feedback).toBe('Good work');
    expect(items[1].itemType).toBe('quiz');
    expect(items[2].score).toBeNull(); // ungraded -> null, never 0
    expect(items[2].maxScore).toBe(50);
  });

  it('throws on structural mismatch', () => {
    expect(() => parseGradebook('<html><body>nothing</body></html>')).toThrow(ParseError);
  });
});

describe('parseMaterials', () => {
  const COURSE_PAGE = `<html><body>
<div id="page">
  <div class="course-content">
    <div class="section">
      <ul class="section img-text">
        <li class="activity modtype_resource modtype_ assign" id="module-501">
          <div class="activityinstance"><a href="https://lms.vit.ac.in/pluginfile.php/123/mod_resource/content/1/lecture1.pdf">
            <span class="instancename">Lecture 1 - Intro to OS.pdf</span></a></div>
        </li>
        <li class="activity modtype_folder" id="module-502">
          <div class="activityinstance"><a href="https://lms.vit.ac.in/mod/folder/view.php?id=502">
            <span class="instancename">Week 2 Resources</span></a></div>
        </li>
        <li class="activity modtype_quiz" id="module-503">
          <div class="activityinstance"><a href="https://lms.vit.ac.in/mod/quiz/view.php?id=789">
            <span class="instancename">Unit 1 Quiz</span></a></div>
        </li>
      </ul>
    </div>
  </div>
</div>
</body></html>`;

  it('extracts downloadable materials and skips non-file activities', () => {
    const mats = parseMaterials(COURSE_PAGE);
    expect(mats).toHaveLength(2);
    expect(mats[0].materialId).toBe(501);
    expect(mats[0].name).toContain('Lecture 1');
    expect(mats[0].downloadUrl).toContain('pluginfile.php');
    expect(mats[1].name).toContain('Week 2');
    expect(mats[1].fileType).toBe('folder');
  });

  it('returns [] for a course with no file activities', () => {
    const onlyQuizzes = `<html><body><div id="page"><div class="course-content">
      <ul><li class="activity modtype_quiz" id="module-9"><a href="https://lms.vit.ac.in/mod/quiz/view.php?id=9"><span class="instancename">Q</span></a></li></ul>
    </div></div></body></html>`;
    expect(parseMaterials(onlyQuizzes)).toEqual([]);
  });
});

describe('parseForumPosts', () => {
  const FORUM = `<html><body>
<div id="page">
  <article class="forumpost clearfix well firstpost starter" data-post-id="701">
    <div class="row header">
      <div class="topic starter">
        <div class="subject"><a href="https://lms.vit.ac.in/mod/forum/discuss.php?d=60">Welcome to the course</a></div>
        <div class="author">By <a href="#">Prof. Meena</a> - <span class="time">Tue, 25 Aug 2026, 10:00 AM</span></div>
      </div>
    </div>
    <div class="content">
      <div class="posting fullpost"><p>Please read the syllabus before the first class.</p></div>
    </div>
  </article>
  <article class="forumpost clearfix well" data-post-id="702">
    <div class="row header">
      <div class="topic">
        <div class="subject"><a href="https://lms.vit.ac.in/mod/forum/discuss.php?d=61">Assignment 1 is live</a></div>
        <div class="author">By <a href="#">Prof. Meena</a> - <span class="time">Wed, 26 Aug 2026, 2:00 PM</span></div>
      </div>
    </div>
    <div class="content">
      <div class="posting fullpost"><p>Submit by Friday night.</p></div>
    </div>
  </article>
</div>
</body></html>`;

  it('parses forum posts with title/author/date/body', () => {
    const posts = parseForumPosts(FORUM);
    expect(posts).toHaveLength(2);
    expect(posts[0].postId).toBe(701);
    expect(posts[0].title).toBe('Welcome to the course');
    expect(posts[0].author).toContain('Prof. Meena');
    expect(posts[0].postedDate).not.toBeNull();
    expect(posts[0].bodyText).toContain('syllabus');
  });

  it('throws on structural mismatch', () => {
    expect(() => parseForumPosts('<html><body>no forum</body></html>')).toThrow(ParseError);
  });
});

describe('parseCalendarEvents', () => {
  const CALENDAR = `<html><body>
<div id="page">
  <ul class="eventlist">
    <li class="event" data-eventtype-course="1">
      <div class="date">Tuesday, 25 August</div>
      <div class="name"><a href="https://lms.vit.ac.in/calendar/view.php?view=day&amp;time=123">Assignment 1 due</a></div>
      <div class="time">11:55 PM</div>
      <div class="course">OS</div>
    </li>
    <li class="event" data-eventtype-course="1">
      <div class="date">Friday, 4 September</div>
      <div class="name"><a href="https://lms.vit.ac.in/calendar/view.php?view=day&amp;time=456">Quiz 1 opens</a></div>
      <div class="time">10:00 AM</div>
      <div class="course">Stats</div>
    </li>
  </ul>
</div>
</body></html>`;

  it('parses calendar events with dates', () => {
    const events = parseCalendarEvents(CALENDAR);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].name).toBe('Assignment 1 due');
    expect(events[0].eventType).toBe('course');
    expect(events[0].date).not.toBeNull();
  });

  it('returns [] for the no-events empty state', () => {
    expect(parseCalendarEvents('<html><body><div>There are no upcoming events</div></body></html>')).toEqual([]);
  });
});

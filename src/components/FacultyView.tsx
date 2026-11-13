import React, { useMemo, useState } from 'react';
import { StudentProfile, TimetableSlot, AttendanceRecord } from '../types';
import { Search, ExternalLink, School, BookOpen } from 'lucide-react';
import { ProctorPerson } from './ProctorPerson';
import { isReal } from '../utils/placeholders';

interface FacultyViewProps {
  student: StudentProfile;
  timetable: TimetableSlot[];
  /** Attendance records carry real faculty names even when the cached timetable predates them. */
  attendance: AttendanceRecord[];
}

/** Official VIT Chennai faculty directory — school-wise pages (verified 2026). */
const DIRECTORY_LINKS: { label: string; sub: string; url: string }[] = [
  { label: 'All Faculty', sub: 'Master directory', url: 'https://chennai.vit.ac.in/faculty/' },
  { label: 'SCOPE', sub: 'Computer Science & Engineering', url: 'https://chennai.vit.ac.in/school-of-computer-science-and-engineering-scope-2/scope-faculty/' },
  { label: 'SELECT', sub: 'Electrical Engineering', url: 'https://chennai.vit.ac.in/school-of-electrical-engineering-select/select-faculty/' },
  { label: 'SENSE', sub: 'Electronics Engineering', url: 'https://chennai.vit.ac.in/school-of-electronics-engineering-sense/sense-faculty/' },
  { label: 'SMEC', sub: 'Mechanical Engineering', url: 'https://chennai.vit.ac.in/school-of-mechanical-engineering-smec/smec-faculty/' },
  { label: 'SAS', sub: 'Maths · Physics · Chemistry', url: 'https://chennai.vit.ac.in/school-of-advanced-sciences-sas/' },
  { label: 'SBST', sub: 'Bio Sciences & Technology', url: 'https://chennai.vit.ac.in/school-of-bio-sciences-and-technology-sbst/sbst-faculty/' },
  { label: 'SSL', sub: 'Social Sciences & Languages', url: 'https://chennai.vit.ac.in/school-of-social-sciences-and-languages-ssl/' },
  { label: 'SCE', sub: 'Civil Engineering', url: 'https://chennai.vit.ac.in/school-of-civil-engineering-sce/' },
  { label: 'V-FIT', sub: 'Fashion & Apparel Technology', url: 'https://chennai.vit.ac.in/school-of-electrical-engineering-select/vfit-faculty/' },
];

interface CourseFaculty {
  courseCode: string;
  courseTitle: string;
  slots: string[];
  faculty: string;
  venue: string;
}

/**
 * FacultyView — the student's own proctor, this semester's teaching faculty,
 * and the official VIT Chennai directory. Presented as a ledger of records
 * rather than a card wall, in the shared directory language.
 */
export const FacultyView: React.FC<FacultyViewProps> = ({ student, timetable, attendance }) => {
  const [query, setQuery] = useState('');

  // Faculty by course from the attendance dataset (real VTOP names) — used as
  // a fallback when the cached timetable rows predate the faculty fix.
  const attendanceFaculty = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of attendance) {
      if (a.facultyName && !map.has(a.courseCode)) map.set(a.courseCode, a.facultyName);
    }
    return map;
  }, [attendance]);

  // Unique course → faculty mapping from the synced timetable (real VTOP data).
  const courses = useMemo<CourseFaculty[]>(() => {
    const byCode = new Map<string, CourseFaculty>();
    for (const t of timetable) {
      const existing = byCode.get(t.courseCode);
      if (existing) {
        if (!existing.slots.includes(t.slot)) existing.slots.push(t.slot);
        if (!existing.faculty && t.facultyName) existing.faculty = t.facultyName;
        if (!existing.venue && t.venue) existing.venue = t.venue;
      } else {
        byCode.set(t.courseCode, {
          courseCode: t.courseCode,
          courseTitle: t.courseTitle || t.courseCode,
          slots: t.slot ? [t.slot] : [],
          faculty: t.facultyName || '',
          venue: t.venue || '',
        });
      }
    }
    // Fallback: attendance-record faculty for courses whose timetable row has none.
    for (const [code, name] of attendanceFaculty) {
      const entry = byCode.get(code);
      if (entry && !entry.faculty) entry.faculty = name;
    }
    return Array.from(byCode.values()).sort((a, b) => a.courseCode.localeCompare(b.courseCode));
  }, [timetable, attendanceFaculty]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return courses;
    return courses.filter(
      (c) =>
        c.faculty.toLowerCase().includes(q) ||
        c.courseCode.toLowerCase().includes(q) ||
        c.courseTitle.toLowerCase().includes(q)
    );
  }, [courses, query]);

  const facultyNames = useMemo(() => {
    const names = new Set(courses.map((c) => c.faculty).filter(Boolean));
    return Array.from(names).sort();
  }, [courses]);

  return (
    <div className="uc-dir-view pb-12">
      {/* Mast */}
      <div className="uc-plate uc-dir-mast">
        <div className="uc-dir-head">
          <div className="uc-dir-id">
            <span className="uc-cap">VIT Chennai</span>
            <h2 className="uc-dir-name">Faculty &amp; proctor</h2>
            <p className="uc-note">
              Your proctor from VTOP, this semester's faculty from your synced timetable, and the official VIT Chennai faculty directory.
            </p>
          </div>
        </div>
      </div>

      {/* Proctor */}
      <div className="uc-plate">
        <div className="uc-plate-head">
          <span className="uc-cap">My proctor</span>
          {student.proctorAvailable && isReal(student.proctorName) && <span className="uc-dir-tag is-good">Assigned</span>}
        </div>
        {student.proctorAvailable && isReal(student.proctorName) ? (
          <ProctorPerson name={student.proctorName.trim()} contact={student.proctorContact} />
        ) : (
          <div className="uc-dir-detail">
            <div className="uc-note-row">
              <BookOpen />
              <span>
                Proctor not available from VTOP{student.regNo ? ' for your profile' : ''}. Your proctor is assigned by the school, so nothing is missing on your side — re-sync your profile from <b>Login</b> and it will appear once VTOP lists it.
              </span>
            </div>
          </div>
        )}
      </div>

      {/* My faculty this semester */}
      <div className="uc-plate">
        <div className="uc-plate-head">
          <span className="uc-cap">My faculty this semester</span>
          <span className="uc-dir-count">
            {courses.length} course{courses.length === 1 ? '' : 's'} · {facultyNames.length} facult{facultyNames.length === 1 ? 'y' : 'ies'}
          </span>
        </div>
        <div className="uc-dir-tools">
          <div className="uc-dir-search">
            <Search />
            <input
              aria-label="Search faculty or course"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search faculty or course…"
            />
          </div>
        </div>
        {filtered.length > 0 ? (
          <div className="uc-courses">
            {filtered.map((c) => {
              const venue = isReal(c.venue) ? c.venue.trim() : '';
              return (
                <div key={c.courseCode} className="uc-course uc-course--static">
                  <span className="uc-course-head">
                    <span>{c.courseCode}</span>
                    {c.slots.length > 0 && <b>{c.slots.join(' · ')}</b>}
                  </span>
                  <strong>{c.courseTitle}</strong>
                  <small>{isReal(c.faculty) ? c.faculty : 'Faculty not provided by VTOP'}</small>
                  {venue && (
                    <span className="uc-course-split">
                      <span>Room <b>{venue}</b></span>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="uc-empty">
            <span>
              {query
                ? `No course or faculty matches “${query.trim()}”.`
                : 'No timetable synced yet — sign in to VTOP and sync to see your faculty for this semester.'}
            </span>
          </div>
        )}
      </div>

      {/* Official directory */}
      <div className="uc-plate uc-dir-ledger">
        <div className="uc-plate-head">
          <span className="uc-cap">Official VIT Chennai faculty pages</span>
          <span className="uc-dir-count">{DIRECTORY_LINKS.length} schools</span>
        </div>
        {DIRECTORY_LINKS.map((link) => (
          <a
            key={link.url}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="uc-dir-row uc-dir-row--acts"
          >
            <span className="uc-dir-tile"><School /></span>
            <span className="uc-dir-main">
              <span className="uc-dir-title">{link.label}</span>
              <span className="uc-dir-meta">{link.sub}</span>
            </span>
            <span className="uc-dir-acts">
              <span className="uc-dir-go">Open <ExternalLink className="h-3.5 w-3.5" /></span>
            </span>
          </a>
        ))}
        <div className="uc-plate-foot">
          <span>Names on this page come from your synced VTOP timetable; the links open the official chennai.vit.ac.in source.</span>
        </div>
      </div>
    </div>
  );
};

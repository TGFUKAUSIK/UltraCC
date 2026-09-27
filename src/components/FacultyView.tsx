import React, { useMemo, useState } from 'react';
import { StudentProfile, TimetableSlot, AttendanceRecord } from '../types';
import { UserRound, Search, ExternalLink, Users, BookOpen, School, MapPin } from 'lucide-react';

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
    <div className="space-y-6 pb-12">
      {/* Header Banner */}
      <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 shadow-xl">
        <div className="flex items-center space-x-4">
          <div className="p-3.5 acc-soft border acc-border rounded-2xl acc-text">
            <Users className="h-6 w-6" />
          </div>
          <div>
            <div className="text-zinc-500 text-xs font-bold uppercase tracking-wider mb-0.5">
              VIT Chennai · Faculty & Proctor
            </div>
            <h2 className="text-2xl font-extrabold text-zinc-900 tracking-tight">Faculty &amp; Proctor</h2>
            <p className="text-xs text-zinc-500 mt-1 font-medium">
              Your proctor from VTOP, this semester's faculty from your synced timetable, and the official VIT Chennai
              faculty directory.
            </p>
          </div>
        </div>
      </div>

      {/* Proctor card */}
      <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 shadow-xl">
        <div className="flex items-center space-x-3 mb-4">
          <div className="p-2.5 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl text-indigo-600">
            <UserRound className="h-6 w-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-zinc-900 tracking-tight">My Proctor</h3>
            <p className="text-xs text-zinc-500 font-medium">From your VTOP profile (proctor/viewProctorDetails)</p>
          </div>
        </div>

        {student.proctorAvailable && student.proctorName ? (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <p className="text-xl font-extrabold text-zinc-900">{student.proctorName}</p>
              {student.proctorContact ? (
                <p className="text-xs text-zinc-500 font-mono mt-1">{student.proctorContact}</p>
              ) : (
                <p className="text-xs text-zinc-500 mt-1">No contact details provided by VTOP.</p>
              )}
            </div>
            <span className="px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-widest rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 self-start sm:self-auto">
              Assigned
            </span>
          </div>
        ) : (
          <div className="p-4 bg-zinc-50 border border-zinc-200 rounded-2xl text-xs text-zinc-500 flex items-start gap-2">
            <BookOpen className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <span>
              Proctor not available from VTOP{student.regNo ? ' for your profile' : ''}. Your proctor is assigned by
              the school, so nothing is missing on your side — re-sync your profile from{' '}
              <strong className="text-zinc-900">Login</strong> and it will appear once VTOP lists it.
            </span>
          </div>
        )}
      </div>

      {/* My Faculty this semester */}
      <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-blue-500/10 border border-blue-500/20 rounded-2xl text-blue-600">
              <School className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-zinc-900 tracking-tight">My Faculty This Semester</h3>
              <p className="text-xs text-zinc-500 font-medium">
                {courses.length} course{courses.length === 1 ? '' : 's'} · {facultyNames.length} facult{facultyNames.length === 1 ? 'y' : 'ies'} from synced timetable
              </p>
            </div>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="h-3.5 w-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              aria-label="Search faculty or course"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search faculty or course..."
              className="w-full bg-white border border-zinc-200 rounded-xl pl-9 pr-3 py-2.5 text-xs text-zinc-900 placeholder-zinc-500 focus:outline-none focus:border-blue-500 font-medium"
            />
          </div>
        </div>

        {filtered.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filtered.map((c) => (
              <div key={c.courseCode} className="bg-zinc-50 border border-zinc-200 rounded-2xl p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-[10px] uppercase font-extrabold tracking-widest px-2 py-0.5 rounded bg-white text-blue-600 border border-zinc-200 font-mono">
                      {c.courseCode}
                    </span>
                    <p className="text-xs font-bold text-zinc-900 mt-1.5 truncate">{c.courseTitle}</p>
                  </div>
                  {c.slots.length > 0 && (
                    <span className="text-[10px] font-mono text-zinc-500 shrink-0">{c.slots.join(' · ')}</span>
                  )}
                </div>
                <div className="mt-3 space-y-1 text-[11px]">
                  <p className="text-zinc-900 font-medium">
                    <UserRound className="h-3 w-3 inline acc-text mr-1" />
                    {c.faculty || <span className="text-zinc-600">Faculty not provided by VTOP</span>}
                  </p>
                  {c.venue && (
                    <p className="text-zinc-500 font-mono flex items-center gap-1">
                      <MapPin className="h-3 w-3" /> {c.venue}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-6 bg-zinc-50 border border-zinc-200 rounded-2xl text-xs text-zinc-500">
            {query
              ? `No course or faculty matches "${query}".`
              : 'No timetable synced yet — log in to see your faculty for this semester.'}
          </div>
        )}
      </div>

      {/* Official directory */}
      <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 shadow-xl">
        <div className="flex items-center space-x-3 mb-5">
          <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-emerald-600">
            <ExternalLink className="h-6 w-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-zinc-900 tracking-tight">Official VIT Chennai Faculty Directory</h3>
            <p className="text-xs text-zinc-500 font-medium">
              Browse the official faculty pages at <span className="font-mono text-zinc-900">chennai.vit.ac.in</span> —
              opens in a new tab.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {DIRECTORY_LINKS.map((link) => (
            <a
              key={link.url}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group p-4 bg-zinc-50 hover:bg-white border border-zinc-200 hover:border-zinc-300 rounded-2xl transition cursor-pointer flex flex-col justify-between gap-3"
            >
              <div>
                <p className="text-sm font-extrabold text-zinc-900 group-hover:acc-text transition">{link.label}</p>
                <p className="text-[10px] text-zinc-500 font-medium mt-0.5 leading-relaxed">{link.sub}</p>
              </div>
              <span className="text-[10px] font-bold text-zinc-500 group-hover:text-emerald-600 transition flex items-center gap-1">
                Open <ExternalLink className="h-3 w-3" />
              </span>
            </a>
          ))}
        </div>

        <p className="text-[10px] text-zinc-600 mt-4 leading-relaxed">
          Faculty names on this page come from your synced VTOP timetable; the directory links are the official
          VIT Chennai source. Individual faculty pages live at <span className="font-mono">chennai.vit.ac.in/member/…</span>.
        </p>
      </div>
    </div>
  );
};

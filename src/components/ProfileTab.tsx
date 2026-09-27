import React from 'react';
import {
  User, Mail, Phone, Building2, GraduationCap, Trophy, Award, Calendar,
  MapPin, BookOpen,
} from 'lucide-react';
import { StudentProfile } from '../types';
import { useCgpaPrivacy } from '../lib/cgpaPrivacy';
import { ProfilePhoto } from './ProfilePhoto';

interface ProfileTabProps {
  student: StudentProfile | null;
}

/* ── Status Card ──────────────────────────────────────────── */

function StatusCard({ icon, label, value, sub, color }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; color: string;
}) {
  return (
    <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className={`p-1.5 rounded-lg ${color}`}>
          {icon}
        </div>
        <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-sm font-bold text-zinc-900">{value}</p>
      {sub && <p className="text-[10px] text-zinc-500 mt-0.5">{sub}</p>}
    </div>
  );
}

/* ── Main ──────────────────────────────────────────────────────────────────── */

export const ProfileTab: React.FC<ProfileTabProps> = ({ student }) => {
  const [cgpaHidden] = useCgpaPrivacy();
  if (!student) {
    return (
      <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 shadow-xl">
        <div className="flex items-center space-x-3 mb-6">
          <div className="p-2.5 bg-blue-500/10 border border-blue-500/20 rounded-2xl text-blue-600">
            <User className="h-6 w-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-zinc-900 tracking-tight">Student Profile</h3>
            <p className="text-xs text-zinc-500 font-medium">Your personal and academic details from VTOP</p>
          </div>
        </div>
        <div className="p-6 bg-zinc-50 border border-zinc-200 rounded-2xl text-center text-xs text-zinc-500">
          Profile not synced yet — log in with VTOP to see your details.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-12">
      {/* Header */}
      <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 shadow-xl">
        <div className="flex items-center space-x-3 mb-6">
          <ProfilePhoto name={student.name} src={student.profilePhotoUrl} size="md" />
          <div>
            <h3 className="text-lg font-bold text-zinc-900 tracking-tight">Student Profile</h3>
            <p className="text-xs text-zinc-500 font-medium">Your personal and academic details from VTOP</p>
          </div>
        </div>

        {/* Profile cards grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">
          <StatusCard
            icon={<User className="h-4 w-4 text-blue-600" />}
            label="Name"
            value={student.name}
            color="bg-blue-500/10 text-blue-600"
          />
          <StatusCard
            icon={<GraduationCap className="h-4 w-4 text-emerald-600" />}
            label="Reg. Number"
            value={student.registrationNo}
            color="bg-emerald-500/10 text-emerald-600"
          />
          <StatusCard
            icon={<BookOpen className="h-4 w-4 text-violet-600" />}
            label="Branch"
            value={student.branch}
            color="bg-violet-500/10 text-violet-600"
          />
          <StatusCard
            icon={<Calendar className="h-4 w-4 text-amber-600" />}
            label="Semester"
            value={student.semester}
            color="bg-amber-500/10 text-amber-600"
          />
          <StatusCard
            icon={<MapPin className="h-4 w-4 text-cyan-600" />}
            label="Campus"
            value="VIT Chennai"
            color="bg-cyan-500/10 text-cyan-600"
          />
          <StatusCard
            icon={<Building2 className="h-4 w-4 text-purple-600" />}
            label="Program"
            value={student.program}
            color="bg-purple-500/10 text-purple-600"
          />
          <StatusCard
            icon={<Mail className="h-4 w-4 text-rose-600" />}
            label="Email"
            value={student.email || 'Not available'}
            color="bg-rose-500/10 text-rose-600"
          />
          <StatusCard
            icon={<Phone className="h-4 w-4 text-orange-600" />}
            label="Phone"
            value={student.mobile || 'Not available'}
            color="bg-orange-500/10 text-orange-600"
          />
        </div>

        {/* CGPA summary */}
        {student.cgpa != null && student.cgpa > 0 && (
          <div className="flex items-center gap-4 p-4 bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/20 rounded-2xl mb-6">
            <div className="p-3 bg-white/10 rounded-xl">
              <Trophy className="h-6 w-6 text-yellow-600" />
            </div>
            <div>
              <p className="text-[10px] text-blue-700 uppercase tracking-wider font-bold">Current CGPA</p>
              <p className="text-3xl font-black text-zinc-900 font-mono">{cgpaHidden ? '••••' : student.cgpa.toFixed(2)}</p>
              <p className="text-xs text-zinc-500">out of 10.00</p>
            </div>
          </div>
        )}
      </div>

      {/* Proctor card */}
      {student.proctorName && (
        <div className="bg-white border border-violet-500/20 rounded-3xl p-6 shadow-xl">
          <div className="flex items-center space-x-3 mb-4">
            <div className="p-2.5 bg-violet-500/10 border border-violet-500/20 rounded-2xl text-violet-600">
              <Award className="h-6 w-6" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-zinc-900 tracking-tight">Academic Proctor</h4>
              <p className="text-[10px] text-zinc-500">Your assigned faculty advisor</p>
            </div>
          </div>
          <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4 mb-3">
            <p className="text-base font-bold text-zinc-900">{student.proctorName}</p>
            {student.proctorEmail && (
              <p className="text-xs text-zinc-500 flex items-center gap-1 mt-0.5">
                <Mail className="h-3 w-3" /> {student.proctorEmail}
              </p>
            )}
            {student.proctorMobile && (
              <p className="text-xs text-zinc-500 flex items-center gap-1 mt-0.5">
                <Phone className="h-3 w-3" /> {student.proctorMobile}
              </p>
            )}
          </div>
          <p className="text-[10px] text-zinc-500">
            Contact your proctor for academic guidance, grievances, and approvals.
          </p>
        </div>
      )}

        {/* Academic & University Records Status */}
        <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 shadow-xl">
          <div className="flex items-center space-x-3 mb-6">
            <div className="p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-2xl text-amber-600">
              <Award className="h-6 w-6" />
            </div>
            <div>
              <h4 className="text-lg font-bold text-zinc-900 tracking-tight">University Records &amp; Status</h4>
              <p className="text-xs text-zinc-500 font-medium">Academic standing and identity status from VTOP</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-4 bg-zinc-50 border border-zinc-200 rounded-xl">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-zinc-900">Enrollment Status</span>
                <span className="px-2 py-0.5 text-[10px] font-bold rounded-lg border bg-emerald-500/10 border-emerald-500/20 text-emerald-600">
                  ACTIVE
                </span>
              </div>
              <p className="text-[10px] text-zinc-500">{student.program || 'Undergraduate Programme'}</p>
              <p className="text-[9px] text-zinc-600 mt-1 font-mono">VIT Chennai Campus</p>
            </div>

            <div className="p-4 bg-zinc-50 border border-zinc-200 rounded-xl">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-zinc-900">Academic Standing</span>
                <span className={`px-2 py-0.5 text-[10px] font-bold rounded-lg border ${student.cgpa && student.cgpa >= 8.0 ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600' : 'bg-blue-500/10 border-blue-500/20 text-blue-600'}`}>
                  {student.cgpa && student.cgpa >= 9.0 ? 'EXEMPLARY' : student.cgpa && student.cgpa >= 8.0 ? 'GOOD STANDING' : 'REGULAR'}
                </span>
              </div>
              <p className="text-[10px] text-zinc-500">
                {student.cgpa != null ? `Cumulative Grade Point: ${cgpaHidden ? '••••' : student.cgpa.toFixed(2)}` : 'CGPA recorded upon FAT publish'}
              </p>
              <p className="text-[9px] text-zinc-600 mt-1 font-mono">Semester {student.semester || '—'}</p>
            </div>

            <div className="p-4 bg-zinc-50 border border-zinc-200 rounded-xl">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-zinc-900">Proctor Assignment</span>
                <span className={`px-2 py-0.5 text-[10px] font-bold rounded-lg border ${student.proctorName ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600' : 'bg-zinc-100 border-zinc-200 text-zinc-500'}`}>
                  {student.proctorName ? 'ASSIGNED' : 'UNASSIGNED'}
                </span>
              </div>
              <p className="text-[10px] text-zinc-500 truncate">{student.proctorName || 'Faculty Advisor'}</p>
              <p className="text-[9px] text-zinc-600 mt-1 font-mono">Mentorship &amp; Leave Approvals</p>
            </div>
          </div>

          <p className="text-[10px] text-zinc-600 mt-4 text-center">
            For fee dues, bank details, biometric logs, credentials and class messages, see the <strong className="text-zinc-500">My Info</strong> tab.
          </p>
        </div>

      {/* Hostel Info */}
      {(student.hostelBlock || student.roomNo) && (
        <div className="bg-white border border-zinc-200 rounded-3xl p-6 shadow-xl">
          <div className="flex items-center space-x-3 mb-4">
            <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-emerald-600">
              <Building2 className="h-6 w-6" />
            </div>
            <div>
              <h4 className="text-lg font-bold text-zinc-900 tracking-tight">Hostel Information</h4>
              <p className="text-xs text-zinc-500 font-medium">Your hostel details from VTOP</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold">Hostel Block</p>
              <p className="text-base font-bold text-zinc-900 mt-1">{student.hostelBlock || '—'}</p>
            </div>
            <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold">Room Number</p>
              <p className="text-base font-bold text-zinc-900 mt-1">{student.roomNo || '—'}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

import React from 'react';
import {
  BookOpen, Clock, Sparkles,
  FileText, Download, Calendar, AlertTriangle,
  GraduationCap, Sliders, Bot, ChevronRight, MapPin,
} from 'lucide-react';
import { isNavHidden } from '../lib/navVisibility';

/* ── Tool Card ─────────────────────────────────────────────────────────────── */

function ToolCard({ icon, title, description, color, onClick }: {
  icon: React.ReactNode; title: string; description: string;
  color: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-4 p-4 bg-zinc-50 border border-zinc-200 rounded-xl hover:border-zinc-200 transition cursor-pointer text-left group"
    >
      <div className={`p-2.5 rounded-xl ${color} shrink-0 group-hover:scale-110 transition-transform`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-zinc-900">{title}</p>
        <p className="text-xs text-zinc-500 mt-0.5">{description}</p>
      </div>
      <ChevronRight className="h-4 w-4 text-zinc-600 group-hover:text-zinc-900 transition shrink-0" />
    </button>
  );
}

/* ── Main ──────────────────────────────────────────────────────────────────── */

interface ToolsHubProps {
  onNavigate: (tab: string) => void;
}

export const ToolsHub: React.FC<ToolsHubProps> = ({ onNavigate }) => {
  return (
    <div className="space-y-5 pb-12">
      {/* Header */}
      <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 shadow-xl">
        <div className="flex items-center space-x-3 mb-6">
          <div className="p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-2xl text-amber-600">
            <Sparkles className="h-6 w-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-zinc-900 tracking-tight">Student tools</h3>
            <p className="text-xs text-zinc-500 font-medium">Utilities and calculators for your academic life</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Academic Tools — one card per destination. The CGPA calculator,
              GPA predictor, what-if simulator and relative grade predictor all
              live as tabs inside Marks & Grades; three cards pointing at the
              same route read as three broken links, so one canonical card
              covers them. */}
          <ToolCard
            icon={<GraduationCap className="h-5 w-5 text-blue-600" />}
            title="Marks, Grades & Predictors"
            description="CGPA calculator, what-if simulator, grade predictor"
            color="bg-blue-500/10 text-blue-600"
            onClick={() => onNavigate('grades')}
          />

          {/* Productivity Tools */}
          <ToolCard
            icon={<Clock className="h-5 w-5 text-amber-600" />}
            title="Deadline Tracker"
            description="Assignment and quiz deadlines from LMS"
            color="bg-amber-500/10 text-amber-600"
            onClick={() => onNavigate('lms')}
          />
          <ToolCard
            icon={<AlertTriangle className="h-5 w-5 text-rose-600" />}
            title="Attendance Warning"
            description="Check courses at risk of debar"
            color="bg-rose-500/10 text-rose-600"
            onClick={() => onNavigate('academics')}
          />
          {/* Syllabus Viewer is withdrawn from navigation for now (see
              src/lib/navVisibility.ts); the tab and its data path are unchanged,
              so this card is the only thing taken out. */}
          {!isNavHidden('syllabus') && (
            <ToolCard
              icon={<FileText className="h-5 w-5 text-cyan-600" />}
              title="Syllabus Viewer"
              description="VTOP’s own syllabus file for each of your courses"
              color="bg-cyan-500/10 text-cyan-600"
              onClick={() => onNavigate('syllabus')}
            />
          )}
          <ToolCard
            icon={<Calendar className="h-5 w-5 text-orange-600" />}
            title="Academic Calendar"
            description="View holidays, exams, and important dates"
            color="bg-orange-500/10 text-orange-600"
            onClick={() => onNavigate('calendar')}
          />

          {/* Export Tools */}
          <ToolCard
            icon={<Download className="h-5 w-5 text-green-600" />}
            title="Export Timetable"
            description="Download timetable as image or PDF"
            color="bg-green-500/10 text-green-600"
            onClick={() => onNavigate('timetable')}
          />
          <ToolCard
            icon={<Download className="h-5 w-5 text-green-600" />}
            title="Export Exams"
            description="Download exam schedule as .ics calendar"
            color="bg-green-500/10 text-green-600"
            onClick={() => onNavigate('exams')}
          />
          <ToolCard
            icon={<Download className="h-5 w-5 text-green-600" />}
            title="Export Calendar"
            description="Download academic calendar as .ics"
            color="bg-green-500/10 text-green-600"
            onClick={() => onNavigate('calendar')}
          />

          {/* AI Tools */}
          <ToolCard
            icon={<Bot className="h-5 w-5 text-blue-600" />}
            title="AI Advisor"
            description="Get academic advice powered by AI"
            color="bg-blue-500/10 text-blue-600"
            onClick={() => onNavigate('ai-advisor')}
          />
          <ToolCard
            icon={<Sliders className="h-5 w-5 text-indigo-600" />}
            title="FFCS Planner"
            description="Plan your courses and schedule"
            color="bg-indigo-500/10 text-indigo-600"
            onClick={() => onNavigate('ffcs')}
          />
          <ToolCard
            icon={<BookOpen className="h-5 w-5 text-teal-600" />}
            title="Free Classrooms"
            description="Find empty rooms for self-study"
            color="bg-teal-500/10 text-teal-600"
            onClick={() => onNavigate('freeClassrooms')}
          />
          <ToolCard
            icon={<FileText className="h-5 w-5 text-amber-600" />}
            title="Question Paper Bank"
            description="Past exam question papers archive"
            color="bg-amber-500/10 text-amber-600"
            onClick={() => onNavigate('qbank')}
          />
          <ToolCard
            icon={<MapPin className="h-5 w-5 text-amber-600" />}
            title="Campus Facilities"
            description="Printing and opt-in study groups"
            color="bg-amber-500/10 text-amber-600"
            onClick={() => onNavigate('campus-utils')}
          />
        </div>
      </div>

      {/* Quick access */}
      <div className="bg-white border border-zinc-200 rounded-3xl p-6 shadow-xl">
        <h4 className="text-sm font-bold text-zinc-900 mb-4">Quick Access</h4>
        <div className="flex flex-wrap gap-2">
          {[
            { label: 'Dashboard', tab: 'dashboard' },
            { label: 'Attendance', tab: 'academics' },
            { label: 'Grades & Marks', tab: 'grades' },
            { label: 'Timetable', tab: 'timetable' },
            { label: 'Syllabus', tab: 'syllabus' },
            { label: 'Exams', tab: 'exams' },
            { label: 'Calendar', tab: 'calendar' },
            { label: 'My Info', tab: 'my-info' },
            { label: 'LMS / Moodle', tab: 'lms' },
            { label: 'Hostel & Life', tab: 'hostel' },
            { label: 'Library', tab: 'library' },
            { label: 'Transport', tab: 'transport' },
            { label: 'Student Communities', tab: 'clubs' },
            { label: 'Campus Map', tab: 'campus' },
            { label: 'Campus Facilities', tab: 'campus-utils' },
            { label: 'Cab Share', tab: 'cabshare' },
            { label: 'Timetable Compare', tab: 'social' },
            { label: 'FFCS Planner', tab: 'ffcs' },
            { label: 'AI Advisor', tab: 'ai-advisor' },
          ].filter((item) => !isNavHidden(item.tab)).map(item => (
            <button
              key={item.tab}
              onClick={() => onNavigate(item.tab)}
              className="px-3 py-1.5 bg-white border border-zinc-200 rounded-lg text-xs font-bold text-zinc-500 hover:text-zinc-900 hover:border-zinc-300 transition cursor-pointer"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

import React, { useState } from 'react';
import { FresherTerm } from '../types';
import { HelpCircle, BookOpen, Search, Lightbulb, Compass, MapPin, ExternalLink, GraduationCap, Utensils, Stethoscope, Building2, Users, Info } from 'lucide-react';

interface FresherGuideViewProps {
  terms: FresherTerm[];
  /** Navigate to the Campus Map (VIT WayFinder) — used by the Campus section. */
  onNavigateTab?: (tab: string) => void;
}

/**
 * Curated VIT Chennai campus guide. Locations are REAL buildings on the
 * Chennai campus (AB1/AB2/AB3 academic blocks, SJT main block, library,
 * canteens, medical centre, admin office) — no coordinates or room mappings
 * are invented here; every "Locate" action opens the official VIT Chennai
 * WayFinder (chennaiwayfinder.vit.ac.in) via the existing Campus Map view.
 */
const CAMPUS_PLACES: {
  name: string;
  category: string;
  description: string;
  hint: string;
  icon: typeof Building2;
}[] = [
  {
    name: 'AB1 / AB2 / AB3 Academic Blocks',
    category: 'Academic Blocks',
    description: 'The three main academic blocks hold most lecture halls, tutorial rooms and faculty cabins. Your timetable venue (e.g. AB1-205) is the block + room number.',
    hint: 'AB1',
    icon: Building2,
  },
  {
    name: 'SJT (Main Block)',
    category: 'Academic Blocks',
    description: 'The main administrative block — exam halls, larger lecture theatres, and several faculty offices. Venues starting with SJT are here.',
    hint: 'SJT',
    icon: Building2,
  },
  {
    name: 'TT Block (Technology Tower)',
    category: 'Academic Blocks',
    description: 'Hosts labs and tech-heavy courses (L-slot labs often land in TT). Check your timetable venue to confirm which floor.',
    hint: 'TT',
    icon: Building2,
  },
  {
    name: 'Central Library',
    category: 'Study & Services',
    description: 'Silent study zones, reference books and past papers. The library is a reliable backup spot during FFCS and before exams.',
    hint: 'Library',
    icon: BookOpen,
  },
  {
    name: 'Canteens & Food Courts',
    category: 'Food',
    description: 'Multiple canteens across campus plus the food court near the hostel zone. Meal cards / UPI are commonly accepted.',
    hint: 'Canteen',
    icon: Utensils,
  },
  {
    name: 'Medical Centre',
    category: 'Health & Safety',
    description: 'On-campus clinic for routine check-ups and emergencies. Keep your student ID handy when visiting.',
    hint: 'Medical',
    icon: Stethoscope,
  },
  {
    name: 'Administrative Office',
    category: 'Student Services',
    description: 'Handles fee queries, bonafide certificates, transcripts and other official paperwork. Go early in the morning to avoid queues.',
    hint: 'Admin',
    icon: Users,
  },
  {
    name: 'Hostel Zones',
    category: 'Student Life',
    description: 'On-campus accommodation with mess, gym and common rooms. Your hostel block appears on your profile when VTOP provides it.',
    hint: 'Hostel',
    icon: GraduationCap,
  },
];

export const FresherGuideView: React.FC<FresherGuideViewProps> = ({ terms, onNavigateTab }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [section, setSection] = useState<'guide' | 'campus'>('guide');

  const filteredTerms = terms.filter((t) => {
    const matchesCat = selectedCategory === 'All' || t.category === selectedCategory;
    const matchesQuery =
      t.term.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (t.fullForm && t.fullForm.toLowerCase().includes(searchTerm.toLowerCase())) ||
      t.meaning.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesCat && matchesQuery;
  });

  return (
    <div className="space-y-6 pb-12">
      {/* Header Banner Bento Card */}
      <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="text-zinc-500 text-xs font-bold uppercase tracking-wider mb-1">
              VIT Freshman Handbook
            </div>
            <h2 className="text-2xl font-extrabold text-zinc-900 flex items-center gap-2 tracking-tight">
              <HelpCircle className="h-6 w-6 text-teal-600" />
              Fresher Survival Dictionary
            </h2>
            <p className="text-sm text-zinc-500 mt-1 font-medium">
              Academic basics, FFCS, CAT/FAT, Attendance/OD, Proctor and the VIT Chennai campus.
            </p>
          </div>

          {/* Section switch: Guide | Campus */}
          <div className="flex gap-2">
            <button
              onClick={() => setSection('guide')}
              className={`px-4 py-2.5 rounded-2xl text-xs font-extrabold border transition cursor-pointer ${
                section === 'guide' ? 'acc-bg text-zinc-900 border-transparent' : 'bg-white text-zinc-500 border-zinc-200 hover:text-zinc-900'
              }`}
            >
              <BookOpen className="h-3.5 w-3.5 inline mr-1.5" />
              Academic Guide
            </button>
            <button
              onClick={() => setSection('campus')}
              className={`px-4 py-2.5 rounded-2xl text-xs font-extrabold border transition cursor-pointer ${
                section === 'campus' ? 'acc-bg text-zinc-900 border-transparent' : 'bg-white text-zinc-500 border-zinc-200 hover:text-zinc-900'
              }`}
            >
              <MapPin className="h-3.5 w-3.5 inline mr-1.5" />
              Campus
            </button>
          </div>
        </div>
      </div>

      {section === 'campus' ? (
        <>
          {/* Campus intro + link into the WayFinder */}
          <div className="p-6 bg-white border border-amber-500/30 rounded-3xl shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start space-x-3">
              <div className="p-2.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-600 shrink-0">
                <Compass className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-zinc-900 tracking-tight">VIT Chennai Campus</h3>
                <p className="text-xs text-zinc-500 mt-1 font-medium max-w-xl leading-relaxed">
                  Quick orientation for freshmen. Room codes like <span className="font-mono text-amber-700">AB1-205</span> mean{' '}
                  <span className="text-zinc-900">Academic Block 1, Room 205</span>. Use the official WayFinder for turn-by-turn
                  navigation around campus.
                </p>
              </div>
            </div>
            <button
              onClick={() => onNavigateTab?.('campus')}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-amber-500 hover:bg-amber-400 text-zinc-950 rounded-2xl text-sm font-extrabold transition cursor-pointer shadow-lg shadow-amber-900/20 whitespace-nowrap"
            >
              <ExternalLink className="h-4 w-4" />
              Open Campus Map (WayFinder)
            </button>
          </div>

          {/* Campus places grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {CAMPUS_PLACES.map((place) => {
              const Icon = place.icon;
              return (
                <div key={place.name} className="bg-white border border-zinc-200 hover:border-zinc-200 rounded-3xl p-6 shadow-xl flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600">
                        <Icon className="h-5 w-5" />
                      </div>
                      <span className="px-2.5 py-1 text-[10px] font-extrabold rounded-md uppercase tracking-wider bg-white text-zinc-500 border border-zinc-200">
                        {place.category}
                      </span>
                    </div>
                    <h4 className="text-base font-bold text-zinc-900 tracking-tight">{place.name}</h4>
                    <p className="text-xs text-zinc-900 mt-2 leading-relaxed font-medium">{place.description}</p>
                  </div>
                  <button
                    onClick={() => onNavigateTab?.('campus')}
                    className="mt-4 w-full py-2.5 bg-white hover:bg-zinc-100 text-amber-600 text-xs font-bold rounded-2xl transition border border-zinc-200 flex items-center justify-center space-x-1.5 cursor-pointer"
                  >
                    <MapPin className="h-3.5 w-3.5" />
                    <span>Locate on Campus Map</span>
                  </button>
                </div>
              );
            })}
          </div>

          <div className="p-4 bg-zinc-50 border border-zinc-200 rounded-2xl text-[11px] text-zinc-500 flex items-start gap-2">
            <Info className="h-4 w-4 text-zinc-600 shrink-0 mt-0.5" />
            <span>
              Campus information is scoped to VIT Chennai. Navigation is powered by the official{' '}
              <strong className="text-zinc-900">VIT Chennai WayFinder</strong> — no fabricated coordinates or room mappings.
            </span>
          </div>
        </>
      ) : (
        <>
          {/* Search + category pills */}
          <div className="relative min-w-full">
            <Search className="absolute left-3.5 top-3.5 h-4 w-4 text-zinc-500" />
            <input
              type="text"
              aria-label="Search the fresher guide"
              placeholder="Search term e.g. FFCS, CAT, OD, Proctor..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-white border border-zinc-200 rounded-2xl pl-10 pr-4 py-3 text-xs text-zinc-900 focus:outline-none focus:border-teal-500 font-medium"
            />
          </div>

          {/* Category Pills */}
          <div className="flex space-x-2 mt-6 pt-4 border-t border-zinc-200 overflow-x-auto no-scrollbar">
            {['All', 'Registration', 'Academic', 'Evaluation', 'Campus'].map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-4 py-1.5 rounded-full text-xs font-extrabold transition cursor-pointer ${
                  selectedCategory === cat
                    ? 'bg-teal-400 text-zinc-950 shadow-md'
                    : 'bg-zinc-50 text-zinc-500 border border-zinc-200 hover:text-zinc-900'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* FFCS Registration Survival Rule Box */}
          <div className="p-6 bg-white border border-teal-500/30 rounded-3xl shadow-xl space-y-2">
            <div className="flex items-center space-x-2 font-extrabold text-teal-700 text-sm">
              <Lightbulb className="h-5 w-5 text-amber-600" />
              <span>PRO-TIP FOR FRESHERS: FFCS REGISTRATION DAY SURVIVAL</span>
            </div>
            <p className="text-xs text-zinc-900 leading-relaxed font-medium">
              Course registration opens strictly at scheduled window times on VTOP. Always keep <strong>3 back-up timetable combinations</strong> saved in UltraCC. Popular professors fill up within 20 seconds. Sit somewhere with a fast, reliable connection — MH Block or the Central Library are popular choices.
            </p>
          </div>

          {/* Glossary Terms Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {filteredTerms.map((item, idx) => (
              <div
                key={idx}
                className="bg-white border border-zinc-200 rounded-3xl p-6 shadow-xl space-y-4 flex flex-col justify-between"
              >
                <div>
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="text-lg font-bold text-zinc-900 tracking-tight">{item.term}</h3>
                      {item.fullForm && (
                        <p className="text-xs font-bold text-teal-600 mt-0.5">{item.fullForm}</p>
                      )}
                    </div>
                    <span className="px-3 py-1 text-[10px] font-extrabold rounded-md uppercase tracking-wider bg-white text-zinc-500 border border-zinc-200">
                      {item.category}
                    </span>
                  </div>

                  <p className="text-xs text-zinc-900 mt-3 leading-relaxed font-medium">{item.meaning}</p>

                  <div className="mt-4 p-4 bg-zinc-50 rounded-2xl border border-zinc-200 text-xs space-y-1.5">
                    <p className="font-extrabold text-amber-600 flex items-center gap-1.5">
                      <Lightbulb className="h-3.5 w-3.5 text-amber-600" /> Student Advice:
                    </p>
                    <p className="text-zinc-900 leading-relaxed font-medium">{item.studentAdvice}</p>
                  </div>
                </div>

                <p className="text-[11px] text-zinc-500 font-mono pt-3 border-t border-zinc-200">
                  Example: "{item.example}"
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

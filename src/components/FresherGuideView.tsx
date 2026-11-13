import React, { useState } from 'react';
import { FresherTerm } from '../types';
import { BookOpen, Search, Lightbulb, MapPin, ExternalLink, GraduationCap, Utensils, Stethoscope, Building2, Users, Info } from 'lucide-react';

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
  icon: typeof Building2;
}[] = [
  {
    name: 'AB1 / AB2 / AB3 Academic Blocks',
    category: 'Academic blocks',
    description: 'The three main academic blocks hold most lecture halls, tutorial rooms and faculty cabins. Your timetable venue (e.g. AB1-205) is the block + room number.',
    icon: Building2,
  },
  {
    name: 'SJT (Main Block)',
    category: 'Academic blocks',
    description: 'The main administrative block — exam halls, larger lecture theatres, and several faculty offices. Venues starting with SJT are here.',
    icon: Building2,
  },
  {
    name: 'TT Block (Technology Tower)',
    category: 'Academic blocks',
    description: 'Hosts labs and tech-heavy courses (L-slot labs often land in TT). Check your timetable venue to confirm which floor.',
    icon: Building2,
  },
  {
    name: 'Central Library',
    category: 'Study & services',
    description: 'Silent study zones, reference books and past papers. The library is a reliable backup spot during FFCS and before exams.',
    icon: BookOpen,
  },
  {
    name: 'Canteens & Food Courts',
    category: 'Food',
    description: 'Multiple canteens across campus plus the food court near the hostel zone. Meal cards / UPI are commonly accepted.',
    icon: Utensils,
  },
  {
    name: 'Medical Centre',
    category: 'Health & safety',
    description: 'On-campus clinic for routine check-ups and emergencies. Keep your student ID handy when visiting.',
    icon: Stethoscope,
  },
  {
    name: 'Administrative Office',
    category: 'Student services',
    description: 'Handles fee queries, bonafide certificates, transcripts and other official paperwork. Go early in the morning to avoid queues.',
    icon: Users,
  },
  {
    name: 'Hostel Zones',
    category: 'Student life',
    description: 'On-campus accommodation with mess, gym and common rooms. Your hostel block appears on your profile when VTOP provides it.',
    icon: GraduationCap,
  },
];

const CATEGORIES = ['All', 'Registration', 'Academic', 'Evaluation', 'Campus'];

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

  // What to say when the search lands on nothing. Naming only the word would be
  // wrong for someone who picked a category and typed nothing, and vice versa,
  // so the sentence is assembled from what is actually on screen.
  const trimmedQuery = searchTerm.trim();
  const glossaryMiss = terms.length === 0
    ? {
        title: 'The guide is not loaded on this device',
        body: 'Reload the page to bring the handbook back. Nothing here depends on your VTOP account.',
      }
    : {
        title: trimmedQuery
          ? `Nothing in ${selectedCategory === 'All' ? 'the guide' : selectedCategory} matches “${trimmedQuery}”`
          : `Nothing is filed under ${selectedCategory}`,
        body: 'Entries cover FFCS, registration, attendance, CAT/FAT, OD and campus words. Try one word — “CAT”, “proctor”, “mess”.',
      };
  const canReset = Boolean(trimmedQuery) || selectedCategory !== 'All';

  return (
    <div className="uc-index pb-12">
      <section className="uc-plate uc-dir-mast">
        <div className="uc-dir-head">
          <div className="uc-dir-id">
            <span className="uc-cap">VIT freshman handbook</span>
            <h2 className="uc-dir-name">Fresher survival dictionary</h2>
            <p className="uc-note">
              Academic basics, FFCS, CAT/FAT, attendance and OD, proctor, and the VIT Chennai campus.
            </p>
          </div>
        </div>
        <div className="uc-dir-detail">
          <div className="uc-seg" role="tablist" aria-label="Freshman handbook section">
            <button role="tab" aria-selected={section === 'guide'} className={section === 'guide' ? 'is-on' : ''} onClick={() => setSection('guide')}>
              Academic guide
            </button>
            <button role="tab" aria-selected={section === 'campus'} className={section === 'campus' ? 'is-on' : ''} onClick={() => setSection('campus')}>
              Campus
            </button>
          </div>
        </div>
      </section>

      {section === 'campus' ? (
        <>
          <section className="uc-plate uc-dir-mast">
            <div className="uc-dir-head">
              <div className="uc-dir-id">
                <span className="uc-cap">VIT Chennai campus</span>
                <p className="uc-note">
                  Room codes like <b className="uc-num">AB1-205</b> mean Academic Block 1, Room 205. Use the
                  official WayFinder for turn-by-turn navigation around campus.
                </p>
              </div>
              <div className="uc-dir-rail">
                <button className="uc-dir-go acc-bg" onClick={() => onNavigateTab?.('campus')}>
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  Open campus map
                </button>
              </div>
            </div>
          </section>

          <section className="uc-plate uc-dir-ledger">
            {CAMPUS_PLACES.map((place) => {
              const Icon = place.icon;
              return (
                <article key={place.name} className="uc-dir-row uc-dir-row--acts">
                  <span className="uc-dir-tile"><Icon className="h-4 w-4" aria-hidden="true" /></span>
                  <div className="uc-dir-main">
                    <span className="uc-dir-title">{place.name}</span>
                    <span className="uc-dir-meta">{place.category}</span>
                    <p className="uc-dir-sub uc-fresh-place">{place.description}</p>
                  </div>
                  <div className="uc-dir-acts">
                    <button
                      className="uc-dir-go"
                      aria-label={`Locate ${place.name} on the campus map`}
                      onClick={() => onNavigateTab?.('campus')}
                    >
                      <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                      Locate
                    </button>
                  </div>
                </article>
              );
            })}
          </section>

          <p className="uc-note-row">
            <Info aria-hidden="true" />
            <span>
              Campus information is scoped to VIT Chennai. Navigation is powered by the official{' '}
              <b>VIT Chennai WayFinder</b> — no fabricated coordinates or room mappings.
            </span>
          </p>
        </>
      ) : (
        <>
          <section className="uc-plate">
            <div className="uc-plate-head"><span className="uc-cap">Search the guide</span><span className="uc-dir-count">{filteredTerms.length} entries</span></div>
            <div className="uc-dir-tools">
              <div className="uc-dir-search">
                <Search aria-hidden="true" />
                <input
                  type="text"
                  aria-label="Search the fresher guide"
                  placeholder="Search term e.g. FFCS, CAT, OD, Proctor…"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <div className="uc-chips" role="group" aria-label="Guide category">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    aria-pressed={selectedCategory === cat}
                    className={selectedCategory === cat ? 'is-on' : ''}
                    onClick={() => setSelectedCategory(cat)}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* FFCS Registration Survival Rule Box */}
          <section className="uc-plate uc-plate--quiet">
            <p className="uc-note-row">
              <Lightbulb aria-hidden="true" />
              <span>
                <b>FFCS registration day survival.</b> Registration opens in the window allotted to your programme, and
                sections close as their seats fill. Save two or three back-up timetable combinations before your window
                opens so you can switch without rebuilding the plan from scratch. The popular professors and the
                convenient slots do go quickly, so the first minutes after your window opens matter most — be somewhere
                with a connection you can trust.
              </span>
            </p>
          </section>

          {/* Glossary ledger — or the dead end the search can reach. A miss used
              to render an empty grid, which looks like a broken page rather than
              a wrong word, so the miss is named and undone. */}
          <section className="uc-plate uc-dir-ledger">
            {filteredTerms.length === 0 ? (
              <div className="uc-dir-blank">
                <b>{glossaryMiss.title}.</b> {glossaryMiss.body}
                {canReset && (
                  <button
                    className="uc-dir-go"
                    onClick={() => { setSearchTerm(''); setSelectedCategory('All'); }}
                  >
                    Show every entry
                  </button>
                )}
              </div>
            ) : (
              filteredTerms.map((item, idx) => (
                <article key={idx} className="uc-dir-card">
                  <div className="uc-fresh-head">
                    <div className="uc-dir-main">
                      <span className="uc-dir-title">{item.term}</span>
                      {item.fullForm && <span className="uc-dir-meta">{item.fullForm}</span>}
                    </div>
                    <span className="uc-dir-tag">{item.category}</span>
                  </div>
                  <p className="uc-dir-sub">{item.meaning}</p>
                  <div className="uc-fresh-advice">
                    <Lightbulb aria-hidden="true" />
                    <span>{item.studentAdvice}</span>
                  </div>
                  <p className="uc-dir-sub uc-fresh-eg">Example: “{item.example}”</p>
                </article>
              ))
            )}
          </section>
        </>
      )}
    </div>
  );
};

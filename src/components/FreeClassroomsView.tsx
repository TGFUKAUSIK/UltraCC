/**
 * FreeClassroomsView — which rooms/labs are free right now (or at any
 * selected day × period), computed from the FFCS course catalogue (campus-wide
 * VENUE + SLOT occupancy) unioned with the student's own synced timetable,
 * all via the authoritative FFCS slot grid (theory AND lab slots — a lab
 * course "L31+L32" blocks its room for the whole 2-period block).
 */

import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { MapPin, Search, Building2, Clock, Info } from 'lucide-react';
import { TimetableSlot } from '../lib/vtop/types';
import {
  ROOM_DAYS, periodsForDay, currentPeriodIndex, allKnownRooms, dayIsScheduled,
  occupiedRoomsForPeriod, catalogueOccupiedRooms, roomBlock, isLabRoom, type RoomDay,
} from '../utils/roomAvailability';
import { minutesOfDay } from '../utils/timetableGrid';

interface FreeClassroomsViewProps {
  timetable: TimetableSlot[];
}

export const FreeClassroomsView: React.FC<FreeClassroomsViewProps> = ({ timetable }) => {
  const { day: todayId, nowMin } = useMemo(() => getCurrentDayTime(), []);
  const dayIds = ROOM_DAYS.map((d) => d.id);
  const todayIsScheduled = dayIds.includes(todayId as RoomDay);

  const [selectedDay, setSelectedDay] = useState<RoomDay>(todayIsScheduled ? (todayId as RoomDay) : 'mon');
  const [selectedPeriodIdx, setSelectedPeriodIdx] = useState<number>(() => {
    const idx = todayIsScheduled ? currentPeriodIndex(todayId as RoomDay, nowMin) : -1;
    return idx >= 0 ? idx : 0;
  });
  const [selectedBlock, setSelectedBlock] = useState('All');
  const [search, setSearch] = useState('');
  const [now, setNow] = useState<{ day: string; nowMin: number }>(getCurrentDayTime);

  // Keep the "now" marker accurate as time passes while the view is open.
  useEffect(() => {
    const t = window.setInterval(() => setNow(getCurrentDayTime()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const periods = periodsForDay(selectedDay);
  const period = periods[selectedPeriodIdx];

  const timetableVenues = useMemo(() => timetable.map((s) => s.venue || s.room || ''), [timetable]);
  const rooms = useMemo(() => allKnownRooms(timetableVenues), [timetableVenues]);

  const { occupiedRooms, freeByBlock } = useMemo(() => {
    // A day the FFCS grid does not publish (Saturday at Chennai) has no
    // schedule to compare against. Listing every room as free there would be a
    // lie — the absence of a class is not evidence of an empty room.
    if (!period) return { occupiedRooms: new Set<string>(), freeByBlock: {} as Record<string, string[]> };
    const occupied = occupiedRoomsForPeriod(
      timetable.map((s) => ({ slot: s.slot, venue: s.venue || s.room || '' })),
      selectedDay,
      selectedPeriodIdx,
    );
    // Union with campus-wide catalogue occupancy so a room used by ANY class
    // (not just this student's) shows busy.
    for (const room of catalogueOccupiedRooms(selectedDay, selectedPeriodIdx)) occupied.add(room);
    const free: Record<string, string[]> = {};
    for (const room of rooms) {
      const block = roomBlock(room);
      if (!occupied.has(room)) (free[block] ??= []).push(room);
    }
    for (const b of Object.keys(free)) free[b].sort((a, b2) => a.localeCompare(b2, undefined, { numeric: true }));
    return { occupiedRooms: occupied, freeByBlock: free };
  }, [rooms, timetable, selectedDay, selectedPeriodIdx, period]);

  const filteredBlocks = useMemo(() => {
    let blocks = Object.keys(freeByBlock).sort();
    if (selectedBlock !== 'All') blocks = blocks.filter((b) => b === selectedBlock);
    if (search.trim()) {
      const q = search.toLowerCase();
      blocks = blocks.filter((b) => freeByBlock[b].some((r) => r.toLowerCase().includes(q)));
    }
    return blocks;
  }, [freeByBlock, selectedBlock, search]);

  const totalFree = Object.values<string[]>(freeByBlock).reduce((n, arr) => n + arr.length, 0);
  const totalOccupied = occupiedRooms.size;
  const dayLabel = ROOM_DAYS.find((d) => d.id === selectedDay)?.label ?? selectedDay;

  const jumpToNow = useCallback(() => {
    const cur = getCurrentDayTime();
    setNow(cur);
    if (dayIds.includes(cur.day as RoomDay)) {
      setSelectedDay(cur.day as RoomDay);
      const idx = currentPeriodIndex(cur.day as RoomDay, cur.nowMin);
      if (idx >= 0) setSelectedPeriodIdx(idx);
    }
  }, [dayIds]);

  const shortRoom = (room: string) => (room.includes('-') ? room.split('-').slice(1).join('-') : room);

  return (
    <div className="uc-index pb-12">
      {/* Mast: the answer first — how much is free, and for when. */}
      <section className="uc-plate uc-dir-mast">
        <div className="uc-dir-head">
          <div className="uc-dir-id">
            <span className="uc-cap">Rooms &amp; labs · from the FFCS grid</span>
            <h2 className="uc-dir-name">What&rsquo;s free right now</h2>
            <p className="uc-note">Find an empty room or lab for studying, or check any other day and period.</p>
          </div>
          {todayIsScheduled && (
            <div className="uc-dir-rail">
              <button className="uc-dir-go acc-bg" onClick={jumpToNow}>
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                Jump to right now
              </button>
            </div>
          )}
        </div>

        <div className="uc-free-metrics">
          <div className="uc-free-metric is-free">
            <span>Free</span>
            <b className="uc-num">{totalFree}</b>
          </div>
          <div className="uc-free-metric">
            <span>Theory rooms</span>
            <b className="uc-num">{freeRoomsCount(freeByBlock, false)}</b>
          </div>
          <div className="uc-free-metric">
            <span>Labs</span>
            <b className="uc-num">{freeRoomsCount(freeByBlock, true)}</b>
          </div>
          <div className="uc-free-metric is-busy">
            <span>In class</span>
            <b className="uc-num">{totalOccupied}</b>
          </div>
        </div>

        <div className="uc-dir-detail">
          <div className="uc-note-row">
            <Info aria-hidden="true" />
            <span>
              Free/occupied status reflects classes scheduled in the FFCS course catalogue and your synced timetable —
              it is a planning guide, not a live room-sensor feed. Lunch (13:25–14:00) has no scheduled classes. A period
              is shown from the earlier of its two bells to the later one: several of VTOP&rsquo;s lab periods start five
              minutes before the theory class numbered with them, and a room is only free when neither kind of class is in it.
            </span>
          </div>
        </div>
      </section>

      <div className="uc-free-cols">
        {/* Controls: one row of choices, compact. */}
        <section className="uc-plate">
          <header className="uc-plate-head">
            <div className="uc-dir-id">
              <span className="uc-cap">Choose a slot</span>
              <p className="uc-note">{dayLabel}{period ? ` · ${period.start}–${period.end}` : ' · no schedule published'}</p>
            </div>
          </header>
          <div className="uc-dir-tools">
            <div>
              <span className="uc-free-label">Day of week</span>
              {/* 3 columns below 380px: six day buttons at 320px viewport shrink under a comfortable tap target. */}
              <div role="group" aria-label="Day of week" className="uc-chips">
                {ROOM_DAYS.map((d) => {
                  const isToday = d.id === todayId;
                  return (
                    <button
                      type="button"
                      key={d.id}
                      aria-pressed={selectedDay === d.id}
                      onClick={() => { setSelectedDay(d.id); setSelectedPeriodIdx(0); }}
                      className={selectedDay === d.id ? 'is-on' : ''}
                    >
                      {d.label}
                      {isToday && <span className="uc-chip-flag">Today</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <span className="uc-free-label">Time period</span>
              <div role="group" aria-label="Time period" className="uc-chips">
                {periods.map((p, i) => {
                  /* "Which period is now" is one rule: the same `currentPeriodIndex`
                     the view opens on and "Jump to Right Now" uses, including its
                     ten minutes of walk-up before the bell. The marker used to ask
                     its own stricter question, so the period the list was showing
                     could carry no marker at all — and the screen then answered "is
                     this the current period?" yes and no at once. */
                  const isNow = now.day === selectedDay && currentPeriodIndex(selectedDay, now.nowMin) === i;
                  return (
                    <button
                      type="button"
                      key={i}
                      aria-pressed={selectedPeriodIdx === i}
                      onClick={() => setSelectedPeriodIdx(i)}
                      className={selectedPeriodIdx === i ? 'is-on' : ''}
                    >
                      {isNow && <span className="uc-chip-dot animate-pulse" aria-hidden="true" />}
                      <span className="uc-num">{p.start}–{p.end}</span>
                      {isNow && <span className="sr-only">Current period</span>}
                    </button>
                  );
                })}
                {periods.length === 0 && (
                  <p className="uc-dir-sub">No scheduled periods for this day.</p>
                )}
              </div>
            </div>

            <div className="uc-free-filters">
              <div className="uc-dir-search">
                <Search aria-hidden="true" />
                <input
                  type="text"
                  aria-label="Search rooms"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search rooms…"
                />
              </div>
              <div className="uc-chips" role="group" aria-label="Filter by block">
                {['All', ...Object.keys(freeByBlock).sort()].map((b) => (
                  <button
                    key={b}
                    type="button"
                    aria-pressed={selectedBlock === b}
                    onClick={() => setSelectedBlock(b)}
                    className={selectedBlock === b ? 'is-on' : ''}
                  >
                    {b}{b !== 'All' && <span className="uc-quiet"> {(freeByBlock[b] || []).length}</span>}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <div className="uc-free-stack">
          {/* The rooms themselves. */}
          {!period ? (
            <section className="uc-plate">
              <div className="uc-dir-blank">
                <b>No class schedule for this day.</b> VTOP publishes its FFCS timetable grid Monday to Friday, so there is
                nothing to check {dayLabel} against. A room is only listed as free when the schedule says no class uses it —
                pick a weekday to see real availability.
              </div>
            </section>
          ) : rooms.length === 0 ? (
            <section className="uc-plate">
              <div className="uc-dir-blank">
                <b>No room data yet.</b> Sync your timetable from VTOP — rooms come from the FFCS catalogue and your
                registered courses.
              </div>
            </section>
          ) : filteredBlocks.length === 0 ? (
            <section className="uc-plate">
              <div className="uc-dir-blank">
                <b>No rooms or labs match these filters.</b> Every room matching your search and block is occupied for this
                period, or the search is narrower than the catalogue.
                <button className="uc-dir-go" onClick={() => { setSelectedBlock('All'); setSearch(''); }}>
                  Reset filters
                </button>
              </div>
            </section>
          ) : (
            <section className="uc-plate">
              <header className="uc-plate-head">
                <div className="uc-dir-id">
                  <span className="uc-cap">Free rooms</span>
                  <p className="uc-note">
                    {totalFree} free {totalFree === 1 ? 'room' : 'rooms'} across {filteredBlocks.length}{' '}
                    {filteredBlocks.length === 1 ? 'block' : 'blocks'} · {dayLabel} {period.start}–{period.end}
                  </p>
                </div>
                <span className="uc-dir-count">{totalOccupied} in class</span>
              </header>
              {filteredBlocks.map((block) => {
                const roomsInBlock = freeByBlock[block];
                const filteredRooms = search.trim()
                  ? roomsInBlock.filter((r) => r.toLowerCase().includes(search.toLowerCase()))
                  : roomsInBlock;
                if (filteredRooms.length === 0) return null;
                return (
                  <article key={block} className="uc-free-block">
                    <div className="uc-free-block-head">
                      <span className="uc-dir-title">{block}</span>
                      <span className="uc-dir-count">
                        {filteredRooms.length} free
                      </span>
                    </div>
                    <div className="uc-free-rooms">
                      {filteredRooms.map((room) => (
                        <span key={room} className="uc-free-room uc-num">{shortRoom(room)}</span>
                      ))}
                    </div>
                  </article>
                );
              })}
            </section>
          )}

          {/* Occupied rooms, as the quiet counterweight to the free list. */}
          {totalOccupied > 0 && (
            <section className="uc-plate uc-plate--quiet">
              <div className="uc-plate-head">
                <div className="uc-dir-id">
                  <span className="uc-cap">In class this period</span>
                  <p className="uc-note">
                    {totalOccupied} rooms the catalogue or your timetable has a class in.
                  </p>
                </div>
              </div>
              <div className="uc-free-rooms is-busy">
                {Array.from(occupiedRooms).sort().map((room) => (
                  <span key={room} className="uc-free-room is-busy uc-num">{room}</span>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
};

/** Count free rooms in a block-grouped map filtered by lab-ness. */
function freeRoomsCount(freeByBlock: Record<string, string[]>, labs: boolean): number {
  return Object.values(freeByBlock).flat().filter((r) => isLabRoom(r) === labs).length;
}

function getCurrentDayTime(): { day: string; nowMin: number } {
  const now = new Date();
  const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  return { day: dayNames[now.getDay()], nowMin: minutesOfDay(now) };
}

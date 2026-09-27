/**
 * FreeClassroomsView — which rooms/labs are free right now (or at any
 * selected day × period), computed from the FFCS course catalogue (campus-wide
 * VENUE + SLOT occupancy) unioned with the student's own synced timetable,
 * all via the authoritative FFCS slot grid (theory AND lab slots — a lab
 * course "L31+L32" blocks its room for the whole 2-period block).
 */

import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { MapPin, Search, XCircle, Building2, Sparkles, Info } from 'lucide-react';
import { TimetableSlot } from '../lib/vtop/types';
import {
  ROOM_DAYS, periodsForDay, currentPeriodIndex, allKnownRooms,
  occupiedRoomsForPeriod, catalogueOccupiedRooms, roomBlock, isLabRoom, type RoomDay,
} from '../utils/roomAvailability';

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
    const occupied = period
      ? occupiedRoomsForPeriod(
          timetable.map((s) => ({ slot: s.slot, venue: s.venue || s.room || '' })),
          selectedDay,
          selectedPeriodIdx,
        )
      : new Set<string>();
    // Union with campus-wide catalogue occupancy so a room used by ANY class
    // (not just this student's) shows busy.
    if (period) for (const room of catalogueOccupiedRooms(selectedDay, selectedPeriodIdx)) occupied.add(room);
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

  const jumpToNow = useCallback(() => {
    const cur = getCurrentDayTime();
    setNow(cur);
    if (dayIds.includes(cur.day as RoomDay)) {
      setSelectedDay(cur.day as RoomDay);
      const idx = currentPeriodIndex(cur.day as RoomDay, cur.nowMin);
      if (idx >= 0) setSelectedPeriodIdx(idx);
    }
  }, [dayIds]);

  return (
    <div className="space-y-4 pb-12">
      {/* Hero Banner */}
      <div className="bg-white border border-emerald-500/20 rounded-3xl p-5 sm:p-6 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-48 h-48 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative z-10">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600">
              <MapPin className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-xl font-extrabold text-zinc-900 tracking-tight">Free Classrooms</h2>
              <p className="text-xs text-zinc-500 font-medium">Find an empty room or lab for studying</p>
            </div>
          </div>
          {todayIsScheduled && (
            <button
              onClick={jumpToNow}
              className="px-3 py-1.5 bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 rounded-xl text-xs font-bold transition hover:bg-emerald-500/25 cursor-pointer flex items-center gap-1.5"
            >
              <Sparkles className="h-3 w-3" /> Jump to Right Now
            </button>
          )}
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-3 gap-3 mt-4">
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-center">
            <p className="text-[10px] font-extrabold text-emerald-600 uppercase tracking-wider">Total Free</p>
            <p className="text-2xl font-black text-zinc-900 font-mono">{totalFree}</p>
          </div>
          <div className="p-3 bg-zinc-50 border border-zinc-200 rounded-xl text-center">
            <p className="text-[10px] font-extrabold text-blue-600 uppercase tracking-wider">Theory</p>
            <p className="text-2xl font-black text-zinc-900 font-mono">{freeRoomsCount(freeByBlock, false)}</p>
          </div>
          <div className="p-3 bg-zinc-50 border border-zinc-200 rounded-xl text-center">
            <p className="text-[10px] font-extrabold text-cyan-600 uppercase tracking-wider">Labs</p>
            <p className="text-2xl font-black text-zinc-900 font-mono">{freeRoomsCount(freeByBlock, true)}</p>
          </div>
        </div>
        <p className="mt-3 text-[10px] text-zinc-500 flex items-start gap-1.5">
          <Info className="h-3 w-3 shrink-0 mt-0.5" />
          Free/occupied status reflects classes scheduled in the FFCS course catalogue and your synced timetable — it is a
          planning guide, not a live room-sensor feed. Lunch (13:25–14:00) has no scheduled classes.
        </p>
      </div>

      {/* Controls */}
      <div className="bg-white border border-zinc-200 rounded-3xl p-4 sm:p-5 shadow-xl space-y-4">
        {/* Day Selector */}
        <div>
          <p className="text-[10px] font-extrabold text-zinc-500 uppercase tracking-wider mb-1.5">Day of Week</p>
          {/* 3 columns below 380px: six day buttons at 320px viewport shrink under a comfortable tap target. */}
          <div role="group" aria-label="Day of week" className={`grid gap-1.5 grid-cols-3 ${todayIsScheduled ? 'min-[380px]:grid-cols-5' : 'min-[380px]:grid-cols-6'}`}>
            {ROOM_DAYS.map((d) => {
              const isToday = d.id === todayId;
              return (
                <button
                  type="button"
                  key={d.id}
                  aria-pressed={selectedDay === d.id}
                  onClick={() => { setSelectedDay(d.id); setSelectedPeriodIdx(0); }}
                  className={`py-2 px-2 rounded-xl text-[11px] font-bold transition-all cursor-pointer text-center ${
                    selectedDay === d.id
                      ? 'bg-emerald-600 text-zinc-900'
                      : 'bg-white border border-zinc-200 text-zinc-500 hover:text-zinc-900'
                  }`}
                >
                  <span className="sm:hidden">{d.label.slice(0, 3)}</span>
                  <span className="hidden sm:inline">{d.label}</span>
                  {isToday && (
                    <span className={`text-[9px] block mt-0.5 font-extrabold ${selectedDay === d.id ? 'text-white' : 'text-emerald-700'}`}>
                      Today
                    </span>
                  )}
                </button>
              );
            })}
         </div>
        </div>

        {/* Time Period */}
        <div>
          <p className="text-[10px] font-extrabold text-zinc-500 uppercase tracking-wider mb-1.5">Time Period</p>
          <div role="group" aria-label="Time period" className="flex overflow-x-auto gap-2 no-scrollbar pb-1">
            {periods.map((p, i) => {
              const isNow = selectedDay === todayId && p.startMin <= now.nowMin && now.nowMin <= p.endMin;
              return (
                <button
                  type="button"
                  key={i}
                  aria-pressed={selectedPeriodIdx === i}
                  onClick={() => setSelectedPeriodIdx(i)}
                  className={`px-3 py-2 rounded-xl text-[11px] font-bold whitespace-nowrap transition-all cursor-pointer shrink-0 flex items-center gap-1.5 ${
                    selectedPeriodIdx === i
                      ? 'bg-blue-600 text-white'
                      : 'bg-white border border-zinc-200 text-zinc-500 hover:text-zinc-900'
                  }`}
                >
                  {isNow && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" aria-hidden="true" />}
                  <span>{p.start}–{p.end}</span>
                  {isNow && <span className="sr-only">happening now</span>}
                </button>
              );
            })}
            {periods.length === 0 && (
              <p className="text-xs text-zinc-500 py-2">No scheduled periods for this day.</p>
            )}
          </div>
        </div>

        {/* Search + Block filter */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
            <input
              type="text"
              aria-label="Search rooms"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search rooms…"
              className="w-full bg-white border border-zinc-200 rounded-xl pl-9 pr-3 py-2 text-xs text-zinc-900 font-mono focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div className="flex overflow-x-auto gap-1.5 no-scrollbar">
            {['All', ...Object.keys(freeByBlock).sort()].map((b) => (
              <button
                key={b}
                onClick={() => setSelectedBlock(b)}
                className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold shrink-0 transition-all cursor-pointer ${
                  selectedBlock === b
                    ? 'bg-emerald-500/20 text-emerald-700 border border-emerald-500/40'
                    : 'bg-white text-zinc-500 hover:text-zinc-900 border border-zinc-200'
                }`}
              >
                {b} {b !== 'All' && <span className="opacity-60">({(freeByBlock[b] || []).length})</span>}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Results */}
      {rooms.length === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-3xl p-8 text-center">
          <Building2 className="h-10 w-10 text-zinc-600 mx-auto mb-3" />
          <p className="text-sm font-bold text-zinc-900">No room data yet</p>
          <p className="text-xs text-zinc-500 mt-1">
            Sync your timetable from VTOP — rooms come from the FFCS catalogue and your registered courses.
          </p>
        </div>
      ) : filteredBlocks.length === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-3xl p-8 text-center">
          <Building2 className="h-10 w-10 text-zinc-600 mx-auto mb-3" />
          <p className="text-sm font-bold text-zinc-900">No rooms or labs found</p>
          <p className="text-xs text-zinc-500 mt-1">All rooms matching your filters are occupied for this time slot.</p>
          <button
            onClick={() => { setSelectedBlock('All'); setSearch(''); }}
            className="mt-3 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-zinc-900 rounded-xl text-xs font-bold transition cursor-pointer"
          >
            Reset Filters
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-[10px] text-zinc-500 font-semibold px-1">
            {totalFree} free rooms across {filteredBlocks.length} blocks
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filteredBlocks.map((block) => {
              const roomsInBlock = freeByBlock[block];
              const filteredRooms = search.trim()
                ? roomsInBlock.filter((r) => r.toLowerCase().includes(search.toLowerCase()))
                : roomsInBlock;
              if (filteredRooms.length === 0) return null;
              return (
                <div key={block} className="bg-white border border-zinc-200 rounded-3xl p-4 sm:p-5 shadow-xl">
                  <div className="flex items-center justify-between mb-3 pb-2 border-b border-zinc-200">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-xl bg-emerald-500/10 text-emerald-600">
                        <Building2 className="h-4 w-4" />
                      </div>
                      <div>
                        <h3 className="text-sm font-extrabold text-zinc-900">{block}</h3>
                        <p className="text-[10px] text-zinc-500">Academic Building</p>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 text-xs font-bold font-mono">
                      {filteredRooms.length} Free
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {filteredRooms.map((room) => (
                      <span
                        key={room}
                        className="px-2.5 py-1.5 bg-emerald-500/5 border border-emerald-500/15 rounded-xl text-xs font-mono text-emerald-700"
                      >
                        {room.includes('-') ? room.split('-').slice(1).join('-') : room}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Occupied Rooms */}
      {totalOccupied > 0 && (
        <div className="bg-white border border-rose-500/20 rounded-3xl p-5 shadow-xl">
          <div className="flex items-center gap-2 mb-3">
            <XCircle className="h-4 w-4 text-rose-600" />
            <h3 className="text-sm font-extrabold text-rose-700">Occupied ({totalOccupied})</h3>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Array.from(occupiedRooms).sort().map((room) => (
              <span key={room} className="px-2 py-1 bg-rose-500/5 border border-rose-500/15 rounded-lg text-[11px] font-mono text-rose-600">
                {room}
              </span>
            ))}
          </div>
        </div>
      )}
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
  return { day: dayNames[now.getDay()], nowMin: now.getHours() * 60 + now.getMinutes() };
}

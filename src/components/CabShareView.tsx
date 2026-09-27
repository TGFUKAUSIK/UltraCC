import React, { useEffect, useMemo, useReducer, useState } from 'react';
import {
  Car, Plus, Users, Clock, Loader2, WifiOff, Trash2, ShieldAlert, RefreshCw, LogOut, Info,
  Phone, EyeOff, MessageCircle, UserCheck,
} from 'lucide-react';
import {
  fetchCabRides, postCabRide, joinCabRide, leaveCabRide, deleteCabRide,
  confirmRideMember, listRideMembers, revealMemberContact, makePosterCode,
  subscribeToCabRides, CabRide, CabShareJoinError, ContactReveal,
} from '../lib/supabaseCommunity';
import {
  canParticipate, fetchPhoneIdentity, getDeviceCode, maskedPhone, normalizeToE164,
  phoneIdentityReducer, savePhoneIdentity, revokePhone, setPhoneVisibility,
  initialPhoneIdentityState, PhoneIdentityState, PhoneError,
  RIDE_BOARD_BACKEND_FIX, RIDE_BOARD_BACKEND_MESSAGE,
} from '../lib/phoneIdentity';
import { CabRideState, getCabParticipantCount, getCabRideState } from '../utils/cabShare';
import {
  consumeRideCode, loadRideCodeMap, posterCodeForRide, recordRideCode, rideKey, saveRideCodeMap,
  type RideCodeMap,
} from '../lib/cabshareOwnership';
import { debugErrorDetail, humanErrorCopy } from '../lib/errorCopy';
import { localTodayIso } from '../utils/localDate';

function memberToken(id: number): string {
  const key = `ultracc.cabshare.member.${id}`;
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    sessionStorage.setItem(key, token);
    return token;
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function clearMemberToken(id: number): void {
  try { sessionStorage.removeItem(`ultracc.cabshare.member.${id}`); } catch { /* private mode */ }
}

/**
 * Whether this tab already holds a seat on a ride. The member token lives in
 * sessionStorage and survives a reload, but the button state used to be pure
 * React state — so after a refresh a rider was shown "Join ride" for a ride
 * they were already on, with no way to see or leave their own seat.
 */
function hasMemberToken(id: number): boolean {
  try {
    return Boolean(sessionStorage.getItem(`ultracc.cabshare.member.${id}`));
  } catch {
    return false;
  }
}

/**
 * Community ride board backed by Supabase. Posting and joining require a
 * saved contact number on this device (self-declared, no SMS verification);
 * contact exchange between riders and the poster only opens after mutual
 * confirmation.
 */
export const CabShareView: React.FC = () => {
  const [rides, setRides] = useState<CabRide[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [realtimeStatus, setRealtimeStatus] = useState<'connecting' | 'live' | 'fallback'>('connecting');
  const [error, setError] = useState<string | null>(null);
  // True when the deployed backend still runs the retired OTP-era schema.
  // Surfaced as its own honest panel — read-only, not "service unavailable" —
  // while the SQL migration that clears it stays operator-only output.
  const [backendOutdated, setBackendOutdated] = useState(false);
  useEffect(() => {
    if (backendOutdated) debugErrorDetail('ride-board', RIDE_BOARD_BACKEND_FIX);
  }, [backendOutdated]);
  const [showPost, setShowPost] = useState(false);
  const [showExpired, setShowExpired] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('VIT Chennai');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [seats, setSeats] = useState(3);
  const [notes, setNotes] = useState('');
  const [contact, setContact] = useState('');
  const [myCode, setMyCode] = useState<string | null>(null);
  // Poster codes this device earned (see cabshareOwnership.ts). They let the
  // rider manage their own listing after a reload instead of losing the code.
  const [rideCodes, setRideCodes] = useState<RideCodeMap>(() => loadRideCodeMap());
  const [posting, setPosting] = useState(false);
  const [joined, setJoined] = useState<Record<number, boolean>>({});
  const [memberAware, setMemberAware] = useState<Record<number, boolean>>({});

  // Saved contact number (device-scoped identity, no verification).
  const deviceCode = useMemo(() => getDeviceCode(), []);
  const [phone, dispatchPhone] = useReducer(phoneIdentityReducer, initialPhoneIdentityState);
  const [phoneLoading, setPhoneLoading] = useState(true);
  const numberSaved = canParticipate(phone);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const identity = await fetchPhoneIdentity(deviceCode);
        if (alive && identity.saved) {
          dispatchPhone({ type: 'SAVED', last4: identity.last4 || '', hideNumber: Boolean(identity.hideNumber) });
        }
      } catch (err) {
        // A stale backend is reported as exactly that; any other failure
        // leaves the panel in its honest "no number saved" state.
        if (alive && err instanceof PhoneError && err.code === 'BACKEND_OUTDATED') setBackendOutdated(true);
      } finally {
        if (alive) setPhoneLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [deviceCode]);

  const load = async (background = false) => {
    if (background) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      setRides(await fetchCabRides());
      setNow(Date.now());
    } catch (err) {
      setError(humanErrorCopy(err, 'Could not load the ride board.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
    const unsubscribe = subscribeToCabRides(() => { if (document.visibilityState === 'visible') void load(true); }, setRealtimeStatus);
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(true);
    }, 15000);
    const onVisible = () => { if (document.visibilityState === 'visible') void load(true); };
    document.addEventListener('visibilitychange', onVisible);
    const clock = window.setInterval(() => setNow(Date.now()), 30000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(clock);
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const classified = useMemo(() => rides.map((ride) => ({ ride, state: getCabRideState(ride, now) })), [rides, now]);
  const visibleRides = classified.filter(({ state }) => showExpired || state !== 'expired');
  const openRides = classified.filter(({ state }) => state === 'open');
  const seatsAvailable = openRides.reduce((sum, item) => sum + item.ride.seats_left, 0);
  const today = localTodayIso();

  const submit = async () => {
    if (!from.trim() || !to.trim() || !date || !time) return;
    setPosting(true);
    setError(null);
    try {
      const code = makePosterCode();
      const details = { from_place: from.trim(), to_place: to.trim(), travel_date: date, travel_time: time };
      await postCabRide({ ...details, seats, notes: notes.trim(), contact: contact.trim(), poster_code: code, poster_device_code: deviceCode });
      // Bind the code to this ride's public details on THIS device before the
      // form is cleared, so "Riders" and "Delete" keep working after a reload.
      const next = recordRideCode(rideCodes, rideKey(details), code);
      setRideCodes(next);
      saveRideCodeMap(next);
      setMyCode(code);
      setFrom(''); setTo('VIT Chennai'); setDate(''); setTime(''); setSeats(3); setNotes(''); setContact(''); setShowPost(false);
      await load(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not post your ride.';
      if (message === RIDE_BOARD_BACKEND_MESSAGE) setBackendOutdated(true);
      else setError(humanErrorCopy(message, 'Could not post your ride.'));
    } finally { setPosting(false); }
  };

  const join = async (id: number) => {
    setError(null);
    try {
      const result = await joinCabRide(id, memberToken(id), deviceCode);
      if (!result.joined) setError('That ride is full — someone took the last seat.');
      else { setJoined((current) => ({ ...current, [id]: true })); setMemberAware((current) => ({ ...current, [id]: result.memberAware })); await load(true); }
    } catch (err) {
      if (err instanceof CabShareJoinError) {
        if (err.kind === 'backend') setBackendOutdated(true);
        else setError(err.message);
      } else setError(humanErrorCopy(err, 'Could not join that ride.'));
    }
  };

  const leave = async (id: number) => {
    setError(null);
    try {
      const ok = await leaveCabRide(id, memberToken(id));
      if (!ok) setError('This browser has no active seat reservation for that ride.');
      else { clearMemberToken(id); setJoined((current) => ({ ...current, [id]: false })); await load(true); }
    } catch (err) { setError(humanErrorCopy(err, 'Could not leave that ride.')); }
  };

  const remove = async (ride: CabRide, code: string) => {
    try {
      const ok = await deleteCabRide(ride.id, code);
      if (!ok) setError('Wrong poster code — the ride was not deleted.');
      else {
        const key = rideKey(ride);
        const next = consumeRideCode(rideCodes, key, code);
        setRideCodes(next);
        saveRideCodeMap(next);
        await load(true);
      }
    } catch { setError('Could not delete that ride (is your poster code correct?).'); }
  };

  return (
    <div className="community-page cabshare-page">
      <div className="community-page-heading">
        <div><span className="community-eyebrow">Campus services · community board</span><h2>Cab Share</h2><p>Coordinate rides to and from VIT Chennai with other students.</p></div>
        <button
          onClick={() => { if (!numberSaved) { setError('Save your contact number first — it keeps the ride board accountable and enables confirmed contact exchange.'); return; } setShowPost((value) => !value); }}
          className="portal-primary-button"
        >
          <Plus className="h-4 w-4" /> Post a ride
        </button>
      </div>

      <div className="community-stat-grid">
        <Stat label="Open rides" value={String(openRides.length)} />
        <Stat label="Seats available" value={String(seatsAvailable)} />
        <Stat label="Listed rides" value={String(rides.length)} />
        <div className="community-live-state"><span className="live-dot" /> <span>Live board</span><small>{refreshing ? 'Updating…' : realtimeStatus === 'live' ? 'Realtime updates' : 'Refreshes every few seconds'}</small><button onClick={() => void load(true)} aria-label="Refresh cab board"><RefreshCw className={refreshing ? 'spin' : ''} /></button></div>
      </div>

      {backendOutdated && (
        <div className="community-panel backend-update-panel" role="status" aria-live="polite">
          <div className="community-panel-heading">
            <div>
              <h3><WifiOff className="h-4 w-4 inline" /> Ride board is read-only right now</h3>
              <p>{RIDE_BOARD_BACKEND_MESSAGE}</p>
            </div>
          </div>
          <p className="phone-privacy-note">Nothing on this device was changed. This is a setting on the shared board itself and clears once it is updated — please check back a little later.</p>
          <div className="phone-panel-actions">
            <button className="portal-secondary-button" onClick={() => void load(true)}>
              <RefreshCw className={refreshing ? 'spin' : ''} /> Re-check the board
            </button>
          </div>
        </div>
      )}

      <PhonePanel state={phone} loading={phoneLoading} deviceCode={deviceCode} dispatch={dispatchPhone} onBackendOutdated={() => setBackendOutdated(true)} />

      {error && <div className="community-alert error"><WifiOff className="h-4 w-4" /><span>{error}</span></div>}
      {/* Rendered at page level on purpose: it used to sit inside the post
          panel, which the submit handler closes — so the poster code, the one
          thing needed to manage the ride, was never actually shown. */}
      {myCode && <div className="community-success">Ride posted. Your poster code is <strong>{myCode}</strong>; this device keeps it so “Riders” and “Delete” work on your listing without typing it back in. Keep the code if you post from another phone.</div>}

      {showPost && (
        <div className="community-panel cab-post-panel">
          <div className="community-panel-heading"><div><h3>Post a ride</h3><p>Only the details you enter are shared on this public board.</p></div><ShieldAlert className="h-5 w-5" /></div>
          <div className="community-form-grid">
            <Field label="From"><input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="e.g. T. Nagar, Porur…" maxLength={120} /></Field>
            <Field label="To"><input value={to} onChange={(e) => setTo(e.target.value)} placeholder="e.g. VIT Chennai" maxLength={120} /></Field>
            <Field label="Date"><input type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Time"><input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
            <Field label="Seats available"><select value={seats} onChange={(e) => setSeats(Number(e.target.value))}>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>
            <Field label="Contact handle (optional — Telegram/Instagram, not your phone)"><input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="e.g. @your_handle" maxLength={100} /></Field>
            <Field label="Notes (optional)" wide><input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Pickup details or fare notes" maxLength={240} /></Field>
          </div>
          <div className="community-form-footer"><p><ShieldAlert className="h-3.5 w-3.5" /> No registration number is stored. Your contact number is shared ONLY with ride partners you confirm. This device remembers the poster code for rides you publish.</p><button onClick={() => void submit()} disabled={posting || !numberSaved || !from.trim() || !to.trim() || !date || !time} className="portal-primary-button">{posting ? 'Posting…' : 'Publish ride'}</button></div>
        </div>
      )}

      <div className="community-panel">
        <div className="community-panel-heading ride-board-heading"><div><h3>Ride board</h3><p>Seat counts update live as riders join and leave.</p></div><div className="ride-board-actions"><button className={showExpired ? 'selected' : ''} onClick={() => setShowExpired((value) => !value)}>{showExpired ? 'Hide expired' : 'Show expired'}</button></div></div>
        {loading && <div className="community-empty"><Loader2 className="spin" /><span>Loading the live ride board…</span></div>}
        {!loading && visibleRides.length === 0 && <div className="community-empty"><Car /><span>{rides.length ? 'No current rides match this view.' : 'No rides have been posted yet.'}<small>Post a ride when you know your route and departure time.</small></span></div>}
        {!loading && visibleRides.length > 0 && <div className="ride-list">{visibleRides.map(({ ride, state }) => <RideRow key={ride.id} ride={ride} state={state} isJoined={Boolean(joined[ride.id]) || hasMemberToken(ride.id)} canLeave={Boolean(memberAware[ride.id]) || hasMemberToken(ride.id)} ownedCode={posterCodeForRide(rideCodes, rideKey(ride))} onJoin={join} onLeave={leave} onDelete={remove} />)}</div>}
      </div>

      <div className="community-note"><Info className="h-4 w-4" /><span>Cab Share is a student-created community board, not an official VIT transport booking service. Phone numbers stay private until a rider and the poster mutually confirm; either side can hide their number at any time. Verify the driver and pickup details yourself before travelling.</span></div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Contact number panel (plain model — save / hide / change; no verification)
// ---------------------------------------------------------------------------

type PhoneAction = Parameters<typeof phoneIdentityReducer>[1];

export const PhonePanel: React.FC<{
  state: PhoneIdentityState;
  loading: boolean;
  deviceCode: string;
  dispatch: (action: PhoneAction) => void;
  /** Raised when the deployment's backend is behind the app version. */
  onBackendOutdated?: () => void;
}> = ({ state, loading, deviceCode, dispatch, onBackendOutdated }) => {
  const [rawPhone, setRawPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);

  if (loading) {
    return <div className="community-panel"><div className="community-empty"><Loader2 className="spin" /><span>Checking your saved contact number…</span></div></div>;
  }

  if (state.phase === 'saved') {
    return (
      <div className="community-panel phone-panel">
        <div className="community-panel-heading">
          <div>
            <h3><Phone className="h-4 w-4 inline text-emerald-600" /> Contact number saved</h3>
            <p>Your number on this device: <strong>{maskedPhone(state.last4)}</strong></p>
          </div>
        </div>
        <div className="phone-panel-actions">
          <label className="phone-hide-toggle">
            <input
              type="checkbox"
              checked={state.hideNumber}
              onChange={async (e) => {
                const hide = e.target.checked;
                try {
                  const ok = await setPhoneVisibility(deviceCode, hide);
                  if (ok) dispatch({ type: 'HIDE_TOGGLED', hideNumber: hide });
                } catch {
                  setNotice({ kind: 'error', text: 'Could not update the visibility preference.' });
                }
              }}
            />
            <EyeOff className="h-4 w-4" /> Hide my number (ride partners see a masked fragment)
          </label>
          <button
            className="portal-secondary-button"
            onClick={async () => {
              try {
                const ok = await revokePhone(deviceCode);
                if (ok) { dispatch({ type: 'REVOKED' }); setNotice({ kind: 'info', text: 'Number removed. Save a new number to post or join rides.' }); }
              } catch {
                setNotice({ kind: 'error', text: 'Could not remove the number right now.' });
              }
            }}
          >
            Change number
          </button>
        </div>
        {notice && <p className={`phone-notice ${notice.kind}`}>{notice.text}</p>}
        <p className="phone-privacy-note">UltraCC never shows your full number on the board. It is shared only with ride partners after mutual confirmation — or with nobody, if you hide it.</p>
      </div>
    );
  }

  return (
    <div className="community-panel phone-panel">
      <div className="community-panel-heading">
        <div><h3><Phone className="h-4 w-4 inline text-blue-600" /> Your contact number</h3><p>Posting and joining rides require a contact number on this device. Your number stays private.</p></div>
        <ShieldAlert className="h-5 w-5" />
      </div>
      <div className="phone-code-row">
        <input
          value={rawPhone}
          onChange={(e) => setRawPhone(e.target.value)}
          inputMode="tel"
          placeholder="98765 43210"
          aria-label="Mobile number"
          maxLength={20}
        />
        <button
          className="portal-primary-button"
          disabled={busy || !rawPhone.trim()}
          onClick={async () => {
            const normalized = normalizeToE164(rawPhone);
            if (!normalized.ok) { setNotice({ kind: 'error', text: normalized.reason || 'Enter a valid number.' }); return; }
            setBusy(true); setNotice(null);
            try {
              const identity = await savePhoneIdentity(deviceCode, normalized.e164);
              dispatch({ type: 'SAVED', last4: identity.last4 || '', hideNumber: Boolean(identity.hideNumber) });
              setRawPhone('');
            } catch (err) {
              const message = err instanceof Error ? err.message : 'Could not save the number.';
              if (err instanceof PhoneError && err.code === 'BACKEND_OUTDATED') {
                // The panel above explains this properly; keep the inline
                // notice short so the fix is read once, not twice.
                setNotice({ kind: 'error', text: 'Saving is unavailable right now — the notice above explains why.' });
                onBackendOutdated?.();
              } else {
                setNotice({ kind: 'error', text: message });
              }
            } finally { setBusy(false); }
          }}
        >
          {busy ? 'Saving…' : 'Save number'}
        </button>
      </div>
      {notice && <p className={`phone-notice ${notice.kind}`}>{notice.text}</p>}
      <p className="phone-privacy-note">Your number is normalized to international format and stored for this device only. It is never displayed publicly and never shared before mutual ride confirmation.</p>
    </div>
  );
};

interface RideRowProps {
  key?: React.Key;
  ride: CabRide;
  state: CabRideState;
  isJoined: boolean;
  canLeave: boolean;
  /** Poster code this device earned for the ride, when it posted it. */
  ownedCode: string | null;
  onJoin: (id: number) => void;
  onLeave: (id: number) => void;
  onDelete: (ride: CabRide, code: string) => void;
}

function RideRow({ ride, state, isJoined, canLeave, ownedCode, onJoin, onLeave, onDelete }: RideRowProps) {
  const participantCount = getCabParticipantCount(ride);
  // Poster tools: rider confirmation + contact exchange.
  const [members, setMembers] = useState<{ memberCode: string; posterConfirmed: boolean; last4?: string | null }[] | null>(null);
  const [reveal, setReveal] = useState<{ code: string; result: ContactReveal } | null>(null);
  // Rider tools: reveal the poster's number after confirmation.
  const [posterContact, setPosterContact] = useState<ContactReveal | null>(null);

  /**
   * This device's own rides need no typing — the stored code is used. For any
   * other ride the manual prompt stays, so a student who posted from another
   * phone and saved the code can still act on it.
   */
  const resolveCode = (promptText: string): string | null => {
    if (ownedCode) return ownedCode;
    const typed = window.prompt(promptText);
    return typed?.trim() || null;
  };

  const openPosterTools = async () => {
    const code = resolveCode('Enter YOUR poster code to manage riders:');
    if (!code) return;
    try {
      const list = await listRideMembers(ride.id, code);
      if (!list) { window.alert('Wrong poster code — this ride is not yours to manage.'); return; }
      setMembers(list);
    } catch {
      window.alert('Could not load the rider list right now.');
    }
  };

  return <article className={`ride-row ${state}`}>
    <div className="ride-route"><span className="ride-state-badge">{state === 'expired' ? 'Expired' : state === 'full' ? 'Full' : 'Open'}</span><strong>{ride.from_place}</strong><span className="ride-arrow">→</span><strong>{ride.to_place}</strong></div>
    <div className="ride-meta"><span><Clock /> {ride.travel_date} · {ride.travel_time}</span><span><Users /> {participantCount}/{ride.seats} joined</span>{ownedCode && <span className="ride-expiry">posted on this device</span>}</div>
    {ride.notes && <p className="ride-notes">{ride.notes}</p>}
    {ride.contact && <p className="ride-contact">Contact: {ride.contact}</p>}
    <div className="ride-actions">
      {state === 'open' && (isJoined ? (canLeave ? <button onClick={() => onLeave(ride.id)} className="portal-secondary-button"><LogOut /> Leave ride</button> : <span className="ride-expiry">Joined · leave unavailable on this server</span>) : <button onClick={() => onJoin(ride.id)} className="portal-primary-button"><Users /> Join ride</button>)}
      {state === 'expired' && <span className="ride-expiry">This departure time has passed.</span>}
      <button onClick={openPosterTools} className="ride-delete" title="Confirm riders / exchange contacts (poster)"><UserCheck /> Riders</button>
      <button onClick={() => { const code = resolveCode('Enter the poster code to delete this ride:'); if (code) onDelete(ride, code); }} className="ride-delete"><Trash2 /> Delete</button>
    </div>
    {isJoined && (
      <div className="ride-contact-exchange">
        <button
          className="portal-secondary-button"            onClick={async () => {
              const myCode = memberToken(ride.id);
              try {
                const result = await revealMemberContact(ride.id, myCode, myCode);
                setPosterContact(result);
              } catch {
                setPosterContact({ status: 'unavailable' });
              }
            }}
        >
          <MessageCircle className="h-4 w-4" /> Ride contact
        </button>
        {posterContact && (
          <ContactStatusLine
            result={posterContact}
            onConfirmRequest={() => window.alert('The poster has not confirmed your seat yet. Ask them to open "Riders" and confirm you — then contact details unlock for both sides.')}
          />
        )}
      </div>
    )}
    {members && members.length === 0 && <p className="ride-notes">No riders have joined yet.</p>}
    {members && members.length > 0 && (
      <div className="ride-member-list">
        {members.map((m) => (
          <div key={m.memberCode} className="ride-member-row">
            <span>{m.last4 ? `rider •••• ${m.last4}` : 'rider'}{m.posterConfirmed ? ' · confirmed' : ''}</span>
            <span className="ride-member-actions">
              {!m.posterConfirmed && <button onClick={async () => {
                const code = resolveCode('Enter YOUR poster code to confirm this rider:');
                if (!code) return;
                try {
                  const ok = await confirmRideMember(ride.id, code, m.memberCode);
                  if (ok) setMembers((current) => current ? current.map((x) => x.memberCode === m.memberCode ? { ...x, posterConfirmed: true } : x) : current);
                } catch { window.alert('Could not confirm that rider.'); }
              }} className="portal-secondary-button"><UserCheck className="h-3.5 w-3.5" /> Confirm</button>}
              {m.posterConfirmed && <button onClick={async () => {
                const code = resolveCode("Enter YOUR poster code to reveal this rider's number:");
                if (!code) return;
                try {
                  const result = await revealMemberContact(ride.id, code, m.memberCode);
                  setReveal({ code: m.memberCode, result });
                } catch { window.alert('Could not fetch the contact.'); }
              }} className="portal-secondary-button"><MessageCircle className="h-3.5 w-3.5" /> Contact</button>}
            </span>
          </div>
        ))}
        {reveal && <ContactStatusLine result={reveal.result} onConfirmRequest={() => undefined} />}
      </div>
    )}
  </article>;
}

export function ContactStatusLine({ result, onConfirmRequest }: { result: ContactReveal; onConfirmRequest: () => void }) {
  if (result.status === 'ok') return <p className="ride-contact">Ride partner: <a href={`tel:${result.phone}`}>{result.phone}</a></p>;
  if (result.status === 'hidden') return <p className="ride-contact">Number hidden by your ride partner — {result.masked}</p>;
  if (result.status === 'awaiting_confirmation' || result.status === 'needs_confirmation') {
    return <p className="ride-contact">Contact unlocks after mutual confirmation. <button className="ride-inline-link" onClick={onConfirmRequest}>How it works</button></p>;
  }
  if (result.status === 'unavailable' || result.status === 'not_found') return <p className="ride-contact">Ride partner has no contact number available.</p>;
  return <p className="ride-contact">Contact details are not available.</p>;
}

function Stat({ label, value }: { label: string; value: string }) { return <div className="community-stat"><span>{label}</span><strong>{value}</strong></div>; }

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) { return <label className={`community-field ${wide ? 'wide' : ''}`}><span>{label}</span>{children}</label>; }

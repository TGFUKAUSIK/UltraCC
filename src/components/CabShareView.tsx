import React, { useEffect, useMemo, useReducer, useState } from 'react';
import {
  Plus, Users, Clock, Loader2, WifiOff, Trash2, ShieldAlert, RefreshCw, LogOut, Info,
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
import { showToast } from '../lib/toast';
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
    <div className="uc-index pb-12">
      <section className="uc-plate uc-dir-mast">
        <div className="uc-dir-head">
          <div className="uc-dir-id">
            <span className="uc-cap">Campus services · community board</span>
            <h2 className="uc-dir-name">Cab share</h2>
            <p className="uc-note">Coordinate rides to and from VIT Chennai with other students.</p>
          </div>
          <div className="uc-dir-rail">
            <button onClick={() => void load(true)} aria-label="Refresh cab board" className="uc-dir-go"><RefreshCw className={refreshing ? 'spin' : ''} aria-hidden="true" /></button>
            <button
              onClick={() => { if (!numberSaved) { setError('Save your contact number first — it keeps the ride board accountable and enables confirmed contact exchange.'); return; } setShowPost((value) => !value); }}
              className="uc-dir-go acc-bg"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Post a ride
            </button>
          </div>
        </div>
        <dl className="uc-facts">
          <div><dt>Open rides</dt><dd className="uc-num">{openRides.length}</dd></div>
          <div><dt>Seats available</dt><dd className="uc-num">{seatsAvailable}</dd></div>
          <div><dt>Listed rides</dt><dd className="uc-num">{rides.length}</dd></div>
          <div><dt>Live board</dt><dd>{refreshing ? 'Updating…' : realtimeStatus === 'live' ? 'Realtime updates' : 'Refreshes every few seconds'}</dd></div>
        </dl>
      </section>

      {backendOutdated && (
        <section className="uc-plate" role="status" aria-live="polite">
          <div className="uc-plate-head"><span className="uc-cap">Ride board is read-only right now</span><WifiOff className="h-4 w-4" aria-hidden="true" /></div>
          <div className="uc-dir-detail">
            <p className="uc-dir-sub is-ink">{RIDE_BOARD_BACKEND_MESSAGE}</p>
            <p className="uc-dir-note uc-dir-sub">Nothing on this device was changed. This is a setting on the shared board itself and clears once it is updated — please check back a little later.</p>
            <div className="uc-dir-form-foot">
              <button className="uc-dir-go" onClick={() => void load(true)}><RefreshCw className={refreshing ? 'spin' : ''} aria-hidden="true" /> Re-check the board</button>
            </div>
          </div>
        </section>
      )}

      <PhonePanel state={phone} loading={phoneLoading} deviceCode={deviceCode} dispatch={dispatchPhone} onBackendOutdated={() => setBackendOutdated(true)} />

      {error && <div className="uc-dir-alert"><WifiOff aria-hidden="true" /><span>{error}</span></div>}
      {/* Rendered at page level on purpose: it used to sit inside the post
          panel, which the submit handler closes — so the poster code, the one
          thing needed to manage the ride, was never actually shown. */}
      {myCode && <div className="uc-note-row uc-note-row--good"><span>Ride posted. Your poster code is <b className="uc-num">{myCode}</b>; this device keeps it so “Riders” and “Delete” work on your listing without typing it back in. Keep the code if you post from another phone.</span></div>}

      {showPost && (
        <section className="uc-plate">
          <div className="uc-plate-head"><span className="uc-cap">Post a ride</span><ShieldAlert className="h-4 w-4" aria-hidden="true" /></div>
          <div className="uc-dir-detail">
            <p className="uc-dir-sub">Only the details you enter are shared on this public board.</p>
            <div className="uc-dir-form">
              <Field label="From"><input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="e.g. T. Nagar, Porur…" maxLength={120} className="uc-dir-input" /></Field>
              <Field label="To"><input value={to} onChange={(e) => setTo(e.target.value)} placeholder="e.g. VIT Chennai" maxLength={120} className="uc-dir-input" /></Field>
              <Field label="Date"><input type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} className="uc-dir-input uc-num" /></Field>
              <Field label="Time"><input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="uc-dir-input uc-num" /></Field>
              <Field label="Seats available"><select value={seats} onChange={(e) => setSeats(Number(e.target.value))} className="uc-dir-select">{[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>
              <Field label="Contact handle (optional — Telegram/Instagram, not your phone)"><input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="e.g. @your_handle" maxLength={100} className="uc-dir-input" /></Field>
              <Field label="Notes (optional)" wide><input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Pickup details or fare notes" maxLength={240} className="uc-dir-input" /></Field>
            </div>
            <div className="uc-dir-form-foot">
              <p className="uc-dir-note uc-dir-sub"><ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" /> No registration number is stored. Your contact number is shared ONLY with ride partners you confirm. This device remembers the poster code for rides you publish.</p>
              <button onClick={() => void submit()} disabled={posting || !numberSaved || !from.trim() || !to.trim() || !date || !time} className="uc-dir-go acc-bg">{posting ? 'Posting…' : 'Publish ride'}</button>
            </div>
          </div>
        </section>
      )}

      <section className="uc-plate uc-dir-ledger">
        <div className="uc-plate-head">
          <span className="uc-cap">Ride board</span>
          <button className={`uc-dir-go ${showExpired ? 'is-on' : ''}`} onClick={() => setShowExpired((value) => !value)}>{showExpired ? 'Hide expired' : 'Show expired'}</button>
        </div>
        {loading && <div className="uc-dir-loading"><Loader2 className="spin" aria-hidden="true" /><span>Loading the live ride board…</span></div>}
        {!loading && visibleRides.length === 0 && <div className="uc-dir-blank"><b>{rides.length ? 'No current rides match this view.' : 'No rides have been posted yet.'}</b> Post a ride when you know your route and departure time.</div>}
        {!loading && visibleRides.length > 0 && <div className="uc-dir-cards">{visibleRides.map(({ ride, state }) => <RideRow key={ride.id} ride={ride} state={state} isJoined={Boolean(joined[ride.id]) || hasMemberToken(ride.id)} canLeave={Boolean(memberAware[ride.id]) || hasMemberToken(ride.id)} ownedCode={posterCodeForRide(rideCodes, rideKey(ride))} onJoin={join} onLeave={leave} onDelete={remove} />)}</div>}
      </section>

      <div className="uc-note-row"><Info aria-hidden="true" /><span>Cab Share is a student-created community board, not an official VIT transport booking service. Phone numbers stay private until a rider and the poster mutually confirm; either side can hide their number at any time. Verify the driver and pickup details yourself before travelling.</span></div>
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
    return <section className="uc-plate"><div className="uc-dir-loading"><Loader2 className="spin" aria-hidden="true" /><span>Checking your saved contact number…</span></div></section>;
  }

  if (state.phase === 'saved') {
    return (
      <section className="uc-plate">
        <div className="uc-plate-head"><span className="uc-cap">Contact number saved</span><Phone className="h-4 w-4" aria-hidden="true" /></div>
        <div className="uc-dir-detail">
          <p className="uc-dir-sub">Your number on this device: <b className="uc-num">{maskedPhone(state.last4)}</b></p>
          <label className="uc-phone-toggle">
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
            <EyeOff className="h-4 w-4" aria-hidden="true" /> Hide my number (ride partners see a masked fragment)
          </label>
          <div className="uc-dir-form-foot">
            <button
              className="uc-dir-go"
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
          {notice && <p className="uc-dir-note uc-dir-sub">{notice.text}</p>}
          <p className="uc-dir-note uc-dir-sub">UltraCC never shows your full number on the board. It is shared only with ride partners after mutual confirmation — or with nobody, if you hide it.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="uc-plate">
      <div className="uc-plate-head"><span className="uc-cap">Your contact number</span><ShieldAlert className="h-4 w-4" aria-hidden="true" /></div>
      <div className="uc-dir-detail">
        <p className="uc-dir-sub">Posting and joining rides require a contact number on this device. Your number stays private.</p>
        <div className="uc-dir-form">
          <label className="uc-dir-field">
            <span>Mobile number</span>
            <input
              value={rawPhone}
              onChange={(e) => setRawPhone(e.target.value)}
              inputMode="tel"
              placeholder="98765 43210"
              aria-label="Mobile number"
              maxLength={20}
              className="uc-dir-input uc-num"
            />
          </label>
          <div className="uc-dir-form-foot">
            <button
              className="uc-dir-go acc-bg"
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
        </div>
        {notice && <p className="uc-dir-note uc-dir-sub">{notice.text}</p>}
        <p className="uc-dir-note uc-dir-sub">Your number is normalized to international format and stored for this device only. It is never displayed publicly and never shared before mutual ride confirmation.</p>
      </div>
    </section>
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

/**
 * What a poster code is being asked for. The code gates four different
 * actions, so the ask is data rather than a modal: the row remembers what the
 * student tapped and runs it once the code is typed.
 */
type CodeTask =
  | { kind: 'riders' }
  | { kind: 'delete' }
  | { kind: 'confirm'; memberCode: string }
  | { kind: 'reveal'; memberCode: string };

const CODE_TASK_COPY: Record<CodeTask['kind'], string> = {
  riders: 'Open the rider list',
  delete: 'Delete this ride',
  confirm: 'Confirm this rider',
  reveal: 'Show this rider’s number',
};

function RideRow({ ride, state, isJoined, canLeave, ownedCode, onJoin, onLeave, onDelete }: RideRowProps) {
  const participantCount = getCabParticipantCount(ride);
  // Poster tools: rider confirmation + contact exchange.
  const [members, setMembers] = useState<{ memberCode: string; posterConfirmed: boolean; last4?: string | null }[] | null>(null);
  const [reveal, setReveal] = useState<{ code: string; result: ContactReveal } | null>(null);
  // Rider tools: reveal the poster's number after confirmation.
  const [posterContact, setPosterContact] = useState<ContactReveal | null>(null);
  // The pending poster-only action, and the code typed for it.
  const [task, setTask] = useState<CodeTask | null>(null);
  const [typedCode, setTypedCode] = useState('');

  const runTask = async (action: CodeTask, code: string) => {
    if (action.kind === 'riders') {
      try {
        const list = await listRideMembers(ride.id, code);
        if (!list) {
          showToast({ title: 'Wrong poster code', message: 'That ride is not yours to manage. The code is the one shown when you posted it.', type: 'warning' });
          return;
        }
        setMembers(list);
      } catch {
        showToast({ title: 'Rider list not loaded', message: 'Try again in a moment.', type: 'error' });
      }
      return;
    }
    if (action.kind === 'delete') {
      onDelete(ride, code);
      return;
    }
    if (action.kind === 'confirm') {
      try {
        const ok = await confirmRideMember(ride.id, code, action.memberCode);
        if (ok)
          setMembers((current) => current
            ? current.map((x) => (x.memberCode === action.memberCode ? { ...x, posterConfirmed: true } : x))
            : current);
        else
          showToast({ title: 'Wrong poster code', message: 'The rider is still waiting for confirmation.', type: 'warning' });
      } catch {
        showToast({ title: 'Could not confirm that rider', message: 'Try again in a moment.', type: 'error' });
      }
      return;
    }
    try {
      const result = await revealMemberContact(ride.id, code, action.memberCode);
      setReveal({ code: action.memberCode, result });
    } catch {
      showToast({ title: 'Number not available', message: 'Try again in a moment.', type: 'error' });
    }
  };

  /**
   * This device's own rides need no typing — the stored code is used. For any
   * other ride the code is asked for in the row itself. It used to be
   * `window.prompt`, which iOS silently answers with null in a home-screen
   * PWA: four buttons on every ride did nothing at all on the phone most
   * students use.
   */
  const request = (action: CodeTask) => {
    if (ownedCode) { void runTask(action, ownedCode); return; }
    setTypedCode('');
    setTask(action);
  };

  const submitCode = (event: React.FormEvent) => {
    event.preventDefault();
    const code = typedCode.trim();
    if (!code || !task) return;
    const action = task;
    setTask(null);
    setTypedCode('');
    void runTask(action, code);
  };

  const stateTag = state === 'expired' ? 'uc-dir-tag' : state === 'full' ? 'uc-dir-tag is-warn' : 'uc-dir-tag is-good';

  return <article className="uc-dir-card">
    <div className="uc-dir-card-top">
      <div className="uc-dir-main">
        <h3 className="uc-dir-title">{ride.from_place} → {ride.to_place}</h3>
        <div className="uc-dir-tags">
          <span className="uc-dir-tag"><Clock aria-hidden="true" /> <span className="uc-num">{ride.travel_date} · {ride.travel_time}</span></span>
          <span className="uc-dir-tag"><Users aria-hidden="true" /> <span className="uc-num">{participantCount}/{ride.seats}</span> joined</span>
          {ownedCode && <span className="uc-dir-tag is-live">posted on this device</span>}
        </div>
      </div>
      <span className={stateTag}>{state === 'expired' ? 'Expired' : state === 'full' ? 'Full' : 'Open'}</span>
    </div>
    {ride.notes && <p className="uc-dir-sub">{ride.notes}</p>}
    {ride.contact && <p className="uc-dir-sub">Contact: <span className="uc-num">{ride.contact}</span></p>}
    <div className="uc-dir-card-foot">
      <div className="uc-dir-acts">
        {state === 'open' && (isJoined ? (canLeave ? <button onClick={() => onLeave(ride.id)} className="uc-dir-go"><LogOut className="h-3.5 w-3.5" aria-hidden="true" /> Leave ride</button> : <span className="uc-dir-sub">Joined · leave unavailable on this server</span>) : <button onClick={() => onJoin(ride.id)} className="uc-dir-go acc-bg"><Users className="h-3.5 w-3.5" aria-hidden="true" /> Join ride</button>)}
        {state === 'expired' && <span className="uc-dir-sub">This departure time has passed.</span>}
        <button onClick={() => request({ kind: 'riders' })} className="uc-dir-go" title="Confirm riders / exchange contacts (poster)"><UserCheck className="h-3.5 w-3.5" aria-hidden="true" /> Riders</button>
        <button onClick={() => request({ kind: 'delete' })} className="uc-dir-go"><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Delete</button>
      </div>
    </div>
    {task && (
      <form className="uc-ride-code" onSubmit={submitCode}>
        <label className="uc-dir-field">
          <span>Your poster code</span>
          <input
            autoFocus
            value={typedCode}
            onChange={(e) => setTypedCode(e.target.value)}
            placeholder="Code shown when you posted this ride"
            aria-label="Poster code"
            className="uc-dir-input uc-num"
          />
        </label>
        <p className="uc-dir-sub">Only the person who posted this ride has the code. {CODE_TASK_COPY[task.kind]}.</p>
        <div className="uc-dir-form-foot">
          <button type="submit" className="uc-dir-go acc-bg" disabled={!typedCode.trim()}>Continue</button>
          <button type="button" className="uc-dir-go" onClick={() => setTask(null)}>Cancel</button>
        </div>
      </form>
    )}
    {isJoined && (
      <div className="uc-ride-members">
        <button
          className="uc-dir-go"
          onClick={async () => {
            const myCode = memberToken(ride.id);
            try {
              const result = await revealMemberContact(ride.id, myCode, myCode);
              setPosterContact(result);
            } catch {
              setPosterContact({ status: 'unavailable' });
            }
          }}
        >
          <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" /> Ride contact
        </button>
        {posterContact && (
          <ContactStatusLine
            result={posterContact}
            onConfirmRequest={() => showToast({ title: 'Waiting on the poster', message: 'They confirm riders from the "Riders" button on this ride. Once confirmed, both numbers unlock.', type: 'info', duration: 6000 })}
          />
        )}
      </div>
    )}
    {members && members.length === 0 && <p className="uc-dir-sub">No riders have joined yet.</p>}
    {members && members.length > 0 && (
      <div className="uc-ride-members">
        {members.map((m) => (
          <div key={m.memberCode} className="uc-ride-member">
            <span className="uc-num">{m.last4 ? `rider •••• ${m.last4}` : 'rider'}{m.posterConfirmed ? ' · confirmed' : ''}</span>
            <span className="uc-dir-acts">
              {!m.posterConfirmed && <button onClick={() => request({ kind: 'confirm', memberCode: m.memberCode })} className="uc-dir-go"><UserCheck className="h-3.5 w-3.5" aria-hidden="true" /> Confirm</button>}
              {m.posterConfirmed && <button onClick={() => request({ kind: 'reveal', memberCode: m.memberCode })} className="uc-dir-go"><MessageCircle className="h-3.5 w-3.5" aria-hidden="true" /> Contact</button>}
            </span>
          </div>
        ))}
        {reveal && <ContactStatusLine result={reveal.result} onConfirmRequest={() => undefined} />}
      </div>
    )}
  </article>;
}

export function ContactStatusLine({ result, onConfirmRequest }: { result: ContactReveal; onConfirmRequest: () => void }) {
  if (result.status === 'ok') return <p className="uc-dir-sub">Ride partner: <a href={`tel:${result.phone}`} className="uc-num">{result.phone}</a></p>;
  if (result.status === 'hidden') return <p className="uc-dir-sub">Number hidden by your ride partner — <span className="uc-num">{result.masked}</span></p>;
  if (result.status === 'awaiting_confirmation' || result.status === 'needs_confirmation') {
    return <p className="uc-dir-sub">Contact unlocks after mutual confirmation. <button className="uc-dir-inline-link" onClick={onConfirmRequest}>How it works</button></p>;
  }
  if (result.status === 'unavailable' || result.status === 'not_found') return <p className="uc-dir-sub">Ride partner has no contact number available.</p>;
  return <p className="uc-dir-sub">Contact details are not available.</p>;
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) { return <label className={`uc-dir-field${wide ? ' uc-dir-field--wide' : ''}`}><span>{label}</span>{children}</label>; }

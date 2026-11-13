import React, { useState, useEffect, useRef } from 'react';
import {
  ShieldCheck, X, CheckCircle, RefreshCw, AlertCircle,
  KeyRound, Calendar, Eye, EyeOff, AlertTriangle,
} from 'lucide-react';
import { vtopDb, formatRelativeTime } from '../lib/db/vtopDatabase';
import { SemesterInfo } from '../lib/vtop/types';
import { isVtopError } from '../lib/vtop/errors';
import { humanErrorCopy } from '../lib/errorCopy';

import { getLiveClient, isLiveSessionActive, resetLiveClient } from '../lib/vtop/liveSession';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { isSyncInFlight, resetSyncCoordinator } from '../lib/vtop/syncCoordinator';
import { pickSemesterId, syncSemesterData, SyncDatasetResult } from '../lib/vtop/syncSemester';
import { getSavedCredentials } from '../lib/settings';
import { attemptAutoSignIn, readVtopCaptcha, MIN_AUTO_SUBMIT_CONFIDENCE } from '../lib/vtop/autoSignIn';
import { useDialog } from '../hooks/useDialog';
import { useSheetDrag } from '../hooks/useSheetDrag';

/**
 * VTOP's own login page.
 *
 * When VTOP answers "Invalid Credentials" the reason is on the account side,
 * not in this form: the login id is not one VTOP accepts, or the password has
 * expired / been changed there. The only place that can be settled is the
 * portal itself, so a credential rejection offers it as a one-click check.
 */
const VTOP_PORTAL_LOGIN_URL = 'https://vtopcc.vit.ac.in/vtop/login';

interface ExtensionSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDataSynced?: () => void | Promise<void>;
  onAccountSwitch?: () => void;
}



export const ExtensionSyncModal: React.FC<ExtensionSyncModalProps> = ({ isOpen, onClose, onDataSynced, onAccountSwitch }) => {
  const saved = getSavedCredentials();
  const [regNo, setRegNo] = useState(saved.regNo);
  const [password, setPassword] = useState(saved.password);
  const [showPassword, setShowPassword] = useState(false);
  const [captchaText, setCaptchaText] = useState('');
  const [captchaBase64, setCaptchaBase64] = useState<string>('');
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [captchaError, setCaptchaError] = useState<string | null>(null);
  const [autoLoginState, setAutoLoginState] = useState<'idle' | 'initializing' | 'solving-captcha' | 'submitting' | 'retrying' | 'syncing' | 'manual'>('idle');
  const [autoStatusMsg, setAutoStatusMsg] = useState('');
  const [semesters, setSemesters] = useState<SemesterInfo[]>([]);
  const [selectedSemester, setSelectedSemester] = useState<string>('');
  const [syncing, setSyncing] = useState(false);
  const [syncComplete, setSyncComplete] = useState(false);
  const [switchingSemester, setSwitchingSemester] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  // True when the last failure was VTOP rejecting the login id / password pair
  // (as opposed to the CAPTCHA, the session, or the network). Drives the
  // "verify on the portal" affordance below the error.
  const [credentialRejected, setCredentialRejected] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState(false);
  const [syncResults, setSyncResults] = useState<SyncDatasetResult[] | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<number | null>(null);
  const mounted = useRef(true);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  // The password the form was prefilled with when it opened (Settings /
  // browser autofill). VTOP answers "invalid credentials" for a pair that is
  // simply OUT OF DATE — the student changed it on the portal and this field
  // still holds the old one — and that case is invisible behind the dots. When
  // a credential rejection arrives with the prefilled value still in place, the
  // error says so instead of implying the student typed it wrong.
  const prefilledPasswordRef = useRef('');
  // Dialog semantics + keyboard support live in useDialog: Esc closes, Tab is
  // trapped inside the panel, and focus starts on (and returns from) the close
  // button so keyboard and screen-reader users never land behind the modal.
  const dialogRef = useDialog<HTMLDivElement>({ isOpen, onClose, initialFocus: closeBtnRef });
  // This is the tallest dialog in the app (CAPTCHA, security note, error list)
  // and the only one that never locked the page behind it: scrolling with the
  // trackpad moved the app under the backdrop and left the student mid-document
  // when they closed it.
  useBodyScrollLock(isOpen);

  // Throw-to-dismiss, the same gesture the More sheet and the timetable share
  // sheet already carry. It is inert while a sign-in is in flight: VTOP's
  // CAPTCHA is single-use, so a sheet flung away mid-login would throw the
  // armed image and the student's typed answer with it.
  const loginBusy = syncing || captchaLoading || (autoLoginState !== 'idle' && autoLoginState !== 'manual');
  const sheetDrag = useSheetDrag({ onDismiss: onClose, enabled: !loginBusy });

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (isOpen) {
      resetForm();
      void loadLastSyncTime();
      // Prefill from saved credentials (Settings).
      const creds = getSavedCredentials();
      if (creds.regNo) setRegNo(creds.regNo);
      if (creds.password) setPassword(creds.password);
      prefilledPasswordRef.current = creds.password;
      resetLiveClient();
      resetSyncCoordinator();
      void initLiveSession();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const resetForm = () => {
    setCaptchaText('');
    setCaptchaBase64('');
    setCaptchaError(null);
    setSyncError(null);
    setCredentialRejected(false);
    setSyncSuccess(false);
    setSyncResults(null);
    setSyncing(false);
    setSemesters([]);
    setSelectedSemester('');
    setSyncComplete(false);
    setSwitchingSemester(false);
    setAutoLoginState('idle');
    setAutoStatusMsg('');
  };

  const initLiveSession = async () => {
    const client = getLiveClient();
    setCaptchaLoading(true);
    setCaptchaError(null);
    try {
      const res = await client.initializeSession();
      if (!mounted.current) return;
      setCaptchaBase64(res.captchaImageBase64 || '');
      setCaptchaText('');
      if (!res.captchaImageBase64) {
        setCaptchaError('VTOP CAPTCHA image could not be loaded. VTOP may be unavailable — try refreshing.');
      } else {
        const result = await readVtopCaptcha(res.captchaImageBase64);
        if (!mounted.current) return;
        if (result.text && result.confidence >= MIN_AUTO_SUBMIT_CONFIDENCE) {
          // Only a confident read is offered as a pre-filled answer; a shaky one
          // would just be typed over — or worse, submitted as-is.
          setCaptchaText(result.text);
        }
      }
    } catch (err) {
      if (!mounted.current) return;
      setCaptchaError(humanErrorCopy(err, 'The CAPTCHA could not be loaded. Try again.'));
    } finally {
      if (mounted.current) setCaptchaLoading(false);
    }
  };

  /**
   * A sync that VTOP signed out halfway through is not a successful login.
   *
   * `syncSemesterData` reports every dataset it could not fetch and never
   * rethrows, so this is the only way the modal learns that the session died
   * during the ~30 requests it just made: asking the client, which is the one
   * thing that knows. Without it the flow ended in `onClose()` — "signed in" —
   * while the Syllabus tab immediately said the opposite, which is exactly the
   * contradiction that reads as UltraCC ignoring a working login.
   */
  const SESSION_LOST_MID_SYNC = 'VTOP signed this tab out partway through the refresh, so only the sections it managed to fetch are saved. Sign in again to finish the rest.';

  /** True when VTOP no longer recognises this tab after a sync. */
  const sessionLostDuringSync = (): boolean => !isLiveSessionActive();

  /**
   * Fully automatic login: the arm → CAPTCHA read → submit sequence (and its
   * retry/confidence policy) lives in `attemptAutoSignIn`, shared with a manual
   * refresh — which signs in silently and never opens this sheet unless VTOP
   * refuses the saved pair. This handler only turns that outcome into sheet
   * state, and on success continues into the semester sync.
   */
  const handleAutoLogin = async () => {
    if (!regNo || !password) {
      setSyncError('Enter your Registration Number and Password.');
      return;
    }
    if (isSyncInFlight()) {
      setSyncError('A background refresh is already running.');
      return;
    }

    await clearPreviousAccountIfNeeded();

    // The session on screen is already armed and already has an answer in the
    // CAPTCHA box — either typed by the student or prefilled by a confident
    // read. Re-initialising here would throw that answer away and spend the
    // next login attempt on a brand-new image, so submit what is showing.
    if (getLiveClient().hasSessionToken() && captchaText.trim()) {
      await handleLogin();
      return;
    }

    setAutoLoginState('initializing');
    setAutoStatusMsg('Connecting to VTOP…');
    setSyncError(null);
    setCredentialRejected(false);
    setSyncSuccess(false);
    setSyncComplete(false);

    const result = await attemptAutoSignIn({
      regNo,
      password,
      onProgress: (progress) => {
        if (!mounted.current) return;
        setCaptchaBase64(progress.captchaBase64);
        setAutoLoginState(progress.step);
        setAutoStatusMsg(progress.message);
      },
    });

    if (result.status !== 'ok') {
      if (!mounted.current) return;
      setAutoLoginState('manual');
      setAutoStatusMsg('');
      setCaptchaBase64(result.captchaBase64);
      switch (result.handover) {
        case 'no-captcha':
          setCaptchaError('VTOP CAPTCHA unavailable — please enter manually.');
          break;
        case 'unreadable':
          setCaptchaText('');
          setCaptchaError('Could not read CAPTCHA automatically — please type it.');
          break;
        case 'low-confidence':
          setCaptchaText('');
          setCaptchaError('The CAPTCHA was too unclear to read safely — please type the 6 characters shown.');
          break;
        case 'rejected':
          setCredentialRejected(true);
          setSyncError(result.message + stalePrefillHint(password));
          // VTOP consumes a CAPTCHA on any login answer, including this one,
          // so the image still on screen cannot be submitted again. Re-arm
          // now — otherwise the student who fixes their password and hits
          // sign in is answered "Invalid Captcha" for a code they read
          // perfectly, and the credential problem hides behind it.
          resetLiveClient();
          void initLiveSession();
          break;
        case 'captcha-exhausted':
          // Out of auto attempts — hand over, but keep the reason VTOP gave on
          // the last attempt. Saying only "failed after N retries" sent students
          // off to retype a CAPTCHA that was never the problem.
          setSyncError(`Auto-login could not get past VTOP's CAPTCHA — last attempt: ${result.message}`);
          break;
        case 'unavailable':
          setSyncError(
            result.code
              ? result.message
              : `VTOP error: ${humanErrorCopy(result.error ?? result.message, 'VTOP could not be reached. Please sign in normally.')}`,
          );
          break;
      }
      return;
    }

    // Login succeeded. LMS is intentionally NOT touched here — Moodle uses a
    // separate account and is synced from Settings → LMS Account.
    setAutoLoginState('syncing');
    setAutoStatusMsg('Login successful — syncing your semester data…');
    try {
      const client = getLiveClient();
      const semestersList = await client.getSemesters();
      if (!mounted.current) return;
      setSemesters(semestersList);
      const semId = pickSemesterId(selectedSemester, semestersList);
      setSelectedSemester(semId);

      const results = await syncSemesterData(client, semId, semestersList);
      if (!mounted.current) return;

      setSyncResults(results);
      const failed = results.filter((r) => !r.ok);
      const sessionGone = sessionLostDuringSync();
      setSyncSuccess(!sessionGone && failed.length === 0);
      setSyncComplete(true);
      setAutoLoginState('idle');
      setAutoStatusMsg('');
      setLastSyncTime(Date.now());
      if (onDataSynced) await onDataSynced();
      if (sessionGone) {
        // Keep the modal open and re-arm: the student needs a fresh CAPTCHA
        // to sign in again, and closing here would hide the incomplete sync.
        setAutoLoginState('manual');
        setSyncError(SESSION_LOST_MID_SYNC);
        resetLiveClient();
        void initLiveSession();
        return;
      }
      // Sign-in succeeded — always close. Partial dataset failures are
      // surfaced as a toast on the dashboard, not by keeping this open.
      onClose();
    } catch (err) {
      if (!mounted.current) return;
      setAutoLoginState('manual');
      setAutoStatusMsg('');
      setSyncError(
        isVtopError(err)
          ? err.message
          : `VTOP error: ${humanErrorCopy(err, 'VTOP could not be reached. Please sign in normally.')}`,
      );
    }
  };

  const handleRefreshCaptcha = async () => {
    setCaptchaError(null);
    setSyncError(null);
    setCredentialRejected(false);
    // Re-initialize the full session (needed so the new CAPTCHA matches the new CSRF)
    resetLiveClient();
    resetSyncCoordinator();
    await initLiveSession();
  };

  const loadLastSyncTime = async () => {
    const cached = await vtopDb.getAllData();
    if (cached?.metadata) {
      setLastSyncTime(cached.metadata.lastSyncedAt);
      if (cached.metadata.selectedSemesterId) setSelectedSemester(cached.metadata.selectedSemesterId);
    }
  };

  /**
   * VTOP answers "invalid credentials" for a pair that is merely out of date —
   * the student changed it on the portal while this form still holds the one
   * saved in Settings. That is invisible behind the password dots, so when a
   * rejection arrives with the prefilled value still in place the error names
   * it instead of implying the student typed something wrong.
   */
  const stalePrefillHint = (currentPassword: string): string =>
    currentPassword && currentPassword === prefilledPasswordRef.current
      ? ' The password in this box was filled in from Settings rather than typed just now — use the eye icon to read it, or retype your current VTOP password.'
      : '';

  const clearPreviousAccountIfNeeded = async () => {
    // Case-INsensitive on purpose: both sides are compared as VTOP sees them
    // (its own login field uppercases), and the cached key is the registration
    // number VTOP reported on the profile.
    const requestedRegNo = regNo.trim().toUpperCase();
    if (!requestedRegNo) return;
    // A custom username is a login ALIAS, not an identifier we can compare to
    // the cached registration number — matching them by string would read
    // "same student, different spelling" as an account switch and wipe the
    // offline cache and the saved LMS account on every sign-in. So only clear
    // up-front when both sides really are registration numbers; otherwise
    // `syncSemesterData` makes the call from the identity VTOP itself reported.
    const REG_NO_SHAPE = /^\d{2}[A-Z]{2,4}\d{4}$/;
    const cached = await vtopDb.getAllData();
    const cachedRegNo = cached?.metadata.registrationNo?.trim().toUpperCase() || '';
    if (REG_NO_SHAPE.test(requestedRegNo) && REG_NO_SHAPE.test(cachedRegNo) && cachedRegNo !== requestedRegNo) {
      await vtopDb.clear();
      onAccountSwitch?.();
    }
  };

  const handleLogin = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!getLiveClient().hasSessionToken()) {
      setSyncError('No active VTOP session. Refresh the CAPTCHA and try again.');
      return;
    }

    if (isSyncInFlight()) {
      setSyncError('A background refresh is already running — wait a moment and try again.');
      return;
    }

    setSyncing(true);
    setSyncError(null);
    setCredentialRejected(false);
    setSyncSuccess(false);

    try {
      await clearPreviousAccountIfNeeded();
      const client = getLiveClient();

      // 1. Login — credentials go over HTTPS to VTOP only.
      await client.login(regNo, password, captchaText);

      // 1b. LMS is intentionally NOT part of VTOP sign-in — Moodle uses a
      // separate account, synced from Settings → LMS Account (Sync Now).

      // 2. Fetch the semester list and pick the semester to sync.
      //    Prefer the student's saved selection (persisted in IndexedDB
      //    metadata) so re-logins never reset to an unexpected semester;
      //    fall back to VTOP's active semester, then the first option.
      const semestersList = await client.getSemesters();
      if (!mounted.current) return;
      setSemesters(semestersList);
      const semId = pickSemesterId(selectedSemester, semestersList);
      setSelectedSemester(semId);

      // 3. Fetch all real academic data for the chosen semester. Failures are
      //    reported per dataset (never silent) — see SyncDatasetResult.
      const results = await syncSemesterData(client, semId, semestersList);

      if (!mounted.current) return;
      setSyncResults(results);
      const failed = results.filter((r) => !r.ok);
      const sessionGone = sessionLostDuringSync();
      setSyncSuccess(!sessionGone && failed.length === 0);
      setSyncComplete(true);
      setLastSyncTime(Date.now());
      if (onDataSynced) await onDataSynced();
      if (sessionGone) {
        setSyncError(SESSION_LOST_MID_SYNC);
        resetLiveClient();
        void initLiveSession();
        return;
      }
      // Signed in — always close. Partial failures toast on the dashboard;
      // only a thrown error (login/session) keeps the modal open.
      onClose();
    } catch (err) {
      if (!mounted.current) return;
      const message = isVtopError(err) ? err.message : `VTOP sync failed: ${humanErrorCopy(err, 'VTOP could not be reached. Please try again.')}`;
      const rejected = isVtopError(err) && err.code === 'LOGIN_FAILED';
      setCredentialRejected(rejected);
      setSyncError(rejected ? message + stalePrefillHint(password) : message);
      // A VTOP CAPTCHA is single-use: after ANY failed login the old captcha
      // is consumed, so refresh automatically (also on session expiry and
      // parse errors, where the session state is uncertain).
      if (
        isVtopError(err) &&
        (err.code === 'CAPTCHA_FAILED' || err.code === 'SESSION_EXPIRED' || err.code === 'LOGIN_FAILED')
      ) {
        resetLiveClient();
        void initLiveSession();
      }
    } finally {
      if (mounted.current) setSyncing(false);
    }
  };

  /** Change semester after the initial sync: refetches semester-dependent data. */
  const handleSemesterChange = async (newId: string) => {
    if (!getLiveClient().hasSessionToken() || !newId || newId === selectedSemester || syncing || switchingSemester) return;
    setSelectedSemester(newId);
    setSwitchingSemester(true);
    setSyncError(null);
    setSyncSuccess(false);
    try {
      const client = getLiveClient();
      const results = await syncSemesterData(client, newId, semesters);
      if (!mounted.current) return;
      const sessionGone = sessionLostDuringSync();
      setSyncResults(results);
      setSyncSuccess(!sessionGone && results.every((r) => r.ok));
      setLastSyncTime(Date.now());
      if (sessionGone) setSyncError(SESSION_LOST_MID_SYNC);
      if (onDataSynced) await onDataSynced();
    } catch (err) {
      if (!mounted.current) return;
      setSyncError(`Could not switch semester: ${humanErrorCopy(err, 'VTOP could not be reached. Please try again.')}`);
    } finally {
      if (mounted.current) setSwitchingSemester(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="uc-scrim ultracc-login-overlay fixed inset-0 flex items-center justify-center p-3 sm:p-6">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="vtop-login-title"
        aria-describedby="vtop-login-security-note"
        className="uc-plate uc-sheet"
        style={sheetDrag.offset ? { transform: `translateY(${sheetDrag.offset}px)`, transition: 'none' } : undefined}
      >
        <header className="uc-plate-head uc-sheet-head is-draggable" {...sheetDrag.handlers}>
          <div className="uc-dir-id">
            <span className="uc-cap"><ShieldCheck className="uc-dir-inline" aria-hidden="true" />VTOP gateway</span>
            <h3 id="vtop-login-title" className="uc-dir-name">Sign in to VTOP</h3>
            <p className="uc-note">Your campus account, read by UltraCC on this device.</p>
          </div>
          <div className="uc-dir-rail">
            <button
              type="button"
              ref={closeBtnRef}
              onClick={onClose}
              aria-label="Close login dialog"
              className="uc-dir-ico"
            >
              <X aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="uc-sheet-body">
          <p id="vtop-login-security-note" className="uc-note-row uc-note-row--warn">
            <AlertTriangle aria-hidden="true" />
            <span>
              <b>Security notice.</b> Your VTOP credentials go over HTTPS only to <b>vtopcc.vit.ac.in</b>, and
              UltraCC never stores or logs them. A login you save in Settings stays on this device, and the
              CAPTCHA never leaves your browser.
            </span>
          </p>

          <form
            onSubmit={(e) => { e.preventDefault(); void (autoLoginState === 'manual' ? handleLogin(e) : handleAutoLogin()); }}
            className="uc-dir-form"
          >
            <h4 className="uc-dir-subhead">
              <KeyRound className="uc-dir-inline" aria-hidden="true" />VIT Chennai VTOP authentication
            </h4>

            <div className="uc-login-grid">
              <label className="uc-dir-field">
                <span>Registration number or VTOP username</span>
                <input
                  id="vtop-regno"
                  type="text"
                  value={regNo}
                  // Keep the student's typing in the field. VTOP's own login box
                  // uppercases as you type and the gateway applies the same rule
                  // before submitting, so nothing is lost by leaving it readable.
                  onChange={(e) => setRegNo(e.target.value)}
                  placeholder="23BCE0000"
                  required
                  autoComplete="username"
                  spellCheck={false}
                  aria-describedby={syncError ? 'vtop-login-error' : undefined}
                  className="uc-dir-input uc-num"
                />
              </label>

              <div className="uc-dir-field">
                <label htmlFor="vtop-password">VTOP password</label>
                <div className="uc-login-pass">
                  <input
                    id="vtop-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    required
                    autoComplete="current-password"
                    aria-describedby={syncError ? 'vtop-login-error' : undefined}
                    className="uc-dir-input uc-num"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="uc-dir-ico"
                    title={showPassword ? 'Hide password' : 'Show password'}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Semester — the selection is saved and reused on the next login. */}
            {semesters.length > 0 && (
              <div className="uc-dir-field">
                <span>{syncComplete ? 'Change semester (refetches data)' : 'Academic semester'}</span>
                <div className="uc-login-pass">
                  <select
                    value={selectedSemester}
                    onChange={(e) => handleSemesterChange(e.target.value)}
                    disabled={syncing || switchingSemester}
                    className="uc-dir-select"
                  >
                    {semesters.map((s) => (
                      <option key={s.id} value={s.id}>{s.name} {s.isCurrent ? '(Active)' : ''}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => handleSemesterChange(selectedSemester)}
                    disabled={syncing || switchingSemester}
                    aria-label="Re-sync this semester"
                    className="uc-dir-ico"
                    title="Re-sync this semester"
                  >
                    <RefreshCw className={switchingSemester ? 'spin' : ''} aria-hidden="true" />
                  </button>
                </div>
                {switchingSemester && (
                  <p className="uc-dir-sub" role="status" aria-live="polite">
                    Refetching attendance, timetable, marks, exams &amp; OD for the new semester…
                  </p>
                )}
                <p className="uc-dir-sub">Your selection is saved and reused on your next login.</p>
              </div>
            )}

            {/* CAPTCHA — only shown once the automatic read has been handed over. */}
            {autoLoginState === 'manual' && (
              <div className="uc-login-captcha">
                <div className="uc-login-captcha-head">
                  <span className="uc-cap">VTOP CAPTCHA</span>
                  <span className="uc-dir-tag is-warn">Auto-read handed over</span>
                </div>

                <div className="uc-login-captcha-row">
                  {captchaLoading ? (
                    <span className="uc-login-captcha-skel" aria-hidden="true" />
                  ) : captchaBase64 ? (
                    <a
                      href={captchaBase64}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open the CAPTCHA full-size in a new tab"
                      className="uc-login-captcha-img"
                    >
                      <img src={captchaBase64} alt="VTOP CAPTCHA — click to enlarge" />
                    </a>
                  ) : (
                    <span className="uc-login-captcha-img uc-login-captcha-blank uc-num" aria-hidden="true">····</span>
                  )}
                  <button
                    type="button"
                    onClick={handleRefreshCaptcha}
                    disabled={captchaLoading}
                    aria-label="Refresh CAPTCHA"
                    className="uc-dir-ico"
                    title="Refresh CAPTCHA"
                  >
                    <RefreshCw className={captchaLoading ? 'spin' : ''} aria-hidden="true" />
                  </button>

                  <div className="uc-login-captcha-field">
                    <label htmlFor="vtop-captcha">Type the 6 CAPTCHA characters</label>
                    <input
                      id="vtop-captcha"
                      type="text"
                      value={captchaText}
                      onChange={(e) => setCaptchaText(e.target.value.toUpperCase())}
                      required
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      maxLength={6}
                      className="uc-dir-input uc-login-captcha-input uc-num"
                    />
                  </div>
                </div>

                {captchaError && (
                  <p role="alert" className="uc-login-alert">
                    <AlertCircle aria-hidden="true" /><span>{captchaError}</span>
                  </p>
                )}
              </div>
            )}

            {syncError && (
              <div id="vtop-login-error" role="alert" className="uc-login-error">
                <p className="uc-login-alert">
                  <AlertCircle aria-hidden="true" /><span>{syncError}</span>
                </p>

                {/* A credential rejection is answered by VTOP, not by this form:
                    the gateway posts exactly the four fields VTOP's own login
                    form posts, and "Invalid Credentials" means the portal
                    accepted the CAPTCHA and refused the login id / password
                    pair. The only place that can be checked is the portal. */}
                {credentialRejected && (
                  <div className="uc-login-error-help">
                    <p>
                      VTOP takes either your registration number or the custom login ID you set on the portal —
                      exactly as it is stored there. Retyping the same pair here will get the same answer.
                    </p>
                    <a href={VTOP_PORTAL_LOGIN_URL} target="_blank" rel="noopener noreferrer">
                      Sign in at vtopcc.vit.ac.in to check this pair ↗
                    </a>
                    <p>
                      If the portal signs you in with the same login ID and password, come straight back and try
                      again here — and use “Forgot Password” / “Forgot LoginId” on that page if it does not.
                    </p>
                  </div>
                )}
              </div>
            )}

            {syncSuccess && syncResults && syncResults.every((r) => r.ok) && (
              <p className="uc-note-row uc-note-row--good">
                <CheckCircle aria-hidden="true" />
                <span>Real VTOP data synced. Your dashboard is up to date.</span>
              </p>
            )}

            {/* Per-dataset sync results — a failed dataset is never silent. */}
            {syncResults && syncResults.some((r) => !r.ok) && (
              <div className="uc-login-error is-warn">
                <p className="uc-login-alert is-warn">
                  <AlertTriangle aria-hidden="true" /><span>Some data could not be fetched</span>
                </p>
                <ul className="uc-login-failed">
                  {syncResults.filter((r) => !r.ok).map((r) => (
                    <li key={r.key}>
                      <b>{r.label}</b>
                      <span>{r.error || 'failed to fetch'}</span>
                    </li>
                  ))}
                </ul>
                <p className="uc-login-error-note">
                  The datasets above are on your dashboard; the rest show as not synced until a re-sync succeeds.
                </p>
              </div>
            )}

            {/* Auto-login progress — announced politely to assistive tech. */}
            {autoLoginState !== 'idle' && autoLoginState !== 'manual' && (
              <p role="status" aria-live="polite" className="uc-login-progress">
                <RefreshCw className="spin" aria-hidden="true" />
                <span>{autoStatusMsg || 'Processing…'}</span>
              </p>
            )}

            <button
              type="submit"
              disabled={syncing || captchaLoading || (autoLoginState !== 'idle' && autoLoginState !== 'manual')}
              aria-busy={syncing || (autoLoginState !== 'idle' && autoLoginState !== 'manual')}
              className="uc-dir-go acc-bg uc-login-submit"
            >
              <RefreshCw className={(syncing || (autoLoginState !== 'idle' && autoLoginState !== 'manual')) ? 'spin' : ''} aria-hidden="true" />
              <span>
                {autoLoginState === 'initializing' && 'Connecting to VTOP…'}
                {autoLoginState === 'solving-captcha' && 'Reading CAPTCHA…'}
                {autoLoginState === 'submitting' && 'Signing in…'}
                {autoLoginState === 'retrying' && 'Retrying with new CAPTCHA…'}
                {autoLoginState === 'syncing' && 'Syncing your data…'}
                {autoLoginState === 'manual' && 'Sign in &amp; sync'}
                {autoLoginState === 'idle' && (syncing ? 'Authenticating…' : 'Sign in')}
              </span>
            </button>
          </form>
        </div>

        <footer className="uc-plate-foot uc-sheet-foot">
          <span>{lastSyncTime ? <><RefreshCw className="uc-dir-inline" aria-hidden="true" />Last local sync: <b className="uc-num">{formatRelativeTime(lastSyncTime)}</b></> : 'Nothing synced on this device yet.'}</span>
          <button
            type="button"
            onClick={onClose}
            disabled={syncing || (autoLoginState !== 'idle' && autoLoginState !== 'manual')}
            className="uc-dir-go"
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  );
};

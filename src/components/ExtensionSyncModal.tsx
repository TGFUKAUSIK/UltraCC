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
import { useDialog } from '../hooks/useDialog';

/**
 * How many times the automatic sign-in may re-arm and guess again.
 *
 * One, not three. Every auto attempt that VTOP rejects is a failed login
 * recorded against the student's real VTOP account (see the lockout note on
 * MIN_AUTO_SUBMIT_CONFIDENCE below), so the loop is deliberately short: one
 * confident guess, one re-arm, then the CAPTCHA is handed to the student, who
 * reads it far more reliably than any local solver.
 */
const MAX_AUTO_RETRIES = 1;

/**
 * Minimum OCR confidence worth spending a real login attempt on.
 *
 * A wrong CAPTCHA is not a free guess: VTOP answers it with a failed login on
 * the student's actual account, and the portal locks accounts after repeated
 * failures (its own "maximum failed attempts" page). Auto-filling a shaky read
 * therefore trades a small convenience for a real risk of locking the student
 * out of VTOP itself. Below this threshold the image is handed over untouched.
 */
const MIN_AUTO_SUBMIT_CONFIDENCE = 0.5;

/**
 * VTOP's own login page.
 *
 * When VTOP answers "Invalid Credentials" the reason is on the account side,
 * not in this form: the login id is not one VTOP accepts, or the password has
 * expired / been changed there. The only place that can be settled is the
 * portal itself, so a credential rejection offers it as a one-click check.
 */
const VTOP_PORTAL_LOGIN_URL = 'https://vtopcc.vit.ac.in/vtop/login';

// CAPTCHA OCR is only needed after the user opens login. Keep the large local
// OCR/template-weight payload out of the initial and login-form chunks.
async function readCaptcha(imageBase64: string) {
  const { ocrCaptchaWithConfidence } = await import('../lib/vtop/ocrCaptcha');
  return ocrCaptchaWithConfidence(imageBase64);
}

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
        const result = await readCaptcha(res.captchaImageBase64);
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
   * Fully automatic login: session init → CAPTCHA OCR → submit → retry on failure.
   * Falls back to manual CAPTCHA entry after MAX_AUTO_RETRIES failures.
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

    for (let attempt = 0; attempt <= MAX_AUTO_RETRIES; attempt++) {
      if (!mounted.current) return;

      try {
        // 1. Initialize session + get CAPTCHA
        setAutoLoginState('initializing');
        setAutoStatusMsg(attempt === 0 ? 'Connecting to VTOP…' : `Retry ${attempt}/${MAX_AUTO_RETRIES} — fetching new CAPTCHA…`);
        resetLiveClient();
        const client = getLiveClient();
        const res = await client.initializeSession();
        if (!mounted.current) return;

        if (!res.captchaImageBase64) {
          setAutoLoginState('manual');
          setAutoStatusMsg('');
          setCaptchaBase64('');
          setCaptchaError('VTOP CAPTCHA unavailable — please enter manually.');
          return;
        }

        setCaptchaBase64(res.captchaImageBase64);

        // 2. OCR the CAPTCHA
        setAutoLoginState('solving-captcha');
        setAutoStatusMsg('Reading CAPTCHA…');
        const ocrResult = await readCaptcha(res.captchaImageBase64);
        if (!mounted.current) return;

        if (!ocrResult.text) {
          setAutoLoginState('manual');
          setAutoStatusMsg('');
          setCaptchaText('');
          setCaptchaError('Could not read CAPTCHA automatically — please type it.');
          return;
        }

        // A low-confidence read is a guess, and guessing costs the student a
        // failed login on their real VTOP account. Leave the box empty instead
        // and let the person who can see the image fill it in.
        if (ocrResult.confidence < MIN_AUTO_SUBMIT_CONFIDENCE) {
          setAutoLoginState('manual');
          setAutoStatusMsg('');
          setCaptchaText('');
          setCaptchaError('The CAPTCHA was too unclear to read safely — please type the 6 characters shown.');
          return;
        }

        setCaptchaText(ocrResult.text);

        // 3. Submit login
        setAutoLoginState('submitting');
        setAutoStatusMsg('Signing in…');
        try {
          await client.login(regNo, password, ocrResult.text);
        } catch (loginErr) {
          const code = isVtopError(loginErr) ? loginErr.code : null;
          const msg = loginErr instanceof Error ? loginErr.message : String(loginErr);
          // VTOP answers a wrong registration number or password with
          // "Invalid Credentials". Re-arming a fresh CAPTCHA for that — as the
          // old substring match on 'Invalid' did — burned three sessions and
          // then told the student to retype a code that was never the problem.
          if (code === 'LOGIN_FAILED') {
            setAutoLoginState('manual');
            setAutoStatusMsg('');
            setCredentialRejected(true);
            setSyncError(msg + stalePrefillHint(password));
            // VTOP consumes a CAPTCHA on any login answer, including this one,
            // so the image still on screen cannot be submitted again. Re-arm
            // now — otherwise the student who fixes their password and hits
            // sign in is answered "Invalid Captcha" for a code they read
            // perfectly, and the credential problem hides behind it.
            resetLiveClient();
            void initLiveSession();
            return;
          }
          // CAPTCHA/session failed — try again with a new CAPTCHA. Typed codes
          // only: matching on the words in VTOP's message is how a credentials
          // rejection used to be retried as a CAPTCHA problem, and the message
          // now legitimately contains the word "CAPTCHA".
          if (code === 'CAPTCHA_FAILED' || code === 'SESSION_EXPIRED') {
            if (attempt < MAX_AUTO_RETRIES) {
              setAutoLoginState('retrying');
              setAutoStatusMsg(`CAPTCHA incorrect — retrying (${attempt + 1}/${MAX_AUTO_RETRIES})…`);
              continue; // retry with fresh CAPTCHA
            }
            // Out of auto attempts — fall back to manual, but keep the reason
            // VTOP gave on the last attempt. Saying only "failed after N
            // retries" sent students off to retype a CAPTCHA that was never the
            // problem, when VTOP had actually explained the real cause.
            setAutoLoginState('manual');
            setAutoStatusMsg('');
            setSyncError(`Auto-login could not get past VTOP's CAPTCHA — last attempt: ${msg}`);
            return;
          }
          // Non-CAPTCHA error (network, etc.) — don't retry
          throw loginErr;
        }

        // 4. Login succeeded. LMS is intentionally NOT touched here — Moodle
        // uses a separate account and is synced from Settings → LMS Account.
        if (!mounted.current) return;
        setAutoLoginState('syncing');
        setAutoStatusMsg('Login successful — syncing your semester data…');

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
        return;

      } catch (err) {
        if (!mounted.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        // Network/session error — don't retry CAPTCHA, just report
        setAutoLoginState('manual');
        setAutoStatusMsg('');
        setSyncError(isVtopError(err) ? err.message : `VTOP error: ${humanErrorCopy(err, 'VTOP could not be reached. Please sign in normally.')}`);
        return;
      }
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
    <div className="ultracc-login-overlay fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-50 backdrop-blur-md animate-fadeIn">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="vtop-login-title"
        aria-describedby="vtop-login-security-note"
        className="w-full max-w-2xl bg-white border border-zinc-200 rounded-3xl shadow-2xl overflow-hidden max-h-[92dvh] overflow-y-auto"
      >

        {/* Header */}
        <div className="p-6 bg-zinc-50 border-b border-zinc-200 flex items-center justify-between sticky top-0 z-10">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-2xl border bg-emerald-500/10 border-emerald-500/30 text-emerald-600">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <h3 id="vtop-login-title" className="text-lg font-extrabold text-zinc-900 tracking-tight">VTOP Login</h3>
              <p className="text-xs text-zinc-500 font-medium">
                UltraCC secure gateway → vtopcc.vit.ac.in
              </p>
            </div>
          </div>
          <button
            ref={closeBtnRef}
            onClick={onClose}
            aria-label="Close login dialog"
            className="p-2 text-zinc-500 hover:text-zinc-900 rounded-xl hover:bg-zinc-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-5 text-xs text-zinc-900">

          {/* Privacy Notice */}
          <div id="vtop-login-security-note" className="p-4 bg-amber-50 border border-amber-500/30 rounded-2xl space-y-1.5">
            <p className="flex items-center gap-1.5 font-extrabold text-amber-700 text-[11px] uppercase tracking-wider">
              <AlertTriangle className="h-3.5 w-3.5" /> Security Notice
            </p>
            <p className="text-[11px] text-amber-700/70 leading-relaxed">
              Your VTOP credentials are transmitted over <strong>HTTPS</strong> only to <strong>vtopcc.vit.ac.in</strong> to log you in.
            </p>
            <p className="text-[11px] text-amber-700/70 leading-relaxed">
              Credentials are <strong>never stored or logged by UltraCC</strong>. If you save your login in Settings it stays on this device only. The CAPTCHA never leaves your browser.
            </p>
          </div>

          {/* Credentials Form */}
          <form onSubmit={(e) => { e.preventDefault(); void (autoLoginState === 'manual' ? handleLogin(e) : handleAutoLogin()); }} className="space-y-4 bg-zinc-50 p-5 rounded-2xl border border-zinc-200">
            <h4 className="font-extrabold text-zinc-900 text-xs flex items-center gap-2">
              <KeyRound className="h-4 w-4 acc-text" />
              <span>VIT Chennai VTOP Authentication</span>
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="vtop-regno" className="block text-[11px] text-zinc-500 font-medium mb-1">Registration Number or VTOP username</label>
                <input
                  id="vtop-regno"
                  type="text"
                  value={regNo}
                  // Keep the student's typing in the field. VTOP's own login
                  // box uppercases as you type and the gateway applies the same
                  // rule before submitting, so nothing is lost by leaving it
                  // readable here.
                  onChange={(e) => setRegNo(e.target.value)}
                  placeholder="23BCE1082"
                  required
                  autoComplete="username"
                  spellCheck={false}
                  aria-describedby={syncError ? 'vtop-login-error' : undefined}
                  className="w-full bg-white border border-zinc-200 rounded-xl px-3.5 py-2.5 text-xs text-zinc-900 font-mono focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="vtop-password" className="block text-[11px] text-zinc-500 font-medium mb-1">VTOP Password</label>
                <div className="relative">
                  <input
                    id="vtop-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    required
                    autoComplete="current-password"
                    aria-describedby={syncError ? 'vtop-login-error' : undefined}
                    className="w-full bg-white border border-zinc-200 rounded-xl px-3.5 py-2.5 text-xs text-zinc-900 font-mono focus:border-blue-500 focus:outline-none pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-500 hover:text-zinc-900"
                    title={showPassword ? 'Hide password' : 'Show password'}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Semester — selection is saved and reused on the next login */}
            {semesters.length > 0 && (
              <div>
                <label className="block text-[11px] text-zinc-500 font-medium mb-1 flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 acc-text" />
                  <span>{syncComplete ? 'Change Semester (refetches data)' : 'Academic Semester'}</span>
                </label>
                <div className="flex items-center gap-2">
                  <select
                    value={selectedSemester}
                    onChange={(e) => handleSemesterChange(e.target.value)}
                    disabled={syncing || switchingSemester}
                    className="w-full bg-white border border-zinc-200 rounded-xl px-3.5 py-2.5 text-xs text-zinc-900 focus:border-blue-500 focus:outline-none disabled:opacity-50"
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
                    className="p-2.5 text-zinc-500 hover:text-zinc-900 bg-white border border-zinc-200 rounded-xl disabled:opacity-40 shrink-0"
                    title="Re-sync this semester"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${switchingSemester ? 'animate-spin' : ''}`} />
                  </button>
                </div>
                {switchingSemester && (
                  <p className="mt-1.5 text-[10px] text-blue-700 flex items-center gap-1">
                    <RefreshCw className="h-3 w-3 animate-spin" /> Refetching attendance, timetable, marks, exams &amp; OD for the new semester…
                  </p>
                )}
                <p className="mt-1 text-[10px] text-zinc-500">Your selection is saved and reused on your next login.</p>
              </div>
            )}

            {/* CAPTCHA — hidden by default, only shown when auto-login fails */}
            {autoLoginState === 'manual' && (
              <div className="p-4 bg-white rounded-xl border border-zinc-200 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-extrabold text-zinc-900 uppercase tracking-wider">
                    VTOP CAPTCHA
                  </span>
                  <span className="text-[10px] font-mono text-amber-700 font-bold bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                    Manual fallback — auto-CAPTCHA failed
                  </span>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center space-x-3">
                    {captchaLoading ? (
                      <div className="h-16 w-64 bg-zinc-100 rounded border border-zinc-200 animate-pulse" />
                    ) : captchaBase64 ? (
                      <a
                        href={captchaBase64}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open the CAPTCHA full-size in a new tab"
                        className="shrink-0 group"
                      >
                        <img
                          src={captchaBase64}
                          alt="VTOP CAPTCHA — click to enlarge"
                          className="h-16 w-auto rounded border border-zinc-200 bg-white p-1 group-hover:ring-2 group-hover:ring-amber-300 cursor-zoom-in"
                        />
                      </a>
                    ) : (
                      <div className="h-16 px-8 bg-zinc-100 rounded border border-zinc-200 font-mono text-lg font-bold tracking-widest text-zinc-900 flex items-center justify-center">
                        ····
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={handleRefreshCaptcha}
                      disabled={captchaLoading}
                      aria-label="Refresh CAPTCHA"
                      className="p-2 text-zinc-500 hover:text-zinc-900 bg-white border border-zinc-200 rounded-lg disabled:opacity-40"
                      title="Refresh CAPTCHA"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${captchaLoading ? 'animate-spin' : ''}`} />
                    </button>
                  </div>

                  <div className="flex-1 max-w-xs">
                    <label htmlFor="vtop-captcha" className="block text-[10px] text-zinc-500 mb-1">Type the 6 CAPTCHA characters:</label>
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
                      className="w-full bg-white border border-zinc-200 rounded-xl px-3 py-2 text-sm text-center font-mono font-bold text-amber-700 focus:border-amber-400 focus:outline-none tracking-widest"
                    />
                  </div>
                </div>

                {captchaError && (
                  <p role="alert" className="text-[10px] text-rose-600 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" /> {captchaError}
                  </p>
                )}
              </div>
            )}

            {syncError && (
              <div id="vtop-login-error" role="alert" className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-700 text-xs space-y-2">
                <div className="flex items-start space-x-2">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{syncError}</span>
                </div>

                {/* A credential rejection is answered by VTOP, not by this form:
                    the gateway posts exactly the four fields VTOP's own login
                    form posts, and "Invalid Credentials" means the portal
                    accepted the CAPTCHA and refused the login id / password
                    pair. The only place that can be checked is the portal. */}
                {credentialRejected && (
                  <div className="pl-6 space-y-1.5 text-[10px] text-rose-700/80 leading-relaxed">
                    <p>
                      VTOP takes either your registration number or the custom login ID you set on
                      the portal — exactly as it is stored there. Retyping the same pair here will
                      get the same answer.
                    </p>
                    <a
                      href={VTOP_PORTAL_LOGIN_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-bold text-rose-700 underline underline-offset-2 hover:text-rose-900"
                    >
                      Sign in at vtopcc.vit.ac.in to check this pair ↗
                    </a>
                    <p>
                      If the portal signs you in with the same login ID and password, come straight
                      back and try again here — and use “Forgot Password” / “Forgot LoginId” on that
                      page if it does not.
                    </p>
                  </div>
                )}
              </div>
            )}

            {syncSuccess && syncResults && syncResults.every((r) => r.ok) && (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-700 text-xs space-y-1">
                <div className="flex items-center space-x-2">
                  <CheckCircle className="h-4 w-4 shrink-0" />
                  <span>Real VTOP data synced. Your dashboard is up to date.</span>
                </div>
              </div>
            )}

            {/* Per-dataset sync results — failed datasets are NEVER silent */}
            {syncResults && syncResults.some((r) => !r.ok) && (
              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-700 text-xs space-y-1.5">
                <p className="font-extrabold text-amber-700 flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" /> Some data could not be fetched
                </p>
                <ul className="space-y-0.5">
                  {syncResults.filter((r) => !r.ok).map((r) => (
                    <li key={r.key} className="flex items-start gap-1.5">
                      <span className="font-bold text-amber-700 shrink-0">{r.label}:</span>
                      <span className="text-amber-700/80">{r.error || 'failed to fetch'}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-[10px] text-amber-700/60 pt-0.5">
                  The synced datasets above are on your dashboard; the failed ones will show "not synced" until a re-sync succeeds.
                </p>
              </div>
            )}

            {/* Auto-login status indicator — announced politely to AT */}
            {autoLoginState !== 'idle' && autoLoginState !== 'manual' && (
              <div role="status" aria-live="polite" className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-xl text-blue-700 text-xs flex items-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin shrink-0" aria-hidden="true" />
                <span>{autoStatusMsg || 'Processing…'}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={syncing || captchaLoading || (autoLoginState !== 'idle' && autoLoginState !== 'manual')}
              aria-busy={syncing || (autoLoginState !== 'idle' && autoLoginState !== 'manual')}
              className="w-full py-3 text-zinc-900 font-extrabold rounded-xl transition cursor-pointer flex items-center justify-center space-x-2 shadow-lg disabled:opacity-50 acc-bg acc-glow hover:opacity-90"
            >
              <RefreshCw className={`h-4 w-4 ${(syncing || (autoLoginState !== 'idle' && autoLoginState !== 'manual')) ? 'animate-spin' : ''}`} />
              <span>
                {autoLoginState === 'initializing' && 'Connecting to VTOP…'}
                {autoLoginState === 'solving-captcha' && 'Reading CAPTCHA…'}
                {autoLoginState === 'submitting' && 'Signing in…'}
                {autoLoginState === 'retrying' && 'Retrying with new CAPTCHA…'}
                {autoLoginState === 'syncing' && 'Syncing your data…'}
                {autoLoginState === 'manual' && 'Sign In & Sync'}
                {autoLoginState === 'idle' && (syncing ? 'Authenticating…' : 'Sign In')}
              </span>
            </button>
          </form>



          {lastSyncTime && (
            <p className="text-[10px] text-zinc-500 font-mono">Last local sync: {formatRelativeTime(lastSyncTime)}</p>
          )}
        </div>

        <div className="p-5 bg-white border-t border-zinc-200 flex justify-end">
          <button
            onClick={onClose}
            disabled={syncing || (autoLoginState !== 'idle' && autoLoginState !== 'manual')}
            className="px-5 py-2.5 acc-bg text-zinc-900 font-extrabold rounded-2xl text-xs transition cursor-pointer disabled:opacity-50"
          >
            Close & Return to Dashboard
          </button>
        </div>
      </div>
    </div>
  );
};

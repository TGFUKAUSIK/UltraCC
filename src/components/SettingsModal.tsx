import React, { useEffect, useState } from 'react';
import {
  X, Calendar, Palette, KeyRound, Trash2, CheckCircle, Save, Loader2, Eye, EyeOff, GraduationCap,
  RefreshCw, BellRing, LayoutDashboard, ShieldCheck, Bot,
} from 'lucide-react';
import { getFreshnessTtlMs, setFreshnessTtlHours } from '../lib/vtop/syncCoordinator';
import { SemesterInfo } from '../lib/vtop/types';
import {
  ACCENT_OPTIONS, AccentColor, getSavedCredentials, saveCredentials, clearSavedCredentials,
  getSavedLmsCredentials, saveLmsCredentials, clearSavedLmsCredentials,
  getGeminiApiKey, saveGeminiApiKey, clearGeminiApiKey, saveAccentColor, getAppTheme, saveAppTheme, THEME_OPTIONS, AppTheme, saveFeatureMode,
  getShowProfilePhoto, saveShowProfilePhoto,
} from '../lib/settings';
import type { FeatureMode } from '../lib/navVisibility';
import { CAMPUS_LIST, readStoredCampusId, writeStoredCampusId, type CampusId } from '../lib/campus';
import { humanErrorCopy } from '../lib/errorCopy';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useDialog } from '../hooks/useDialog';
import { useSheetDrag } from '../hooks/useSheetDrag';
import type { BackgroundPushController } from '../hooks/useBackgroundPush';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  semesters: SemesterInfo[];
  selectedSemesterId: string;
  semesterLoading?: boolean;
  onSemesterChange: (semId: string) => void;
  onClearAllData: () => Promise<void>;
  /** LMS sync trigger (Settings → LMS Account → Sync Now). */
  onLmsSync?: () => Promise<{ ok: boolean; message: string }>;
  /** LMS per-dataset sync errors to display (never silent). */
  lmsSyncErrors?: { label: string; error: string }[];
  /** Background notification controller (reminders that survive a closed browser). */
  backgroundPush?: BackgroundPushController;
  /** Feature mode (minimal vs complete) — the selected value and its setter. */
  mode?: FeatureMode;
  onModeChange?: (mode: FeatureMode) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen, onClose, semesters, selectedSemesterId, semesterLoading, onSemesterChange, onClearAllData,
  onLmsSync, lmsSyncErrors, backgroundPush, mode = 'complete', onModeChange,
}) => {
  useBodyScrollLock(isOpen);
  const panelRef = useDialog({ isOpen, onClose });
  const saved = getSavedCredentials();
  const [regNo, setRegNo] = useState(saved.regNo);
  const [password, setPassword] = useState(saved.password);
  const [showPassword, setShowPassword] = useState(false);
  const savedLms = getSavedLmsCredentials();
  const [lmsUsername, setLmsUsername] = useState(savedLms.username);
  const [lmsPassword, setLmsPassword] = useState(savedLms.password);
  const [showLmsPassword, setShowLmsPassword] = useState(false);
  const [apiKey, setApiKey] = useState(getGeminiApiKey());
  const [showKey, setShowKey] = useState(false);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [ttlHours, setTtlHours] = useState<number>(() =>
    Math.max(1, Math.round(getFreshnessTtlMs() / 3_600_000)),
  );
  const [lmsSyncing, setLmsSyncing] = useState(false);
  const [lmsResult, setLmsResult] = useState<{ ok: boolean; message: string } | null>(null);
  // Read through the guarded helper: the campus list asks this question once per
  // row while rendering, and unguarded storage throws on a locked-down phone.
  const [storedCampus, setStoredCampus] = useState<CampusId>(() => readStoredCampusId());
  const [campusNotice, setCampusNotice] = useState<string | null>(null);
  const [appTheme, setAppTheme] = useState<AppTheme>(() => getAppTheme());
  const [showProfilePhoto, setShowProfilePhoto] = useState<boolean>(() => getShowProfilePhoto());

  // Throw-to-dismiss, shared with the sign-in sheet and the More sheet. Inert
  // while the sheet is working — a half-finished LMS sync or a clear-all would
  // be hidden, not cancelled, by flinging the panel away.
  const { offset, handlers: sheetDragHandlers } = useSheetDrag({
    onDismiss: onClose,
    enabled: !lmsSyncing && !clearing,
  });

  /**
   * Re-read the stored values every time the dialog opens. App keeps this modal
   * mounted, so the `useState` seeds above run exactly once at boot: after
   * Clear-all data (or a credential change from the sign-in sheet) the fields
   * still showed the previous username and password, and "Sync now" — which
   * deliberately saves what is on screen — wrote the cleared credentials back.
   */
  useEffect(() => {
    if (!isOpen) return;
    const vtop = getSavedCredentials();
    setRegNo(vtop.regNo);
    setPassword(vtop.password);
    const lms = getSavedLmsCredentials();
    setLmsUsername(lms.username);
    setLmsPassword(lms.password);
    setApiKey(getGeminiApiKey());
    setShowPassword(false);
    setShowLmsPassword(false);
    setShowProfilePhoto(getShowProfilePhoto());
    setStoredCampus(readStoredCampusId());
    setCampusNotice(null);
  }, [isOpen]);

  if (!isOpen) return null;

  const flash = (msg: string) => {
    setSavedFlash(msg);
    setTimeout(() => setSavedFlash(null), 2500);
  };

  const handleSaveCredentials = () => {
    saveCredentials({ regNo, password });
    flash('VTOP login saved for this tab. The password is not written to storage.');
  };

  const handleSaveApiKey = () => {
    saveGeminiApiKey(apiKey);
    flash('Gemini API key saved.');
  };

  const handleSaveLmsCredentials = () => {
    saveLmsCredentials({ username: lmsUsername, password: lmsPassword });
    flash('LMS credentials saved for this session.');
  };

  const handleTheme = (color: AccentColor) => {
    saveAccentColor(color);
    flash(`Accent theme set to ${color}.`);
  };

  const handleSurfaceTheme = (theme: AppTheme) => {
    setAppTheme(theme);
    saveAppTheme(theme);
    flash(`Surface theme set to ${theme}.`);
  };

  const handleProfilePhoto = (show: boolean) => {
    setShowProfilePhoto(show);
    saveShowProfilePhoto(show);
    flash(show ? 'VTOP profile photo shown across the app.' : 'Initials avatar shown instead of your profile photo.');
  };

  const handleFeatureMode = (next: FeatureMode) => {
    saveFeatureMode(next);
    onModeChange?.(next);
    flash(next === 'minimal'
      ? 'Minimal mode on — Dashboard, Attendance, Marks & Grades, Proctor and Settings.'
      : 'Minimal mode off — every UltraCC feature is back.');
  };

  const handleClear = async () => {
    setClearing(true);
    try {
      await onClearAllData();
      // "All local data cleared" has to include the secrets this dialog owns.
      // onClearAllData drops the LMS pair; the VTOP credentials and the Gemini
      // key lived only here, and leaving them in storage while the cache was
      // gone would have made the message a lie on a shared laptop.
      clearSavedCredentials();
      clearSavedLmsCredentials();
      clearGeminiApiKey();
      setRegNo('');
      setPassword('');
      setLmsUsername('');
      setLmsPassword('');
      setApiKey('');
      flash('All local data and saved credentials cleared.');
    } finally {
      setClearing(false);
    }
  };

  const handleLmsSync = async () => {
    if (!onLmsSync) return;
    // Sync the values currently visible in the form. Requiring a separate
    // Save click made a correct username/password appear to be ignored.
    saveLmsCredentials({ username: lmsUsername, password: lmsPassword });
    setLmsSyncing(true);
    setLmsResult(null);
    try {
      const result = await onLmsSync();
      // The colour follows the sync's own verdict. Reading the sentence for the
      // word "failed" painted "LMS synced with 3 issues." in success green.
      setLmsResult({ ok: result.ok, message: result.message });
    } catch (err) {
      setLmsResult({ ok: false, message: humanErrorCopy(err, 'LMS sync did not finish. Try again.') });
    } finally {
      setLmsSyncing(false);
    }
  };

  const activeAccent = document.documentElement.getAttribute('data-accent') || 'blue';

  return (
    <div className="uc-scrim ultracc-settings-overlay fixed inset-0 flex items-center justify-center p-3 sm:p-6">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ultracc-settings-title"
        className="ultracc-settings-panel uc-plate uc-sheet"
        style={offset ? { transform: `translateY(${offset}px)`, transition: 'none' } : undefined}
      >
        <header className="uc-plate-head uc-sheet-head is-draggable" {...sheetDragHandlers}>
          <div className="uc-dir-id">
            <span className="uc-cap"><Palette className="uc-dir-inline" aria-hidden="true" />Preferences</span>
            <h3 id="ultracc-settings-title" className="uc-dir-name">Settings</h3>
            <p className="uc-note">Semester, appearance, saved login and your AI key.</p>
          </div>
          <div className="uc-dir-rail">
            <button type="button" onClick={onClose} aria-label="Close settings" className="uc-dir-ico">
              <X aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="uc-sheet-body">

          {/* Minimal mode — first, because it decides what the rest of the app
              offers. This is the only control that changes navigation. */}
          <section className="uc-set">
            <p className="uc-cap"><LayoutDashboard aria-hidden="true" />Minimal mode</p>
            <button
              type="button"
              role="switch"
              aria-checked={mode === 'minimal'}
              aria-label="Minimal mode"
              onClick={() => handleFeatureMode(mode === 'minimal' ? 'complete' : 'minimal')}
              className={`uc-switch-row${mode === 'minimal' ? ' is-on' : ''}`}
            >
              <span className="uc-set-row-main">
                <b>{mode === 'minimal' ? 'On' : 'Off'}</b>
                <small>Dashboard, Attendance, Marks &amp; Grades, Proctor and Settings</small>
              </span>
              <span className="uc-switch-track" aria-hidden="true"><span className="uc-switch-knob" /></span>
            </button>
            <p className="uc-set-hint">
              {mode === 'minimal'
                ? 'The rail, the tab bar and search show only those five. Your sync keeps running, and turning this off brings everything back.'
                : 'Turn this on to keep only the Dashboard, Attendance, Marks & Grades, Proctor and Settings in the rail, the tab bar and search.'}
            </p>
          </section>

          {/* Semester */}
          <section className="uc-set">
            <p className="uc-cap"><Calendar aria-hidden="true" />Academic semester</p>
            {semesters.length > 0 ? (
              <select
                aria-label="Active semester"
                value={selectedSemesterId}
                onChange={(e) => onSemesterChange(e.target.value)}
                disabled={semesterLoading}
                className="uc-dir-select"
              >
                {semesters.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} {s.isCurrent ? '(Active)' : ''}</option>
                ))}
              </select>
            ) : (
              <p className="uc-set-hint">
                No semesters yet — log in first, then choose your semester here. Your choice is saved and reused automatically.
              </p>
            )}
            <p className="uc-set-hint">Changing semester re-syncs attendance, timetable, marks, exams &amp; OD.</p>
          </section>

          {/* Surface theme */}
          <section className="uc-set">
            <p className="uc-cap"><Palette aria-hidden="true" />Surface theme</p>
            <div className="uc-set-3">
              {THEME_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleSurfaceTheme(opt.id)}
                  aria-pressed={appTheme === opt.id}
                  className={`uc-opt${appTheme === opt.id ? ' is-on' : ''}`}
                >
                  {opt.label}
                  <small>{opt.description}</small>
                </button>
              ))}
            </div>
            <p className="uc-set-hint">Keeps the same UltraCC design system across light and dark surfaces.</p>
          </section>

          {/* Accent theme */}
          <section className="uc-set">
            <p className="uc-cap"><Palette aria-hidden="true" />Theme colour</p>
            <div className="uc-sws">
              {ACCENT_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleTheme(opt.id)}
                  title={opt.label}
                  aria-label={`${opt.label} accent`}
                  aria-pressed={activeAccent === opt.id}
                  className="uc-sw"
                  style={{ backgroundColor: opt.swatch }}
                >
                  {activeAccent === opt.id && <CheckCircle size={15} aria-hidden="true" />}
                </button>
              ))}
            </div>
            <p className="uc-set-hint">Applied instantly across the app.</p>
          </section>

          {/* VTOP profile photo */}
          <section className="uc-set">
            <p className="uc-cap"><Eye aria-hidden="true" />Profile photo</p>
            <div className="uc-set-row">
              <span className="uc-set-row-main">
                <b>{showProfilePhoto ? 'Show VTOP profile picture' : 'Show initials avatar'}</b>
                <small>Applies to the header, dashboard and profile surfaces.</small>
              </span>
              <button
                type="button"
                onClick={() => handleProfilePhoto(!showProfilePhoto)}
                aria-pressed={showProfilePhoto}
                className={`uc-dir-go${showProfilePhoto ? '' : ' is-on'}`}
              >
                {showProfilePhoto ? 'Turn off' : 'Turn on'}
              </button>
            </div>
            <p className="uc-set-hint">Turning this off only changes what is rendered — your photo is never deleted.</p>
          </section>

          {/* Auto-refresh freshness */}
          <section className="uc-set">
            <p className="uc-cap"><RefreshCw aria-hidden="true" />Auto refresh</p>
            <select
              aria-label="Automatic refresh interval"
              value={ttlHours}
              onChange={(e) => {
                const h = Number(e.target.value);
                setTtlHours(h);
                setFreshnessTtlHours(h);
              }}
              className="uc-dir-select"
            >
              <option value={1}>Refresh when data is 1 hour old</option>
              <option value={6}>Refresh when data is 6 hours old (default)</option>
              <option value={12}>Refresh when data is 12 hours old</option>
              <option value={24}>Refresh when data is 1 day old</option>
              <option value={48}>Refresh when data is 2 days old</option>
              <option value={168}>Refresh when data is 1 week old</option>
            </select>
            <p className="uc-set-hint">
              Cached data always shows instantly. When it gets older than this, UltraCC refreshes it in the background (on open, when you return to the app, or when the connection comes back) — only while you're signed in, never offline, and never more than once per freshness window.
            </p>
          </section>

          {/* VTOP credentials */}
          <section className="uc-set">
            <p className="uc-cap"><KeyRound aria-hidden="true" />Saved VTOP login</p>
            <p className="uc-set-hint">
              The registration number is kept <b>on this device</b> to prefill the login form. The password is kept in this tab's memory only — it is never written to storage, so it is asked for again after the app is closed and reopened.
            </p>
            <div className="uc-set-grid">
              <label className="uc-dir-field">
                <span>Registration number or VTOP username</span>
                <input
                  type="text"
                  value={regNo}
                  // Stored as typed; the gateway uppercases the login id the
                  // same way VTOP's own login field does before submitting.
                  onChange={(e) => setRegNo(e.target.value)}
                  className="uc-dir-input uc-num"
                />
              </label>
              <div className="uc-dir-field">
                <label htmlFor="settings-vtop-password">VTOP password</label>
                <div className="uc-login-pass">
                  <input
                    id="settings-vtop-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="uc-dir-input uc-num"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide VTOP password' : 'Show VTOP password'}
                    aria-pressed={showPassword}
                    className="uc-dir-ico"
                    title={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                  </button>
                </div>
              </div>
            </div>
            <button type="button" onClick={handleSaveCredentials} className="uc-dir-go acc-bg uc-set-act">
              <Save aria-hidden="true" />Save login
            </button>
          </section>

          {/* LMS (Moodle) account */}
          <section className="uc-set">
            <p className="uc-cap"><GraduationCap aria-hidden="true" />LMS account · lms.vit.ac.in</p>
            <p className="uc-set-hint">
              Moodle uses a separate LMS account. Enter the exact username/email shown in VTOP under My Credentials, not your VTOP registration number. Credentials stay in memory for this session and are sent only to the UltraCC gateway over HTTPS.
            </p>
            <div className="uc-set-grid">
              <label className="uc-dir-field">
                <span>LMS username or email</span>
                <input
                  type="text"
                  value={lmsUsername}
                  onChange={(e) => setLmsUsername(e.target.value.trim())}
                  placeholder="Use the username shown in VTOP My Credentials"
                  className="uc-dir-input uc-num"
                />
              </label>
              <div className="uc-dir-field">
                <label htmlFor="settings-lms-password">LMS password</label>
                <div className="uc-login-pass">
                  <input
                    id="settings-lms-password"
                    type={showLmsPassword ? 'text' : 'password'}
                    value={lmsPassword}
                    onChange={(e) => setLmsPassword(e.target.value)}
                    className="uc-dir-input uc-num"
                  />
                  <button
                    type="button"
                    onClick={() => setShowLmsPassword(!showLmsPassword)}
                    aria-label={showLmsPassword ? 'Hide LMS password' : 'Show LMS password'}
                    aria-pressed={showLmsPassword}
                    className="uc-dir-ico"
                    title={showLmsPassword ? 'Hide password' : 'Show password'}
                  >
                    {showLmsPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                  </button>
                </div>
              </div>
            </div>
            <button type="button" onClick={handleSaveLmsCredentials} className="uc-dir-go acc-bg uc-set-act">
              <Save aria-hidden="true" />Save LMS login
            </button>

            <div className="uc-set-sync">
              <button
                type="button"
                onClick={handleLmsSync}
                disabled={lmsSyncing || !onLmsSync}
                aria-busy={lmsSyncing}
                className="uc-dir-go acc-bg uc-set-act"
              >
                {lmsSyncing
                  ? <Loader2 className="spin" aria-hidden="true" />
                  : <RefreshCw aria-hidden="true" />}
                {lmsSyncing ? 'Syncing LMS…' : 'Sync Now'}
              </button>
              {lmsResult && (
                <p className={`text-[11px] font-medium ${lmsResult.ok ? 'text-emerald-700' : 'text-rose-700'}`} role="status">
                  {lmsResult.message}
                </p>
              )}
              {lmsSyncErrors && lmsSyncErrors.length > 0 && (
                <div className="uc-note-row uc-note-row--warn uc-note-row--stack" role="status">
                  <p className="uc-note-row-head">Some LMS data could not be fetched</p>
                  {lmsSyncErrors.map((e, i) => (
                    <p key={i} className="uc-note-row-line"><b>{e.label}:</b> {humanErrorCopy(e.error, 'The LMS did not answer, so this was not loaded.')}</p>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Gemini API key */}
          <section className="uc-set">
            <p className="uc-cap"><Bot aria-hidden="true" />Gemini API key · AI advisor</p>
            <p className="uc-set-hint">
              Used only by the AI Advisor chat — sent directly to Google Gemini. Stored on this device.
            </p>
            <div className="uc-dir-field">
              <label htmlFor="settings-gemini-key">Gemini API key</label>
              <div className="uc-login-pass">
                <input
                  id="settings-gemini-key"
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Paste your Gemini API key"
                  className="uc-dir-input uc-num"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  aria-label={showKey ? 'Hide Gemini API key' : 'Show Gemini API key'}
                  aria-pressed={showKey}
                  className="uc-dir-ico"
                  title={showKey ? 'Hide key' : 'Show key'}
                >
                  {showKey ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                </button>
              </div>
            </div>
            <button type="button" onClick={handleSaveApiKey} className="uc-dir-go acc-bg uc-set-act">
              <Save aria-hidden="true" />Save API key
            </button>
          </section>

          {/* Background notifications (works with the browser closed) */}
          {backgroundPush && (
            <section className="uc-set">
              <p className="uc-cap"><BellRing aria-hidden="true" />Background notifications</p>
              <p className="uc-set-hint">
                Class reminders (10 minutes before) and LMS quiz windows arrive even when UltraCC is closed. Only your reminder times are uploaded — never marks, attendance or credentials.
              </p>
              <div className="uc-set-row">
                <span className="uc-set-row-main">
                  <b>{backgroundPush.enabled ? 'On' : 'Off'}</b>
                  <small>
                    {backgroundPush.message
                      ?? (!backgroundPush.supported
                        ? 'This browser cannot receive background notifications.'
                        : !backgroundPush.configured
                          ? 'Background reminders aren\'t available yet.'
                          : backgroundPush.permission === 'denied'
                            ? 'Blocked in your browser settings — allow notifications for this site.'
                            : backgroundPush.enabled
                              ? `${backgroundPush.upcoming} reminders scheduled on the server.`
                              : 'Reminders currently only arrive while UltraCC is open.')}
                    {backgroundPush.enabled && backgroundPush.healthNote && (
                      <span className="uc-set-row-note">{backgroundPush.healthNote}</span>
                    )}
                  </small>
                </span>
                <button
                  type="button"
                  onClick={() => void backgroundPush.toggle()}
                  disabled={backgroundPush.busy || !backgroundPush.supported || !backgroundPush.configured || backgroundPush.permission === 'denied'}
                  aria-pressed={backgroundPush.enabled}
                  className={`uc-dir-go${backgroundPush.enabled ? '' : ' is-on'}`}
                >
                  {backgroundPush.busy ? <Loader2 className="spin" aria-hidden="true" /> : backgroundPush.enabled ? 'Turn off' : 'Enable'}
                </button>
              </div>
            </section>
          )}

          {/* Campus selection */}
          <section className="uc-set">
            <p className="uc-cap"><GraduationCap aria-hidden="true" />Campus</p>
            <div className="uc-set-list">
              {CAMPUS_LIST.map((c) => {
                const active = c.id === storedCampus;
                return (
                  <button
                    key={c.id}
                    type="button"
                    // A campus UltraCC cannot sign in to is shown for the answer
                    // it is, not as a choice that leads to empty screens.
                    disabled={!c.verified}
                    aria-disabled={!c.verified}
                    aria-pressed={active}
                    onClick={() => {
                      if (!c.verified) return;
                      // A device that will not store the choice would reload back
                      // to the same campus, so say so instead of reloading.
                      if (!writeStoredCampusId(c.id)) {
                        setCampusNotice('This browser will not save settings, so the campus stays where it is.');
                        return;
                      }
                      // Force a page reload to re-initialize with the new campus
                      window.location.reload();
                    }}
                    className={`uc-pick${active ? ' is-on' : ''}`}
                  >
                    <span className="uc-pick-main">
                      <b>{c.label}</b>
                      <small className="uc-num">{c.vtopHost}</small>
                      {c.note && <small>{c.note}</small>}
                    </span>
                    <span className="uc-pick-rail">
                      {active && <span className="uc-dir-tag is-live">ACTIVE</span>}
                      <span className={`uc-dir-tag${c.verified ? ' is-good' : ''}`}>
                        {c.verified ? 'AVAILABLE' : 'COMING SOON'}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            {campusNotice && (
              <p className="uc-set-warn" role="status">{campusNotice}</p>
            )}
            <p className="uc-set-hint">
              UltraCC signs in to VIT Chennai today. The other campuses are listed so you know what is coming; picking one will not work yet. Changing campus signs you out, so you will need to sign in again.
            </p>
          </section>

          {/* Local data */}
          <section className="uc-set">
            <p className="uc-cap"><Trash2 aria-hidden="true" />Local data</p>
            <button type="button" onClick={handleClear} disabled={clearing} className="uc-dir-go uc-danger uc-set-act">
              {clearing ? <Loader2 className="spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
              Clear all cached VTOP data
            </button>
            <p className="uc-set-hint">Removes synced data from this device. Your VTOP account is untouched.</p>
          </section>
        </div>

        <footer className="uc-plate-foot uc-sheet-foot">
          <span role="status" aria-live="polite">
            {savedFlash
              ? (<><CheckCircle aria-hidden="true" />{savedFlash}</>)
              : (<><ShieldCheck aria-hidden="true" />Settings are stored on this device only.</>)}
          </span>
          <button type="button" onClick={onClose} className="uc-dir-go acc-bg">Done</button>
        </footer>
      </div>
    </div>
  );
};

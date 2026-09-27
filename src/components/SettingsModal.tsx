import React, { useEffect, useState } from 'react';
import {
  X, Calendar, Palette, KeyRound, Trash2, CheckCircle, Save, Loader2, Eye, EyeOff, GraduationCap, RefreshCw, BellRing, LayoutDashboard,
} from 'lucide-react';
import { getFreshnessTtlMs, setFreshnessTtlHours } from '../lib/vtop/syncCoordinator';
import { SemesterInfo } from '../lib/vtop/types';
import {
  ACCENT_OPTIONS, AccentColor, getSavedCredentials, saveCredentials, clearSavedCredentials,
  getSavedLmsCredentials, saveLmsCredentials, clearSavedLmsCredentials,
  getGeminiApiKey, saveGeminiApiKey, clearGeminiApiKey, saveAccentColor, getAppTheme, saveAppTheme, THEME_OPTIONS, AppTheme, saveFeatureMode,
} from '../lib/settings';
import type { FeatureMode } from '../lib/navVisibility';
import { CAMPUS_LIST } from '../lib/campus';
import { humanErrorCopy } from '../lib/errorCopy';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useDialog } from '../hooks/useDialog';
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
  const [lmsMessage, setLmsMessage] = useState<string | null>(null);
  const [appTheme, setAppTheme] = useState<AppTheme>(() => getAppTheme());

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
  }, [isOpen]);

  if (!isOpen) return null;

  const flash = (msg: string) => {
    setSavedFlash(msg);
    setTimeout(() => setSavedFlash(null), 2500);
  };

  const handleSaveCredentials = () => {
    saveCredentials({ regNo, password });
    flash('VTOP credentials saved on this device.');
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

  const handleFeatureMode = (next: FeatureMode) => {
    saveFeatureMode(next);
    onModeChange?.(next);
    flash(`Feature mode set to ${next}.`);
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
    setLmsMessage(null);
    try {
      const result = await onLmsSync();
      setLmsMessage(result.message);
    } finally {
      setLmsSyncing(false);
    }
  };

  return (
    <div className="ultracc-settings-overlay fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-50 backdrop-blur-md animate-fadeIn">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ultracc-settings-title"
        className="ultracc-settings-panel w-full max-w-xl bg-white border border-zinc-200 rounded-3xl shadow-2xl overflow-hidden max-h-[92dvh] overflow-y-auto"
      >
        <div className="p-6 bg-zinc-50 border-b border-zinc-200 flex items-center justify-between sticky top-0 z-10">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-2xl bg-blue-500/10 border border-blue-500/30 text-blue-600">
              <Palette className="h-5 w-5" />
            </div>
            <div>
              <h3 id="ultracc-settings-title" className="text-lg font-extrabold text-zinc-900 tracking-tight">Settings</h3>
              <p className="text-xs text-zinc-500 font-medium">Semester, appearance, saved login & AI key</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close settings" className="p-2 text-zinc-500 hover:text-zinc-900 rounded-xl hover:bg-zinc-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-6 text-xs text-zinc-900">

          {/* Semester */}
          <section className="space-y-2">
            <p className="font-extrabold text-zinc-900 flex items-center gap-2">
              <Calendar className="h-4 w-4 acc-text" /> Academic Semester
            </p>
            {semesters.length > 0 ? (
              <select
                aria-label="Active semester"
                value={selectedSemesterId}
                onChange={(e) => onSemesterChange(e.target.value)}
                disabled={semesterLoading}
                className="w-full bg-white border border-zinc-200 rounded-xl px-3.5 py-2.5 text-xs text-zinc-900 focus:border-blue-500 focus:outline-none disabled:opacity-50"
              >
                {semesters.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} {s.isCurrent ? '(Active)' : ''}</option>
                ))}
              </select>
            ) : (
              <p className="text-[11px] text-zinc-500">
                No semesters yet — log in first, then choose your semester here. Your choice is saved and reused automatically.
              </p>
            )}
            <p className="text-[10px] text-zinc-500">Changing semester re-syncs attendance, timetable, marks, exams &amp; OD.</p>
          </section>

          {/* Feature mode */}
          <section className="space-y-2">
            <p className="font-extrabold text-zinc-900 flex items-center gap-2">
              <LayoutDashboard className="h-4 w-4 acc-text" /> Feature Mode
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleFeatureMode('minimal')}
                className={`text-left rounded-xl border px-3 py-3 transition cursor-pointer ${mode === 'minimal' ? 'acc-soft acc-border' : 'border-zinc-200 bg-white'}`}
              >
                <span className="block text-xs font-extrabold text-zinc-900">Minimal</span>
                <span className="block text-[10px] text-zinc-500 mt-1">Timetable, attendance, exams and marks only</span>
              </button>
              <button
                onClick={() => handleFeatureMode('complete')}
                className={`text-left rounded-xl border px-3 py-3 transition cursor-pointer ${mode === 'complete' ? 'acc-soft acc-border' : 'border-zinc-200 bg-white'}`}
              >
                <span className="block text-xs font-extrabold text-zinc-900">Complete</span>
                <span className="block text-[10px] text-zinc-500 mt-1">Every UltraCC feature</span>
              </button>
            </div>
            <p className="text-[10px] text-zinc-500">Minimal keeps just the daily essentials in the rail, menu and search; complete shows everything.</p>
          </section>

          {/* Surface theme */}
          <section className="space-y-2">
            <p className="font-extrabold text-zinc-900 flex items-center gap-2">
              <Palette className="h-4 w-4 acc-text" /> Surface Theme
            </p>            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {THEME_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => handleSurfaceTheme(opt.id)}
                  className={`text-left rounded-xl border px-3 py-3 transition cursor-pointer ${appTheme === opt.id ? 'acc-soft acc-border' : 'border-zinc-200 bg-white'}`}
                >
                  <span className="block text-xs font-extrabold text-zinc-900">{opt.label}</span>
                  <span className="block text-[10px] text-zinc-500 mt-1">{opt.description}</span>
                </button>
              ))}
            </div>
            <p className="text-[10px] text-zinc-500">Keeps the same UltraCC design system across light and dark surfaces.</p>
          </section>

          {/* Accent theme */}
          <section className="space-y-2">
            <p className="font-extrabold text-zinc-900 flex items-center gap-2">
              <Palette className="h-4 w-4 acc-text" /> Theme Colour
            </p>
            <div className="flex flex-wrap gap-2.5">
              {ACCENT_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => handleTheme(opt.id)}
                  title={opt.label}
                  className="w-9 h-9 rounded-full border-2 border-zinc-200 hover:scale-110 transition cursor-pointer flex items-center justify-center"
                  style={{ backgroundColor: opt.swatch }}
                >
                  {opt.id === (document.documentElement.getAttribute('data-accent') || 'blue') && (
                    <CheckCircle className="h-4 w-4 text-zinc-900" />
                  )}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-zinc-500">Applied instantly across the app.</p>
          </section>

          {/* Auto-refresh freshness */}
          <section className="space-y-2">
            <p className="font-extrabold text-zinc-900 flex items-center gap-2">
              <RefreshCw className="h-4 w-4 acc-text" /> Auto Refresh
            </p>
            <select
              aria-label="Automatic refresh interval"
              value={ttlHours}
              onChange={(e) => {
                const h = Number(e.target.value);
                setTtlHours(h);
                setFreshnessTtlHours(h);
              }}
              className="w-full bg-white border border-zinc-200 rounded-xl px-3.5 py-2.5 text-xs text-zinc-900 focus:border-blue-500 focus:outline-none"
            >
              <option value={1}>Refresh when data is 1 hour old</option>
              <option value={6}>Refresh when data is 6 hours old (default)</option>
              <option value={12}>Refresh when data is 12 hours old</option>
              <option value={24}>Refresh when data is 1 day old</option>
              <option value={48}>Refresh when data is 2 days old</option>
              <option value={168}>Refresh when data is 1 week old</option>
            </select>
            <p className="text-[10px] text-zinc-500">
              Cached data always shows instantly. When it gets older than this, UltraCC refreshes it in the background (on open, when you return to the app, or when the connection comes back) — only while you're signed in, never offline, and never more than once per freshness window.
            </p>
          </section>

          {/* VTOP credentials */}
          <section className="space-y-2.5">
            <p className="font-extrabold text-zinc-900 flex items-center gap-2">
              <KeyRound className="h-4 w-4 acc-text" /> Saved VTOP Login
            </p>
            <p className="text-[10px] text-zinc-500 leading-relaxed">
              Stored <strong>only on this device</strong> (localStorage) and used to prefill the login form. Never sent anywhere except to VTOP when you log in.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-zinc-500 font-medium mb-1">Registration Number or VTOP username</label>
                <input
                  type="text"
                  value={regNo}
                  // Stored as typed; the gateway uppercases the login id the
                  // same way VTOP's own login field does before submitting.
                  onChange={(e) => setRegNo(e.target.value)}
                  className="w-full bg-white border border-zinc-200 rounded-xl px-3.5 py-2.5 text-xs text-zinc-900 font-mono focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] text-zinc-500 font-medium mb-1">VTOP Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-white border border-zinc-200 rounded-xl px-3.5 py-2.5 text-xs text-zinc-900 font-mono focus:border-blue-500 focus:outline-none pr-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-500 hover:text-zinc-900"
                  >
                    {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            </div>
            <button
              onClick={handleSaveCredentials}
              className="px-4 py-2 acc-bg text-zinc-900 font-bold rounded-xl transition cursor-pointer flex items-center gap-1.5 hover:opacity-90"
            >
              <Save className="h-3.5 w-3.5" /> Save Login
            </button>
          </section>

          {/* LMS (Moodle) account */}
          <section className="space-y-2.5">
            <p className="font-extrabold text-zinc-900 flex items-center gap-2">
              <GraduationCap className="h-4 w-4 acc-text" /> LMS Account (lms.vit.ac.in)
            </p>
            <p className="text-[10px] text-zinc-500 leading-relaxed">
              Moodle uses a separate LMS account. Enter the exact username/email shown in VTOP under My Credentials, not your VTOP registration number. Credentials stay in memory for this session and are sent only to the UltraCC gateway over HTTPS.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-zinc-500 font-medium mb-1">LMS Username / email</label>
                <input
                  type="text"
                  value={lmsUsername}
                  onChange={(e) => setLmsUsername(e.target.value.trim())}
                  placeholder="Use the username shown in VTOP My Credentials"
                  className="w-full bg-white border border-zinc-200 rounded-xl px-3.5 py-2.5 text-xs text-zinc-900 font-mono focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] text-zinc-500 font-medium mb-1">LMS Password</label>
                <div className="relative">
                  <input
                    type={showLmsPassword ? 'text' : 'password'}
                    value={lmsPassword}
                    onChange={(e) => setLmsPassword(e.target.value)}
                    className="w-full bg-white border border-zinc-200 rounded-xl px-3.5 py-2.5 text-xs text-zinc-900 font-mono focus:border-blue-500 focus:outline-none pr-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShowLmsPassword(!showLmsPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-500 hover:text-zinc-900"
                  >
                    {showLmsPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            </div>
            <button
              onClick={handleSaveLmsCredentials}
              className="px-4 py-2 acc-bg text-zinc-900 font-bold rounded-xl transition cursor-pointer flex items-center gap-1.5 hover:opacity-90"
            >
              <Save className="h-3.5 w-3.5" /> Save LMS Login
            </button>
            <div className="pt-1 border-t border-zinc-200">
              <button
                onClick={handleLmsSync}
                disabled={lmsSyncing || !onLmsSync}
                className="w-full py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-zinc-900 text-xs font-extrabold transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {lmsSyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SyncIcon />}
                {lmsSyncing ? 'Syncing LMS…' : 'Sync Now'}
              </button>
              {lmsMessage && (
                <p className={`text-[11px] mt-2 font-medium ${lmsMessage.includes('failed') ? 'text-rose-700' : 'text-emerald-700'}`}>{lmsMessage}</p>
              )}
              {lmsSyncErrors && lmsSyncErrors.length > 0 && (
                <div className="mt-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-700 text-[11px] space-y-1" role="status">
                  <p className="font-extrabold text-amber-700">Some LMS data could not be fetched</p>
                  {lmsSyncErrors.map((e, i) => (
                    <p key={i}><span className="font-bold">{e.label}:</span> {humanErrorCopy(e.error, 'The LMS did not answer, so this was not loaded.')}</p>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Gemini API key */}
          <section className="space-y-2.5">
            <p className="font-extrabold text-zinc-900 flex items-center gap-2">
              <SparklesIcon /> Gemini API Key (AI Advisor)
            </p>
            <p className="text-[10px] text-zinc-500 leading-relaxed">
              Used only by the AI Advisor chat — sent directly to Google Gemini. Stored on this device.
            </p>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                aria-label="Gemini API key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Paste your Gemini API key"
                className="w-full bg-white border border-zinc-200 rounded-xl px-3.5 py-2.5 text-xs text-zinc-900 font-mono focus:border-blue-500 focus:outline-none pr-9"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-500 hover:text-zinc-900"
              >
                {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
            <button
              onClick={handleSaveApiKey}
              className="px-4 py-2 acc-bg text-zinc-900 font-bold rounded-xl transition cursor-pointer flex items-center gap-1.5 hover:opacity-90"
            >
              <Save className="h-3.5 w-3.5" /> Save API Key
            </button>
          </section>

          {/* Background notifications (works with the browser closed) */}
          {backgroundPush && (
            <section className="space-y-2.5">
              <p className="font-extrabold text-zinc-900 flex items-center gap-2">
                <BellRing className="h-4 w-4 acc-text" /> Background Notifications
              </p>
              <p className="text-[10px] text-zinc-500 leading-relaxed">
                Class reminders (10 minutes before) and LMS quiz windows arrive even when UltraCC is closed.
                Only your reminder times are uploaded — never marks, attendance or credentials.
              </p>
              <div className="flex items-center justify-between gap-3 border border-zinc-200 rounded-xl px-3 py-2.5">
                <span className="text-xs font-bold text-zinc-800">
                  {backgroundPush.enabled ? 'On' : 'Off'}
                  <span className="block text-[10px] text-zinc-500 font-medium mt-0.5">
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
                      <span className="block text-[10px] mt-0.5 acc-text font-semibold">{backgroundPush.healthNote}</span>
                    )}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => void backgroundPush.toggle()}
                  disabled={backgroundPush.busy || !backgroundPush.supported || !backgroundPush.configured || backgroundPush.permission === 'denied'}
                  aria-pressed={backgroundPush.enabled}
                  className={`shrink-0 px-3.5 py-2 rounded-xl text-[11px] font-extrabold transition cursor-pointer disabled:opacity-50 ${
                    backgroundPush.enabled ? 'bg-white border border-zinc-200 text-zinc-900' : 'acc-bg text-white'
                  }`}
                >
                  {backgroundPush.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : backgroundPush.enabled ? 'Turn off' : 'Enable'}
                </button>
              </div>
            </section>
          )}

          {/* Campus Selection */}
          <section className="space-y-2.5">
            <p className="font-extrabold text-sky-600 flex items-center gap-2">
              <GraduationCap className="h-4 w-4" /> Campus
            </p>
            <div className="space-y-2">
              {CAMPUS_LIST.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    localStorage.setItem('ultracc:campus', c.id);
                    // Force a page reload to re-initialize with the new campus
                    window.location.reload();
                  }}
                  className={`w-full flex items-center justify-between gap-3 border rounded-xl px-3 py-2.5 transition cursor-pointer ${
                    c.id === (localStorage.getItem('ultracc:campus') || 'chennai')
                      ? 'bg-sky-500/10 border-sky-500/30'
                      : 'bg-zinc-50 border-zinc-200 hover:border-zinc-200'
                  }`}
                >
                  <div className="min-w-0 text-left">
                    <p className="text-sm font-bold text-zinc-900">{c.label}</p>
                    <p className="text-[10px] text-zinc-500 truncate">{c.vtopHost}</p>
                    {c.note && <p className="text-[10px] text-amber-600/80 mt-0.5">{c.note}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {c.id === (localStorage.getItem('ultracc:campus') || 'chennai') && (
                      <span className="text-[9px] font-bold text-sky-700">ACTIVE</span>
                    )}
                    <span
                      className={`text-[9px] font-bold px-2 py-1 rounded-full border ${
                        c.verified
                          ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/25'
                          : 'bg-zinc-100 text-zinc-500 border-zinc-200'
                      }`}
                    >
                      {c.verified ? 'VERIFIED' : 'CONFIGURED'}
                    </span>
                  </div>
                </button>
              ))}
            </div>
            <p className="text-[10px] text-zinc-500">
              Select your VIT campus. Chennai is verified; others are configured with official VTOP hosts but parsers are not yet live-verified. Changing campus requires re-login.
            </p>
          </section>

          <section className="space-y-2">
            <p className="font-extrabold text-rose-600 flex items-center gap-2">
              <Trash2 className="h-4 w-4" /> Local Data
            </p>
            <button
              onClick={handleClear}
              disabled={clearing}
              className="px-4 py-2 bg-rose-500/10 border border-rose-500/30 text-rose-700 font-bold rounded-xl transition cursor-pointer flex items-center gap-1.5 hover:bg-rose-500/20 disabled:opacity-50"
            >
              {clearing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Clear all cached VTOP data
            </button>
            <p className="text-[10px] text-zinc-500">Removes synced data from this device. Your VTOP account is untouched.</p>
          </section>

          {savedFlash && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-700 flex items-center gap-2">
              <CheckCircle className="h-4 w-4 shrink-0" /> {savedFlash}
            </div>
          )}
        </div>

        <div className="p-5 bg-white border-t border-zinc-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2.5 acc-bg text-zinc-900 font-extrabold rounded-2xl text-xs transition cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

function SyncIcon() {
  return (
    <span className="acc-text">
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" /></svg>
    </span>
  );
}

function SparklesIcon() {
  return (
    <span className="acc-text">
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.9 5.7L19.6 9l-5.7 1.9L12 16.6l-1.9-5.7L4.4 9l5.7-1.3L12 2zM19 14l.9 2.6L22.5 17.5l-2.6.9L19 21l-.9-2.6-2.6-.9 2.6-.9L19 14z" /></svg>
    </span>
  );
}

import React, { useState } from 'react';
import { UserRound, CreditCard, KeyRound, Mail, Phone, GraduationCap, ShieldCheck, Eye, EyeOff, ExternalLink, BadgeCheck, Landmark, Fingerprint, MessagesSquare, History, CalendarClock, Megaphone, Users, Wallet, Sparkles } from 'lucide-react';
import { PaymentsInfo, CredentialsInfo, CredentialRow, PaymentReceiptsInfo, SapInfo, BankInfo, BiometricInfo, ProctorMessage, LoginHistoryRow, ClassMessage, HodDeanInfo, WalletInfo, ExtraCurricularInfo } from '../lib/vtop/types';
import { Download } from 'lucide-react';
import { StudentProfile } from '../types';
import { useCgpaPrivacy } from '../lib/cgpaPrivacy';
import { ProfilePhoto } from './ProfilePhoto';

interface MyInfoViewProps {
  student?: StudentProfile | null;
  payments?: PaymentsInfo | null;
  credentials?: CredentialsInfo | null;
  paymentReceipts?: PaymentReceiptsInfo | null;
  sapInfo?: SapInfo | null;
  bankInfo?: BankInfo | null;
  biometric?: BiometricInfo | null;
  proctorMessages?: ProctorMessage[] | null;
  loginHistory?: LoginHistoryRow[] | null;
}

type Section = 'profile' | 'payments' | 'credentials' | 'more';

/**
 * MyInfoView — the student's own info: VTOP profile, fee dues/payments,
 * and the accounts VTOP manages (credentials page).
 */
export const MyInfoView: React.FC<MyInfoViewProps> = ({ student, payments, credentials, paymentReceipts, sapInfo, bankInfo, biometric, proctorMessages, loginHistory, classMessages, hodDean, wallet, extraCurricular }) => {
  const [section, setSection] = useState<Section>('profile');

  const tabs: { id: Section; label: string; icon: React.ElementType }[] = [
    { id: 'profile', label: 'Profile', icon: UserRound },
    { id: 'payments', label: 'Payments', icon: CreditCard },
    { id: 'credentials', label: 'My Accounts', icon: KeyRound },
    { id: 'more', label: 'Documents & More', icon: History },
  ];

  return (
    <div className="my-info-view space-y-6">
      <div>
        <h2 className="text-2xl font-extrabold text-zinc-900 tracking-tight">My Info</h2>
        <p className="text-sm text-zinc-500 font-medium mt-1">
          Your profile, fee payments and VTOP-managed accounts — synced from VTOP
        </p>
      </div>

      {/* Section tabs */}
      <div className="flex space-x-1 bg-white border border-zinc-200 rounded-2xl p-1 w-fit">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = section === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setSection(t.id)}
              className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                active ? 'acc-bg text-zinc-900 acc-glow' : 'text-zinc-500 hover:text-zinc-900'
              }`}
            >
              <Icon className="h-4 w-4" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {section === 'profile' && <ProfileSection student={student} sapInfo={sapInfo} />}
      {section === 'payments' && <PaymentsSection payments={payments} paymentReceipts={paymentReceipts} />}
      {section === 'credentials' && <CredentialsSection credentials={credentials} />}
      {section === 'more' && (
        <MoreSection
          bankInfo={bankInfo}
          biometric={biometric}
          proctorMessages={proctorMessages}
          loginHistory={loginHistory}
          classMessages={classMessages}
          hodDean={hodDean}
          wallet={wallet}
          extraCurricular={extraCurricular}
        />
      )}
    </div>
  );
};

function ProfileSection({ student, sapInfo }: { student?: StudentProfile | null; sapInfo?: SapInfo | null }) {
  if (!student) {
    return <EmptyState text="Profile not synced yet — log in with VTOP to see your details." />;
  }
  const [cgpaHidden] = useCgpaPrivacy();
  // Each row is labelled with what VTOP actually calls the value it holds.
  // "Branch / Group Studied" on the profile page is the Class-XII group ("PCM",
  // "Computer with Maths"), so it gets its own row and can never be shown as
  // the branch. Branch is blank (rendered as "—") until VTOP states one.
  const rows: { label: string; value: string }[] = [
    { label: 'Name', value: student.name },
    { label: 'Registration No.', value: student.regNo },
    { label: 'Programme', value: student.program },
    { label: 'Branch', value: student.branch },
    { label: 'School', value: student.school },
    { label: 'Class XII group', value: student.groupStudied },
    { label: 'Semester', value: student.semester > 0 ? String(student.semester) : 'Not available from VTOP' },
    { label: 'CGPA', value: cgpaHidden ? '••••' : student.cgpa !== null && student.cgpa > 0 ? student.cgpa.toFixed(2) : 'Not available from VTOP' },
    { label: 'Credits Earned', value: student.totalCreditsCompleted !== null ? String(student.totalCreditsCompleted) : 'Not available from VTOP' },
    { label: 'Credits Registered', value: student.totalCreditsRequired !== null ? String(student.totalCreditsRequired) : 'Not available from VTOP' },
  ];
  return (
    <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 shadow-xl">
      <div className="profile-mobile-identity">
        <ProfilePhoto name={student.name} src={student.profilePhotoUrl} size="md" className="profile-mobile-avatar" />
        <div>
          <strong>{student.name}</strong>
          <span>{student.regNo}{(student.branch || student.school) ? ` · ${student.branch || student.school}` : ''}</span>
          <small>VIT Chennai</small>
        </div>
      </div>
      <div className="flex items-center space-x-3 mb-6">
        <div className="p-2.5 bg-blue-500/10 border border-blue-500/20 rounded-2xl text-blue-600">
          <GraduationCap className="h-6 w-6" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-zinc-900 tracking-tight">Student Profile</h3>
          <p className="text-xs text-zinc-500 font-medium">From your VTOP profile</p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {rows.map((r) => (
          <div key={r.label} className="bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3">
            <p className="text-[10px] uppercase tracking-wide text-zinc-500 font-bold">{r.label}</p>
            <p className="text-sm font-semibold text-zinc-900 mt-1 break-words">{r.value || '—'}</p>
          </div>
        ))}
        {sapInfo && sapInfo.rows.length > 0 && (
          <div className="bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3">
            <p className="text-[10px] uppercase tracking-wide text-zinc-500 font-bold">SAP ID</p>
            <p className="text-sm font-semibold text-zinc-900 mt-1 break-words">
              {sapInfo.rows.find((r) => /sap/i.test(r.label))?.value || sapInfo.rows.map((r) => r.value).filter(Boolean).join(' · ')}
            </p>
          </div>
        )}
        {(student.hostelBlock || student.roomNo) && (
          <div className="bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3">
            <p className="text-[10px] uppercase tracking-wide text-zinc-500 font-bold">Hostel</p>
            <p className="text-sm font-semibold text-zinc-900 mt-1">
              {[student.hostelBlock, student.roomNo].filter(Boolean).join(' · ') || '—'}
            </p>
          </div>
        )}
      </div>

      {/* Proctor */}
      <div className="mt-6 bg-zinc-50 border border-zinc-200 rounded-2xl p-5">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-violet-500/10 border border-violet-500/20 rounded-xl text-violet-600">
            <BadgeCheck className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-zinc-900">
              {student.proctorAvailable && student.proctorName ? student.proctorName : 'Proctor not provided by VTOP'}
            </p>
            <p className="text-[11px] text-zinc-500">Academic Proctor</p>
            {student.proctorContact && (
              <p className="text-[11px] text-zinc-500 mt-1 flex items-center gap-1.5 break-all">
                {student.proctorContact.includes('@') ? <Mail className="h-3.5 w-3.5 shrink-0" /> : <Phone className="h-3.5 w-3.5 shrink-0" />}
                {student.proctorContact}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PaymentsSection({ payments, paymentReceipts }: { payments?: PaymentsInfo | null; paymentReceipts?: PaymentReceiptsInfo | null }) {
  if (!payments) {
    return <EmptyState text="Payments not synced yet — log in and sync to see your fee dues." />;
  }
  return (
    <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 shadow-xl">
      <div className="flex items-center space-x-3 mb-6">
        <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-emerald-600">
          <CreditCard className="h-6 w-6" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-zinc-900 tracking-tight">{payments.title || 'Fee Payments'}</h3>
          <p className="text-xs text-zinc-500 font-medium">From VTOP p2p/Payments</p>
        </div>
      </div>

      {payments.message && (
        <div className="flex items-start gap-3 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl mb-5">
          <ShieldCheck className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
          <p className="text-sm text-emerald-700">{payments.message}</p>
        </div>
      )}

      {payments.rows.length === 0 && !payments.message && (
        <p className="text-sm text-zinc-500">
          No payment/dues information returned by VTOP for your account.
        </p>
      )}

      {payments.rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <tbody>
              {payments.rows.map((r, i) => (
                <tr key={i} className="border-t border-zinc-200 first:border-t-0">
                  <td className="py-2.5 pr-4 text-zinc-500 font-medium whitespace-nowrap">{r.label}</td>
                  <td className="py-2.5 font-semibold text-zinc-900 text-right">{r.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[10px] text-zinc-600 mt-5">
        Amounts shown are exactly what VTOP reports. Payment itself happens on VTOP's payment portal.
      </p>

      {/* Payment receipts */}
      <div className="mt-8 border-t border-zinc-200 pt-6">
        <h4 className="text-sm font-bold text-zinc-900 mb-3">Payment Receipts</h4>
        {!paymentReceipts ? (
          <p className="text-[11px] text-zinc-500">Not synced yet — re-sync to fetch your fee receipts.</p>
        ) : paymentReceipts.receipts.length === 0 ? (
          <p className="text-[11px] text-zinc-500">No receipts returned by VTOP for your account.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-widest text-zinc-500">
                  <th scope="col" className="py-2 pr-3 font-extrabold">Receipt No.</th>
                  <th scope="col" className="py-2 pr-3 font-extrabold">Date</th>
                  <th scope="col" className="py-2 pr-3 font-extrabold">Amount</th>
                  <th scope="col" className="py-2 font-extrabold">Campus</th>
                  <th scope="col" className="py-2 font-extrabold"></th>
                </tr>
              </thead>
              <tbody>
                {paymentReceipts.receipts.map((r, i) => (
                  <tr key={`${r.receiptNumber}-${i}`} className="border-t border-zinc-200">
                    <td className="py-2 pr-3 font-mono text-zinc-900">{r.receiptNumber}</td>
                    <td className="py-2 pr-3 text-zinc-900">{r.date}</td>
                    <td className="py-2 pr-3 font-mono text-emerald-600">{r.amount}</td>
                    <td className="py-2 text-zinc-500">{r.campusCode}</td>
                    <td className="py-2">
                      <button
                        onClick={() => {
                          // Generate a printable receipt
                          const win = window.open('', '_blank');
                          if (win) {
                            win.document.write(`<!DOCTYPE html><html><head><title>Receipt ${r.receiptNumber}</title><style>body{font-family:system-ui;padding:40px;background:#000;color:#fff}table{width:100%;border-collapse:collapse}td,th{padding:8px 12px;border-bottom:1px solid #333;text-align:left}th{color:#888;font-size:11px;text-transform:uppercase}.amount{color:#34d399;font-size:20px;font-weight:bold}.header{text-align:center;margin-bottom:30px}.header h1{font-size:24px;margin:0}.header p{color:#888;font-size:12px}@media print{body{background:#fff;color:#000}}</style></head><body><div class='header'><h1>UltraCC — Payment Receipt</h1><p>VIT Chennai Fee Payment Receipt</p></div><table><tr><th>Receipt Number</th><td>${r.receiptNumber}</td></tr><tr><th>Date</th><td>${r.date}</td></tr><tr><th>Amount</th><td class='amount'>${r.amount}</td></tr><tr><th>Campus</th><td>${r.campusCode}</td></tr><tr><th>Registration No</th><td>${r.regno}</td></tr><tr><th>Application No</th><td>${r.applno}</td></tr></table><p style='margin-top:30px;text-align:center;color:#666;font-size:10px'>Generated by UltraCC • ${new Date().toLocaleDateString('en-IN')}</p></body></html>`);
                            win.document.close();
                            win.print();
                          }
                        }}
                        className="p-1.5 text-zinc-500 hover:text-emerald-600 bg-white border border-zinc-200 rounded-lg transition cursor-pointer"
                        title="Download receipt"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function CredentialsSection({ credentials }: { credentials?: CredentialsInfo | null }) {
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});

  if (!credentials) {
    return <EmptyState text="Accounts not synced yet — log in and sync to see the credentials VTOP manages for you." />;
  }
  if (credentials.credentials.length === 0) {
    return <EmptyState text="VTOP returned no managed accounts for you." />;
  }
  return (
    <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 shadow-xl">
      <div className="flex items-center space-x-3 mb-6">
        <div className="p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-2xl text-amber-600">
          <KeyRound className="h-6 w-6" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-zinc-900 tracking-tight">{credentials.title || 'My Accounts'}</h3>
          <p className="text-xs text-zinc-500 font-medium">Accounts VTOP manages for you — usernames &amp; login URLs</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {credentials.credentials.map((c: CredentialRow, i: number) => (
          <div key={`${c.account}-${i}`} className="bg-zinc-50 border border-zinc-200 rounded-2xl p-4">
            <p className="font-bold text-zinc-900 text-sm">{c.account}</p>
            <div className="mt-3 space-y-2 text-xs">
              {c.username && (
                <p className="flex items-center justify-between gap-2">
                  <span className="text-zinc-500">Username</span>
                  <span className="font-mono text-zinc-900">{c.username}</span>
                </p>
              )}
              {c.defaultCredentials && (
                <p className="flex items-center justify-between gap-2">
                  <span className="text-zinc-500">Default password</span>
                  <span className="font-mono text-zinc-900">
                    {revealed[i] ? c.defaultCredentials : '••••••••'}
                    <button
                      onClick={() => setRevealed((s) => ({ ...s, [i]: !s[i] }))}
                      className="ml-2 text-zinc-500 hover:text-zinc-900 transition cursor-pointer align-middle"
                      title={revealed[i] ? 'Hide' : 'Show'}
                    >
                      {revealed[i] ? <EyeOff className="h-3.5 w-3.5 inline" /> : <Eye className="h-3.5 w-3.5 inline" />}
                    </button>
                  </span>
                </p>
              )}
              {c.url && (
                <a
                  href={c.url.startsWith('http') ? c.url : `https://${c.url}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-700 transition"
                >
                  <ExternalLink className="h-3 w-3" /> Open portal
                </a>
              )}
              {c.venueDate && <p className="text-[10px] text-zinc-600">{c.venueDate}</p>}
            </div>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-zinc-600 mt-5">
        Passwords are shown only on this device and are never stored or sent anywhere else.
      </p>
    </div>
  );
}

function MoreSection({
  bankInfo, biometric, proctorMessages, loginHistory, classMessages, hodDean, wallet, extraCurricular,
}: {
  bankInfo?: BankInfo | null;
  biometric?: BiometricInfo | null;
  proctorMessages?: ProctorMessage[] | null;
  loginHistory?: LoginHistoryRow[] | null;
  classMessages?: ClassMessage[] | null;
  hodDean?: HodDeanInfo | null;
  wallet?: WalletInfo | null;
  extraCurricular?: ExtraCurricularInfo | null;
}) {
  return (
    <div className="space-y-5">
      {/* Class messages */}
      <div className="bg-white border border-zinc-200 rounded-3xl p-6 shadow-xl">
        <div className="flex items-center space-x-3 mb-4">
          <div className="p-2.5 bg-sky-500/10 border border-sky-500/20 rounded-2xl text-sky-600">
            <Megaphone className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-zinc-900 tracking-tight">Class Messages</h3>
            <p className="text-[10px] text-zinc-500">From VTOP — StudentClassMessage</p>
          </div>
        </div>
        {!classMessages || classMessages.length === 0 ? (
          <p className="text-xs text-zinc-500">No class messages synced — re-sync to fetch announcements from VTOP.</p>
        ) : (
          <div className="space-y-3">
            {classMessages.slice(0, 10).map((m, i) => (
              <div key={i} className="bg-zinc-50 border border-zinc-200 rounded-2xl p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-bold text-zinc-900">{m.subject || 'Message'}</p>
                  <span className="text-[10px] font-mono text-zinc-500 shrink-0">{m.date}</span>
                </div>
                {m.from && <p className="text-[10px] text-zinc-500 mt-0.5">From: {m.from}</p>}
                {m.body && <p className="text-xs text-zinc-900 mt-2 leading-relaxed">{m.body}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* HOD / Dean */}
      <div className="bg-white border border-zinc-200 rounded-3xl p-6 shadow-xl">
        <div className="flex items-center space-x-3 mb-4">
          <div className="p-2.5 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl text-indigo-600">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-zinc-900 tracking-tight">HOD / Dean</h3>
            <p className="text-[10px] text-zinc-500">From VTOP — viewHodDeanDetails</p>
          </div>
        </div>
        {!hodDean ? (
          <p className="text-xs text-zinc-500">Not synced yet — re-sync to fetch HOD / Dean details.</p>
        ) : hodDean.rows.length === 0 ? (
          <p className="text-xs text-zinc-500">VTOP returned no HOD / Dean details for your account.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {hodDean.rows.map((r, i) => (
              <div key={i} className="bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2">
                <p className="text-[9px] uppercase tracking-wide text-zinc-500 font-bold">{r.label}</p>
                <p className="text-sm font-semibold text-zinc-900 mt-0.5 break-words">{r.value}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Wallet */}
      <div className="bg-white border border-zinc-200 rounded-3xl p-6 shadow-xl">
        <div className="flex items-center space-x-3 mb-4">
          <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-emerald-600">
            <Wallet className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-zinc-900 tracking-tight">Student Wallet</h3>
            <p className="text-[10px] text-zinc-500">From VTOP — getStudentWallet</p>
          </div>
        </div>
        {!wallet ? (
          <p className="text-xs text-zinc-500">Not synced yet — re-sync to fetch your wallet balance.</p>
        ) : wallet.rows.length === 0 ? (
          <p className="text-xs text-zinc-500">{wallet.message || 'VTOP returned no wallet information for your account.'}</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {wallet.rows.map((r, i) => (
              <div key={i} className="bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2">
                <p className="text-[9px] uppercase tracking-wide text-zinc-500 font-bold">{r.label}</p>
                <p className="text-sm font-semibold text-zinc-900 mt-0.5 break-words">{r.value}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Extra-curricular */}
      <div className="bg-white border border-zinc-200 rounded-3xl p-6 shadow-xl">
        <div className="flex items-center space-x-3 mb-4">
          <div className="p-2.5 bg-fuchsia-500/10 border border-fuchsia-500/20 rounded-2xl text-fuchsia-600">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-zinc-900 tracking-tight">Extra-Curricular</h3>
            <p className="text-[10px] text-zinc-500">From VTOP — ExtraCurricular</p>
          </div>
        </div>
        {!extraCurricular ? (
          <p className="text-xs text-zinc-500">Not synced yet — re-sync to fetch your activities.</p>
        ) : extraCurricular.rows.length === 0 ? (
          <p className="text-xs text-zinc-500">VTOP returned no extra-curricular activities for your account.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {extraCurricular.rows.map((r, i) => (
              <div key={i} className="bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2">
                <p className="text-[9px] uppercase tracking-wide text-zinc-500 font-bold">{r.label}</p>
                <p className="text-sm font-semibold text-zinc-900 mt-0.5 break-words">{r.value}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bank info */}
      <div className="bg-white border border-zinc-200 rounded-3xl p-6 shadow-xl">
        <div className="flex items-center space-x-3 mb-4">
          <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-emerald-600">
            <Landmark className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-zinc-900 tracking-tight">Bank Information</h3>
            <p className="text-[10px] text-zinc-500">From VTOP — BankInfoStudent</p>
          </div>
        </div>
        {!bankInfo ? (
          <p className="text-xs text-zinc-500">Not synced yet — re-sync to fetch your bank details from VTOP.</p>
        ) : bankInfo.rows.length === 0 ? (
          <p className="text-xs text-zinc-500">{bankInfo.message || 'VTOP returned no bank information for your account.'}</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {bankInfo.rows.map((r, i) => (
              <div key={i} className="bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2">
                <p className="text-[9px] uppercase tracking-wide text-zinc-500 font-bold">{r.label}</p>
                <p className="text-sm font-semibold text-zinc-900 mt-0.5 break-words">{r.value}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Biometric */}
      <div className="bg-white border border-zinc-200 rounded-3xl p-6 shadow-xl">
        <div className="flex items-center space-x-3 mb-4">
          <div className="p-2.5 bg-sky-500/10 border border-sky-500/20 rounded-2xl text-sky-600">
            <Fingerprint className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-zinc-900 tracking-tight">Biometric Info</h3>
            <p className="text-[10px] text-zinc-500">From VTOP — BiometricInfo</p>
          </div>
        </div>
        {!biometric ? (
          <p className="text-xs text-zinc-500">Not synced yet — re-sync to fetch your biometric details.</p>
        ) : biometric.rows.length === 0 ? (
          <p className="text-xs text-zinc-500">{biometric.message || 'VTOP returned no biometric information for your account.'}</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {biometric.rows.map((r, i) => (
              <div key={i} className="bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2">
                <p className="text-[9px] uppercase tracking-wide text-zinc-500 font-bold">{r.label}</p>
                <p className="text-sm font-semibold text-zinc-900 mt-0.5 break-words">{r.value}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Proctor messages */}
      <div className="bg-white border border-zinc-200 rounded-3xl p-6 shadow-xl">
        <div className="flex items-center space-x-3 mb-4">
          <div className="p-2.5 bg-violet-500/10 border border-violet-500/20 rounded-2xl text-violet-600">
            <MessagesSquare className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-zinc-900 tracking-tight">Messages from Proctor</h3>
            <p className="text-[10px] text-zinc-500">From VTOP — viewMessagesSendByProctor</p>
          </div>
        </div>
        {!proctorMessages || proctorMessages.length === 0 ? (
          <p className="text-xs text-zinc-500">No proctor messages synced — re-sync to fetch them from VTOP.</p>
        ) : (
          <div className="space-y-3">
            {proctorMessages.map((m, i) => (
              <div key={i} className="bg-zinc-50 border border-zinc-200 rounded-2xl p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-bold text-zinc-900">{m.subject || 'Message'}</p>
                  <span className="text-[10px] font-mono text-zinc-500 shrink-0">{m.date}</span>
                </div>
                {m.from && <p className="text-[10px] text-zinc-500 mt-0.5">From: {m.from}</p>}
                {m.body && <p className="text-xs text-zinc-900 mt-2 leading-relaxed">{m.body}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Login history */}
      <div className="bg-white border border-zinc-200 rounded-3xl p-6 shadow-xl">
        <div className="flex items-center space-x-3 mb-4">
          <div className="p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-2xl text-amber-600">
            <CalendarClock className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-zinc-900 tracking-tight">Login History</h3>
            <p className="text-[10px] text-zinc-500">From VTOP — recent login sessions</p>
          </div>
        </div>
        {!loginHistory || loginHistory.length === 0 ? (
          <p className="text-xs text-zinc-500">No login history synced.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-widest text-zinc-500">
                  <th scope="col" className="py-1.5 pr-3 font-extrabold">Date</th>
                  <th scope="col" className="py-1.5 pr-3 font-extrabold">Time</th>
                  <th scope="col" className="py-1.5 pr-3 font-extrabold">IP</th>
                  <th scope="col" className="py-1.5 font-extrabold">Status</th>
                </tr>
              </thead>
              <tbody>
                {loginHistory.slice(0, 20).map((r, i) => (
                  <tr key={i} className="border-t border-zinc-200">
                    <td className="py-1.5 pr-3 font-mono text-zinc-500">{r.date}</td>
                    <td className="py-1.5 pr-3 font-mono text-zinc-500">{r.time}</td>
                    <td className="py-1.5 pr-3 font-mono text-zinc-900">{r.ip}</td>
                    <td className="py-1.5">
                      <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold ${/success|logged in|passed/i.test(r.status) ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-600 border border-amber-500/20'}`}>
                        {r.status || '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="p-10 bg-white border border-zinc-200 rounded-3xl text-center">
      <UserRound className="h-8 w-8 text-zinc-600 mx-auto mb-2" />
      <p className="text-sm font-bold text-zinc-900">Nothing here yet</p>
      <p className="text-[11px] text-zinc-500 mt-1 max-w-xs mx-auto">{text}</p>
    </div>
  );
}

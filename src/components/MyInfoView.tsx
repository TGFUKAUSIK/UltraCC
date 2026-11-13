import React, { useState } from 'react';
import { UserRound, CreditCard, KeyRound, Mail, Phone, GraduationCap, ShieldCheck, Eye, EyeOff, ExternalLink, BadgeCheck, Landmark, Fingerprint, MessagesSquare, History, CalendarClock, Megaphone, Users, Wallet, Award, Download } from 'lucide-react';
import { PaymentsInfo, CredentialsInfo, CredentialRow, PaymentReceiptsInfo, SapInfo, BankInfo, BiometricInfo, ProctorMessage, LoginHistoryRow, ClassMessage, HodDeanInfo, WalletInfo, ExtraCurricularInfo } from '../lib/vtop/types';
import { StudentProfile } from '../types';
import { useCgpaPrivacy } from '../lib/cgpaPrivacy';
import { publishedGpaLabel } from '../utils/gradeModel';
import { isReal } from '../utils/placeholders';
import { receiptHtml } from '../utils/receiptHtml';
import { schoolLabel } from '../utils/vitSchools';
import { ProfilePhoto } from './ProfilePhoto';

/** A VTOP field as text, or '' when VTOP only left a stub ("-", "R -", "None"). */
const shown = (value: unknown) => (isReal(value) ? String(value).trim() : '');

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
    <div className="my-info-view uc-index pb-12">
      <section className="uc-plate uc-dir-mast">
        <div className="uc-dir-head">
          <div className="uc-dir-id">
            <span className="uc-cap">Student record · VIT Chennai</span>
            <h2 className="uc-dir-name">My Info</h2>
            <p className="uc-note">Your profile, fee payments and the accounts VTOP manages — synced from VTOP.</p>
          </div>
        </div>
      </section>

      {/* Section tabs */}
      <div className="uc-tabs" role="tablist" aria-label="My Info sections">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = section === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSection(t.id)}
              className={active ? 'is-on' : undefined}
            >
              <Icon aria-hidden="true" />
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
  const schoolName = schoolLabel(student.school);
  const rows: { label: string; value: string }[] = [
    { label: 'Name', value: shown(student.name) },
    { label: 'Registration No.', value: shown(student.regNo) },
    { label: 'Programme', value: shown(student.program) },
    { label: 'Branch', value: shown(student.branch) },
    { label: 'School', value: shown(schoolName) },
    { label: 'Class XII group', value: shown(student.groupStudied) },
    { label: 'Semester', value: student.semester > 0 ? String(student.semester) : 'Not available from VTOP' },
    { label: 'CGPA', value: cgpaHidden ? '••••' : publishedGpaLabel(student.cgpa, 'Not available from VTOP') },
    { label: 'Credits Earned', value: student.totalCreditsCompleted !== null ? String(student.totalCreditsCompleted) : 'Not available from VTOP' },
    { label: 'Credits Registered', value: student.totalCreditsRequired !== null ? String(student.totalCreditsRequired) : 'Not available from VTOP' },
  ];
  return (
    <section className="uc-plate">
      <div className="uc-plate-head">
        <span className="uc-cap"><GraduationCap className="uc-dir-inline" aria-hidden="true" />Student profile</span>
        <span className="uc-dir-count">From your VTOP profile</span>
      </div>

      <div className="profile-mobile-identity">
        <ProfilePhoto name={student.name} src={student.profilePhotoUrl} size="md" className="profile-mobile-avatar" />
        <div>
          <strong>{student.name}</strong>
          <span>{student.regNo}{(shown(student.branch) || schoolName) ? ` · ${shown(student.branch) || schoolName}` : ''}</span>
          <small>VIT Chennai</small>
        </div>
      </div>

      <dl className="uc-facts uc-info-facts">
        {rows.map((r) => (
          <div key={r.label}>
            <dt>{r.label}</dt>
            <dd>{r.value || '—'}</dd>
          </div>
        ))}
        {sapInfo && sapInfo.rows.length > 0 && (
          <div>
            <dt>SAP ID</dt>
            <dd>{shown(sapInfo.rows.find((r) => /sap/i.test(r.label))?.value) || sapInfo.rows.map((r) => r.value).filter(isReal).join(' · ') || '—'}</dd>
          </div>
        )}
        {(isReal(student.hostelBlock) || isReal(student.roomNo)) && (
          <div>
            <dt>Hostel</dt>
            <dd>{[student.hostelBlock, student.roomNo].filter(isReal).join(' · ')}</dd>
          </div>
        )}
      </dl>

      <div className="uc-info-block">
        <div className="uc-info-head">
          <BadgeCheck aria-hidden="true" />
          <div>
            <b>{student.proctorAvailable && isReal(student.proctorName) ? shown(student.proctorName) : 'Proctor not provided by VTOP'}</b>
            <small>Academic proctor</small>
            {isReal(student.proctorContact) && (
              <small className="uc-info-contact">
                {student.proctorContact.includes('@') ? <Mail aria-hidden="true" /> : <Phone aria-hidden="true" />}
                {student.proctorContact}
              </small>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function PaymentsSection({ payments, paymentReceipts }: { payments?: PaymentsInfo | null; paymentReceipts?: PaymentReceiptsInfo | null }) {
  if (!payments) {
    return <EmptyState text="Payments not synced yet — log in and sync to see your fee dues." />;
  }
  return (
    <section className="uc-plate">
      <div className="uc-plate-head">
        <span className="uc-cap"><CreditCard className="uc-dir-inline" aria-hidden="true" />{payments.title || 'Fee payments'}</span>
        <span className="uc-dir-count">From VTOP p2p/Payments</span>
      </div>

      {payments.message && (
        <div className="uc-info-msg is-good">
          <ShieldCheck aria-hidden="true" />
          <div><p className="uc-info-prose">{payments.message}</p></div>
        </div>
      )}

      {payments.rows.length === 0 && !payments.message && (
        <p className="uc-info-blank uc-info-pad">No payment or dues information returned by VTOP for your account.</p>
      )}

      {payments.rows.length > 0 && (
        <dl className="uc-facts uc-info-facts">
          {payments.rows.map((r, i) => (
            <div key={i}>
              <dt>{r.label}</dt>
              <dd>{shown(r.value) || '—'}</dd>
            </div>
          ))}
        </dl>
      )}

      <p className="uc-info-note">
        Amounts shown are exactly what VTOP reports. Payment itself happens on VTOP's payment portal.
      </p>

      {/* Payment receipts */}
      <div className="uc-info-block">
        <p className="uc-dir-subhead">Payment receipts</p>
        {!paymentReceipts ? (
          <p className="uc-info-blank">Not synced yet — re-sync to fetch your fee receipts.</p>
        ) : paymentReceipts.receipts.length === 0 ? (
          <p className="uc-info-blank">No receipts returned by VTOP for your account.</p>
        ) : (
          <div className="uc-info-tbl">
            <table className="uc-tbl">
              <thead>
                <tr>
                  <th scope="col">Receipt No.</th>
                  <th scope="col">Date</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Campus</th>
                  <th scope="col"><span className="sr-only">Receipt</span></th>
                </tr>
              </thead>
              <tbody>
                {paymentReceipts.receipts.map((r, i) => (
                  <tr key={`${r.receiptNumber}-${i}`}>
                    <td className="uc-num">{shown(r.receiptNumber) || '—'}</td>
                    <td className="uc-num">{shown(r.date) || '—'}</td>
                    <td className="uc-num is-good">{shown(r.amount) || '—'}</td>
                    <td>{shown(r.campusCode) || '—'}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => {
                          // Generate a printable receipt
                          const win = window.open('', '_blank');
                          if (win) {
                            win.document.write(receiptHtml(r));
                            win.document.close();
                            win.print();
                          }
                        }}
                        className="uc-dir-ico"
                        title="Download receipt"
                        aria-label={`Download receipt ${r.receiptNumber}`}
                      >
                        <Download aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
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
    <section className="uc-plate">
      <div className="uc-plate-head">
        <span className="uc-cap"><KeyRound className="uc-dir-inline" aria-hidden="true" />{credentials.title || 'My accounts'}</span>
        <span className="uc-dir-count">Usernames &amp; login URLs</span>
      </div>

      <div className="uc-dir-cards uc-info-cards">
        {credentials.credentials.map((c: CredentialRow, i: number) => (
          <div key={`${c.account}-${i}`} className="uc-dir-card">
            <p className="uc-dir-title">{c.account}</p>
            <div className="uc-info-row">
              {isReal(c.username) && (
                <p className="uc-info-line">
                  <span>Username</span>
                  <span className="uc-num">{c.username}</span>
                </p>
              )}
              {isReal(c.defaultCredentials) && (
                <p className="uc-info-line">
                  <span>Default password</span>
                  <span className="uc-num">
                    {revealed[i] ? c.defaultCredentials : '••••••••'}
                    <button
                      type="button"
                      onClick={() => setRevealed((s) => ({ ...s, [i]: !s[i] }))}
                      aria-label={revealed[i] ? `Hide password for ${c.account}` : `Show password for ${c.account}`}
                      aria-pressed={Boolean(revealed[i])}
                      className="uc-info-eye"
                      title={revealed[i] ? 'Hide' : 'Show'}
                    >
                      {revealed[i] ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                    </button>
                  </span>
                </p>
              )}
              {c.url && (
                <a
                  href={c.url.startsWith('http') ? c.url : `https://${c.url}`}
                  target="_blank"
                  rel="noreferrer"
                  className="uc-info-link"
                >
                  <ExternalLink aria-hidden="true" /> Open portal
                </a>
              )}
              {isReal(c.venueDate) && <p className="uc-info-blank">{c.venueDate}</p>}
            </div>
          </div>
        ))}
      </div>

      <p className="uc-info-note">
        Passwords are shown only on this device and are never stored or sent anywhere else.
      </p>
    </section>
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
    <div className="uc-index">
      {/* Class messages */}
      <section className="uc-plate">
        <div className="uc-plate-head">
          <span className="uc-cap"><Megaphone className="uc-dir-inline" aria-hidden="true" />Class messages</span>
          <span className="uc-dir-count">From VTOP</span>
        </div>
        {!classMessages || classMessages.length === 0 ? (
          <p className="uc-info-blank uc-info-pad">No class messages synced — re-sync to fetch announcements from VTOP.</p>
        ) : (
          <div className="uc-info-list">
            {classMessages.slice(0, 10).map((m, i) => (
              <article key={i} className="uc-info-msg">
                <div>
                  <div className="uc-info-msg-top">
                    <b>{isReal(m.subject) ? m.subject : 'Message'}</b>
                    <time className="uc-num">{m.date}</time>
                  </div>
                  {isReal(m.from) && <p className="uc-info-from">From: {m.from}</p>}
                  {m.body && <p className="uc-info-prose">{m.body}</p>}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* HOD / Dean */}
      <section className="uc-plate">
        <div className="uc-plate-head">
          <span className="uc-cap"><Users className="uc-dir-inline" aria-hidden="true" />HOD / Dean</span>
          <span className="uc-dir-count">From VTOP</span>
        </div>
        {!hodDean ? (
          <p className="uc-info-blank uc-info-pad">Not synced yet — re-sync to fetch HOD / Dean details.</p>
        ) : hodDean.rows.length === 0 ? (
          <p className="uc-info-blank uc-info-pad">VTOP returned no HOD / Dean details for your account.</p>
        ) : (
          <dl className="uc-facts uc-info-facts">
            {hodDean.rows.map((r, i) => (<div key={i}><dt>{r.label}</dt><dd>{shown(r.value) || '—'}</dd></div>))}
          </dl>
        )}
      </section>

      {/* Wallet */}
      <section className="uc-plate">
        <div className="uc-plate-head">
          <span className="uc-cap"><Wallet className="uc-dir-inline" aria-hidden="true" />Student wallet</span>
          <span className="uc-dir-count">From VTOP</span>
        </div>
        {!wallet ? (
          <p className="uc-info-blank uc-info-pad">Not synced yet — re-sync to fetch your wallet balance.</p>
        ) : wallet.rows.length === 0 ? (
          <p className="uc-info-blank uc-info-pad">{wallet.message || 'VTOP returned no wallet information for your account.'}</p>
        ) : (
          <dl className="uc-facts uc-info-facts">
            {wallet.rows.map((r, i) => (<div key={i}><dt>{r.label}</dt><dd>{shown(r.value) || '—'}</dd></div>))}
          </dl>
        )}
      </section>

      {/* Extra-curricular */}
      <section className="uc-plate">
        <div className="uc-plate-head">
          <span className="uc-cap"><Award className="uc-dir-inline" aria-hidden="true" />Extra-curricular</span>
          <span className="uc-dir-count">From VTOP</span>
        </div>
        {!extraCurricular ? (
          <p className="uc-info-blank uc-info-pad">Not synced yet — re-sync to fetch your activities.</p>
        ) : extraCurricular.rows.length === 0 ? (
          <p className="uc-info-blank uc-info-pad">VTOP returned no extra-curricular activities for your account.</p>
        ) : (
          <dl className="uc-facts uc-info-facts">
            {extraCurricular.rows.map((r, i) => (<div key={i}><dt>{r.label}</dt><dd>{shown(r.value) || '—'}</dd></div>))}
          </dl>
        )}
      </section>

      {/* Bank info */}
      <section className="uc-plate">
        <div className="uc-plate-head">
          <span className="uc-cap"><Landmark className="uc-dir-inline" aria-hidden="true" />Bank information</span>
          <span className="uc-dir-count">From VTOP</span>
        </div>
        {!bankInfo ? (
          <p className="uc-info-blank uc-info-pad">Not synced yet — re-sync to fetch your bank details from VTOP.</p>
        ) : bankInfo.rows.length === 0 ? (
          <p className="uc-info-blank uc-info-pad">{bankInfo.message || 'VTOP returned no bank information for your account.'}</p>
        ) : (
          <dl className="uc-facts uc-info-facts">
            {bankInfo.rows.map((r, i) => (<div key={i}><dt>{r.label}</dt><dd>{shown(r.value) || '—'}</dd></div>))}
          </dl>
        )}
      </section>

      {/* Biometric */}
      <section className="uc-plate">
        <div className="uc-plate-head">
          <span className="uc-cap"><Fingerprint className="uc-dir-inline" aria-hidden="true" />Biometric info</span>
          <span className="uc-dir-count">From VTOP</span>
        </div>
        {!biometric ? (
          <p className="uc-info-blank uc-info-pad">Not synced yet — re-sync to fetch your biometric details.</p>
        ) : biometric.rows.length === 0 ? (
          <p className="uc-info-blank uc-info-pad">{biometric.message || 'VTOP returned no biometric information for your account.'}</p>
        ) : (
          <dl className="uc-facts uc-info-facts">
            {biometric.rows.map((r, i) => (<div key={i}><dt>{r.label}</dt><dd>{shown(r.value) || '—'}</dd></div>))}
          </dl>
        )}
      </section>

      {/* Proctor messages */}
      <section className="uc-plate">
        <div className="uc-plate-head">
          <span className="uc-cap"><MessagesSquare className="uc-dir-inline" aria-hidden="true" />Messages from proctor</span>
          <span className="uc-dir-count">From VTOP</span>
        </div>
        {!proctorMessages || proctorMessages.length === 0 ? (
          <p className="uc-info-blank uc-info-pad">No proctor messages synced — re-sync to fetch them from VTOP.</p>
        ) : (
          <div className="uc-info-list">
            {proctorMessages.map((m, i) => (
              <article key={i} className="uc-info-msg">
                <div>
                  <div className="uc-info-msg-top">
                    <b>{isReal(m.subject) ? m.subject : 'Message'}</b>
                    <time className="uc-num">{m.date}</time>
                  </div>
                  {isReal(m.from) && <p className="uc-info-from">From: {m.from}</p>}
                  {m.body && <p className="uc-info-prose">{m.body}</p>}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Login history */}
      <section className="uc-plate">
        <div className="uc-plate-head">
          <span className="uc-cap"><CalendarClock className="uc-dir-inline" aria-hidden="true" />Login history</span>
          <span className="uc-dir-count">Recent VTOP sessions</span>
        </div>
        {!loginHistory || loginHistory.length === 0 ? (
          <p className="uc-info-blank uc-info-pad">No login history synced.</p>
        ) : (
          <div className="uc-info-tbl">
            <table className="uc-tbl">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Time</th>
                  <th scope="col">IP</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {loginHistory.slice(0, 20).map((r, i) => (
                  <tr key={i}>
                    <td className="uc-num">{shown(r.date) || '—'}</td>
                    <td className="uc-num">{shown(r.time) || '—'}</td>
                    <td className="uc-num">{shown(r.ip) || '—'}</td>
                    <td>
                      <span className={`uc-dir-tag${/success|logged in|passed/i.test(r.status) ? ' is-good' : ' is-warn'}`}>
                        {isReal(r.status) ? r.status : '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="uc-plate uc-plate--quiet uc-info-empty">
      <UserRound aria-hidden="true" />
      <b>Nothing here yet</b>
      <p>{text}</p>
    </div>
  );
}

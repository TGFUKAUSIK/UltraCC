import React, { useMemo, useState } from 'react';
import { Send, Bot, User, Loader2, KeyRound, Database, Info } from 'lucide-react';
import { StudentProfile, AttendanceRecord, ExamSchedule, TimetableSlot, CourseMarks } from '../types';
import { GradeSummary, GradeHistory, SemesterGrades, OdSummary } from '../lib/vtop/types';
import { getGeminiApiKey } from '../lib/settings';
import { useCgpaPrivacy } from '../lib/cgpaPrivacy';
import { attendanceComponent, componentLabel } from '../utils/attendanceComponents';
import { isEvaluatedAssessment } from '../utils/assessmentStatus';
import { VTOP_ATTENDANCE_FLOOR } from '../utils/attendanceBands';
import { VIT_BANDS, VIT_FAT_MINIMUM_RATIO, gpaLabel, publishedGpaLabel } from '../utils/gradeModel';
import { humanErrorCopy } from '../lib/errorCopy';

interface AiAdvisorViewProps {
  student: StudentProfile;
  attendance: AttendanceRecord[];
  timetable: TimetableSlot[];
  marks: CourseMarks[];
  exams: ExamSchedule[];
  grades: GradeSummary | null;
  gradeHistory?: GradeHistory | null;
  semesterGrades?: SemesterGrades | null;
  od: OdSummary | null;
  semesterLabel: string;
}

interface ChatMessage {
  sender: 'user' | 'ai';
  text: string;
  time: string;
}

// gemini-2.5-flash now returns 404 for new API users; use the current
// generateContent model exposed by Google's Gemini API.
const GEMINI_MODEL = 'gemini-3.6-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

/**
 * The grading rules the advisor is allowed to quote, written from the same
 * tables every other screen reads.
 *
 * This prompt used to hardcode "CAT1 (50 marks scaled to 15), … FAT scaled to 40
 * or 50" — the regulation default, not VTOP's published weightage. A student
 * whose course carries a 60-weight FAT or a PAT row instead of a quiz got advice
 * built on a scheme their course does not use, and the numbers in the chat did
 * not match the card they had just opened. The bands, the FAT floor and the
 * attendance bar below are generated, so they cannot drift from the model.
 */
const GRADE_RULES_TEXT = [
  `Grade bands (VIT's absolute scale, with the C-points each is worth): ${VIT_BANDS.map((b) => `${b.grade}≥${b.min} (${b.points} pts)`).join(', ')}.`,
  `A student must also score at least ${Math.round(VIT_FAT_MINIMUM_RATIO * 100)}% of the FAT paper to pass a course, and VTOP withholds attendance credit below ${VTOP_ATTENDANCE_FLOOR}% attendance.`,
  'For a course’s actual components and weightage, use only the assessment rows in the Student Context — VTOP publishes them per course, and theory, lab and project courses differ. Never assume a fixed CAT/DA/Quiz/FAT split, and never read an assessment VTOP has not graded as a zero.',
].join(' ');

const SYSTEM_INSTRUCTION = `You are UltraCC's Intelligent Academic Strategist for VIT Chennai students.
You understand the FFCS credit system and the A1+TA1/B1+TB1 slot structure. ${GRADE_RULES_TEXT}
Always give direct, actionable, student-first advice. Keep responses structured with concise bullet points, bold emphasis, and empathetic practical guidance. Never encourage reckless attendance loss, but calculate precise safe bunks.`;

/** Call the Gemini REST API directly from the browser with the saved key. */
async function askGemini(apiKey: string, userText: string, context: unknown): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  // AI Studio "AQ."-prefixed keys authenticate via the x-goog-api-key header.
  headers['x-goog-api-key'] = apiKey;

  const body = {
    contents: [{ role: 'user', parts: [{ text: context ? `Student Context:\n${JSON.stringify(context, null, 2)}\n\nUser Question/Request:\n${userText}` : userText }] }],
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    generationConfig: { temperature: 0.7 },
  };

  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let detail = '';
    try {
      const err = await res.json();
      detail = err?.error?.message || '';
    } catch { /* ignore */ }
    throw new Error(detail || `Gemini API error (HTTP ${res.status})`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').filter(Boolean).join('') || '';
  if (!text) throw new Error('Gemini returned an empty response.');
  return text;
}

/**
 * A reply, typeset.
 *
 * The system instruction asks for "concise bullet points, bold emphasis" and
 * Gemini answers in light markdown. The bubble printed that source verbatim, so
 * a student read "**Grade bands (VIT's absolute scale…)**" with the asterisks
 * still on it and got a list as one run-on line of dashes. Only the markers the
 * instruction actually calls for are turned back into type — bold runs, bullet
 * and numbered items, inline code, a stray heading's hashes removed — and every
 * character stays a text node React escapes, never injected HTML.
 */
const INLINE_MARK = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/g;
const BULLET_LINE = /^\s*[-*•]\s+/;
const NUMBERED_LINE = /^\s*\d+[.)]\s+/;
const HEADING_LINE = /^#{1,6}\s+/;

function inlineRuns(text: string, key: string): React.ReactNode[] {
  return text
    .split(INLINE_MARK)
    .filter((part) => part !== '')
    .map((part, i) => {
      const id = `${key}-${i}`;
      if (/^\*\*[^*\n]+\*\*$/.test(part)) return <strong key={id}>{part.slice(2, -2)}</strong>;
      if (/^`[^`\n]+`$/.test(part)) return <code key={id} className="uc-msg-code">{part.slice(1, -1)}</code>;
      return <React.Fragment key={id}>{part}</React.Fragment>;
    });
}

/** Exported so the typesetting can be checked without a network call. */
export const RichReply: React.FC<{ text: string }> = ({ text }) => {
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; text: string }[] = [];

  const closeList = () => {
    if (!list.length) return;
    const ordered = list[0].ordered;
    blocks.push(
      ordered
        ? <ol key={`list-${blocks.length}`} className="uc-msg-list">{list.map((item, i) => <li key={i}>{inlineRuns(item.text, `li-${blocks.length}-${i}`)}</li>)}</ol>
        : <ul key={`list-${blocks.length}`} className="uc-msg-list">{list.map((item, i) => <li key={i}>{inlineRuns(item.text, `li-${blocks.length}-${i}`)}</li>)}</ul>,
    );
    list = [];
  };

  text.split('\n').forEach((raw) => {
    const line = raw.trim();
    const bullet = BULLET_LINE.test(line);
    const numbered = NUMBERED_LINE.test(line);
    if (bullet || numbered) {
      list.push({ ordered: numbered, text: line.replace(BULLET_LINE, '').replace(NUMBERED_LINE, '').trim() });
      return;
    }
    closeList();
    if (!line) return;
    blocks.push(<p key={`p-${blocks.length}`}>{inlineRuns(line.replace(HEADING_LINE, ''), `p-${blocks.length}`)}</p>);
  });
  closeList();

  return <>{blocks}</>;
};

export const AiAdvisorView: React.FC<AiAdvisorViewProps> = ({ student, attendance, timetable, marks, exams, grades, gradeHistory, semesterGrades, od, semesterLabel }) => {
  const [cgpaHidden] = useCgpaPrivacy();
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const apiKey = getGeminiApiKey();
  const hasKey = !!apiKey;
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      sender: 'ai',
      text: hasKey
        ? `Hello ${student.name}! I am your AI Academic Strategist for VIT Chennai${semesterLabel ? ` (${semesterLabel})` : ''}. I can see your synced academic records — attendance, timetable, marks, exams, CGPA and OD hours.\n\nAsk me about bunk planning, exam strategy, FAT targets or study schedules.`
        : `Hello ${student.name}! I'm your AI Academic Strategist, but I need a Gemini API key to work.\n\nOpen Settings → Gemini API Key and paste your key, then I can help with attendance planning, exam prep and academic strategy.`,
      time: 'Just now',
    },
  ]);

  // Every chip below stands on a record that exists. A course count of zero is
  // not information, and "CGPA: —" is a placeholder wearing a label: the same
  // rule the Grades and My Info screens follow, where an unpublished figure is
  // absent rather than rendered as a stub.
  const recordCount = attendance.length + timetable.length + marks.length + exams.length;
  const cgpaFigure = cgpaHidden ? '••••' : publishedGpaLabel(student.cgpa, '');

  /**
   * Starter questions written from the records in front of the student.
   *
   * These four used to be fixed strings — "Can I safely bunk Discrete Math C1
   * slot today?", "…CAT 2 Data Structures", "…DBMS FAT…" — courses most students
   * are not registered for. Tapping one handed the model a question about a
   * course that was not in the context it had just been given, and the answer
   * came back confident about a subject the student never took. Each line below
   * is derived from the synced rows and is simply absent when no row can carry it.
   */
  const samplePrompts = useMemo(() => {
    const prompts: string[] = [];

    // The theory course with the least headroom — the one a bunk question is
    // actually about. VTOP tracks theory and lab separately, so the lab half of
    // a course is not what a "C1 slot" question means.
    const tightest = attendance
      .filter((a) => attendanceComponent(a) === 'Theory' && a.totalHeld > 0)
      .sort((a, b) => a.percentage - b.percentage)[0];
    if (tightest) {
      const name = tightest.courseTitle || tightest.courseCode;
      prompts.push(`Can I safely bunk ${name}${tightest.slot ? ` (${tightest.slot})` : ''} this week?`);
    }

    // The nearest exam VTOP has actually dated.
    const nextExam = exams.filter((e) => e.date).sort((a, b) => a.date.localeCompare(b.date))[0];
    if (nextExam) {
      prompts.push(`Build me a study plan for ${nextExam.courseTitle || nextExam.courseCode} ${nextExam.examType}.`);
    }

    // A course VTOP has graded something in, so a FAT target is a real question.
    const graded = marks.find((m) => [m.cat1, m.cat2, m.da1, m.da2, m.da3, m.quiz].some(isEvaluatedAssessment));
    if (graded) prompts.push(`What FAT score do I need in ${graded.courseCode} to hold my grade?`);

    prompts.push('Summarize my highest academic risks this week.');
    return prompts;
  }, [attendance, exams, marks]);

  const handleSendMessage = async (customPrompt?: string) => {
    const textToSend = customPrompt || prompt;
    if (!textToSend.trim() || loading) return;
    const key = getGeminiApiKey();
    if (!key) {
      setMessages((prev) => [
        ...prev,
        {
          sender: 'ai',
          text: 'Please add your Gemini API key in Settings first (Settings → Gemini API Key).',
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
      return;
    }

    const userMsg: ChatMessage = {
      sender: 'user',
      text: textToSend,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!customPrompt) setPrompt('');
    setLoading(true);

    try {
      // Only sanitized, minimum-necessary academic context — never credentials,
      // cookies, CAPTCHA or raw VTOP data.
      const context = {
        student: {
          name: student.name,
          regNo: student.regNo,
          // null rather than VTOP's Class-XII group: the advisor used to be
          // told the student's "branch" was "PCM", which it then repeated back
          // as if it were their course of study.
          branch: student.branch || null,
          school: student.school || null,
          semester: student.semester,
          activeSemester: semesterLabel || 'unknown',
          cgpa: student.cgpa !== null && student.cgpa !== undefined ? student.cgpa : null,
          creditsEarned: student.totalCreditsCompleted ?? null,
          creditsRegistered: student.totalCreditsRequired ?? null,
          proctor: student.proctorAvailable ? student.proctorName : null,
        },
        attendance: attendance.map((a) => ({
          code: a.courseCode,
          title: a.courseTitle,
          // VTOP tracks theory and lab separately — the advisor must not blend
          // them or attribute a lab shortfall to the theory half.
          component: componentLabel(attendanceComponent(a)),
          slot: a.slot || null,
          percentage: a.totalHeld > 0 ? a.percentage : null,
          attended: a.attended,
          totalHeld: a.totalHeld,
          faculty: a.facultyName || null,
        })),
        timetable: timetable.map((t) => ({
          day: t.day,
          slot: t.slot,
          time: `${t.startTime}-${t.endTime}`,
          code: t.courseCode,
          title: t.courseTitle,
          venue: t.venue || null,
          faculty: t.facultyName || null,
          credits: typeof t.credits === 'number' ? t.credits : null,
        })),
        marks: marks.map((m) => ({
          code: m.courseCode,
          title: m.courseTitle,
          // An assessment VTOP has not graded is sent as null, never "0/50" —
          // otherwise the advisor reasons about marks the student does not have.
          cat1: isEvaluatedAssessment(m.cat1) ? `${m.cat1.scored}/${m.cat1.max}` : null,
          cat2: isEvaluatedAssessment(m.cat2) ? `${m.cat2.scored}/${m.cat2.max}` : null,
          da1: isEvaluatedAssessment(m.da1) ? `${m.da1.scored}/${m.da1.max}` : null,
          da2: isEvaluatedAssessment(m.da2) ? `${m.da2.scored}/${m.da2.max}` : null,
          da3: isEvaluatedAssessment(m.da3) ? `${m.da3.scored}/${m.da3.max}` : null,
          quiz: isEvaluatedAssessment(m.quiz) ? `${m.quiz.scored}/${m.quiz.max}` : null,
          // Partial internals are not a reliable final-grade signal. Keep
          // the advisor from turning the legacy estimate into an assertion.
          estimatedGrade: null,
        })),
        exams: exams.map((e) => ({
          code: e.courseCode,
          examType: e.examType,
          date: e.date,
          time: e.time || null,
          venue: e.venue || null,
          seatNo: e.seatNo || null,
        })),
        gradeSummary: grades?.available
          ? { cgpa: grades.cgpa, creditsEarned: grades.creditsEarned, creditsRegistered: grades.creditsRegistered }
          : null,
        gradeHistory: gradeHistory?.available
          ? {
              cgpa: gradeHistory.cgpa,
              gradeCounts: gradeHistory.gradeCounts,
              effectiveGrades: gradeHistory.effectiveGrades.map((g) => ({
                course: g.basketTitle,
                type: g.courseType,
                credits: g.creditsEarned,
                grade: g.grade,
              })),
            }
          : null,
        semesterGrades: semesterGrades?.available
          ? {
              gpa: semesterGrades.gpa,
              grades: semesterGrades.grades.map((g) => ({
                code: g.courseCode,
                title: g.courseTitle,
                type: g.courseType,
                total: g.grandTotal,
                grade: g.grade,
              })),
            }
          : null,
        // Name the quantity, and state a cap only when one was published: the
        // model used to receive `{ total, limit }` and call the hours *used* a
        // balance, exactly the way the dashboard did.
        odHours: od?.available
          ? { hoursUsed: od.totalOdHours, ...(od.limitHours !== null ? { semesterCapHours: od.limitHours } : {}) }
          : null,
      };
      const advice = await askGemini(key, textToSend, context);
      setMessages((prev) => [
        ...prev,
        {
          sender: 'ai',
          text: advice,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          sender: 'ai',
          // A provider failure can carry an HTTP status, a quota message or a
          // request URL. Only our own curated sentences reach the chat.
          text: humanErrorCopy(
            err?.message,
            'The AI advisor could not answer just now. Check the API key in Settings, then try again.',
          ),
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="uc-index pb-12">
      <section className="uc-plate uc-dir-mast">
        <div className="uc-dir-head">
          <div className="uc-dir-id">
            <span className="uc-cap">Powered by Gemini</span>
            <h2 className="uc-dir-name">AI academic strategist</h2>
            <p className="uc-note">Contextual reasoning for attendance bunk calculation, exam preparation plans, and grade simulations.</p>
          </div>
        </div>
        <div className="uc-dir-detail">
          {!hasKey && (
            <div className="uc-note-row uc-note-row--warn">
              <KeyRound aria-hidden="true" />
              <span>No Gemini API key set. Add yours in <b>Settings → Gemini API key</b> (stored only on this device) to enable the AI advisor.</span>
            </div>
          )}
          <h3 className="uc-dir-subhead"><Database className="uc-dir-inline" />{recordCount > 0 ? `The AI can see your synced data (${semesterLabel || 'active semester'})` : 'The AI can see your profile only'}</h3>
          {recordCount > 0 ? (
            <div className="uc-dir-tags">
              {attendance.length > 0 && (
                <span className="uc-dir-tag">Attendance: <b className="uc-num">{attendance.length}</b> record{attendance.length === 1 ? '' : 's'}</span>
              )}
              {timetable.length > 0 && (
                <span className="uc-dir-tag">Timetable: <b className="uc-num">{timetable.length}</b> slots</span>
              )}
              {marks.length > 0 && (
                <span className="uc-dir-tag">Marks: <b className="uc-num">{marks.length}</b> courses</span>
              )}
              {exams.length > 0 && (
                <span className="uc-dir-tag">Exams: <b className="uc-num">{exams.length}</b></span>
              )}
              {/* A CGPA VTOP has not posted has no chip: "CGPA: —" is a stub, and
                  the privacy toggle's dots are the student's own choice rather
                  than a placeholder. */}
              {cgpaFigure && (
                <span className="uc-dir-tag">CGPA: <b className="uc-num">{cgpaFigure}</b></span>
              )}
              {semesterGrades?.available && semesterGrades.gpa != null && (
                <span className="uc-dir-tag">Semester GPA: <b className="uc-num">{gpaLabel(semesterGrades.gpa)}</b></span>
              )}
              {/* Hours *used*, with the cap only when VTOP published one — the
                  same phrasing the dashboard and the OD tracker carry, so this
                  number cannot read as a balance. */}
              {od?.available && (
                <span className="uc-dir-tag">OD hours used: <b className="uc-num">{od.totalOdHours}h{od.limitHours !== null ? ` of ${od.limitHours}h` : ''}</b></span>
              )}
              {student.proctorAvailable && (
                <span className="uc-dir-tag">Proctor: <b>{student.proctorName}</b></span>
              )}
            </div>
          ) : (
            <div className="uc-note-row">
              <Info aria-hidden="true" />
              <span>No attendance, timetable, marks or exams have synced{semesterLabel ? ` for ${semesterLabel}` : ''} yet. Run a sync from the dashboard and the advisor can reason about them.</span>
            </div>
          )}
          <p className="uc-dir-note uc-dir-sub">Credentials, cookies, CAPTCHA and raw VTOP data are never shared with the AI.</p>
        </div>
      </section>

      <section className="uc-plate">
        <div className="uc-plate-head"><span className="uc-cap">Try asking</span></div>
        <div className="uc-dir-detail">
          <div className="uc-asks">
            {samplePrompts.map((sp, idx) => (
              <button key={idx} onClick={() => handleSendMessage(sp)} className="uc-ask">
                <span>“{sp}”</span>
                {/* The chip's whole job is to send this question, so it carries
                    the same paper plane as the composer instead of a sparkle. */}
                <Send aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="uc-plate uc-chat">
        <div className="uc-plate-head"><span className="uc-cap">Conversation</span><Bot className="h-4 w-4" aria-hidden="true" /></div>
        <div className="uc-chat-log">
          {messages.map((msg, index) => (
            <div key={index} className={`uc-msg${msg.sender === 'user' ? ' is-user' : ''}`}>
              <div className={`uc-msg-ava${msg.sender === 'user' ? ' acc-bg' : ''}`}>
                {msg.sender === 'user' ? <User className="h-4 w-4" aria-hidden="true" /> : <Bot className="h-4 w-4" aria-hidden="true" />}
              </div>
              <div className={`uc-msg-body${msg.sender === 'user' ? ' acc-bg' : ''}`}>
                {msg.sender === 'user' ? <p>{msg.text}</p> : <RichReply text={msg.text} />}
                <span className="uc-msg-time">{msg.time}</span>
              </div>
            </div>
          ))}

          {loading && (
            <div className="uc-msg">
              <div className="uc-msg-ava"><Bot className="h-4 w-4" aria-hidden="true" /></div>
              <div className="uc-chat-await">
                <Loader2 className="h-4 w-4 spin" aria-hidden="true" />
                <span>AI Strategist analyzing your records &amp; generating response…</span>
              </div>
            </div>
          )}
        </div>

        <div className="uc-chat-bar">
          <input
            type="text"
            aria-label="Ask the AI advisor about attendance, bunk limits or exam planning"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
            placeholder="Ask AI Advisor about attendance, bunk limits, or exam planning..."
            className="uc-dir-input"
          />
          <button
            onClick={() => handleSendMessage()}
            disabled={loading || !prompt.trim()}
            aria-label="Send your question"
            className="uc-chat-send acc-bg"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </section>
    </div>
  );
};

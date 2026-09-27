import React, { useState } from 'react';
import { Sparkles, Send, Bot, User, Loader2, KeyRound, Database } from 'lucide-react';
import { StudentProfile, AttendanceRecord, ExamSchedule, TimetableSlot, CourseMarks } from '../types';
import { GradeSummary, GradeHistory, SemesterGrades, OdSummary } from '../lib/vtop/types';
import { getGeminiApiKey } from '../lib/settings';
import { useCgpaPrivacy } from '../lib/cgpaPrivacy';
import { attendanceComponent, componentLabel } from '../utils/attendanceComponents';
import { isEvaluatedAssessment } from '../utils/assessmentStatus';
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

const SYSTEM_INSTRUCTION = `You are UltraCC's Intelligent Academic Strategist for VIT Chennai students.
You understand the FFCS credit system, A1+TA1/B1+TB1 slot structures, CAT1 (50 marks scaled to 15), CAT2 (50 marks scaled to 15), Digital Assignments (10 marks), Quiz/Surprise Test (10 marks), FAT (100 marks scaled to 40 or 50), and the strict 75% attendance rule.
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
        odHours: od?.available ? { total: od.totalOdHours, limit: od.limitHours } : null,
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

  const samplePrompts = [
    'Can I safely bunk Discrete Math C1 slot today?',
    'Create a 5-day study plan for CAT 2 Data Structures.',
    'What target score do I need in DBMS FAT for an S grade?',
    'Summarize my highest academic risks this week.',
  ];

  return (
    <div className="space-y-6 pb-12">
      {/* Header Bento Card */}
      <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 shadow-xl">
        <div className="flex items-center space-x-4">
          <div className="p-3.5 acc-soft border acc-border rounded-2xl acc-text">
            <Sparkles className="h-6 w-6 animate-pulse" />
          </div>
          <div>
            <div className="text-zinc-500 text-xs font-bold uppercase tracking-wider mb-0.5">
              Powered by Gemini
            </div>
            <h2 className="text-2xl font-extrabold text-zinc-900 tracking-tight">AI Academic Strategist</h2>
            <p className="text-xs text-zinc-500 mt-1 font-medium">
              Contextual reasoning for attendance bunk calculation, exam preparation plans, and grade simulations.
            </p>
          </div>
        </div>
      </div>

      {!hasKey && (
        <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-amber-700 text-xs flex items-center gap-2">
          <KeyRound className="h-4 w-4 shrink-0" />
          <span>
            No Gemini API key set. Add yours in <strong>Settings → Gemini API Key</strong> (stored only on this device) to enable the AI Advisor.
          </span>
        </div>
      )}

      {/* Data visibility — what the AI can see (sanitized academic data only) */}
      <div className="bg-white border border-zinc-200 rounded-2xl p-4 shadow-xl">
        <p className="text-[10px] font-extrabold text-zinc-500 uppercase tracking-widest mb-2.5 flex items-center gap-1.5">
          <Database className="h-3 w-3 acc-text" />
          The AI can see your synced data ({semesterLabel || 'active semester'})
        </p>
        <div className="flex flex-wrap gap-2 text-[10px] font-bold">
          <span className="px-2.5 py-1 rounded-full bg-white border border-zinc-200 text-zinc-900">
            Attendance: {attendance.length} record{attendance.length === 1 ? '' : 's'}
          </span>
          <span className="px-2.5 py-1 rounded-full bg-white border border-zinc-200 text-zinc-900">
            Timetable: {timetable.length} slots
          </span>
          <span className="px-2.5 py-1 rounded-full bg-white border border-zinc-200 text-zinc-900">
            Marks: {marks.length} courses
          </span>
          <span className="px-2.5 py-1 rounded-full bg-white border border-zinc-200 text-zinc-900">
            Exams: {exams.length}
          </span>
          <span className="px-2.5 py-1 rounded-full bg-white border border-zinc-200 text-zinc-900">
            CGPA: {cgpaHidden ? '••••' : student.cgpa !== null && student.cgpa !== undefined ? student.cgpa.toFixed(2) : '—'}
          </span>
          {semesterGrades?.available && semesterGrades.gpa != null && (
            <span className="px-2.5 py-1 rounded-full bg-white border border-zinc-200 text-zinc-900">
              Semester GPA: {semesterGrades.gpa.toFixed(2)}
            </span>
          )}
          <span className="px-2.5 py-1 rounded-full bg-white border border-zinc-200 text-zinc-900">
            OD: {od?.available ? `${od.totalOdHours}h` : '—'}
          </span>
          {student.proctorAvailable && (
            <span className="px-2.5 py-1 rounded-full bg-white border border-zinc-200 text-zinc-900">
              Proctor: {student.proctorName}
            </span>
          )}
        </div>
        <p className="text-[10px] text-zinc-600 mt-2.5">
          Credentials, cookies, CAPTCHA and raw VTOP data are never shared with the AI.
        </p>
      </div>

      {/* Suggested Quick Prompts (Bento Cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {samplePrompts.map((sp, idx) => (
          <button
            key={idx}
            onClick={() => handleSendMessage(sp)}
            className="p-4 bg-white hover:bg-white border border-zinc-200 hover:border-zinc-200 rounded-2xl text-xs text-left text-zinc-900 transition cursor-pointer flex items-center justify-between group font-medium shadow-md"
          >
            <span>"{sp}"</span>
            <Sparkles className="h-3.5 w-3.5 acc-text opacity-0 group-hover:opacity-100 transition shrink-0 ml-2" />
          </button>
        ))}
      </div>

      {/* Chat Conversation Box */}
      <div className="bg-white border border-zinc-200 rounded-3xl shadow-xl flex flex-col h-[520px] overflow-hidden">
        {/* Messages list */}
        <div className="flex-1 p-6 overflow-y-auto space-y-4">
          {messages.map((msg, index) => (
            <div
              key={index}
              className={`flex items-start space-x-3 ${msg.sender === 'user' ? 'flex-row-reverse space-x-reverse' : ''}`}
            >
              <div
                className={`p-2.5 rounded-xl text-zinc-900 shrink-0 ${
                  msg.sender === 'user' ? 'acc-bg' : 'bg-white border border-zinc-200'
                }`}
              >
                {msg.sender === 'user' ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4 acc-text" />}
              </div>

              <div
                className={`max-w-[80%] p-4 rounded-2xl text-xs leading-relaxed ${
                  msg.sender === 'user'
                    ? 'acc-bg text-zinc-900 rounded-tr-none font-medium shadow-md'
                    : 'bg-white text-zinc-900 border border-zinc-200 rounded-tl-none whitespace-pre-wrap font-medium'
                }`}
              >
                <p>{msg.text}</p>
                <p
                  className={`text-[10px] mt-2 font-mono ${
                    msg.sender === 'user' ? 'text-blue-700 text-right' : 'text-zinc-500'
                  }`}
                >
                  {msg.time}
                </p>
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex items-center space-x-3">
              <div className="p-2.5 rounded-xl bg-white border border-zinc-200 acc-text">
                <Bot className="h-4 w-4" />
              </div>
              <div className="p-3.5 bg-zinc-50 border border-zinc-200 rounded-2xl rounded-tl-none text-xs text-zinc-500 flex items-center space-x-2 font-medium">
                <Loader2 className="h-4 w-4 animate-spin acc-text" />
                <span>AI Strategist analyzing your records &amp; generating response...</span>
              </div>
            </div>
          )}
        </div>

        {/* Input Bar */}
        <div className="p-4 bg-white border-t border-zinc-200 flex items-center space-x-3">
          <input
            type="text"
            aria-label="Ask the AI advisor about attendance, bunk limits or exam planning"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
            placeholder="Ask AI Advisor about attendance, bunk limits, or exam planning..."
            className="flex-1 bg-white border border-zinc-200 rounded-2xl px-4 py-3 text-xs text-zinc-900 placeholder-zinc-500 focus:outline-none focus:border-blue-500 font-medium"
          />
          <button
            onClick={() => handleSendMessage()}
            disabled={loading || !prompt.trim()}
            className="p-3 acc-bg hover:opacity-90 disabled:bg-white disabled:text-zinc-600 text-zinc-900 rounded-2xl transition cursor-pointer font-bold text-xs flex items-center justify-center shadow-md"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

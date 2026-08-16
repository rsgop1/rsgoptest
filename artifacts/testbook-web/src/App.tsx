import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  getLearnerGetTestSeriesQueryKey,
  getLearnerGetWebSessionQueryKey,
  useLearnerCreateReport,
  useLearnerGetAiInfo,
  useLearnerGetTestSeries,
  useLearnerGetWebSession,
  useLearnerSubmitAttempt,
} from '@workspace/api-client-react';
import type {
  LearnerQuestion,
  LearnerQuestionReview,
  LearnerResult,
  LearnerTest,
  LearnerWebSession,
} from '@workspace/api-client-react';
import {
  ArrowLeft,
  ArrowRight,
  Award,
  BarChart3,
  Bookmark,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Flag,
  Grid2X2,
  Languages,
  Lightbulb,
  LockKeyhole,
  Menu,
  MessageSquareWarning,
  MoreVertical,
  RotateCcw,
  Send,
  ShieldCheck,
  Target,
  UserRound,
  X,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();
const RESULT_KEY = 'testbook:last-result';
const SESSION_KEY = 'testbook:last-session';
const ATTEMPT_KEY = 'testbook:last-attempt-context';

type AnswerMap = Record<string, number>;
type MenuAction = 'focus' | 'report' | 'ai' | 'profile' | null;
type ReviewFilter = 'all' | 'incorrect' | 'skipped' | 'marked';

function formatTime(total: number) {
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function initials(name?: string) {
  return (name || 'Aspirant')
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function prettyDuration(seconds: number) {
  const mins = Math.floor(seconds / 60);
  return mins > 0 ? `${mins} min${mins === 1 ? '' : 's'}` : `${seconds} sec`;
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function Header({
  session,
  time,
  onSubmit,
  onMenu,
  isRunner = false,
}: {
  session?: LearnerWebSession | null;
  time?: number;
  onSubmit?: () => void;
  onMenu?: () => void;
  isRunner?: boolean;
}) {
  return (
    <header className={`sticky top-0 z-30 border-b ${isRunner ? 'border-[#2f4552] bg-[#17333d]' : 'border-[#d8d4c9] bg-[#17333d]'} text-[#f4f0e6]`}>
      <div className="mx-auto flex h-[68px] max-w-[1500px] items-center justify-between gap-3 px-4 sm:px-7">
        <Link href="/" data-testid="link-brand" className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-md bg-[#70c3ae] text-[#17333d]"><Target size={18} strokeWidth={2.7} /></span>
          <span className="hidden sm:block">
            <span className="block font-semibold tracking-tight">testbook<span className="text-[#70c3ae]">+</span></span>
            <span className="block text-[10px] uppercase tracking-[.2em] text-[#afc1c3]">premium exam companion</span>
          </span>
        </Link>
        {isRunner ? (
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <div className="hidden min-w-0 md:block"><p className="truncate text-sm font-semibold">Live mock test</p><p className="text-[11px] text-[#afc1c3]">Telegram-linked session</p></div>
            <div className={`number-font flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-bold ${time !== undefined && time < 300 ? 'border-[#e79b84] text-[#f4b09b]' : 'border-[#3b665f] text-[#70c3ae]'}`} data-testid="text-timer"><Clock3 size={15} />{formatTime(time || 0)}</div>
            <button onClick={onMenu} data-testid="button-runner-menu" aria-label="Open runner menu" className="rounded-md p-2 text-[#b4c6c8] hover:bg-[#244651] hover:text-white"><MoreVertical size={18} /></button>
            <button onClick={onSubmit} data-testid="button-submit-top" className="hidden rounded-md bg-[#d96f61] px-4 py-2 text-xs font-bold uppercase tracking-wide text-white hover:bg-[#c75e53] sm:block">Submit test</button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-[#afc1c3] sm:block">Telegram connected</span>
            <div className="grid h-9 w-9 place-items-center rounded-full bg-[#2a5058] text-xs font-bold text-[#70c3ae]" data-testid="avatar-user">{initials(session?.fullName)}</div>
            <span className="hidden text-sm font-medium sm:block" data-testid="text-username">{session?.fullName || 'Aspirant'}</span>
          </div>
        )}
      </div>
    </header>
  );
}

function LoadingScreen() {
  return <div className="min-h-[100dvh] bg-[#f1eee7]"><div className="mx-auto max-w-[1500px] p-5"><div className="h-16 animate-pulse rounded-lg bg-[#e4e0d5]" /><div className="mt-8 grid gap-5 lg:grid-cols-[1.25fr_.75fr]"><div className="h-80 animate-pulse rounded-xl bg-[#faf9f5]" /><div className="h-80 animate-pulse rounded-xl bg-[#faf9f5]" /></div></div></div>;
}

function StateCard({ kind, title, detail, action }: { kind: 'token' | 'error' | 'premium' | 'empty'; title: string; detail: string; action?: ReactNode }) {
  const Icon = kind === 'premium' ? LockKeyhole : kind === 'error' ? XCircle : kind === 'empty' ? Grid2X2 : ShieldCheck;
  return <div className="exam-grid flex min-h-[100dvh] items-center justify-center bg-[#f1eee7] p-5"><div className="w-full max-w-lg rounded-xl border border-[#d8d4c9] bg-[#faf9f5] p-8 text-center shadow-[0_18px_50px_rgba(23,51,61,.08)] sm:p-12"><div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-xl bg-[#e1f0ea] text-[#287e70]"><Icon size={25} /></div><p className="mb-3 text-xs font-bold uppercase tracking-[.18em] text-[#287e70]">testbook+ / secure access</p><h1 className="text-2xl font-bold tracking-tight text-[#17333d]" data-testid="text-state-title">{title}</h1><p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-[#687579]" data-testid="text-state-detail">{detail}</p>{action}</div></div>;
}

function HomePage() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token') || '';
  const testId = params.get('testId') || params.get('test') || '';
  const sessionQuery = useLearnerGetWebSession({ token }, { query: { enabled: !!token, queryKey: getLearnerGetWebSessionQueryKey({ token }), retry: false } });
  const session = sessionQuery.data;
  const testQuery = useLearnerGetTestSeries({ testId, token }, { query: { enabled: !!token && !!session && !!testId, queryKey: getLearnerGetTestSeriesQueryKey({ testId, token }), retry: false } });
  const [started, setStarted] = useState(false);
  if (!token) return <StateCard kind="token" title="Your secure link is missing" detail="Open this test from the Telegram bot to start a verified attempt." action={<a href="https://t.me" data-testid="link-open-telegram" className="mt-7 inline-flex rounded-md bg-[#17333d] px-5 py-3 text-sm font-bold text-[#f4f0e6]">Open Telegram</a>} />;
  if (!testId) return <StateCard kind="error" title="Test details are missing" detail="Use the complete test link from Telegram. No attempt has been started." />;
  if (sessionQuery.isLoading) return <LoadingScreen />;
  if (sessionQuery.isError || !session) return <StateCard kind="error" title="This link has expired" detail="Request a fresh test link from the Testbook+ Telegram bot. Your attempt has not been started." action={<button onClick={() => sessionQuery.refetch()} data-testid="button-retry-session" className="mt-7 rounded-md bg-[#17333d] px-5 py-3 text-sm font-bold text-[#f4f0e6]">Try again</button>} />;
  if (session.tier.toLowerCase() !== 'premium') return <StateCard kind="premium" title="Premium access required" detail="This mock test is reserved for Testbook+ Premium learners. Continue in Telegram to activate your access." action={<a href="https://t.me" data-testid="link-upgrade-premium" className="mt-7 inline-flex rounded-md bg-[#d7a55a] px-5 py-3 text-sm font-bold text-[#17333d]">View Premium access</a>} />;
  if (testQuery.isLoading) return <LoadingScreen />;
  if (testQuery.isError || !testQuery.data) return <StateCard kind="error" title="Test unavailable" detail="We could not load this paper. Your secure session is valid, so please retry." action={<button onClick={() => testQuery.refetch()} data-testid="button-retry-test" className="mt-7 rounded-md bg-[#17333d] px-5 py-3 text-sm font-bold text-[#f4f0e6]">Reload paper</button>} />;
  if (!testQuery.data.questions?.length) return <StateCard kind="empty" title="No questions yet" detail="This paper is being prepared by the faculty team. Check back shortly." />;
  return started ? <Runner test={testQuery.data} token={token} session={session} /> : <StartState test={testQuery.data} session={session} onStart={() => setStarted(true)} />;
}

function StartState({ test, session, onStart }: { test: LearnerTest; session: LearnerWebSession; onStart: () => void }) {
  const mins = Math.round(test.webTimerSeconds / 60);
  return <div className="min-h-[100dvh] bg-[#f1eee7]"><Header session={session} /><main className="mx-auto max-w-[1240px] px-4 py-8 sm:px-7 lg:py-14"><div className="mb-9 flex items-center gap-2 text-xs text-[#687579]"><span className="text-[#287e70]">Mock tests</span><span>/</span><span>{test.mainCategory}</span><span>/</span><span className="font-medium text-[#17333d]">{test.testName}</span></div><section className="grid overflow-hidden rounded-xl border border-[#d8d4c9] bg-[#faf9f5] shadow-[0_18px_55px_rgba(23,51,61,.08)] lg:grid-cols-[1.15fr_.85fr]"><div className="relative overflow-hidden bg-[#17333d] p-7 text-[#f4f0e6] sm:p-12"><div className="absolute -right-16 -top-20 h-64 w-64 rounded-full border-[26px] border-[#70c3ae]/10" /><div className="absolute bottom-8 right-8 text-[#70c3ae]/25"><BarChart3 size={110} strokeWidth={1} /></div><p className="mb-6 flex items-center gap-2 text-xs font-bold uppercase tracking-[.2em] text-[#70c3ae]"><ShieldCheck size={15} /> Premium paper</p><h1 className="max-w-xl text-3xl font-bold tracking-tight sm:text-5xl" data-testid="text-test-name">{test.testName}</h1><p className="mt-5 max-w-lg text-sm leading-7 text-[#c1d0cf]">A quiet, timed paper built for the actual exam room. Work one question at a time, then review the evidence.</p><div className="mt-9 flex flex-wrap gap-2">{[test.mainCategory, test.subCategory].map((item) => <span key={item} className="rounded-full border border-[#43606a] px-3 py-1.5 text-xs text-[#c1d0cf]">{item}</span>)}</div></div><div className="p-7 sm:p-12"><div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[#d8d4c9] bg-[#d8d4c9]"><InfoTile label="Questions" value={String(test.questionCount)} /><InfoTile label="Web duration" value={`${mins} min`} /><InfoTile label="Correct mark" value={`+${test.positiveMarking}`} /><InfoTile label="Wrong mark" value={`−${test.negativeMarking}`} /></div><div className="mt-8"><p className="mb-3 text-xs font-bold uppercase tracking-[.15em] text-[#8a9697]">Paper blueprint</p><div className="space-y-3">{test.sections.map((section, i) => <div key={section} className="flex items-center justify-between border-b border-[#ece8df] pb-3 text-sm"><span className="text-[#56656a]">{section}</span><span className="number-font text-xs text-[#8a9697]">{Math.ceil(test.questionCount / test.sections.length) + (i < test.questionCount % test.sections.length ? 1 : 0)} Q</span></div>)}</div></div><button onClick={onStart} data-testid="button-start-test" className="mt-8 flex w-full items-center justify-center gap-2 rounded-md bg-[#287e70] py-3.5 text-sm font-bold text-[#f4f0e6] shadow-[0_8px_20px_rgba(40,126,112,.2)] hover:-translate-y-0.5 hover:bg-[#236f63]">Enter exam hall <ArrowRight size={17} /></button><p className="mt-3 text-center text-[11px] text-[#8a9697]">Your answers are sent only when you submit this attempt.</p></div></section></main></div>;
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return <div className="bg-[#faf9f5] p-4"><p className="text-[11px] uppercase tracking-wide text-[#8a9697]">{label}</p><p className="number-font mt-1 text-lg font-bold text-[#17333d]" data-testid={`text-stat-${slug(label)}`}>{value}</p></div>;
}

function Runner({ test, token, session }: { test: LearnerTest; token: string; session: LearnerWebSession }) {
  const [, setLocation] = useLocation();
  const submit = useLearnerSubmitAttempt();
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [marked, setMarked] = useState<string[]>([]);
  const [language, setLanguage] = useState('English');
  const [time, setTime] = useState(test.webTimerSeconds);
  const [showPalette, setShowPalette] = useState(true);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [menu, setMenu] = useState<MenuAction>(null);
  const [submitted, setSubmitted] = useState(false);
  const [reportText, setReportText] = useState('');
  const [reportState, setReportState] = useState('');
  const report = useLearnerCreateReport();
  const ai = useLearnerGetAiInfo();
  const question = test.questions[current];
  const sectionCounts = useMemo(() => test.sections.map((name) => ({ name, count: test.questions.filter((q) => q.section === name).length })), [test]);

  useEffect(() => {
    const id = window.setInterval(() => setTime((value) => value > 0 ? value - 1 : 0), 1000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => { if (time === 0 && !submitted) setShowConfirm(true); }, [time, submitted]);

  const submitAttempt = () => {
    setSubmitError('');
    submit.mutate({ data: { token, testId: test.testId, answers, markedForReview: marked, timeSpentSeconds: Math.max(0, test.webTimerSeconds - time) } }, {
      onSuccess: (result) => {
        localStorage.setItem(RESULT_KEY, JSON.stringify(result));
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        localStorage.setItem(ATTEMPT_KEY, JSON.stringify({ token, testId: test.testId }));
        setSubmitted(true);
        setLocation('/result');
      },
      onError: () => setSubmitError('We could not submit your attempt. Check your connection and try again.'),
    });
  };

  const getAi = () => {
    ai.mutate({ data: { token, testId: test.testId, questionId: question.id } });
    setMenu('ai');
  };
  const sendReport = () => {
    if (reportText.trim().length < 3) {
      setReportState('Please enter at least 3 characters.');
      return;
    }
    setReportState('');
    report.mutate({ data: { token, testId: test.testId, questionId: question.id, reportText: reportText.trim() } }, {
      onSuccess: (response) => setReportState(response.message || 'Report submitted. Thank you.'),
      onError: () => setReportState('Report could not be submitted. Please try again.'),
    });
  };

  if (submitted) return null;
  return <div className="min-h-[100dvh] bg-[#f1eee7]"><Header session={session} time={time} isRunner onSubmit={() => setShowConfirm(true)} onMenu={() => setMenu(menu ? null : 'profile')} /><div className="border-b border-[#d8d4c9] bg-[#faf9f5]"><div className="mx-auto flex max-w-[1500px] items-center gap-1 overflow-x-auto px-4 sm:px-7">{sectionCounts.map((section) => <button key={section.name} onClick={() => { const index = test.questions.findIndex((q) => q.section === section.name); if (index >= 0) setCurrent(index); }} data-testid={`button-section-${slug(section.name)}`} className={`whitespace-nowrap border-b-2 px-4 py-3 text-xs font-semibold ${question.section === section.name ? 'border-[#287e70] text-[#287e70]' : 'border-transparent text-[#687579] hover:text-[#17333d]'}`}>{section.name}<span className="ml-2 text-[10px] text-[#8a9697]">{section.count}</span></button>)}</div></div><main className="mx-auto grid max-w-[1500px] gap-0 lg:grid-cols-[minmax(0,1fr)_310px]"><section className="min-h-[calc(100dvh-117px)] bg-[#faf9f5] px-4 py-6 sm:px-8 lg:px-12"><div className="mb-7 flex flex-wrap items-center justify-between gap-3 border-b border-[#ece8df] pb-4"><div><p className="text-xs font-bold uppercase tracking-[.14em] text-[#8a9697]">Question <span className="number-font text-[#17333d]">{String(current + 1).padStart(2, '0')}</span> / {test.questions.length}</p><p className="mt-1 text-xs text-[#287e70]">{question.section}</p></div><div className="flex items-center gap-2"><button onClick={() => setLanguage(language === 'English' ? 'Hindi' : 'English')} data-testid="button-language-toggle" className="flex items-center gap-1.5 rounded-md border border-[#d8d4c9] px-3 py-2 text-xs font-semibold text-[#56656a] hover:bg-[#f1eee7]"><Languages size={14} /> {language}<ChevronDown size={13} /></button><button onClick={() => setShowPalette(!showPalette)} data-testid="button-toggle-palette" className="rounded-md border border-[#d8d4c9] p-2 text-[#687579] hover:bg-[#f1eee7] lg:hidden"><Menu size={16} /></button></div></div><div className="mx-auto max-w-3xl animate-rise-in" key={question.id}><div className="mb-8 flex items-start gap-3"><span className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-[#e1f0ea] text-xs font-bold text-[#287e70]">{current + 1}</span><h2 className="focus-copy text-lg font-semibold leading-8 text-[#17333d] sm:text-xl" data-testid={`text-question-${question.id}`}>{question.question}</h2></div>{question.imageUrl && <img src={question.imageUrl} alt="Question illustration" className="mb-7 max-h-64 rounded-lg object-contain" data-testid={`img-question-${question.id}`} />}<div className="space-y-3">{question.options.map((option, index) => <button key={option} onClick={() => setAnswers((prev) => ({ ...prev, [question.id]: index }))} data-testid={`button-option-${question.id}-${index}`} className={`flex w-full items-center gap-4 rounded-lg border p-4 text-left text-sm ${answers[question.id] === index ? 'border-[#287e70] bg-[#e1f0ea] text-[#17333d] ring-1 ring-[#287e70]' : 'border-[#d8d4c9] bg-[#faf9f5] text-[#56656a] hover:border-[#abbcb8] hover:bg-[#f5f2eb]'}`}><span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs font-bold ${answers[question.id] === index ? 'border-[#287e70] bg-[#287e70] text-[#f4f0e6]' : 'border-[#c8c7bd] text-[#687579]'}`}>{String.fromCharCode(65 + index)}</span><span data-testid={`text-option-${question.id}-${index}`}>{option}</span>{answers[question.id] === index && <Check size={16} className="ml-auto text-[#287e70]" />}</button>)}</div></div><div className="mx-auto mt-12 flex max-w-3xl flex-wrap items-center justify-between gap-3 border-t border-[#ece8df] pt-5"><button onClick={() => setAnswers((prev) => { const next = { ...prev }; delete next[question.id]; return next; })} data-testid="button-clear-answer" className="flex items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold text-[#687579] hover:bg-[#f1eee7]"><RotateCcw size={14} /> Clear response</button><button onClick={() => setMarked((prev) => prev.includes(question.id) ? prev.filter((id) => id !== question.id) : [...prev, question.id])} data-testid="button-mark-review" className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold ${marked.includes(question.id) ? 'bg-[#f5e9d5] text-[#98672a]' : 'text-[#687579] hover:bg-[#f1eee7]'}`}><Bookmark size={14} fill={marked.includes(question.id) ? 'currentColor' : 'none'} /> {marked.includes(question.id) ? 'Marked for review' : 'Mark for review'}</button></div><div className="mx-auto mt-6 flex max-w-3xl items-center justify-between gap-3"><button disabled={current === 0} onClick={() => setCurrent((value) => value - 1)} data-testid="button-previous" className="flex items-center gap-2 rounded-md border border-[#d8d4c9] px-4 py-2.5 text-xs font-bold text-[#56656a] disabled:cursor-not-allowed disabled:opacity-40"><ArrowLeft size={15} /> Previous</button><button onClick={() => current === test.questions.length - 1 ? setShowConfirm(true) : setCurrent((value) => value + 1)} data-testid="button-next" className="flex items-center gap-2 rounded-md bg-[#17333d] px-5 py-2.5 text-xs font-bold text-[#f4f0e6] hover:bg-[#244a55]">{current === test.questions.length - 1 ? 'Review & submit' : 'Save & next'} <ArrowRight size={15} /></button></div></section><aside className={`${showPalette ? 'block' : 'hidden'} border-l border-[#d8d4c9] bg-[#f5f2eb] p-5 lg:block`}><div className="sticky top-[92px]"><div className="mb-5 flex items-center justify-between"><div><p className="text-sm font-bold text-[#17333d]">Question palette</p><p className="mt-1 text-xs text-[#8a9697]">{Object.keys(answers).length} answered · {marked.length} marked</p></div><Grid2X2 size={17} className="text-[#287e70]" /></div><div className="mb-6 grid grid-cols-5 gap-2">{test.questions.map((item, index) => <button key={item.id} onClick={() => setCurrent(index)} data-testid={`button-palette-${index + 1}`} className={`relative h-9 rounded-md border text-xs font-bold ${current === index ? 'border-[#17333d] bg-[#17333d] text-[#f4f0e6]' : marked.includes(item.id) ? 'border-[#d7a55a] bg-[#f5e9d5] text-[#98672a]' : answers[item.id] !== undefined ? 'border-[#77b9aa] bg-[#e1f0ea] text-[#287e70]' : 'border-[#d8d4c9] bg-[#faf9f5] text-[#687579]'}`}>{index + 1}{marked.includes(item.id) && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-[#d7a55a]" />}</button>)}</div><div className="space-y-2 border-t border-[#d8d4c9] pt-5 text-xs text-[#687579]"><Legend color="bg-[#e1f0ea]" label="Answered" /><Legend color="bg-[#f5e9d5]" label="Marked for review" /><Legend color="bg-[#faf9f5]" label="Not visited" /></div><div className="mt-8 rounded-lg border border-[#c9e2d9] bg-[#e1f0ea] p-4"><div className="flex gap-2 text-[#287e70]"><ShieldCheck size={16} /><p className="text-xs font-semibold">Secure session active</p></div><p className="mt-2 text-[11px] leading-5 text-[#687579]">Answers are sent only once, when you submit the paper.</p></div></div></aside></main>{menu && <RunnerMenu action={menu} session={session} question={question} ai={ai} onClose={() => { setMenu(null); setReportState(''); }} onFocus={() => setMenu('focus')} onReport={() => setMenu('report')} onAi={getAi} reportText={reportText} setReportText={setReportText} reportState={reportState} sendReport={sendReport} reportPending={report.isPending} />}{showConfirm && <SubmitDialog total={test.questions.length} answered={Object.keys(answers).length} pending={submit.isPending} error={submitError} onCancel={() => setShowConfirm(false)} onSubmit={submitAttempt} />}</div>;
}

function Legend({ color, label }: { color: string; label: string }) {
  return <div className="flex items-center gap-2"><span className={`h-3 w-3 rounded-sm border border-[#c8c7bd] ${color}`} />{label}</div>;
}

function RunnerMenu({
  action,
  session,
  question,
  ai,
  onClose,
  onFocus,
  onReport,
  onAi,
  reportText,
  setReportText,
  reportState,
  sendReport,
  reportPending,
}: {
  action: MenuAction;
  session: LearnerWebSession;
  question: LearnerQuestion;
  ai: ReturnType<typeof useLearnerGetAiInfo>;
  onClose: () => void;
  onFocus: () => void;
  onReport: () => void;
  onAi: () => void;
  reportText: string;
  setReportText: (value: string) => void;
  reportState: string;
  sendReport: () => void;
  reportPending: boolean;
}) {
  if (action === 'focus') return <Overlay title="Focus question" icon={<Target size={18} />} onClose={onClose}><div className="animate-soft-in"><p className="text-xs font-bold uppercase tracking-[.14em] text-[#287e70]">{question.section}</p><h2 className="focus-copy mt-4 text-2xl font-semibold leading-9 text-[#17333d] sm:text-3xl">{question.question}</h2>{question.imageUrl && <img src={question.imageUrl} alt="Question illustration" className="mt-7 max-h-80 max-w-full rounded-lg object-contain" />}</div><div className="mt-8 rounded-lg border border-[#c9e2d9] bg-[#e1f0ea] p-4 text-sm text-[#56656a]">Focus mode keeps the complete question readable without the palette or exam controls.</div></Overlay>;
  if (action === 'report') return <Overlay title="Report question" icon={<MessageSquareWarning size={18} />} onClose={onClose}><p className="text-sm leading-6 text-[#687579]">Tell the faculty team what needs attention in this question. Your report is linked to this test and question.</p><label className="mt-6 block text-xs font-bold uppercase tracking-wide text-[#56656a]" htmlFor="report-text">Report details</label><textarea id="report-text" value={reportText} onChange={(event) => setReportText(event.target.value)} data-testid="input-report-text" className="mt-2 min-h-32 w-full resize-y rounded-md border border-[#d8d4c9] bg-[#faf9f5] p-3 text-sm text-[#17333d] outline-none focus:border-[#287e70] focus:ring-2 focus:ring-[#287e70]/15" placeholder="For example: option B appears to be duplicated." />{reportState && <p className={`mt-3 rounded-md p-3 text-xs ${reportState.includes('submitted') ? 'bg-[#e1f0ea] text-[#287e70]' : 'bg-[#f9e8e3] text-[#a14d45]'}`} data-testid="status-report">{reportState}</p>}<button onClick={sendReport} disabled={reportPending} data-testid="button-send-report" className="mt-6 flex w-full items-center justify-center gap-2 rounded-md bg-[#17333d] py-3 text-sm font-bold text-[#f4f0e6] disabled:opacity-60"><Send size={15} />{reportPending ? 'Sending report…' : 'Send report'}</button></Overlay>;
  if (action === 'ai') return <Overlay title="AI Info" icon={<Lightbulb size={18} />} onClose={onClose}>{ai.isPending && <div className="space-y-3" data-testid="status-ai-loading"><div className="h-4 w-4/5 animate-pulse rounded bg-[#e4e0d5]" /><div className="h-4 w-full animate-pulse rounded bg-[#e4e0d5]" /><div className="h-4 w-2/3 animate-pulse rounded bg-[#e4e0d5]" /></div>}{ai.isError && <div className="rounded-md bg-[#f9e8e3] p-4 text-sm text-[#a14d45]" data-testid="status-ai-error">AI guidance could not be loaded. Please try again from the menu.</div>}{ai.data && <div className="animate-soft-in"><p className="mb-3 text-xs font-bold uppercase tracking-[.14em] text-[#287e70]">Guidance for this question</p><p className="whitespace-pre-wrap text-sm leading-7 text-[#56656a]" data-testid="text-ai-answer">{ai.data.answer}</p></div>}{!ai.isPending && !ai.isError && !ai.data && <div className="rounded-md border border-[#d8d4c9] p-4 text-sm text-[#687579]">Select AI Info to request guidance for the current question.</div>}</Overlay>;
  return <Overlay title="Telegram profile" icon={<UserRound size={18} />} onClose={onClose}><div className="flex items-center gap-4 border-b border-[#ece8df] pb-5"><div className="grid h-12 w-12 place-items-center rounded-full bg-[#e1f0ea] font-bold text-[#287e70]">{initials(session.fullName)}</div><div><p className="font-semibold text-[#17333d]" data-testid="text-runner-profile-name">{session.fullName}</p><p className="text-sm text-[#687579]" data-testid="text-runner-profile-username">{session.username ? `@${session.username.replace(/^@/, '')}` : 'Telegram username unavailable'}</p></div></div><div className="mt-5 flex items-center gap-2 text-sm font-semibold text-[#287e70]" data-testid="status-telegram-profile"><CheckCircle2 size={17} /> Telegram session verified</div><p className="mt-2 text-sm leading-6 text-[#687579]">Your Premium access and test link are being used from the same Telegram-linked session.</p><div className="mt-6 grid gap-2 sm:grid-cols-2"><button onClick={onFocus} data-testid="button-focus-question" className="flex items-center gap-2 rounded-md border border-[#d8d4c9] px-3 py-2.5 text-sm font-semibold text-[#56656a] hover:bg-[#f1eee7]"><Target size={15} /> Focus question</button><button onClick={onReport} data-testid="button-report-question" className="flex items-center gap-2 rounded-md border border-[#d8d4c9] px-3 py-2.5 text-sm font-semibold text-[#56656a] hover:bg-[#f1eee7]"><MessageSquareWarning size={15} /> Report question</button><button onClick={onAi} data-testid="button-ai-info" className="flex items-center gap-2 rounded-md border border-[#d8d4c9] px-3 py-2.5 text-sm font-semibold text-[#56656a] hover:bg-[#f1eee7]"><Lightbulb size={15} /> AI Info</button></div></Overlay>;
}

function Overlay({ title, icon, children, onClose }: { title: string; icon: ReactNode; children: ReactNode; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#17333d]/65 p-4" role="dialog" aria-modal="true"><div className="animate-soft-in max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[#d8d4c9] bg-[#faf9f5] p-6 shadow-2xl sm:p-8"><div className="mb-6 flex items-center justify-between border-b border-[#ece8df] pb-5"><h2 className="flex items-center gap-2 text-lg font-bold text-[#17333d]">{icon}{title}</h2><button onClick={onClose} data-testid="button-close-overlay" aria-label="Close dialog" className="rounded-md p-2 text-[#687579] hover:bg-[#f1eee7]"><X size={18} /></button></div>{children}</div></div>;
}

function SubmitDialog({ total, answered, pending, error, onCancel, onSubmit }: { total: number; answered: number; pending: boolean; error: string; onCancel: () => void; onSubmit: () => void }) {
  return <div className="fixed inset-0 z-50 grid place-items-center bg-[#17333d]/65 p-4"><div className="w-full max-w-md rounded-xl border border-[#d8d4c9] bg-[#faf9f5] p-7 shadow-2xl"><div className="mb-5 flex items-start justify-between"><div className="grid h-11 w-11 place-items-center rounded-lg bg-[#f5e9d5] text-[#98672a]"><Flag size={21} /></div><button onClick={onCancel} data-testid="button-close-submit-dialog" className="rounded-md p-2 text-[#687579] hover:bg-[#f1eee7]"><X size={18} /></button></div><h2 className="text-xl font-bold text-[#17333d]">Submit this attempt?</h2><p className="mt-2 text-sm leading-6 text-[#687579]">You have answered <b className="text-[#17333d]">{answered}</b> of {total} questions. You cannot edit answers after submitting.</p>{error && <p className="mt-4 rounded-md bg-[#f9e8e3] p-3 text-xs text-[#a14d45]" data-testid="status-submit-error">{error}</p>}<div className="mt-7 flex gap-3"><button onClick={onCancel} data-testid="button-continue-test" className="flex-1 rounded-md border border-[#d8d4c9] py-3 text-sm font-bold text-[#56656a]">Continue test</button><button onClick={onSubmit} disabled={pending} data-testid="button-confirm-submit" className="flex-1 rounded-md bg-[#d96f61] py-3 text-sm font-bold text-[#f4f0e6] disabled:opacity-60">{pending ? 'Submitting…' : 'Submit attempt'}</button></div></div></div>;
}

function ResultPage() {
  const [, setLocation] = useLocation();
  const [result, setResult] = useState<LearnerResult | null>(null);
  const [session, setSession] = useState<LearnerWebSession | null>(null);
  const [attemptContext, setAttemptContext] = useState<{ token: string; testId: string } | null>(null);
  const [filter, setFilter] = useState<ReviewFilter>('all');
  const [openReview, setOpenReview] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuAction>(null);
  const [reportText, setReportText] = useState('');
  const [reportState, setReportState] = useState('');
  const [aiQuestion, setAiQuestion] = useState<LearnerQuestionReview | null>(null);
  const report = useLearnerCreateReport();
  const ai = useLearnerGetAiInfo();

  useEffect(() => {
    try {
      const raw = localStorage.getItem(RESULT_KEY);
      const sessionRaw = localStorage.getItem(SESSION_KEY);
      if (raw) setResult(JSON.parse(raw) as LearnerResult);
      if (sessionRaw) setSession(JSON.parse(sessionRaw) as LearnerWebSession);
      const contextRaw = localStorage.getItem(ATTEMPT_KEY);
      if (contextRaw) setAttemptContext(JSON.parse(contextRaw) as { token: string; testId: string });
    } catch {
      setResult(null);
    }
  }, []);

  if (!result) return <StateCard kind="empty" title="No completed attempt yet" detail="Submit a mock test to unlock your detailed performance report." action={<button onClick={() => setLocation('/')} data-testid="button-back-to-test" className="mt-7 rounded-md bg-[#17333d] px-5 py-3 text-sm font-bold text-[#f4f0e6]">Back to test</button>} />;
  const scorePercent = result.maxScore ? Math.round((result.score / result.maxScore) * 100) : 0;
  const reviewItems = Array.isArray(result.review) ? result.review : [];
  const filtered = reviewItems.filter((item) => filter === 'all' || (filter === 'marked' ? result.markedForReview.includes(item.id) : item.status === filter));
  const openAi = (item: LearnerQuestionReview) => {
    setAiQuestion(item);
    setMenu('ai');
    ai.mutate({ data: { token: attemptContext?.token || '', testId: attemptContext?.testId || '', questionId: item.id } });
  };
  const closeMenu = () => { setMenu(null); setAiQuestion(null); setReportState(''); };
  return <div className="min-h-[100dvh] bg-[#f1eee7]"><Header session={session} /><main className="mx-auto max-w-[1240px] px-4 py-8 sm:px-7 lg:py-12"><div className="mb-8 flex flex-wrap items-end justify-between gap-4"><div><Link href="/" data-testid="link-result-back" className="mb-5 flex items-center gap-2 text-xs font-semibold text-[#287e70]"><ArrowLeft size={14} /> Back to test library</Link><p className="text-xs font-bold uppercase tracking-[.18em] text-[#287e70]">Attempt complete</p><h1 className="mt-2 text-3xl font-bold tracking-tight text-[#17333d] sm:text-4xl" data-testid="text-result-title">{result.testName}</h1><p className="mt-2 text-sm text-[#687579]">A detailed read of this attempt, with every answer available for review.</p></div><button onClick={() => setLocation('/')} data-testid="button-retake-test" className="flex items-center gap-2 rounded-md border border-[#d8d4c9] bg-[#faf9f5] px-4 py-2.5 text-xs font-bold text-[#56656a] hover:bg-[#f5f2eb]"><RotateCcw size={14} /> Retake test</button></div><section className="grid gap-4 md:grid-cols-[1.1fr_.9fr]"><div className="relative overflow-hidden rounded-xl bg-[#17333d] p-7 text-[#f4f0e6] sm:p-9"><div className="absolute -right-8 -top-12 text-[#70c3ae]/15"><Award size={210} strokeWidth={1} /></div><div className="relative"><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.15em] text-[#70c3ae]"><CheckCircle2 size={15} /> Scorecard</div><div className="mt-5 flex items-end gap-3"><span className="number-font text-6xl font-bold tracking-tight" data-testid="text-score">{result.score}</span><span className="mb-2 text-lg text-[#afc1c3]">/ {result.maxScore}</span></div><div className="mt-5 h-2 overflow-hidden rounded-full bg-[#38545d]"><div className="h-full rounded-full bg-[#70c3ae]" style={{ width: `${Math.max(0, Math.min(100, scorePercent))}%` }} /></div><p className="mt-3 text-xs text-[#afc1c3]">{scorePercent}% of maximum score · Attempt #{result.attemptId}</p></div></div><div className="grid grid-cols-2 gap-3">{[['Attempted', result.attempted, 'text-[#287e70]'], ['Correct', result.correct, 'text-[#287e70]'], ['Incorrect', result.incorrect, 'text-[#d96f61]'], ['Skipped', result.skipped, 'text-[#98672a]']].map(([label, value, color]) => <div key={String(label)} className="rounded-lg border border-[#d8d4c9] bg-[#faf9f5] p-5"><p className="text-xs text-[#8a9697]">{label}</p><p className={`number-font mt-3 text-3xl font-bold ${color}`} data-testid={`text-result-${slug(String(label))}`}>{value}</p><p className="mt-1 text-[11px] text-[#8a9697]">{label === 'Attempted' ? `${result.totalQuestions} total questions` : 'in this attempt'}</p></div>)}</div></section><section className="mt-5 grid gap-5 lg:grid-cols-[1.2fr_.8fr]"><div className="rounded-xl border border-[#d8d4c9] bg-[#faf9f5] p-6 sm:p-8"><div className="mb-7 flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[.15em] text-[#8a9697]">Section report</p><h2 className="mt-1 text-xl font-bold text-[#17333d]">Where your marks moved</h2></div><BarChart3 className="text-[#287e70]" size={22} /></div><div className="space-y-5">{result.sections?.map((section) => <div key={section.name} className="animate-rise-in" data-testid={`row-section-${slug(section.name)}`}><div className="mb-2 flex items-center justify-between text-sm"><span className="font-semibold text-[#56656a]">{section.name}</span><span className="number-font text-xs text-[#687579]">{section.correct}/{section.attempted} correct</span></div><div className="h-2 overflow-hidden rounded-full bg-[#ece8df]"><div className="h-full rounded-full bg-[#70b9a7]" style={{ width: `${section.attempted ? Math.round((section.correct / section.attempted) * 100) : 0}%` }} /></div><div className="mt-2 flex gap-4 text-[11px] text-[#8a9697]"><span>Score {section.score}</span><span>{section.incorrect} incorrect</span></div></div>)}</div></div><div className="rounded-xl border border-[#d8d4c9] bg-[#faf9f5] p-6 sm:p-8"><p className="text-xs font-bold uppercase tracking-[.15em] text-[#8a9697]">Signal</p><h2 className="mt-1 text-xl font-bold text-[#17333d]">Your exam pulse</h2><div className="mt-7 space-y-5"><Pulse label="Accuracy" value={`${result.accuracy}%`} icon={<Target size={16} />} /><Pulse label="Time spent" value={prettyDuration(result.timeSpentSeconds)} icon={<Clock3 size={16} />} /><Pulse label="Rank percentile" value={`${result.rankPercentile}%`} icon={<BarChart3 size={16} />} /><Pulse label="Attempt quality" value={result.incorrect <= result.correct ? 'On track' : 'Needs review'} icon={<ShieldCheck size={16} />} /></div>{session && <div className="mt-7 rounded-lg border border-[#c9e2d9] bg-[#e1f0ea] p-4"><div className="flex items-center gap-2 text-xs font-bold text-[#287e70]"><CheckCircle2 size={15} /> Telegram profile synced</div><p className="mt-1 text-xs text-[#56656a]" data-testid="text-result-profile">{session.fullName}{session.username ? ` · @${session.username.replace(/^@/, '')}` : ''}</p><p className="mt-1 text-[11px] text-[#687579]">{result.telegramSynced ? 'Your result has been synced after submission.' : 'The result was saved locally; Telegram sync is not confirmed.'}</p></div>}</div></section><section className="mt-5 grid gap-5 lg:grid-cols-2"><InsightCard title="Strengths" icon={<CheckCircle2 size={18} />} items={result.strengths} tone="positive" /><InsightCard title="Focus areas" icon={<Target size={18} />} items={result.focusAreas} tone="warm" /></section><section className="mt-5 rounded-xl border border-[#d8d4c9] bg-[#faf9f5] p-6 sm:p-8"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.15em] text-[#8a9697]">Recommendation</p><h2 className="mt-1 text-xl font-bold text-[#17333d]">What to do next</h2></div><div className="rounded-md bg-[#e1f0ea] p-2 text-[#287e70]"><Lightbulb size={18} /></div></div><p className="mt-5 max-w-3xl text-sm leading-7 text-[#56656a]" data-testid="text-recommendation">{result.recommendation}</p></section><section className="mt-5 rounded-xl border border-[#d8d4c9] bg-[#faf9f5] p-6 sm:p-8"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.15em] text-[#8a9697]">Answer review</p><h2 className="mt-1 text-xl font-bold text-[#17333d]">Question-by-question solutions</h2></div><div className="flex flex-wrap gap-2" role="tablist">{(['all', 'incorrect', 'skipped', 'marked'] as ReviewFilter[]).map((item) => <button key={item} onClick={() => setFilter(item)} data-testid={`button-filter-${item}`} className={`rounded-full border px-3 py-1.5 text-xs font-semibold capitalize ${filter === item ? 'border-[#287e70] bg-[#e1f0ea] text-[#287e70]' : 'border-[#d8d4c9] text-[#687579] hover:bg-[#f1eee7]'}`}>{item}</button>)}</div></div><div className="mt-6 space-y-3">{filtered.length ? filtered.map((item) => <ReviewRow key={item.id} item={item} marked={result.markedForReview.includes(item.id)} expanded={openReview === item.id} onToggle={() => setOpenReview(openReview === item.id ? null : item.id)} onAi={() => openAi(item)} onReport={() => { setAiQuestion(item); setMenu('report'); }} />) : <div className="rounded-lg border border-dashed border-[#d8d4c9] p-8 text-center text-sm text-[#687579]" data-testid="empty-review">No questions match this filter.</div>}</div></section></main>{menu === 'ai' && aiQuestion && <ResultAiOverlay item={aiQuestion} ai={ai} onClose={closeMenu} />}{menu === 'report' && aiQuestion && <ResultReportOverlay item={aiQuestion} token={attemptContext?.token || ''} testId={attemptContext?.testId || ''} report={report} reportText={reportText} setReportText={setReportText} reportState={reportState} setReportState={setReportState} onClose={closeMenu} />}</div>;
}

function InsightCard({ title, icon, items, tone }: { title: string; icon: ReactNode; items: string[]; tone: 'positive' | 'warm' }) {
  return <div className={`rounded-xl border p-6 sm:p-8 ${tone === 'positive' ? 'border-[#c9e2d9] bg-[#e1f0ea]' : 'border-[#ead9bd] bg-[#f5e9d5]'}`}><div className={`flex items-center gap-2 text-xs font-bold uppercase tracking-[.15em] ${tone === 'positive' ? 'text-[#287e70]' : 'text-[#98672a]'}`}>{icon}{title}</div><ul className="mt-5 space-y-3">{items?.length ? items.map((item) => <li key={item} className="flex gap-3 text-sm leading-6 text-[#56656a]"><span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${tone === 'positive' ? 'bg-[#287e70]' : 'bg-[#98672a]'}`} />{item}</li>) : <li className="text-sm text-[#687579]">No additional signals were returned for this attempt.</li>}</ul></div>;
}

function Pulse({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return <div className="flex items-center justify-between border-b border-[#ece8df] pb-4"><span className="flex items-center gap-2 text-sm text-[#687579]">{icon}{label}</span><span className="number-font text-sm font-bold text-[#17333d]" data-testid={`text-pulse-${slug(label)}`}>{value}</span></div>;
}

function ReviewRow({ item, marked, expanded, onToggle, onAi, onReport }: { item: LearnerQuestionReview; marked: boolean; expanded: boolean; onToggle: () => void; onAi: () => void; onReport: () => void }) {
  const statusLabel = item.status === 'correct' ? 'Correct' : item.status === 'incorrect' ? 'Incorrect' : 'Skipped';
  const statusClass = item.status === 'correct' ? 'bg-[#e1f0ea] text-[#287e70]' : item.status === 'incorrect' ? 'bg-[#f9e8e3] text-[#a14d45]' : 'bg-[#f5e9d5] text-[#98672a]';
  return <div className="animate-soft-in overflow-hidden rounded-lg border border-[#e4e0d5]"><button onClick={onToggle} data-testid={`button-review-${item.id}`} className="flex w-full items-start gap-3 p-4 text-left hover:bg-[#f8f6f0] sm:items-center"><span className="number-font mt-0.5 text-xs text-[#8a9697] sm:mt-0">{item.id}</span><span className="min-w-0 flex-1"><span className="line-clamp-2 block text-sm font-semibold leading-6 text-[#17333d]">{item.question}</span><span className="mt-1 block text-xs text-[#8a9697]">{item.section}</span></span>{marked && <Bookmark size={15} className="mt-1 shrink-0 text-[#98672a]" fill="currentColor" /> }<span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${statusClass}`} data-testid={`status-review-${item.id}`}>{statusLabel}</span><ChevronDown size={16} className={`mt-1 shrink-0 text-[#8a9697] transition-transform ${expanded ? 'rotate-180' : ''}`} /></button>{expanded && <div className="animate-rise-in border-t border-[#e4e0d5] bg-[#f8f6f0] p-5 sm:p-6"><div className="grid gap-3 sm:grid-cols-2"><AnswerDetail label="Selected answer" value={item.selectedOption === null ? 'Not answered' : `${String.fromCharCode(65 + item.selectedOption)} · ${item.options[item.selectedOption]}`} tone={item.status === 'incorrect' ? 'negative' : 'neutral'} /><AnswerDetail label="Correct answer" value={`${String.fromCharCode(65 + item.correctOptionIndex)} · ${item.options[item.correctOptionIndex]}`} tone="positive" /></div><div className="mt-5"><p className="text-xs font-bold uppercase tracking-wide text-[#8a9697]">Explanation</p><p className="mt-2 text-sm leading-7 text-[#56656a]" data-testid={`text-explanation-${item.id}`}>{item.explanation}</p></div><div className="mt-5 flex flex-wrap gap-2"><button onClick={onAi} data-testid={`button-review-ai-${item.id}`} className="flex items-center gap-2 rounded-md border border-[#d8d4c9] bg-[#faf9f5] px-3 py-2 text-xs font-semibold text-[#56656a] hover:bg-white"><Lightbulb size={14} /> AI Info</button><button onClick={onReport} data-testid={`button-review-report-${item.id}`} className="flex items-center gap-2 rounded-md border border-[#d8d4c9] bg-[#faf9f5] px-3 py-2 text-xs font-semibold text-[#56656a] hover:bg-white"><MessageSquareWarning size={14} /> Report question</button></div></div>}</div>;
}

function AnswerDetail({ label, value, tone }: { label: string; value: string; tone: 'positive' | 'negative' | 'neutral' }) {
  return <div className="rounded-md border border-[#e4e0d5] bg-[#faf9f5] p-3"><p className="text-[11px] uppercase tracking-wide text-[#8a9697]">{label}</p><p className={`mt-1 text-sm font-semibold ${tone === 'positive' ? 'text-[#287e70]' : tone === 'negative' ? 'text-[#a14d45]' : 'text-[#56656a]'}`}>{value}</p></div>;
}

function ResultAiOverlay({ item, ai, onClose }: { item: LearnerQuestionReview; ai: ReturnType<typeof useLearnerGetAiInfo>; onClose: () => void }) {
  return <Overlay title="AI Info" icon={<Lightbulb size={18} />} onClose={onClose}><p className="text-xs font-bold uppercase tracking-[.14em] text-[#287e70]">{item.section}</p><p className="focus-copy mt-3 text-sm font-semibold leading-6 text-[#17333d]">{item.question}</p>{ai.isPending && <div className="mt-6 space-y-3" data-testid="status-ai-loading"><div className="h-4 w-4/5 animate-pulse rounded bg-[#e4e0d5]" /><div className="h-4 w-full animate-pulse rounded bg-[#e4e0d5]" /></div>}{ai.isError && <div className="mt-6 rounded-md bg-[#f9e8e3] p-4 text-sm text-[#a14d45]" data-testid="status-ai-error">AI guidance could not be loaded for this question.</div>}{ai.data && <p className="mt-6 whitespace-pre-wrap text-sm leading-7 text-[#56656a]" data-testid="text-ai-answer">{ai.data.answer}</p>}</Overlay>;
}

function ResultReportOverlay({ item, token, testId, report, reportText, setReportText, reportState, setReportState, onClose }: { item: LearnerQuestionReview; token: string; testId: string; report: ReturnType<typeof useLearnerCreateReport>; reportText: string; setReportText: (value: string) => void; reportState: string; setReportState: (value: string) => void; onClose: () => void }) {
  const send = () => {
    if (reportText.trim().length < 3) { setReportState('Please enter at least 3 characters.'); return; }
    setReportState('');
    report.mutate({ data: { token, testId, questionId: item.id, reportText: reportText.trim() } }, {
      onSuccess: (response) => setReportState(response.message || 'Report submitted. Thank you.'),
      onError: () => setReportState('Report could not be submitted. Please try again.'),
    });
  };
  return <Overlay title="Report question" icon={<MessageSquareWarning size={18} />} onClose={onClose}><p className="text-sm leading-6 text-[#687579]">Report an issue with this question or its explanation.</p><p className="mt-3 text-sm font-semibold text-[#17333d]">{item.question}</p><label className="mt-6 block text-xs font-bold uppercase tracking-wide text-[#56656a]" htmlFor="result-report-text">Report details</label><textarea id="result-report-text" value={reportText} onChange={(event) => setReportText(event.target.value)} data-testid="input-result-report-text" className="mt-2 min-h-32 w-full resize-y rounded-md border border-[#d8d4c9] bg-[#faf9f5] p-3 text-sm text-[#17333d] outline-none focus:border-[#287e70] focus:ring-2 focus:ring-[#287e70]/15" placeholder="Describe the issue clearly." />{reportState && <p className={`mt-3 rounded-md p-3 text-xs ${reportState.includes('submitted') ? 'bg-[#e1f0ea] text-[#287e70]' : 'bg-[#f9e8e3] text-[#a14d45]'}`} data-testid="status-result-report">{reportState}</p>}<button onClick={send} disabled={report.isPending} data-testid="button-send-result-report" className="mt-6 flex w-full items-center justify-center gap-2 rounded-md bg-[#17333d] py-3 text-sm font-bold text-[#f4f0e6] disabled:opacity-60"><Send size={15} />{report.isPending ? 'Sending report…' : 'Send report'}</button></Overlay>;
}

function Router() {
  return <Switch><Route path="/" component={HomePage} /><Route path="/result" component={ResultPage} /><Route path="/not-found" component={NotFound} /><Route component={NotFound} /></Switch>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;
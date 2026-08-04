import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  useLearnerGetTestSeries,
  useLearnerGetWebSession,
  useLearnerSubmitAttempt,
  getLearnerGetTestSeriesQueryKey,
  getLearnerGetWebSessionQueryKey,
} from '@workspace/api-client-react';
import type { LearnerQuestion, LearnerResult, LearnerTest } from '@workspace/api-client-react';
import {
  ArrowLeft, ArrowRight, Award, BarChart3, Bookmark, Check, CheckCircle2, ChevronDown,
  Clock3, Flag, Grid2X2, Info, Languages, LockKeyhole, Menu, RotateCcw, ShieldCheck,
  Sparkles, Target, TimerReset, X, XCircle, Zap,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();

type AnswerMap = Record<string, number>;

const fallbackTest: LearnerTest = {
  testId: 'demo-ssc-cgl',
  testName: 'SSC CGL Tier I · Full Mock 04',
  mainCategory: 'SSC CGL',
  subCategory: 'Tier I · 2025 Pattern',
  positiveMarking: 2,
  negativeMarking: 0.5,
  timerSeconds: 3600,
  questionCount: 12,
  sections: ['General Intelligence', 'General Awareness', 'Quantitative Aptitude', 'English Comprehension'],
  questions: Array.from({ length: 12 }, (_, index) => ({
    id: `demo-${index + 1}`,
    question: [
      'If a code transforms RATION into UDWLRQ, how would the word MARKET be written using the same rule?',
      'Which constitutional body conducts elections to the Parliament and state legislatures?',
      'A sum becomes ₹1,728 in three years at compound interest. What was the principal at 20% per annum?',
      'Select the word that is most nearly opposite in meaning to “ABUNDANT”.',
      'Find the missing number in the series: 3, 8, 18, 38, 78, ?',
      'The headquarters of the International Monetary Fund is located in which city?',
      'A train 180 m long crosses a platform in 18 seconds at 54 km/h. Find the length of the platform.',
      'Choose the correctly spelt word.',
      'If SOUTH is coded as 12345 and NORTH as 67845, what is the code for THORN?',
      'Which gas is most abundant in Earth’s atmosphere?',
      'The average of five consecutive integers is 42. What is the largest integer?',
      'Identify the figure of speech: “The leaves danced in the evening breeze.”',
    ][index],
    options: [
      ['PDUNHW', 'PDUNGV', 'QBSLFU', 'NBSLFU'],
      ['Election Commission of India', 'Finance Commission', 'UPSC', 'CAG'],
      ['₹1,000', '₹1,200', '₹1,250', '₹1,440'],
      ['Plentiful', 'Sparse', 'Sufficient', 'Overflowing'],
      ['118', '148', '158', '168'],
      ['New York', 'Geneva', 'Washington, D.C.', 'Paris'],
      ['72 m', '90 m', '100 m', '120 m'],
      ['Accomodate', 'Acommodate', 'Accommodate', 'Accomadate'],
      ['54876', '84576', '68475', '87456'],
      ['Oxygen', 'Nitrogen', 'Argon', 'Carbon dioxide'],
      ['43', '44', '45', '46'],
      ['Metaphor', 'Personification', 'Alliteration', 'Irony'],
    ][index],
    section: ['General Intelligence', 'General Awareness', 'Quantitative Aptitude', 'English Comprehension'][index % 4],
    imageUrl: null,
  })),
};

function formatTime(total: number) {
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours > 0 ? `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}` : `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function initials(name?: string) {
  return (name || 'Aspirant').split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase();
}

function Header({ session, time, onSubmit, isRunner = false }: { session?: { fullName: string; username: string | null; tier: string }; time?: number; onSubmit?: () => void; isRunner?: boolean }) {
  return (
    <header className={`sticky top-0 z-30 border-b ${isRunner ? 'bg-[#182436] text-slate-100 border-slate-700' : 'bg-[#182436] text-slate-100 border-slate-700'}`}>
      <div className="mx-auto flex h-[68px] max-w-[1500px] items-center justify-between gap-4 px-4 sm:px-7">
        <Link href="/" data-testid="link-brand" className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#48d5c2] text-[#182436]"><Target size={19} strokeWidth={2.8} /></span>
          <span className="hidden sm:block">
            <span className="block font-semibold tracking-tight">testbook<span className="text-[#48d5c2]">+</span></span>
            <span className="block text-[10px] uppercase tracking-[.2em] text-slate-400">focus mode</span>
          </span>
        </Link>
        {isRunner ? (
          <div className="flex min-w-0 items-center gap-3">
            <div className="hidden min-w-0 md:block"><p className="truncate text-sm font-semibold">SSC CGL · Full Mock 04</p><p className="text-[11px] text-slate-400">Live exam hall</p></div>
            <div className={`number-font flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-bold ${time !== undefined && time < 300 ? 'border-[#ef776d] text-[#ff9d91]' : 'border-slate-600 text-[#48d5c2]'}`} data-testid="text-timer"><Clock3 size={15} />{formatTime(time || 0)}</div>
            <button onClick={onSubmit} data-testid="button-submit-top" className="hidden rounded-md bg-[#ef776d] px-4 py-2 text-xs font-bold uppercase tracking-wide text-white hover:bg-[#db655d] sm:block">Submit test</button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-slate-400 sm:block">Telegram connected</span>
            <div className="grid h-9 w-9 place-items-center rounded-full bg-[#2c415a] text-xs font-bold text-[#48d5c2]" data-testid="avatar-user">{initials(session?.fullName)}</div>
            <span className="hidden text-sm font-medium sm:block" data-testid="text-username">{session?.fullName || 'Aspirant'}</span>
          </div>
        )}
      </div>
    </header>
  );
}

function LoadingScreen() {
  return <div className="min-h-[100dvh] bg-[#f0f4f7]"><div className="mx-auto max-w-[1500px] p-5"><div className="h-16 animate-pulse rounded-xl bg-slate-200" /><div className="mt-8 grid gap-5 lg:grid-cols-[1.3fr_.7fr]"><div className="h-80 animate-pulse rounded-2xl bg-white" /><div className="h-80 animate-pulse rounded-2xl bg-white" /></div></div></div>;
}

function StateCard({ kind, title, detail, action }: { kind: 'token' | 'error' | 'premium' | 'empty'; title: string; detail: string; action?: ReactNode }) {
  const Icon = kind === 'premium' ? LockKeyhole : kind === 'error' ? XCircle : kind === 'empty' ? Grid2X2 : ShieldCheck;
  return <div className="exam-grid flex min-h-[100dvh] items-center justify-center bg-[#edf3f5] p-5"><div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-[0_20px_60px_rgba(24,36,54,.1)] sm:p-12"><div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-[#e7f8f5] text-[#159c8d]"><Icon size={25} /></div><p className="mb-3 text-xs font-bold uppercase tracking-[.18em] text-[#159c8d]">testbook+ / focus mode</p><h1 className="text-2xl font-bold tracking-tight text-[#182436]" data-testid="text-state-title">{title}</h1><p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-slate-500" data-testid="text-state-detail">{detail}</p>{action}</div></div>;
}

function HomePage() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token') || '';
  const testId = params.get('testId') || params.get('test') || fallbackTest.testId;
  const sessionQuery = useLearnerGetWebSession({ token }, { query: { enabled: !!token, queryKey: getLearnerGetWebSessionQueryKey({ token }), retry: false } });
  const session = sessionQuery.data;
  const testQuery = useLearnerGetTestSeries({ testId, token }, { query: { enabled: !!token && !!session, queryKey: getLearnerGetTestSeriesQueryKey({ testId, token }), retry: false } });
  const [started, setStarted] = useState(false);
  if (!token) return <StateCard kind="token" title="Your secure link is missing" detail="Open this test from the Telegram bot to start a verified attempt." action={<a href="https://t.me" data-testid="link-open-telegram" className="mt-7 inline-flex rounded-lg bg-[#182436] px-5 py-3 text-sm font-bold text-white">Open Telegram</a>} />;
  if (sessionQuery.isLoading) return <LoadingScreen />;
  if (sessionQuery.isError) return <StateCard kind="error" title="This link has expired" detail="Request a fresh test link from the Testbook+ Telegram bot. Your attempt has not been started." action={<button onClick={() => sessionQuery.refetch()} data-testid="button-retry-session" className="mt-7 rounded-lg bg-[#182436] px-5 py-3 text-sm font-bold text-white">Try again</button>} />;
  if (session && session.tier.toLowerCase() !== 'premium') return <StateCard kind="premium" title="Premium access required" detail="This mock test is reserved for Testbook+ Premium learners. Continue in Telegram to activate your access." action={<a href="https://t.me" data-testid="link-upgrade-premium" className="mt-7 inline-flex rounded-lg bg-[#e6ad4e] px-5 py-3 text-sm font-bold text-[#182436]">View Premium access</a>} />;
  if (testQuery.isLoading) return <LoadingScreen />;
  if (testQuery.isError) return <StateCard kind="error" title="Test unavailable" detail="We could not load this paper. Your secure session is valid, so please retry." action={<button onClick={() => testQuery.refetch()} data-testid="button-retry-test" className="mt-7 rounded-lg bg-[#182436] px-5 py-3 text-sm font-bold text-white">Reload paper</button>} />;
  const test = testQuery.data || fallbackTest;
  if (!test.questions?.length) return <StateCard kind="empty" title="No questions yet" detail="This paper is being prepared by the faculty team. Check back shortly." />;
  return started ? <Runner test={test} token={token} session={session} /> : <StartState test={test} session={session} onStart={() => setStarted(true)} />;
}

function StartState({ test, session, onStart }: { test: LearnerTest; session?: { fullName: string; username: string | null; tier: string; premiumExpiry: string | null }; onStart: () => void }) {
  const mins = Math.round(test.timerSeconds / 60);
  return <div className="min-h-[100dvh] bg-[#eef3f5]"><Header session={session} /><main className="mx-auto max-w-[1240px] px-4 py-8 sm:px-7 lg:py-14"><div className="mb-9 flex items-center gap-2 text-xs text-slate-500"><span className="text-[#159c8d]">Mock tests</span><span>/</span><span>{test.mainCategory}</span><span>/</span><span className="font-medium text-slate-700">{test.testName}</span></div><section className="grid overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_18px_55px_rgba(24,36,54,.08)] lg:grid-cols-[1.15fr_.85fr]"><div className="relative overflow-hidden bg-[#182436] p-7 text-white sm:p-12"><div className="absolute -right-16 -top-20 h-64 w-64 rounded-full border-[26px] border-[#48d5c2]/10" /><div className="absolute bottom-8 right-8 text-[#48d5c2]/30"><BarChart3 size={110} strokeWidth={1} /></div><p className="mb-6 flex items-center gap-2 text-xs font-bold uppercase tracking-[.2em] text-[#48d5c2]"><Sparkles size={15} /> Premium paper</p><h1 className="max-w-xl text-3xl font-bold tracking-tight sm:text-5xl" data-testid="text-test-name">{test.testName}</h1><p className="mt-5 max-w-lg text-sm leading-7 text-slate-300">A focused, timed paper built for the actual exam room. No distractions. Just the next right answer.</p><div className="mt-9 flex flex-wrap gap-2">{[test.mainCategory, test.subCategory].map((item) => <span key={item} className="rounded-full border border-slate-600 px-3 py-1.5 text-xs text-slate-300">{item}</span>)}</div></div><div className="p-7 sm:p-12"><div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200"><InfoTile label="Questions" value={String(test.questionCount)} /><InfoTile label="Duration" value={`${mins} min`} /><InfoTile label="Correct mark" value={`+${test.positiveMarking}`} /><InfoTile label="Wrong mark" value={`−${test.negativeMarking}`} /></div><div className="mt-8"><p className="mb-3 text-xs font-bold uppercase tracking-[.15em] text-slate-400">Paper blueprint</p><div className="space-y-3">{test.sections.map((section, i) => <div key={section} className="flex items-center justify-between border-b border-slate-100 pb-3 text-sm"><span className="text-slate-600">{section}</span><span className="number-font text-xs text-slate-400">{Math.ceil(test.questionCount / test.sections.length) + (i < test.questionCount % test.sections.length ? 1 : 0)} Q</span></div>)}</div></div><button onClick={onStart} data-testid="button-start-test" className="mt-8 flex w-full items-center justify-center gap-2 rounded-lg bg-[#159c8d] py-3.5 text-sm font-bold text-white shadow-[0_8px_20px_rgba(21,156,141,.2)] hover:-translate-y-0.5 hover:bg-[#108b7e]">Enter exam hall <ArrowRight size={17} /></button><p className="mt-3 text-center text-[11px] text-slate-400">Your progress is saved only when you submit this attempt.</p></div></section></main></div>;
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return <div className="bg-white p-4"><p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p><p className="number-font mt-1 text-lg font-bold text-[#182436]" data-testid={`text-stat-${label.toLowerCase().replaceAll(' ', '-')}`}>{value}</p></div>;
}

function Runner({ test, token, session }: { test: LearnerTest; token: string; session?: { fullName: string; username: string | null; tier: string } }) {
  const [, setLocation] = useLocation();
  const submit = useLearnerSubmitAttempt();
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [marked, setMarked] = useState<string[]>([]);
  const [language, setLanguage] = useState('English');
  const [time, setTime] = useState(test.timerSeconds);
  const [showPalette, setShowPalette] = useState(true);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const question = test.questions[current];
  useEffect(() => {
    const id = window.setInterval(() => setTime((value) => value > 0 ? value - 1 : 0), 1000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => { if (time === 0 && !submitted) setShowConfirm(true); }, [time, submitted]);
  const sectionCounts = useMemo(() => test.sections.map((name) => ({ name, count: test.questions.filter((q) => q.section === name).length })), [test]);
  const submitAttempt = () => {
    setSubmitError('');
    submit.mutate({ data: { token, testId: test.testId, answers, markedForReview: marked, timeSpentSeconds: test.timerSeconds - time } }, {
      onSuccess: (result) => { localStorage.setItem('testbook:last-result', JSON.stringify(result)); setSubmitted(true); setLocation('/result'); },
      onError: () => setSubmitError('We could not submit your attempt. Check your connection and try again.'),
    });
  };
  if (submitted) return null;
  return <div className="min-h-[100dvh] bg-[#eef3f5]"><Header session={session} time={time} isRunner onSubmit={() => setShowConfirm(true)} /><div className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-[1500px] items-center gap-1 overflow-x-auto px-4 sm:px-7">{sectionCounts.map((section) => <button key={section.name} onClick={() => { const index = test.questions.findIndex((q) => q.section === section.name); if (index >= 0) setCurrent(index); }} data-testid={`button-section-${section.name.replaceAll(' ', '-').toLowerCase()}`} className={`whitespace-nowrap border-b-2 px-4 py-3 text-xs font-semibold ${question.section === section.name ? 'border-[#159c8d] text-[#159c8d]' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{section.name}<span className="ml-2 text-[10px] text-slate-400">{section.count}</span></button>)}</div></div><main className="mx-auto grid max-w-[1500px] gap-0 lg:grid-cols-[minmax(0,1fr)_310px]"><section className="min-h-[calc(100dvh-117px)] bg-white px-4 py-6 sm:px-8 lg:px-12"><div className="mb-7 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4"><div><p className="text-xs font-bold uppercase tracking-[.14em] text-slate-400">Question <span className="number-font text-[#182436]">{String(current + 1).padStart(2, '0')}</span> / {test.questions.length}</p><p className="mt-1 text-xs text-[#159c8d]">{question.section}</p></div><div className="flex items-center gap-2"><button onClick={() => setLanguage(language === 'English' ? 'Hindi' : 'English')} data-testid="button-language-toggle" className="flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"><Languages size={14} /> {language}<ChevronDown size={13} /></button><button onClick={() => setShowPalette(!showPalette)} data-testid="button-toggle-palette" className="rounded-md border border-slate-200 p-2 text-slate-500 lg:hidden"><Menu size={16} /></button></div></div><div className="mx-auto max-w-3xl animate-rise-in" key={question.id}><div className="mb-8 flex items-start gap-3"><span className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-[#e7f8f5] text-xs font-bold text-[#159c8d]">{current + 1}</span><h2 className="text-lg font-semibold leading-8 text-[#182436] sm:text-xl" data-testid={`text-question-${question.id}`}>{question.question}</h2></div>{question.imageUrl && <img src={question.imageUrl} alt="Question illustration" className="mb-7 max-h-64 rounded-lg object-contain" data-testid={`img-question-${question.id}`} />}<div className="space-y-3">{question.options.map((option, index) => <button key={option} onClick={() => setAnswers((prev) => ({ ...prev, [question.id]: index }))} data-testid={`button-option-${question.id}-${index}`} className={`flex w-full items-center gap-4 rounded-lg border p-4 text-left text-sm ${answers[question.id] === index ? 'border-[#159c8d] bg-[#e7f8f5] text-[#182436] ring-1 ring-[#159c8d]' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'}`}><span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs font-bold ${answers[question.id] === index ? 'border-[#159c8d] bg-[#159c8d] text-white' : 'border-slate-300 text-slate-500'}`}>{String.fromCharCode(65 + index)}</span><span data-testid={`text-option-${question.id}-${index}`}>{option}</span>{answers[question.id] === index && <Check size={16} className="ml-auto text-[#159c8d]" />}</button>)}</div></div><div className="mx-auto mt-12 flex max-w-3xl flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5"><button onClick={() => setAnswers((prev) => { const next = { ...prev }; delete next[question.id]; return next; })} data-testid="button-clear-answer" className="flex items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100"><RotateCcw size={14} /> Clear response</button><button onClick={() => setMarked((prev) => prev.includes(question.id) ? prev.filter((id) => id !== question.id) : [...prev, question.id])} data-testid="button-mark-review" className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold ${marked.includes(question.id) ? 'bg-[#fff3d9] text-[#a66c0a]' : 'text-slate-500 hover:bg-slate-100'}`}><Bookmark size={14} fill={marked.includes(question.id) ? 'currentColor' : 'none'} /> {marked.includes(question.id) ? 'Marked for review' : 'Mark for review'}</button></div><div className="mx-auto mt-6 flex max-w-3xl items-center justify-between gap-3"><button disabled={current === 0} onClick={() => setCurrent((value) => value - 1)} data-testid="button-previous" className="flex items-center gap-2 rounded-md border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"><ArrowLeft size={15} /> Previous</button><button onClick={() => current === test.questions.length - 1 ? setShowConfirm(true) : setCurrent((value) => value + 1)} data-testid="button-next" className="flex items-center gap-2 rounded-md bg-[#182436] px-5 py-2.5 text-xs font-bold text-white hover:bg-[#25354a]">{current === test.questions.length - 1 ? 'Review & submit' : 'Save & next'} <ArrowRight size={15} /></button></div></section><aside className={`${showPalette ? 'block' : 'hidden'} border-l border-slate-200 bg-[#f6f8f9] p-5 lg:block`}><div className="sticky top-[92px]"><div className="mb-5 flex items-center justify-between"><div><p className="text-sm font-bold text-[#182436]">Question palette</p><p className="mt-1 text-xs text-slate-400">{Object.keys(answers).length} answered · {marked.length} marked</p></div><Grid2X2 size={17} className="text-[#159c8d]" /></div><div className="mb-6 grid grid-cols-5 gap-2">{test.questions.map((item, index) => <button key={item.id} onClick={() => setCurrent(index)} data-testid={`button-palette-${index + 1}`} className={`relative h-9 rounded-md border text-xs font-bold ${current === index ? 'border-[#182436] bg-[#182436] text-white' : marked.includes(item.id) ? 'border-[#e6ad4e] bg-[#fff3d9] text-[#a66c0a]' : answers[item.id] !== undefined ? 'border-[#48bfae] bg-[#dff6f1] text-[#117e71]' : 'border-slate-200 bg-white text-slate-500'}`}>{index + 1}{marked.includes(item.id) && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-[#e6ad4e]" />}</button>)}</div><div className="space-y-2 border-t border-slate-200 pt-5 text-xs text-slate-500"><Legend color="bg-[#dff6f1]" label="Answered" /><Legend color="bg-[#fff3d9]" label="Marked for review" /><Legend color="bg-white" label="Not visited" /></div><div className="mt-8 rounded-lg border border-[#cfeae5] bg-[#e7f8f5] p-4"><div className="flex gap-2 text-[#117e71]"><ShieldCheck size={16} /><p className="text-xs font-semibold">Your session is secure</p></div><p className="mt-2 text-[11px] leading-5 text-slate-500">Answers are sent only once, when you submit the paper.</p></div></div></aside></main>{showConfirm && <SubmitDialog total={test.questions.length} answered={Object.keys(answers).length} pending={submit.isPending} error={submitError} onCancel={() => setShowConfirm(false)} onSubmit={submitAttempt} />}</div>;
}

function Legend({ color, label }: { color: string; label: string }) { return <div className="flex items-center gap-2"><span className={`h-3 w-3 rounded-sm border border-slate-300 ${color}`} />{label}</div>; }
function SubmitDialog({ total, answered, pending, error, onCancel, onSubmit }: { total: number; answered: number; pending: boolean; error: string; onCancel: () => void; onSubmit: () => void }) {
  return <div className="fixed inset-0 z-50 grid place-items-center bg-[#182436]/60 p-4"><div className="w-full max-w-md rounded-2xl bg-white p-7 shadow-2xl"><div className="mb-5 flex items-start justify-between"><div className="grid h-11 w-11 place-items-center rounded-xl bg-[#fff3d9] text-[#a66c0a]"><Flag size={21} /></div><button onClick={onCancel} data-testid="button-close-submit-dialog" className="rounded-md p-2 text-slate-400 hover:bg-slate-100"><X size={18} /></button></div><h2 className="text-xl font-bold text-[#182436]">Submit this attempt?</h2><p className="mt-2 text-sm leading-6 text-slate-500">You have answered <b className="text-[#182436]">{answered}</b> of {total} questions. You cannot edit answers after submitting.</p>{error && <p className="mt-4 rounded-md bg-[#fff0ee] p-3 text-xs text-[#c55048]" data-testid="status-submit-error">{error}</p>}<div className="mt-7 flex gap-3"><button onClick={onCancel} data-testid="button-continue-test" className="flex-1 rounded-lg border border-slate-200 py-3 text-sm font-bold text-slate-600">Continue test</button><button onClick={onSubmit} disabled={pending} data-testid="button-confirm-submit" className="flex-1 rounded-lg bg-[#ef776d] py-3 text-sm font-bold text-white disabled:opacity-60">{pending ? 'Submitting…' : 'Submit attempt'}</button></div></div></div>;
}

function ResultPage() {
  const [, setLocation] = useLocation();
  const [result, setResult] = useState<LearnerResult | null>(null);
  useEffect(() => { try { const raw = localStorage.getItem('testbook:last-result'); if (raw) setResult(JSON.parse(raw)); } catch { setResult(null); } }, []);
  if (!result) return <StateCard kind="empty" title="No completed attempt yet" detail="Submit a mock test to unlock your detailed performance report." action={<button onClick={() => setLocation('/')} data-testid="button-back-to-test" className="mt-7 rounded-lg bg-[#182436] px-5 py-3 text-sm font-bold text-white">Back to test</button>} />;
  const scorePercent = result.maxScore ? Math.round((result.score / result.maxScore) * 100) : 0;
  return <div className="min-h-[100dvh] bg-[#eef3f5]"><Header /><main className="mx-auto max-w-[1240px] px-4 py-8 sm:px-7 lg:py-12"><div className="mb-8 flex flex-wrap items-end justify-between gap-4"><div><Link href="/" data-testid="link-result-back" className="mb-5 flex items-center gap-2 text-xs font-semibold text-[#159c8d]"><ArrowLeft size={14} /> Back to test library</Link><p className="text-xs font-bold uppercase tracking-[.18em] text-[#159c8d]">Attempt complete</p><h1 className="mt-2 text-3xl font-bold tracking-tight text-[#182436] sm:text-4xl" data-testid="text-result-title">{result.testName}</h1><p className="mt-2 text-sm text-slate-500">Your paper has been evaluated. Here is the honest read.</p></div><button onClick={() => setLocation('/')} data-testid="button-retake-test" className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50"><RotateCcw size={14} /> Retake test</button></div><section className="grid gap-4 md:grid-cols-[1.1fr_.9fr]"><div className="relative overflow-hidden rounded-2xl bg-[#182436] p-7 text-white sm:p-9"><div className="absolute -right-8 -top-12 text-[#48d5c2]/15"><Award size={210} strokeWidth={1} /></div><div className="relative"><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.15em] text-[#48d5c2]"><CheckCircle2 size={15} /> Scorecard</div><div className="mt-5 flex items-end gap-3"><span className="number-font text-6xl font-bold tracking-tight" data-testid="text-score">{result.score}</span><span className="mb-2 text-lg text-slate-400">/ {result.maxScore}</span></div><div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-700"><div className="h-full rounded-full bg-[#48d5c2]" style={{ width: `${Math.max(0, Math.min(100, scorePercent))}%` }} /></div><p className="mt-3 text-xs text-slate-400">{scorePercent}% of maximum score · Attempt #{result.attemptId}</p></div></div><div className="grid grid-cols-2 gap-3">{[['Attempted', result.attempted, 'text-[#159c8d]'], ['Correct', result.correct, 'text-[#159c8d]'], ['Incorrect', result.incorrect, 'text-[#ef776d]'], ['Skipped', result.skipped, 'text-[#a66c0a]']].map(([label, value, color]) => <div key={String(label)} className="rounded-xl border border-slate-200 bg-white p-5"><p className="text-xs text-slate-400">{label}</p><p className={`number-font mt-3 text-3xl font-bold ${color}`} data-testid={`text-result-${String(label).toLowerCase()}`}>{value}</p><p className="mt-1 text-[11px] text-slate-400">{label === 'Attempted' ? `${result.totalQuestions} total questions` : 'in this attempt'}</p></div>)}</div></section><section className="mt-5 grid gap-5 lg:grid-cols-[1.2fr_.8fr]"><div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8"><div className="mb-7 flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[.15em] text-slate-400">Section report</p><h2 className="mt-1 text-xl font-bold text-[#182436]">Where your marks moved</h2></div><BarChart3 className="text-[#159c8d]" size={22} /></div><div className="space-y-5">{result.sections?.map((section) => <div key={section.name} data-testid={`row-section-${section.name.replaceAll(' ', '-').toLowerCase()}`}><div className="mb-2 flex items-center justify-between text-sm"><span className="font-semibold text-slate-600">{section.name}</span><span className="number-font text-xs text-slate-500">{section.correct}/{section.attempted} correct</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-[#48bfae]" style={{ width: `${section.attempted ? Math.round((section.correct / section.attempted) * 100) : 0}%` }} /></div><div className="mt-2 flex gap-4 text-[11px] text-slate-400"><span>Score {section.score}</span><span>{section.incorrect} incorrect</span></div></div>)}</div></div><div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8"><p className="text-xs font-bold uppercase tracking-[.15em] text-slate-400">Signal</p><h2 className="mt-1 text-xl font-bold text-[#182436]">Your exam pulse</h2><div className="mt-7 space-y-5"><Pulse label="Accuracy" value={`${result.accuracy}%`} icon={<Target size={16} />} /><Pulse label="Rank percentile" value={`${result.rankPercentile}%`} icon={<Zap size={16} />} /><Pulse label="Attempt quality" value={result.incorrect <= result.correct ? 'On track' : 'Needs review'} icon={<ShieldCheck size={16} />} /></div><div className="mt-8 rounded-xl bg-[#e7f8f5] p-4"><p className="text-xs font-bold text-[#117e71]">Next move</p><p className="mt-1 text-xs leading-5 text-slate-600">Review every incorrect response before starting another paper. Accuracy compounds faster than speed.</p></div></div></section></main></div>;
}

function Pulse({ label, value, icon }: { label: string; value: string; icon: ReactNode }) { return <div className="flex items-center justify-between border-b border-slate-100 pb-4"><span className="flex items-center gap-2 text-sm text-slate-500">{icon}{label}</span><span className="number-font text-sm font-bold text-[#182436]" data-testid={`text-pulse-${label.toLowerCase().replace(' ', '-')}`}>{value}</span></div>; }

function Router() { return <Switch><Route path="/" component={HomePage} /><Route path="/result" component={ResultPage} /><Route path="/not-found" component={NotFound} /><Route component={NotFound} /></Switch>; }
function App() { return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>; }
export default App;
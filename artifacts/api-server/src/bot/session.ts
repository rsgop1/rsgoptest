import type { QuestionData } from "@workspace/db";

export interface QuizSession {
  testId: string;
  testName: string;
  questions: QuestionData[];
  currentIndex: number;
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
  userAnswers: (number | null)[];
  pollMessageIds: number[];
  wrongQuestionIds: Array<{ testId: string; questionIndex: number }>;
  currentPollMessageId?: number;
  currentPollId?: string;
  timer?: ReturnType<typeof setTimeout>;
  questionSentAt?: number;
  cheatWarnings: number;
  timerSeconds: number;
  consecutiveCorrect: number;
  isLiveTest?: boolean;
  liveTestId?: number;
}

export interface SolutionSession {
  testId: string;
  testName: string;
  questions: QuestionData[];
  userAnswers: (number | null)[];
  currentIndex: number;
  attemptId?: number;
}

export interface AdSession {
  testId: string;
  adMessageId: number;
  skipTimer?: ReturnType<typeof setTimeout>;
}

export interface PendingUpiPayment {
  testId?: string;
  isPremium: boolean;
  amount: number;
  originalAmount?: number;
  couponCode?: string;
  cartAbandonTimer?: ReturnType<typeof setTimeout>;
}

export interface PendingCoupon {
  testId?: string;
  isPremium: boolean;
  originalInr: number;
  originalStars: number;
}

export interface PendingReport {
  testId: string;
  questionIndex: number;
  questionText: string;
  userAnswer: number | null;
  correctAnswer: number;
  step: "awaiting_text";
}

export interface UserSession {
  onboardingStep: "idle" | "awaiting_subcategory";
  pendingCategory?: string;
  quiz?: QuizSession;
  solution?: SolutionSession;
  pendingUpiPayment?: PendingUpiPayment;
  pendingAd?: AdSession;
  pendingReport?: PendingReport;
  pendingAnonDoubt?: boolean;
  pendingTimerSelect?: string;
  pendingPractice?: {
    testId: string;
    startQuestion?: number;
    timerSeconds?: number;
    totalQuestions: number;
    awaiting: "start" | "count";
  };
  pendingCustomPractice?: {
    setId: number;
    startQuestion?: number;
    timerSeconds?: number;
    totalQuestions: number;
    awaiting: "start" | "count";
  };
  pendingFileIdMode?: boolean;
  pendingCustomTest?: {
    step: "awaiting_language" | "awaiting_count" | "awaiting_pdf";
    language?: "en" | "hi";
    questionCount?: number;
  };
  pendingCoupon?: PendingCoupon;
  awaitingCouponInput?: boolean;
  pendingPypTestId?: string;
  pendingSupportTicket?: {
    category: string;
    step: "awaiting_description";
  };
  pendingAiTutor?: boolean;
  agenticActive?: boolean;
  agenticMessageIds?: number[];
}

const sessions = new Map<number, UserSession>();

export function getSession(userId: number): UserSession {
  if (!sessions.has(userId)) {
    sessions.set(userId, { onboardingStep: "idle" });
  }
  return sessions.get(userId)!;
}

export function updateSession(userId: number, data: Partial<UserSession>): void {
  const current = getSession(userId);
  sessions.set(userId, { ...current, ...data });
}

export function clearQuiz(userId: number): void {
  const s = getSession(userId);
  if (s.quiz?.timer) clearTimeout(s.quiz.timer);
  if (s.pendingAd?.skipTimer) clearTimeout(s.pendingAd.skipTimer);
  updateSession(userId, { quiz: undefined, pendingAd: undefined });
}

export function clearSolution(userId: number): void {
  updateSession(userId, { solution: undefined });
}

export function clearAgenticSession(userId: number): void {
  updateSession(userId, { agenticActive: false, agenticMessageIds: undefined, pendingAiTutor: false });
}

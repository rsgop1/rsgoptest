import type { QuestionData } from "@workspace/db";

export interface QuizSession {
  testId: string;
  testName: string;
  questions: QuestionData[];
  currentIndex: number;
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
  wrongQuestionIds: Array<{ testId: string; questionIndex: number }>;
  currentPollMessageId?: number;
  currentPollId?: string;
  timer?: ReturnType<typeof setTimeout>;
  questionSentAt?: number;
  cheatWarnings: number;
}

export interface SolutionSession {
  testId: string;
  testName: string;
  questions: QuestionData[];
  userAnswers: (number | null)[];
  currentIndex: number;
}

export interface PendingUpiPayment {
  testId?: string;
  isPremium: boolean;
  amount: number;
}

export interface UserSession {
  onboardingStep: "idle" | "awaiting_subcategory";
  pendingCategory?: string;
  quiz?: QuizSession;
  solution?: SolutionSession;
  pendingUpiPayment?: PendingUpiPayment;
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
  updateSession(userId, { quiz: undefined });
}

export function clearSolution(userId: number): void {
  updateSession(userId, { solution: undefined });
}

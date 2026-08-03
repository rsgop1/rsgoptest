import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronLeft, ChevronRight, CircleAlert, Gauge, Target, Users } from "lucide-react";

type QuestionMetric = {
  index: number;
  id: string;
  question: string;
  options: string[];
  correctOptionIndex: number;
  explanation: string;
  attempts: number;
  answered: number;
  skipped: number;
  correct: number;
  wrong: number;
  accuracy: number;
  skipRate: number;
  discrimination: number;
  difficulty: string;
  optionDistribution: Array<{ optionIndex: number; option: string; count: number; percentage: number; isCorrect: boolean }>;
};

type Props = {
  questions?: QuestionMetric[];
  insights?: {
    questionsTracked: number;
    averageQuestionAccuracy: number;
    highSkipQuestions: number;
    hardQuestions: number;
  };
  totalAttempts?: number;
};

function Metric({ label, value, tone = "default" }: { label: string; value: string | number; tone?: "default" | "green" | "red" | "amber" }) {
  const color = tone === "green" ? "text-emerald-600" : tone === "red" ? "text-red-600" : tone === "amber" ? "text-amber-600" : "text-foreground";
  return <div className="rounded-lg border bg-card p-3"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className={`mt-1 text-xl font-bold ${color}`}>{value}</p></div>;
}

export function QuestionAnalyticsPanel({ questions = [], insights, totalAttempts = 0 }: Props) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [sortMode, setSortMode] = useState<"sequence" | "hardest" | "skipped">("sequence");
  const ordered = useMemo(() => {
    if (sortMode === "hardest") return [...questions].sort((a, b) => a.accuracy - b.accuracy);
    if (sortMode === "skipped") return [...questions].sort((a, b) => b.skipRate - a.skipRate);
    return questions;
  }, [questions, sortMode]);
  const question = ordered[selectedIndex];

  if (!questions.length) return <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Question analytics will appear after users submit attempts.</div>;

  const go = (delta: number) => setSelectedIndex((current) => Math.max(0, Math.min(ordered.length - 1, current + delta)));
  const difficultyTone = question.difficulty === "Easy" ? "bg-emerald-100 text-emerald-700" : question.difficulty === "Moderate" ? "bg-blue-100 text-blue-700" : "bg-red-100 text-red-700";

  return <div className="space-y-4">
    {insights && <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Metric label="Questions tracked" value={`${insights.questionsTracked}/${questions.length}`} />
      <Metric label="Avg question accuracy" value={`${insights.averageQuestionAccuracy}%`} tone="green" />
      <Metric label="Hard questions" value={insights.hardQuestions} tone="red" />
      <Metric label="High skip rate" value={insights.highSkipQuestions} tone="amber" />
    </div>}

    <Card className="overflow-hidden">
      <CardHeader className="gap-3 border-b bg-muted/20 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Question-wise performance</CardTitle>
          <div className="flex gap-1">
            {(["sequence", "hardest", "skipped"] as const).map((mode) => <Button key={mode} size="sm" variant={sortMode === mode ? "default" : "outline"} onClick={() => { setSortMode(mode); setSelectedIndex(0); }}>{mode === "sequence" ? "All questions" : mode === "hardest" ? "Hardest first" : "Most skipped"}</Button>)}
          </div>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {ordered.map((item, index) => <button key={item.id} onClick={() => setSelectedIndex(index)} className={`flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-xs font-semibold transition ${index === selectedIndex ? "border-primary bg-primary text-primary-foreground" : item.accuracy < 50 ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>{item.index + 1}</button>)}
        </div>
      </CardHeader>
      <CardContent className="space-y-5 p-4 md:p-6">
        <div className="flex items-start justify-between gap-3">
          <div><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Question {question.index + 1} of {questions.length}</p><h3 className="text-lg font-semibold leading-relaxed">{question.question}</h3></div>
          <Badge className={difficultyTone}>{question.difficulty}</Badge>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Metric label="Attempts" value={question.attempts} />
          <Metric label="Answered" value={question.answered} />
          <Metric label="Correct" value={`${question.accuracy}%`} tone="green" />
          <Metric label="Wrong" value={`${question.wrong} (${question.answered ? Math.round(question.wrong / question.answered * 100) : 0}%)`} tone="red" />
          <Metric label="Skipped" value={`${question.skipped} (${question.skipRate}%)`} tone="amber" />
        </div>
        <div className="grid gap-5 lg:grid-cols-[1fr_260px]">
          <div className="space-y-3">
            <h4 className="flex items-center gap-2 text-sm font-semibold"><Target className="h-4 w-4 text-primary" />Option-wise response distribution</h4>
            {question.optionDistribution.map((option) => <div key={option.optionIndex} className={`rounded-lg border p-3 ${option.isCorrect ? "border-emerald-300 bg-emerald-50/50" : ""}`}>
              <div className="mb-2 flex items-start justify-between gap-3 text-sm"><span><b>{String.fromCharCode(65 + option.optionIndex)}.</b> {option.option}{option.isCorrect && <Badge className="ml-2 bg-emerald-600 text-[10px]">Correct answer</Badge>}</span><span className="shrink-0 font-semibold">{option.count} · {option.percentage.toFixed(1)}%</span></div>
              <div className="h-2 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${option.isCorrect ? "bg-emerald-500" : "bg-slate-400"}`} style={{ width: `${Math.min(100, option.percentage)}%` }} /></div>
            </div>)}
          </div>
          <div className="space-y-3">
            <h4 className="flex items-center gap-2 text-sm font-semibold"><Gauge className="h-4 w-4 text-primary" />Diagnostic signals</h4>
            <div className="rounded-lg border p-3 text-sm"><p className="text-muted-foreground">Discrimination index</p><p className={`mt-1 text-2xl font-bold ${question.discrimination >= 20 ? "text-emerald-600" : question.discrimination < 0 ? "text-red-600" : "text-amber-600"}`}>{question.discrimination}%</p><p className="mt-1 text-xs text-muted-foreground">Top performers accuracy minus bottom performers accuracy</p></div>
            <div className="rounded-lg border p-3 text-sm"><p className="text-muted-foreground">Correct option</p><p className="mt-1 font-semibold">{String.fromCharCode(65 + question.correctOptionIndex)} · {question.options[question.correctOptionIndex]}</p></div>
            {question.skipRate >= 25 && <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"><CircleAlert className="h-4 w-4 shrink-0" />High skip rate: review wording, timer, or difficulty.</div>}
          </div>
        </div>
        <div className="rounded-lg border bg-muted/20 p-4"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Official solution</p><p className="whitespace-pre-wrap text-sm leading-relaxed">{question.explanation || "No explanation added for this question."}</p></div>
        <div className="flex items-center justify-between border-t pt-4"><Button variant="outline" size="sm" disabled={selectedIndex === 0} onClick={() => go(-1)}><ChevronLeft className="mr-1 h-4 w-4" />Previous</Button><span className="flex items-center gap-1 text-xs text-muted-foreground"><Users className="h-3.5 w-3.5" />Based on {totalAttempts} total attempts</span><Button variant="outline" size="sm" disabled={selectedIndex === ordered.length - 1} onClick={() => go(1)}>Next<ChevronRight className="ml-1 h-4 w-4" /></Button></div>
      </CardContent>
    </Card>
  </div>;
}
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAdminListTests } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart2, Users, Target, Trophy, TrendingUp, Brain, RefreshCw, Play, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QuestionAnalyticsPanel } from "@/components/question-analytics-panel";

interface AnalyticsData {
  testId: string;
  testName: string;
  totalAttempts: number;
  avgScore: number;
  avgAccuracy: number;
  bestScore: number;
  topScorers: Array<{ userId: number; score: number; name: string }>;
  scoreDistribution: Array<{ range: string; count: number }>;
  questions?: any[];
  insights?: any;
}

function useTestAnalytics(testId: string | null) {
  return useQuery<AnalyticsData>({
    queryKey: ["admin", "analytics", testId],
    queryFn: async () => {
      const resp = await fetch(`/api/admin/tests/${testId}/analytics`, { credentials: "include" });
      if (!resp.ok) throw new Error("Failed to load analytics");
      return resp.json();
    },
    enabled: !!testId,
  });
}

function useQuestionAnalytics(testId: string | null) {
  return useQuery<any>({
    queryKey: ["admin", "question-analytics", testId],
    queryFn: async () => {
      const response = await fetch(`/api/admin/tests/${testId}/question-analytics`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load question analytics");
      return response.json();
    },
    enabled: !!testId,
  });
}

function StatCard({ icon: Icon, label, value, sub }: {
  icon: React.ElementType; label: string; value: string | number; sub?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold">{value}</p>
            {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DistributionBar({ label, count, max }: { label: string; count: number; max: number }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm w-16 shrink-0 text-muted-foreground">{label}</span>
      <div className="flex-1 bg-muted rounded-full h-3 overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-sm font-medium w-8 text-right">{count}</span>
    </div>
  );
}

function AgenticAnalysisMonitor() {
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  const loadStatus = async () => {
    try {
      const response = await fetch("/api/admin/agentic-analysis/status", { credentials: "include" });
      if (!response.ok) throw new Error("Unable to load Agentic status");
      setStatus(await response.json());
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load Agentic status");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStatus();
    const timer = window.setInterval(() => void loadStatus(), 15000);
    return () => window.clearInterval(timer);
  }, []);

  const runNow = async () => {
    setRunning(true);
    try {
      const response = await fetch("/api/admin/agentic-analysis/run", {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Agentic run failed");
      setStatus(await response.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Agentic run failed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card className="border-violet-200 bg-gradient-to-br from-violet-50/80 via-background to-background">
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-violet-600 p-2 text-white"><Brain className="h-5 w-5" /></div>
            <div>
              <CardTitle className="text-base">Agentic Intelligence Monitor</CardTitle>
              <p className="text-sm text-muted-foreground">On-demand Gemini analysis for active test sets. Completed sets are skipped on later runs.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void loadStatus()} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
            <Button size="sm" onClick={() => void runNow()} disabled={running || status?.running}><Play className="mr-2 h-4 w-4" />{running ? "Running…" : "Run now"}</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertTriangle className="h-4 w-4" />{error}</div>}
        {loading && !status ? <Skeleton className="h-24 w-full" /> : status && (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
              <div className="rounded-lg border bg-background p-3"><p className="text-xs text-muted-foreground">Worker</p><p className="mt-1 font-semibold">{status.running ? "Running" : "Idle"}</p></div>
              <div className="rounded-lg border bg-background p-3"><p className="text-xs text-muted-foreground">Active sets</p><p className="mt-1 text-xl font-bold">{status.activeSets}</p></div>
              <div className="rounded-lg border bg-background p-3"><p className="text-xs text-muted-foreground">Indexed sets</p><p className="mt-1 text-xl font-bold">{status.analyzedSets}</p></div>
              <div className="rounded-lg border bg-background p-3"><p className="text-xs text-muted-foreground">Pending sets</p><p className="mt-1 text-xl font-bold">{status.pendingSets}</p></div>
              <div className="rounded-lg border bg-background p-3"><p className="text-xs text-muted-foreground">Indexed questions</p><p className="mt-1 text-xl font-bold">{status.analyzedQuestions}</p></div>
              <div className="rounded-lg border bg-background p-3"><p className="text-xs text-muted-foreground">Last completed</p><p className="mt-1 text-sm font-semibold">{status.lastCompletedAt ? new Date(status.lastCompletedAt).toLocaleTimeString() : "Not yet"}</p></div>
            </div>
            {status.lastError && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Last worker warning: {status.lastError}</div>}
            {!status.sets?.length ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No set intelligence indexed yet. Run the worker to analyze active published sets.</div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold"><CheckCircle2 className="h-4 w-4 text-emerald-600" />Set and question intelligence</div>
                {status.sets.map((set: any) => (
                  <details key={set.testId} className="rounded-lg border bg-background p-4">
                    <summary className="cursor-pointer list-none">
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div><p className="font-semibold">{set.testId}</p><p className="text-sm text-muted-foreground">{set.focus}</p></div>
                        <div className="flex flex-wrap gap-2 text-xs"><Badge variant="outline">{set.questionCount} questions</Badge><Badge variant="outline">{set.difficulty}</Badge><Badge variant="outline">{set.updatedAt ? new Date(set.updatedAt).toLocaleString() : "—"}</Badge></div>
                      </div>
                    </summary>
                    <div className="mt-4 space-y-3 border-t pt-3">
                      <div className="flex flex-wrap gap-2">{set.topics?.map((topic: string) => <Badge key={topic}>{topic}</Badge>)}</div>
                      <div className="max-h-72 space-y-2 overflow-auto">
                        {set.questions?.map((question: any, index: number) => (
                          <div key={`${set.testId}-${index}`} className="rounded-md border p-3 text-sm">
                            <div className="flex justify-between gap-3"><span className="font-medium">Q{index + 1} · {question.question || "Question insight"}</span><Badge variant="outline">{question.difficulty}</Badge></div>
                            <p className="mt-1 text-muted-foreground">{question.focus}</p>
                            <p className="mt-1 text-xs text-violet-700">{question.topics?.join(" · ")}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </details>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function Analytics() {
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null);
  const { data: tests, isLoading: testsLoading } = useAdminListTests();
  const { data: analytics, isLoading: analyticsLoading } = useTestAnalytics(selectedTestId);
  const { data: questionAnalytics, isLoading: questionAnalyticsLoading } = useQuestionAnalytics(selectedTestId);

  const maxDist = analytics ? Math.max(...analytics.scoreDistribution.map(d => d.count), 1) : 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Test Analytics</h1>
          <p className="text-muted-foreground mt-1">Performance insights for each test series.</p>
        </div>
        <Select value={selectedTestId ?? ""} onValueChange={setSelectedTestId}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder="Select a test to analyze…" />
          </SelectTrigger>
          <SelectContent>
            {testsLoading ? (
              <SelectItem value="loading" disabled>Loading tests…</SelectItem>
            ) : tests?.map(t => (
              <SelectItem key={t.testId} value={t.testId}>{t.testName}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <AgenticAnalysisMonitor />

      {!selectedTestId && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <BarChart2 className="h-12 w-12 mb-4 opacity-40" />
            <p className="text-lg font-medium">Select a test to view analytics</p>
            <p className="text-sm">Choose from the dropdown above to see detailed stats.</p>
          </CardContent>
        </Card>
      )}

      {selectedTestId && analyticsLoading && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      )}

      {analytics && !analyticsLoading && (
        <>
          <div>
            <h2 className="text-lg font-semibold mb-3">{analytics.testName}</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard icon={Users} label="Total Attempts" value={analytics.totalAttempts} />
              <StatCard icon={Target} label="Avg Score" value={analytics.avgScore} sub="points" />
              <StatCard icon={TrendingUp} label="Avg Accuracy" value={`${analytics.avgAccuracy}%`} />
              <StatCard icon={Trophy} label="Best Score" value={analytics.bestScore} sub="points" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Score Distribution</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {analytics.totalAttempts === 0 ? (
                  <p className="text-muted-foreground text-sm text-center py-4">No attempts yet</p>
                ) : (
                  analytics.scoreDistribution.map(d => (
                    <DistributionBar key={d.range} label={d.range} count={d.count} max={maxDist} />
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top Scorers</CardTitle>
              </CardHeader>
              <CardContent>
                {!analytics.topScorers.length ? (
                  <p className="text-muted-foreground text-sm text-center py-4">No attempts yet</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Rank</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead className="text-right">Score</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {analytics.topScorers.map((s, i) => (
                        <TableRow key={s.userId}>
                          <TableCell>
                            <Badge variant={i === 0 ? "default" : "outline"}>
                              {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-medium">{s.name}</TableCell>
                          <TableCell className="text-right font-bold">{s.score}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Advanced question analysis</CardTitle>
              <p className="text-sm text-muted-foreground">Real option-level performance from saved user answers.</p>
            </CardHeader>
            <CardContent>
              {questionAnalyticsLoading ? <Skeleton className="h-48 w-full" /> : <QuestionAnalyticsPanel questions={questionAnalytics?.questions} insights={questionAnalytics?.insights} totalAttempts={questionAnalytics?.totalAttempts ?? analytics.totalAttempts} />}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAdminListTests } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart2, Users, Target, Trophy, TrendingUp } from "lucide-react";

interface AnalyticsData {
  testId: string;
  testName: string;
  totalAttempts: number;
  avgScore: number;
  avgAccuracy: number;
  bestScore: number;
  topScorers: Array<{ userId: number; score: number; name: string }>;
  scoreDistribution: Array<{ range: string; count: number }>;
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

export default function Analytics() {
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null);
  const { data: tests, isLoading: testsLoading } = useAdminListTests();
  const { data: analytics, isLoading: analyticsLoading } = useTestAnalytics(selectedTestId);

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
        </>
      )}
    </div>
  );
}

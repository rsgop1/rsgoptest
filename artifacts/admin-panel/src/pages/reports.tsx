import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { 
  CheckCircle2, 
  Trash2, 
  Search,
  Filter,
  Inbox,
  Clock,
  CheckSquare,
  AlertCircle,
  FileText,
  User,
  MessagesSquare,
  XCircle,
  Activity
} from "lucide-react";
import { toast } from "sonner";
import { format, differenceInHours } from "date-fns";

interface Report {
  id: number;
  userId: number;
  testId: string;
  questionIndex: number;
  questionText: string;
  userAnswer: number | null;
  correctAnswer: number;
  reportText: string;
  status: "open" | "resolved";
  adminNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

const BASE = "/api/admin";

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error((err as any).error ?? "Request failed");
  }
  return res.json();
}

// Derive priority heuristically since API doesn't have it natively
function derivePriority(r: Report): "high" | "normal" {
  const text = r.reportText.toLowerCase();
  if (text.includes("urgent") || text.includes("error") || text.includes("wrong") || text.includes("broken")) {
    return "high";
  }
  return "normal";
}

export default function Reports() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<"open" | "resolved" | "all">("open");
  const [priorityFilter, setPriorityFilter] = useState<"all" | "high" | "normal">("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all"); // testId
  const [searchQuery, setSearchQuery] = useState("");
  
  const [selectedReportId, setSelectedReportId] = useState<number | null>(null);
  const [adminNote, setAdminNote] = useState("");

  const { data: allReports = [], isLoading } = useQuery<Report[]>({
    queryKey: ["admin-reports", statusFilter],
    queryFn: () => apiFetch(`/reports?status=${statusFilter}`),
    refetchInterval: 30000,
  });

  const resolveMut = useMutation({
    mutationFn: ({ id, note }: { id: number; note: string }) =>
      apiFetch(`/reports/${id}/resolve`, {
        method: "PATCH",
        body: JSON.stringify({ adminNote: note }),
      }),
    onSuccess: () => {
      toast.success("Ticket resolved & user notified");
      qc.invalidateQueries({ queryKey: ["admin-reports"] });
      setSelectedReportId(null);
      setAdminNote("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/reports/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Ticket deleted");
      qc.invalidateQueries({ queryKey: ["admin-reports"] });
      setSelectedReportId(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Client-side filtering & derived stats
  const { filteredReports, stats, categories } = useMemo(() => {
    let openCount = 0;
    let resolvedCount = 0;
    let highPriorityCount = 0;
    const catSet = new Set<string>();

    allReports.forEach(r => {
      catSet.add(r.testId);
      if (r.status === "open") openCount++;
      if (r.status === "resolved") resolvedCount++;
      if (derivePriority(r) === "high" && r.status === "open") highPriorityCount++;
    });

    const filtered = allReports.filter(r => {
      if (priorityFilter !== "all" && derivePriority(r) !== priorityFilter) return false;
      if (categoryFilter !== "all" && r.testId !== categoryFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          r.id.toString().includes(q) ||
          r.userId.toString().includes(q) ||
          r.reportText.toLowerCase().includes(q) ||
          r.questionText.toLowerCase().includes(q)
        );
      }
      return true;
    });

    return {
      filteredReports: filtered,
      stats: { openCount, resolvedCount, highPriorityCount },
      categories: Array.from(catSet).sort()
    };
  }, [allReports, priorityFilter, categoryFilter, searchQuery]);

  const selectedReport = allReports.find(r => r.id === selectedReportId);

  return (
    <div className="flex flex-col h-full space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Support Tickets</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage user-reported content issues and platform anomalies.
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="shadow-sm">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Inbox className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Open Tickets</p>
              <h3 className="text-2xl font-bold tracking-tight">{stats.openCount}</h3>
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center shrink-0">
              <CheckSquare className="h-6 w-6 text-green-600 dark:text-green-500" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Resolved</p>
              <h3 className="text-2xl font-bold tracking-tight">{stats.resolvedCount}</h3>
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
              <AlertCircle className="h-6 w-6 text-destructive" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">High Priority</p>
              <h3 className="text-2xl font-bold tracking-tight">{stats.highPriorityCount}</h3>
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-orange-500/10 flex items-center justify-center shrink-0">
              <Activity className="h-6 w-6 text-orange-600 dark:text-orange-500" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Total Processed</p>
              <h3 className="text-2xl font-bold tracking-tight">{allReports.length}</h3>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Toolbar */}
      <Card className="shadow-sm overflow-hidden">
        <div className="p-3 bg-muted/40 border-b flex flex-col sm:flex-row items-center gap-3">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by Ticket ID, User ID, or content..."
              className="pl-9 w-full bg-background border-muted-foreground/20"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="flex items-center gap-2 bg-background border border-muted-foreground/20 rounded-md px-2 py-1">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
                <SelectTrigger className="h-7 w-[110px] border-0 bg-transparent p-0 focus:ring-0 shadow-none font-medium text-sm">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="all">All Status</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <Select value={priorityFilter} onValueChange={(v: any) => setPriorityFilter(v)}>
              <SelectTrigger className="h-9 w-[120px] border-muted-foreground/20 font-medium text-sm">
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priorities</SelectItem>
                <SelectItem value="high">High Priority</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
              </SelectContent>
            </Select>

            <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v)}>
              <SelectTrigger className="h-9 w-[140px] border-muted-foreground/20 font-medium text-sm">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map(c => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-muted-foreground uppercase bg-muted/20 border-b">
              <tr>
                <th className="px-4 py-3 font-semibold">Ticket</th>
                <th className="px-4 py-3 font-semibold">User</th>
                <th className="px-4 py-3 font-semibold">Test / Q#</th>
                <th className="px-4 py-3 font-semibold">Priority</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Submitted</th>
              </tr>
            </thead>
            <tbody className="divide-y border-b-0">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-muted-foreground">
                    <div className="flex flex-col items-center justify-center">
                      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mb-2"></div>
                      Loading tickets...
                    </div>
                  </td>
                </tr>
              ) : filteredReports.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-12 text-center text-muted-foreground">
                    <Inbox className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
                    <p className="font-medium text-base text-foreground">No tickets found</p>
                    <p className="text-sm mt-1">Try adjusting your filters or search query.</p>
                  </td>
                </tr>
              ) : (
                filteredReports.map((r) => {
                  const prio = derivePriority(r);
                  return (
                    <tr 
                      key={r.id} 
                      onClick={() => { setSelectedReportId(r.id); setAdminNote(r.adminNote || ""); }}
                      className="hover:bg-muted/30 cursor-pointer transition-colors group"
                    >
                      <td className="px-4 py-3 font-medium text-foreground">
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground/50 text-xs">#{r.id}</span>
                          <span className="line-clamp-1 max-w-[200px]">{r.reportText}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <User className="h-3.5 w-3.5" />
                          {r.userId}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="font-mono text-[10px] bg-muted/20 text-muted-foreground">
                          {r.testId} / Q{r.questionIndex + 1}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        {prio === "high" ? (
                          <span className="flex items-center gap-1 text-destructive text-xs font-semibold">
                            <AlertCircle className="h-3.5 w-3.5" /> High
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs font-medium">Normal</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {r.status === "open" ? (
                          <Badge variant="secondary" className="bg-orange-500/10 text-orange-600 hover:bg-orange-500/20 border-orange-500/20">Open</Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-green-500/10 text-green-600 hover:bg-green-500/20 border-green-500/20">Resolved</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">
                        {format(new Date(r.createdAt), "MMM d, HH:mm")}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Detail Slide-out Sheet */}
      <Sheet open={!!selectedReportId} onOpenChange={(o) => !o && setSelectedReportId(null)}>
        <SheetContent className="w-full sm:max-w-[480px] p-0 flex flex-col h-full bg-card border-l">
          {selectedReport && (
            <>
              <div className="flex-1 overflow-y-auto">
                <div className="p-6 border-b bg-muted/10">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="font-mono bg-background text-muted-foreground">
                          Ticket #{selectedReport.id}
                        </Badge>
                        {selectedReport.status === "open" ? (
                          <Badge variant="secondary" className="bg-orange-500/10 text-orange-600 border-orange-500/20">Open</Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-green-500/10 text-green-600 border-green-500/20">Resolved</Badge>
                        )}
                        {derivePriority(selectedReport) === "high" && (
                          <Badge variant="destructive" className="bg-destructive/10 text-destructive border-destructive/20 shadow-none">High Priority</Badge>
                        )}
                      </div>
                      <h2 className="text-lg font-bold mt-2">Issue in {selectedReport.testId}</h2>
                      <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        Opened on {format(new Date(selectedReport.createdAt), "PPp")}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="p-6 space-y-6">
                  {/* User Report */}
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold flex items-center gap-2 text-foreground border-b pb-2">
                      <MessagesSquare className="h-4 w-4 text-primary" /> User Report
                    </h3>
                    <div className="bg-primary/5 p-4 rounded-lg text-sm text-foreground/90 font-medium leading-relaxed">
                      "{selectedReport.reportText}"
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                      Submitted by User ID: <span className="font-mono text-foreground">{selectedReport.userId}</span>
                    </div>
                  </div>

                  {/* Context */}
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold flex items-center gap-2 text-foreground border-b pb-2">
                      <FileText className="h-4 w-4 text-primary" /> Question Context
                    </h3>
                    <div className="bg-muted p-4 rounded-lg">
                      <Badge variant="outline" className="mb-2 bg-background">Question {selectedReport.questionIndex + 1}</Badge>
                      <p className="text-sm text-foreground/90 font-medium mt-1 leading-relaxed">
                        {selectedReport.questionText}
                      </p>
                      <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-border/50">
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">User Answer</p>
                          <div className="text-sm font-semibold flex items-center gap-1">
                            {selectedReport.userAnswer !== null ? (
                              <span className="text-destructive"><XCircle className="h-4 w-4 inline mr-1"/>Option {selectedReport.userAnswer + 1}</span>
                            ) : (
                              <span className="text-muted-foreground">Skipped</span>
                            )}
                          </div>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Correct Answer</p>
                          <div className="text-sm font-semibold text-green-600 dark:text-green-500 flex items-center gap-1">
                            <CheckCircle2 className="h-4 w-4 inline mr-1" /> Option {selectedReport.correctAnswer + 1}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Resolution Input */}
                  {selectedReport.status === "open" ? (
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold flex items-center gap-2 text-foreground border-b pb-2">
                        <CheckSquare className="h-4 w-4 text-primary" /> Resolution
                      </h3>
                      <p className="text-xs text-muted-foreground mb-2">
                        Add a note that will be sent to the user when resolving this ticket.
                      </p>
                      <Textarea
                        placeholder="e.g. Thanks for reporting! The explanation has been updated."
                        value={adminNote}
                        onChange={(e) => setAdminNote(e.target.value)}
                        className="min-h-[100px] resize-none focus-visible:ring-primary/50"
                      />
                    </div>
                  ) : (
                    selectedReport.adminNote && (
                      <div className="space-y-2">
                        <h3 className="text-sm font-semibold flex items-center gap-2 text-foreground border-b pb-2">
                          <CheckSquare className="h-4 w-4 text-primary" /> Resolution Note
                        </h3>
                        <div className="bg-green-500/10 border border-green-500/20 p-4 rounded-lg text-sm text-green-800 dark:text-green-300 font-medium">
                          {selectedReport.adminNote}
                        </div>
                      </div>
                    )
                  )}
                </div>
              </div>

              <div className="p-4 border-t bg-muted/10 flex items-center justify-between shrink-0">
                <Button
                  variant="ghost"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => deleteMut.mutate(selectedReport.id)}
                  disabled={deleteMut.isPending}
                >
                  <Trash2 className="h-4 w-4 mr-2" /> Delete
                </Button>
                
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setSelectedReportId(null)}>
                    Close
                  </Button>
                  {selectedReport.status === "open" && (
                    <Button
                      onClick={() => resolveMut.mutate({ id: selectedReport.id, note: adminNote })}
                      disabled={resolveMut.isPending}
                      className="bg-primary text-primary-foreground hover:bg-primary/90"
                    >
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      Resolve Ticket
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
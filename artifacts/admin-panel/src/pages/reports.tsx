import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle, Trash2, Flag, AlertCircle } from "lucide-react";
import { toast } from "sonner";

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

export default function Reports() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<"open" | "resolved" | "all">("open");
  const [resolveId, setResolveId] = useState<number | null>(null);
  const [adminNote, setAdminNote] = useState("");

  const { data: reports = [], isLoading } = useQuery<Report[]>({
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
      toast.success("Report resolved & user notified!");
      qc.invalidateQueries({ queryKey: ["admin-reports"] });
      setResolveId(null);
      setAdminNote("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/reports/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Report deleted");
      qc.invalidateQueries({ queryKey: ["admin-reports"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const openReports = reports.filter((r) => r.status === "open");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Question Reports</h1>
          <p className="text-muted-foreground text-sm mt-1">
            User-reported issues with questions
          </p>
        </div>
        {openReports.length > 0 && (
          <Badge variant="destructive" className="text-sm px-3 py-1">
            <AlertCircle className="h-3.5 w-3.5 mr-1" />
            {openReports.length} Open
          </Badge>
        )}
      </div>

      <div className="flex gap-3 items-center">
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">
          {reports.length} report{reports.length !== 1 ? "s" : ""}
        </span>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-6 h-32 bg-muted/30" />
            </Card>
          ))}
        </div>
      ) : reports.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Flag className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No {statusFilter !== "all" ? statusFilter : ""} reports</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {reports.map((r) => (
            <Card key={r.id} className={r.status === "open" ? "border-orange-200 dark:border-orange-900" : ""}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={r.status === "open" ? "destructive" : "secondary"}>
                        {r.status}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        Test: {r.testId} · Q{r.questionIndex + 1}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        User: {r.userId}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(r.createdAt).toLocaleString("en-IN")}
                      </span>
                    </div>
                    <p className="text-sm font-medium mt-2 line-clamp-2 text-foreground">
                      {r.questionText}
                    </p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                <div className="bg-muted/50 rounded-lg p-3 text-sm">
                  <p className="text-muted-foreground text-xs mb-1">User Report:</p>
                  <p className="font-medium">{r.reportText}</p>
                </div>
                <div className="flex gap-2 text-xs text-muted-foreground">
                  <span>User answered: Option {r.userAnswer !== null ? r.userAnswer + 1 : "Skipped"}</span>
                  <span>·</span>
                  <span>Correct: Option {r.correctAnswer + 1}</span>
                </div>
                {r.adminNote && (
                  <div className="bg-green-50 dark:bg-green-950 rounded-lg p-3 text-sm">
                    <p className="text-green-700 dark:text-green-300 text-xs mb-1">Admin Note:</p>
                    <p className="text-green-800 dark:text-green-200">{r.adminNote}</p>
                  </div>
                )}
                <div className="flex gap-2 justify-end">
                  {r.status === "open" && (
                    <Button
                      size="sm"
                      onClick={() => { setResolveId(r.id); setAdminNote(""); }}
                    >
                      <CheckCircle className="h-3.5 w-3.5 mr-1" />
                      Resolve
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => deleteMut.mutate(r.id)}
                    disabled={deleteMut.isPending}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={resolveId !== null} onOpenChange={(o) => !o && setResolveId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve Report</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Add an optional note to send to the user when resolving this report:
            </p>
            <Textarea
              placeholder="e.g. The explanation has been updated. Thank you!"
              value={adminNote}
              onChange={(e) => setAdminNote(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveId(null)}>Cancel</Button>
            <Button
              onClick={() => resolveId !== null && resolveMut.mutate({ id: resolveId, note: adminNote })}
              disabled={resolveMut.isPending}
            >
              {resolveMut.isPending ? "Resolving…" : "Resolve & Notify User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

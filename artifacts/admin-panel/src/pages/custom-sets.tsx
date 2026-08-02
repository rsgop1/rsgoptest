import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Trash2, ExternalLink, FileText, Search, RefreshCw, Bot, Eye, Clock3, UserRound, Link2 } from "lucide-react";

interface CustomQuestion {
  id?: string;
  question: string;
  options?: string[];
  correctOptionIndex?: number;
  explanation?: string;
}

interface CustomSet {
  id: number;
  userId: number;
  title: string;
  language: string;
  questionCount: number;
  status: string;
  shareToken: string;
  failReason: string | null;
  sourceFileName: string | null;
  isActive: boolean;
  createdAt: string;
  completedAt: string | null;
  fullName: string | null;
  username: string | null;
  questionsData: CustomQuestion[] | null;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function fetchCustomSets(): Promise<CustomSet[]> {
  const res = await fetch(`${BASE}/api/admin/custom-sets`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch custom sets");
  return res.json();
}

async function deleteCustomSet(id: number): Promise<void> {
  const res = await fetch(`${BASE}/api/admin/custom-sets/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to delete set");
}

export default function CustomSetsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [selectedSet, setSelectedSet] = useState<CustomSet | null>(null);

  const { data: sets = [], isLoading, refetch } = useQuery<CustomSet[]>({
    queryKey: ["admin-custom-sets"],
    queryFn: fetchCustomSets,
    refetchInterval: 15000,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteCustomSet,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-custom-sets"] });
      toast.success("Custom set removed");
      setDeleteId(null);
    },
    onError: () => {
      toast.error("Failed to delete set");
    },
  });

  const filtered = sets.filter((s) => {
    const q = search.toLowerCase();
    return (
      s.title.toLowerCase().includes(q) ||
      (s.fullName ?? "").toLowerCase().includes(q) ||
      (s.username ?? "").toLowerCase().includes(q) ||
      String(s.userId).includes(q)
    );
  });

  const stats = {
    total: sets.length,
    ready: sets.filter((s) => s.status === "ready").length,
    processing: sets.filter((s) => s.status === "processing").length,
    failed: sets.filter((s) => s.status === "failed").length,
  };

  function statusBadge(status: string) {
    if (status === "ready") return <Badge className="bg-green-100 text-green-800 border-green-200">✅ Ready</Badge>;
    if (status === "processing") return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">⏳ Processing</Badge>;
    return <Badge className="bg-red-100 text-red-800 border-red-200">❌ Failed</Badge>;
  }

  const BOT_USERNAME = "gt_testprobot";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bot className="w-6 h-6 text-blue-500" />
            AI Custom Test Sets
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            User-generated test sets created from uploaded PDFs
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
          <RefreshCw className="w-4 h-4" />
          Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-5">
            <div className="text-2xl font-bold text-blue-600">{stats.total}</div>
            <div className="text-sm text-muted-foreground">Total Sets</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="text-2xl font-bold text-green-600">{stats.ready}</div>
            <div className="text-sm text-muted-foreground">Ready</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="text-2xl font-bold text-yellow-600">{stats.processing}</div>
            <div className="text-sm text-muted-foreground">Processing</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="text-2xl font-bold text-red-600">{stats.failed}</div>
            <div className="text-sm text-muted-foreground">Failed</div>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <CardTitle className="text-base">All Custom Sets</CardTitle>
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by title or user…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-8 text-sm"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="text-center py-12 text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No custom sets found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title / File</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead className="text-center">Lang</TableHead>
                    <TableHead className="text-center">Questions</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((s) => {
                    const shareLink = `https://t.me/${BOT_USERNAME}?start=customset_${s.shareToken}`;
                    const created = new Date(s.createdAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" });
                    return (
                      <TableRow key={s.id} className={!s.isActive ? "opacity-40" : undefined}>
                        <TableCell className="max-w-[200px]">
                          <div className="font-medium text-sm truncate">{s.title}</div>
                          {s.sourceFileName && (
                            <div className="text-xs text-muted-foreground truncate">{s.sourceFileName}</div>
                          )}
                          {s.failReason && (
                            <div className="text-xs text-red-500 truncate" title={s.failReason}>
                              {s.failReason.slice(0, 60)}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">{s.fullName ?? "-"}</div>
                          <div className="text-xs text-muted-foreground">
                            {s.username ? `@${s.username}` : `ID: ${s.userId}`}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <span>{s.language === "hi" ? "🇮🇳 HI" : "🇬🇧 EN"}</span>
                        </TableCell>
                        <TableCell className="text-center font-mono">
                          {s.questionCount}
                        </TableCell>
                        <TableCell className="text-center">
                          {statusBadge(s.status)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {created}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {s.status === "ready" && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                title="Open share link"
                                onClick={() => window.open(shareLink, "_blank")}
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              title="View full set details"
                              onClick={() => setSelectedSet(s)}
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50"
                              title="Remove set"
                              onClick={() => setDeleteId(s.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet open={!!selectedSet} onOpenChange={(open) => !open && setSelectedSet(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          {selectedSet && (
            <>
              <SheetHeader>
                <div className="flex items-center gap-2">{statusBadge(selectedSet.status)}<Badge variant="outline">{selectedSet.language === "hi" ? "Hindi" : "English"}</Badge></div>
                <SheetTitle className="mt-2">{selectedSet.title}</SheetTitle>
                <SheetDescription>AI-generated custom test details and question preview</SheetDescription>
              </SheetHeader>
              <div className="space-y-5 py-6">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground flex items-center gap-1"><UserRound className="h-3.5 w-3.5" /> Created by</p><p className="font-semibold mt-1">{selectedSet.fullName || "Unknown user"}</p><p className="text-xs text-muted-foreground">{selectedSet.username ? `@${selectedSet.username}` : `Telegram ID ${selectedSet.userId}`}</p></div>
                  <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" /> Created at</p><p className="font-semibold mt-1">{new Date(selectedSet.createdAt).toLocaleString("en-IN")}</p><p className="text-xs text-muted-foreground">{selectedSet.completedAt ? `Completed ${new Date(selectedSet.completedAt).toLocaleString("en-IN")}` : "Still processing"}</p></div>
                  <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Source PDF</p><p className="font-semibold mt-1 truncate">{selectedSet.sourceFileName || "Not recorded"}</p></div>
                  <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Question count</p><p className="font-semibold mt-1">{selectedSet.questionCount} generated questions</p></div>
                </div>
                {selectedSet.status === "failed" && selectedSet.failReason && <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{selectedSet.failReason}</div>}
                {selectedSet.status === "ready" && (
                  <Button variant="outline" className="w-full" onClick={() => window.open(`https://t.me/${BOT_USERNAME}?start=customset_${selectedSet.shareToken}`, "_blank")}><Link2 className="h-4 w-4 mr-2" />Open share link</Button>
                )}
                <div>
                  <div className="flex items-center justify-between mb-3"><h3 className="font-semibold">Generated questions</h3><Badge variant="secondary">{selectedSet.questionsData?.length ?? 0} available</Badge></div>
                  <div className="space-y-3">
                    {(selectedSet.questionsData ?? []).map((question, index) => (
                      <div key={question.id ?? index} className="rounded-xl border p-4">
                        <p className="text-sm font-semibold">Q{index + 1}. {question.question}</p>
                        {question.options?.length ? <div className="grid gap-1.5 mt-3">{question.options.map((option, optionIndex) => <div key={optionIndex} className={`rounded-md px-3 py-2 text-sm ${question.correctOptionIndex === optionIndex ? "bg-emerald-500/10 text-emerald-700 font-medium" : "bg-muted/50"}`}>{String.fromCharCode(65 + optionIndex)}. {option}{question.correctOptionIndex === optionIndex ? "  Correct" : ""}</div>)}</div> : null}
                        {question.explanation && <p className="text-xs text-muted-foreground mt-3 border-t pt-3"><span className="font-medium">Explanation:</span> {question.explanation}</p>}
                      </div>
                    ))}
                    {!selectedSet.questionsData?.length && <p className="text-sm text-muted-foreground rounded-lg border border-dashed p-6 text-center">Question payload is not available for this set.</p>}
                  </div>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Delete Dialog */}
      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Custom Set</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the test set from the user's profile and disable the share link.
              The user will no longer be able to access it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deleteId !== null && deleteMutation.mutate(deleteId)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

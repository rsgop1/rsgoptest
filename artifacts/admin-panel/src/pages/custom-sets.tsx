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
import { Trash2, ExternalLink, FileText, Search, RefreshCw, Bot } from "lucide-react";

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

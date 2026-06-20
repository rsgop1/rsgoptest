import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Radio, Users, Clock, Calendar, StopCircle, MessageSquare } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

interface LiveTest {
  id: number;
  testId: string;
  title: string;
  scheduledAt: string;
  groupChatId: number | null;
  status: string;
  participantCount: number;
  currentQuestionIndex: number;
  createdAt: string;
}

interface TestSeries {
  testId: string;
  testName: string;
  mainCategory: string;
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

function statusBadge(status: string) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    scheduled: { label: "Scheduled", variant: "outline" },
    notified: { label: "Notified", variant: "default" },
    live: { label: "🔴 LIVE", variant: "destructive" },
    completed: { label: "Completed", variant: "secondary" },
  };
  const cfg = map[status] ?? { label: status, variant: "outline" as const };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

export default function LiveTests() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    testId: "",
    title: "",
    scheduledAt: "",
    groupChatId: "",
  });

  const { data: liveTests = [], isLoading } = useQuery<LiveTest[]>({
    queryKey: ["admin-live-tests"],
    queryFn: () => apiFetch("/live-tests"),
    refetchInterval: 15000,
  });

  const { data: tests = [] } = useQuery<TestSeries[]>({
    queryKey: ["admin-tests-for-live"],
    queryFn: () => apiFetch("/tests"),
  });

  const createMut = useMutation({
    mutationFn: (data: typeof form) =>
      apiFetch("/live-tests", {
        method: "POST",
        body: JSON.stringify({
          testId: data.testId,
          title: data.title,
          scheduledAt: data.scheduledAt,
          groupChatId: data.groupChatId || undefined,
        }),
      }),
    onSuccess: () => {
      toast.success("Live test scheduled! Users will be notified 30 min before.");
      qc.invalidateQueries({ queryKey: ["admin-live-tests"] });
      setShowCreate(false);
      setForm({ testId: "", title: "", scheduledAt: "", groupChatId: "" });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const cancelMut = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/live-tests/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Live test cancelled");
      qc.invalidateQueries({ queryKey: ["admin-live-tests"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const stopMut = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/live-tests/${id}/stop`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Live test stopped — scoreboards sent to all participants");
      qc.invalidateQueries({ queryKey: ["admin-live-tests"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const [msgTarget, setMsgTarget] = useState<number | null>(null);
  const [msgText, setMsgText] = useState("");

  const sendMsgMut = useMutation({
    mutationFn: ({ id, message }: { id: number; message: string }) =>
      apiFetch(`/live-tests/${id}/message`, { method: "POST", body: JSON.stringify({ message }) }),
    onSuccess: () => {
      toast.success("Message sent to all participants!");
      setMsgTarget(null);
      setMsgText("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const upcoming = liveTests.filter((t) => t.status === "scheduled" || t.status === "notified" || t.status === "live");
  const past = liveTests.filter((t) => t.status === "completed");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Live Mock Tests</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Kahoot-style synchronized tests for all users
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Schedule Live Test
        </Button>
      </div>

      {upcoming.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Radio className="h-4 w-4 text-red-500" />
            Upcoming & Live
          </h2>
          {upcoming.map((lt) => (
            <Card key={lt.id} className={lt.status === "live" ? "border-red-300 dark:border-red-800" : ""}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {statusBadge(lt.status)}
                      <span className="font-semibold text-sm">{lt.title}</span>
                    </div>
                    <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5" />
                        {new Date(lt.scheduledAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="h-3.5 w-3.5" />
                        {lt.participantCount} joined
                      </span>
                      {lt.status === "live" && (
                        <span className="flex items-center gap-1 text-red-500">
                          <Clock className="h-3.5 w-3.5" />
                          Q{lt.currentQuestionIndex + 1} in progress
                        </span>
                      )}
                      {lt.groupChatId && (
                        <span className="text-xs">Group: {lt.groupChatId}</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Test ID: {lt.testId}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Send message to all participants"
                      onClick={() => { setMsgTarget(lt.id); setMsgText(""); }}
                    >
                      <MessageSquare className="h-4 w-4 text-blue-500" />
                    </Button>
                    {lt.status === "live" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Force stop live test"
                        className="text-orange-500 hover:text-orange-600"
                        onClick={() => {
                          if (confirm("Force-stop this live test? All participants will get their current scorecard.")) {
                            stopMut.mutate(lt.id);
                          }
                        }}
                        disabled={stopMut.isPending}
                      >
                        <StopCircle className="h-4 w-4" />
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => cancelMut.mutate(lt.id)}
                        disabled={cancelMut.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {past.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-muted-foreground">Past Tests</h2>
          {past.slice(0, 10).map((lt) => (
            <Card key={lt.id} className="opacity-70">
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      {statusBadge(lt.status)}
                      <span className="font-medium text-sm">{lt.title}</span>
                    </div>
                    <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
                      <span>{new Date(lt.scheduledAt).toLocaleDateString("en-IN")}</span>
                      <span>{lt.participantCount} participants</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!isLoading && liveTests.length === 0 && (
        <Card>
          <CardContent className="p-12 text-center">
            <Radio className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="font-medium">No live tests scheduled yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Schedule a synchronized test and all users will be notified 30 minutes before it starts.
            </p>
            <Button className="mt-4" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Schedule First Live Test
            </Button>
          </CardContent>
        </Card>
      )}

      <Dialog open={msgTarget !== null} onOpenChange={(open) => { if (!open) setMsgTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-blue-500" />
              Send Message to Participants
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              This message will be sent to ALL participants of this live test via Telegram bot.
            </p>
            <Textarea
              rows={4}
              value={msgText}
              onChange={(e) => setMsgText(e.target.value)}
              placeholder="e.g. Test starts in 5 minutes! Get ready 🔥"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMsgTarget(null)}>Cancel</Button>
            <Button
              disabled={!msgText.trim() || sendMsgMut.isPending}
              onClick={() => msgTarget && sendMsgMut.mutate({ id: msgTarget, message: msgText })}
            >
              {sendMsgMut.isPending ? "Sending…" : "Send Message"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule Live Test</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Select Test Series</Label>
              <Select
                value={form.testId}
                onValueChange={(v) => {
                  const t = tests.find((x) => x.testId === v);
                  setForm((f) => ({ ...f, testId: v, title: t ? `Live: ${t.testName}` : f.title }));
                }}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Choose a test series..." />
                </SelectTrigger>
                <SelectContent>
                  {tests.map((t) => (
                    <SelectItem key={t.testId} value={t.testId}>
                      {t.testName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Live Test Title</Label>
              <Input
                className="mt-1"
                placeholder="e.g. Sunday SSC Challenge"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
            </div>
            <div>
              <Label>Scheduled Date & Time (IST)</Label>
              <Input
                type="datetime-local"
                className="mt-1"
                value={form.scheduledAt}
                onChange={(e) => setForm((f) => ({ ...f, scheduledAt: e.target.value }))}
              />
            </div>
            <div>
              <Label>Group Chat ID (for leaderboard, optional)</Label>
              <Input
                className="mt-1"
                placeholder="-1001234567890"
                value={form.groupChatId}
                onChange={(e) => setForm((f) => ({ ...f, groupChatId: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Final leaderboard will be posted here. Leave empty to skip.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              onClick={() => createMut.mutate(form)}
              disabled={!form.testId || !form.title || !form.scheduledAt || createMut.isPending}
            >
              {createMut.isPending ? "Scheduling…" : "Schedule Live Test"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

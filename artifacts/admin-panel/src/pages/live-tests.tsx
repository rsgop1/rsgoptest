import { useState, useEffect } from "react";
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
import {
  Plus, Trash2, Radio, Users, Clock, Calendar, StopCircle, MessageSquare,
  Megaphone, Bell, Play, Trophy, RefreshCw, ChevronDown, ChevronUp, Eye,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";

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

interface Participant {
  userId: number;
  fullName: string;
  tier: string;
  username: string | null;
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
  const map: Record<string, { label: string; className: string }> = {
    scheduled: { label: "📅 Scheduled", className: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 border-none" },
    announced: { label: "📢 Announced", className: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300 border-none" },
    notified: { label: "🔔 Notified", className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300 border-none" },
    live: { label: "🔴 LIVE", className: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 border-none animate-pulse" },
    completed: { label: "✅ Completed", className: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 border-none" },
  };
  const cfg = map[status] ?? { label: status, className: "bg-gray-100 text-gray-600 border-none" };
  return <Badge className={cfg.className}>{cfg.label}</Badge>;
}

function useCountdown(scheduledAt: string) {
  const [remaining, setRemaining] = useState("");

  useEffect(() => {
    const update = () => {
      const diff = new Date(scheduledAt).getTime() - Date.now();
      if (diff <= 0) { setRemaining("Starting…"); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      if (h > 0) setRemaining(`${h}h ${m}m`);
      else if (m > 0) setRemaining(`${m}m ${s}s`);
      else setRemaining(`${s}s`);
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [scheduledAt]);

  return remaining;
}

function CountdownBadge({ scheduledAt }: { scheduledAt: string }) {
  const r = useCountdown(scheduledAt);
  const diff = new Date(scheduledAt).getTime() - Date.now();
  const urgent = diff < 5 * 60 * 1000;
  return (
    <span className={`flex items-center gap-1 text-sm font-mono ${urgent ? "text-red-500 font-bold" : "text-muted-foreground"}`}>
      <Clock className="h-3.5 w-3.5" />
      {r}
    </span>
  );
}

export default function LiveTests() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    testId: "",
    title: "",
    scheduledAt: "",
    groupChatId: "",
    maxParticipants: "",
  });
  const [msgTarget, setMsgTarget] = useState<LiveTest | null>(null);
  const [msgText, setMsgText] = useState("");
  const [participantsTarget, setParticipantsTarget] = useState<LiveTest | null>(null);
  const [expandedPast, setExpandedPast] = useState(false);

  const { data: liveTests = [], isLoading } = useQuery<LiveTest[]>({
    queryKey: ["admin-live-tests"],
    queryFn: () => apiFetch("/live-tests"),
    refetchInterval: 10000,
  });

  const { data: tests = [] } = useQuery<TestSeries[]>({
    queryKey: ["admin-tests-for-live"],
    queryFn: () => apiFetch("/tests"),
  });

  const { data: participants = [], isLoading: participantsLoading } = useQuery<Participant[]>({
    queryKey: ["admin-live-participants", participantsTarget?.id],
    queryFn: () => apiFetch(`/live-tests/${participantsTarget!.id}/participants`),
    enabled: !!participantsTarget,
  });

  const createMut = useMutation({
    mutationFn: (data: typeof form) =>
      apiFetch("/live-tests", {
        method: "POST",
        body: JSON.stringify({
          testId: data.testId,
          title: data.title,
          // datetime-local gives IST time; append IST offset so server stores correct UTC
          scheduledAt: data.scheduledAt
            ? new Date(data.scheduledAt + ":00+05:30").toISOString()
            : data.scheduledAt,
          groupChatId: data.groupChatId || undefined,
        }),
      }),
    onSuccess: () => {
      toast.success("Live test scheduled!");
      qc.invalidateQueries({ queryKey: ["admin-live-tests"] });
      setShowCreate(false);
      setForm({ testId: "", title: "", scheduledAt: "", groupChatId: "", maxParticipants: "" });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const cancelMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/live-tests/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Live test cancelled");
      qc.invalidateQueries({ queryKey: ["admin-live-tests"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const stopMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/live-tests/${id}/stop`, { method: "POST" }),
    onSuccess: (data: any) => {
      toast.success(`Live test stopped — ${data.notified} participants notified`);
      qc.invalidateQueries({ queryKey: ["admin-live-tests"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const startMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/live-tests/${id}/start`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Live test started! Questions being sent to participants.");
      qc.invalidateQueries({ queryKey: ["admin-live-tests"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const announceMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/live-tests/${id}/announce`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Announcement sent to group!");
      qc.invalidateQueries({ queryKey: ["admin-live-tests"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const notifyMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/live-tests/${id}/notify`, { method: "POST" }),
    onSuccess: () => {
      toast.success("5-minute reminder sent to participants!");
      qc.invalidateQueries({ queryKey: ["admin-live-tests"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const sendMsgMut = useMutation({
    mutationFn: ({ id, message }: { id: number; message: string }) =>
      apiFetch(`/live-tests/${id}/message`, { method: "POST", body: JSON.stringify({ message }) }),
    onSuccess: (data: any) => {
      toast.success(`Message sent to ${data.sent} participants!`);
      setMsgTarget(null);
      setMsgText("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const upcoming = liveTests.filter((t) => t.status !== "completed");
  const past = liveTests.filter((t) => t.status === "completed");

  const stats = {
    totalParticipants: liveTests.reduce((a, t) => a + (t.participantCount || 0), 0),
    liveCount: liveTests.filter(t => t.status === "live").length,
    completedCount: past.length,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Radio className="h-6 w-6 text-red-500" />
            Live Mock Tests
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Kahoot-style synchronized tests — schedule, announce, and control in real time
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Schedule Live Test
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card className="p-4">
          <div className="text-2xl font-bold">{stats.liveCount > 0 ? <span className="text-red-500">{stats.liveCount}</span> : upcoming.length}</div>
          <div className="text-sm text-muted-foreground mt-0.5">{stats.liveCount > 0 ? "Currently Live" : "Upcoming"}</div>
        </Card>
        <Card className="p-4">
          <div className="text-2xl font-bold">{stats.totalParticipants}</div>
          <div className="text-sm text-muted-foreground mt-0.5">Total Registrations</div>
        </Card>
        <Card className="p-4">
          <div className="text-2xl font-bold">{stats.completedCount}</div>
          <div className="text-sm text-muted-foreground mt-0.5">Completed Tests</div>
        </Card>
      </div>

      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      )}

      {!isLoading && upcoming.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Radio className="h-4 w-4 text-red-500" />
            Active & Upcoming
          </h2>
          {upcoming.map((lt) => (
            <Card key={lt.id} className={`${lt.status === "live" ? "border-red-400 dark:border-red-700 shadow-md" : ""}`}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      {statusBadge(lt.status)}
                      <span className="font-semibold">{lt.title}</span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5" />
                        {new Date(lt.scheduledAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} IST
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="h-3.5 w-3.5" />
                        {lt.participantCount} joined
                      </span>
                      {lt.status !== "completed" && lt.status !== "live" && (
                        <CountdownBadge scheduledAt={lt.scheduledAt} />
                      )}
                      {lt.status === "live" && (
                        <span className="flex items-center gap-1 text-red-500 font-medium">
                          <Clock className="h-3.5 w-3.5" />
                          Q{lt.currentQuestionIndex + 1} active
                        </span>
                      )}
                      {lt.groupChatId && (
                        <span className="text-xs text-muted-foreground">Group: {lt.groupChatId}</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1.5">Test ID: <code className="bg-muted px-1 rounded">{lt.testId}</code></p>
                  </div>

                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <div className="flex items-center gap-1">
                      {lt.status !== "live" && lt.status !== "completed" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          title="View participants"
                          onClick={() => setParticipantsTarget(lt)}
                          className="h-8 w-8 p-0"
                        >
                          <Eye className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Send message to all participants"
                        onClick={() => { setMsgTarget(lt); setMsgText(""); }}
                        className="h-8 w-8 p-0"
                      >
                        <MessageSquare className="h-4 w-4 text-blue-500" />
                      </Button>
                    </div>

                    <div className="flex items-center gap-1 flex-wrap justify-end">
                      {lt.status === "scheduled" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1"
                          title="Announce to group chat"
                          onClick={() => announceMut.mutate(lt.id)}
                          disabled={announceMut.isPending}
                        >
                          <Megaphone className="h-3.5 w-3.5 text-purple-500" />
                          Announce
                        </Button>
                      )}
                      {(lt.status === "announced") && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1"
                          title="Send 5-min reminder to participants"
                          onClick={() => notifyMut.mutate(lt.id)}
                          disabled={notifyMut.isPending}
                        >
                          <Bell className="h-3.5 w-3.5 text-yellow-500" />
                          Remind
                        </Button>
                      )}
                      {["scheduled", "announced", "notified"].includes(lt.status) && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1 border-green-300 text-green-700 hover:bg-green-50 dark:border-green-700 dark:text-green-400 dark:hover:bg-green-950/30"
                          title="Start test now (send questions to all participants)"
                          onClick={() => {
                            if (confirm(`Start "${lt.title}" now? Questions will be sent to all ${lt.participantCount} participants.`))
                              startMut.mutate(lt.id);
                          }}
                          disabled={startMut.isPending}
                        >
                          <Play className="h-3.5 w-3.5" />
                          Start Now
                        </Button>
                      )}
                      {lt.status === "live" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1 border-orange-300 text-orange-600 hover:bg-orange-50 dark:border-orange-700 dark:text-orange-400"
                          title="Force stop live test"
                          onClick={() => {
                            if (confirm(`Force-stop "${lt.title}"? All participants will be notified that the test has ended.`))
                              stopMut.mutate(lt.id);
                          }}
                          disabled={stopMut.isPending}
                        >
                          <StopCircle className="h-3.5 w-3.5" />
                          Force Stop
                        </Button>
                      )}
                      {["scheduled", "announced", "notified"].includes(lt.status) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10"
                          onClick={() => {
                            if (confirm(`Cancel "${lt.title}"?`)) cancelMut.mutate(lt.id);
                          }}
                          disabled={cancelMut.isPending}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>

                {lt.status === "live" && (
                  <div className="mt-3 p-2.5 bg-red-50 dark:bg-red-950/20 rounded-lg border border-red-200 dark:border-red-800">
                    <div className="flex items-center gap-2 text-red-600 dark:text-red-400 text-sm">
                      <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                      <span className="font-medium">Test in progress</span>
                      <span className="text-red-400">— Question {lt.currentQuestionIndex + 1} active</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!isLoading && past.length > 0 && (
        <div className="space-y-3">
          <button
            className="flex items-center gap-2 text-lg font-semibold text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setExpandedPast(v => !v)}
          >
            <Trophy className="h-4 w-4" />
            Past Tests ({past.length})
            {expandedPast ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {expandedPast && past.slice(0, 20).map((lt) => (
            <Card key={lt.id} className="opacity-75 hover:opacity-100 transition-opacity">
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      {statusBadge(lt.status)}
                      <span className="font-medium text-sm">{lt.title}</span>
                    </div>
                    <div className="flex gap-4 mt-1.5 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {new Date(lt.scheduledAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" })}
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {lt.participantCount} participants
                      </span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    onClick={() => setParticipantsTarget(lt)}
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!isLoading && liveTests.length === 0 && (
        <Card>
          <CardContent className="p-12 text-center">
            <Radio className="h-12 w-12 mx-auto text-muted-foreground mb-4 opacity-30" />
            <p className="font-semibold text-lg">No live tests scheduled yet</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
              Schedule a synchronized test — all users will be notified and can join from your group or channel.
            </p>
            <Button className="mt-4" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Schedule First Live Test
            </Button>
          </CardContent>
        </Card>
      )}

      <Dialog
        open={!!participantsTarget}
        onOpenChange={(open) => { if (!open) setParticipantsTarget(null); }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-blue-500" />
              Participants — {participantsTarget?.title}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-96 overflow-y-auto">
            {participantsLoading ? (
              <div className="space-y-2 py-2">
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : participants.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                <Users className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p>No participants yet</p>
              </div>
            ) : (
              <div className="space-y-1 py-1">
                <div className="text-sm text-muted-foreground px-1 pb-2">
                  {participants.length} registered participant{participants.length !== 1 ? "s" : ""}
                </div>
                {participants.map((p, i) => (
                  <div key={p.userId} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors">
                    <span className="text-muted-foreground text-sm w-6 text-right">{i + 1}.</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{p.fullName}</div>
                      <div className="text-xs text-muted-foreground">
                        {p.username ? `@${p.username}` : `ID: ${p.userId}`}
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-xs shrink-0 ${p.tier === "Premium" ? "border-yellow-400 text-yellow-600" : ""}`}
                    >
                      {p.tier === "Premium" ? "💎 Premium" : "Free"}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setParticipantsTarget(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={msgTarget !== null} onOpenChange={(open) => { if (!open) setMsgTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-blue-500" />
              Message Participants
            </DialogTitle>
          </DialogHeader>
          {msgTarget && (
            <div className="space-y-3">
              <div className="p-3 bg-muted rounded-lg text-sm">
                <span className="font-medium">{msgTarget.title}</span>
                <span className="text-muted-foreground ml-2">— {msgTarget.participantCount} participants</span>
              </div>
              <p className="text-sm text-muted-foreground">
                This message will be sent via Telegram bot to all registered participants.
              </p>
              <Textarea
                rows={4}
                value={msgText}
                onChange={(e) => setMsgText(e.target.value)}
                placeholder="e.g. Test starts in 5 minutes! Be ready 🔥"
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMsgTarget(null)}>Cancel</Button>
            <Button
              disabled={!msgText.trim() || sendMsgMut.isPending}
              onClick={() => msgTarget && sendMsgMut.mutate({ id: msgTarget.id, message: msgText })}
            >
              {sendMsgMut.isPending ? "Sending…" : "Send Message"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Radio className="h-5 w-5 text-red-500" />
              Schedule Live Test
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Select Test Series <span className="text-destructive">*</span></Label>
              <Select
                value={form.testId}
                onValueChange={(v) => {
                  const t = tests.find((x) => x.testId === v);
                  setForm((f) => ({ ...f, testId: v, title: t ? `Live: ${t.testName}` : f.title }));
                }}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Choose a test series…" />
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
              <Label>Live Test Title <span className="text-destructive">*</span></Label>
              <Input
                className="mt-1"
                placeholder="e.g. Sunday SSC Challenge"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
            </div>
            <div>
              <Label>Scheduled Date & Time (IST) <span className="text-destructive">*</span></Label>
              <Input
                type="datetime-local"
                className="mt-1"
                value={form.scheduledAt}
                onChange={(e) => setForm((f) => ({ ...f, scheduledAt: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Announcement is sent when scheduled. 5-min reminder is sent automatically.
              </p>
            </div>
            <div>
              <Label>Group Chat ID (optional)</Label>
              <Input
                className="mt-1 font-mono text-sm"
                placeholder="-1001234567890"
                value={form.groupChatId}
                onChange={(e) => setForm((f) => ({ ...f, groupChatId: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Announcement, start notification, and final leaderboard will be posted here.
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

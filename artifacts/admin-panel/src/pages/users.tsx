import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useAdminListUsers,
  useAdminGrantUserPremium,
  useAdminRevokeUserPremium,
  useAdminMessageUser,
  useAdminResetUserUsage,
  getAdminListUsersQueryKey,
  type AdminUser,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  Trophy,
  UserCircle,
  Settings2,
  Crown,
  MessageSquare,
  RotateCcw,
  ShieldOff,
  CalendarDays,
  Activity,
  CreditCard,
  Ticket,
  FileText,
  RefreshCw,
} from "lucide-react";

function isPremium(user: AdminUser) {
  return user.tier.toLowerCase() === "premium";
}

function premiumExpiryLabel(user: AdminUser) {
  if (!user.premiumExpiry) return "No active expiry";
  return format(new Date(user.premiumExpiry), "MMM d, yyyy");
}

type User360 = {
  access: { activePremium: boolean; premiumDaysLeft: number; vipEligible: boolean };
  summary: { totalAttempts: number; averageAccuracy: number; wrongQuestions: number; supportOpen: number; customSets: number };
  history: Array<{ id: number; testName: string; score: number; maxScore: number; accuracy: number; completedAt: string }>;
  payments: Array<{ id: number; method: string; amount: number; status: string; submittedAt: string }>;
  redemptions: Array<{ id: number; code: string; campaignName: string | null; grantedPremiumDays: number; redeemedAt: string }>;
  tickets: Array<{ id: number; category: string; status: string; priority: string; message: string }>;
  customSets: Array<{ id: number; title: string; status: string; sourceFileName: string | null; failReason: string | null }>;
  achievements: Array<{ id: number; title?: string; name?: string; awardedAt: string }>;
};

export default function Users() {
  const { data: users, isLoading } = useAdminListUsers();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [premiumDays, setPremiumDays] = useState("30");
  const [message, setMessage] = useState("");
  const [activeSection, setActiveSection] = useState<"overview" | "activity" | "commerce" | "support">("overview");
  const { data: user360, isLoading: user360Loading, refetch: refetchUser360 } = useQuery<User360>({
    queryKey: ["admin-user-360", selectedUser?.userId],
    enabled: Boolean(selectedUser),
    queryFn: async () => {
      const response = await fetch(`/api/admin/users/${selectedUser!.userId}/360`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load user profile");
      return response.json();
    },
  });
  const { data: premiumOverview } = useQuery<{
    activePremium: number;
    expiringSoon: number;
    vipEnabled: boolean;
    vipFailures: number;
    couponGrantedPremium: number;
  }>({
    queryKey: ["admin-premium-overview"],
    queryFn: async () => {
      const res = await fetch("/api/admin/premium/overview", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load Premium overview");
      return res.json();
    },
    refetchInterval: 60_000,
  });

  const refreshUsers = () => queryClient.invalidateQueries({ queryKey: getAdminListUsersQueryKey() });
  const success = (title: string) => {
    toast({ title });
    refreshUsers();
  };
  const failure = (title: string) => toast({ title, variant: "destructive" });

  const grantPremium = useAdminGrantUserPremium({
    mutation: {
      onSuccess: (result) => {
        success(`Premium access active until ${format(new Date(result.premiumExpiry), "MMM d, yyyy")}`);
        setSelectedUser((current) => current ? { ...current, tier: "Premium", premiumExpiry: result.premiumExpiry } : current);
      },
      onError: () => failure("Could not grant premium access"),
    },
  });
  const revokePremium = useAdminRevokeUserPremium({
    mutation: {
      onSuccess: () => {
        success("Premium access revoked");
        setSelectedUser((current) => current ? { ...current, tier: "Free", premiumExpiry: null } : current);
      },
      onError: () => failure("Could not revoke premium access"),
    },
  });
  const sendMessage = useAdminMessageUser({
    mutation: {
      onSuccess: () => {
        success("Message sent on Telegram");
        setMessage("");
      },
      onError: () => failure("Message could not be delivered. The user may have blocked the bot."),
    },
  });
  const resetUsage = useAdminResetUserUsage({
    mutation: {
      onSuccess: () => {
        success("Daily AI usage reset");
        setSelectedUser((current) => current ? { ...current, aiDoubtCount: 0, aiDoubtDate: null, anonDoubtsUsed: 0, anonDoubtDate: null } : current);
      },
      onError: () => failure("Could not reset daily usage"),
    },
  });

  const openControls = (user: AdminUser) => {
    setSelectedUser(user);
    setPremiumDays("30");
    setMessage("");
    setActiveSection("overview");
  };

  const handleGrant = () => {
    if (!selectedUser) return;
    const days = Number(premiumDays);
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      failure("Enter whole days between 1 and 3650");
      return;
    }
    grantPremium.mutate({ userId: selectedUser.userId, data: { days } });
  };

  const handleSendMessage = () => {
    if (!selectedUser || !message.trim()) return;
    sendMessage.mutate({ userId: selectedUser.userId, data: { message: message.trim() } });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">User Control Center</h1>
        <Card><CardContent className="p-6"><div className="space-y-4">
          {[...Array(10)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div></CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">User Control Center</h1>
        <p className="text-muted-foreground mt-1">Manage premium access, daily limits, and direct Telegram communication.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Active Premium</p><p className="mt-1 text-2xl font-bold text-amber-600">{premiumOverview?.activePremium ?? "—"}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Expiring in 7 days</p><p className="mt-1 text-2xl font-bold">{premiumOverview?.expiringSoon ?? "—"}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">VIP status</p><p className="mt-1 text-2xl font-bold">{premiumOverview ? (premiumOverview.vipEnabled ? "Live" : "Off") : "—"}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">VIP failures</p><p className="mt-1 text-2xl font-bold text-red-600">{premiumOverview?.vipFailures ?? "—"}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Coupon Premium grants</p><p className="mt-1 text-2xl font-bold text-purple-600">{premiumOverview?.couponGrantedPremium ?? "—"}</p></CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Telegram ID</TableHead>
                <TableHead>User Details</TableHead>
                <TableHead>Tier / Expiry</TableHead>
                <TableHead>Target Exam</TableHead>
                <TableHead className="text-right">Tests Taken</TableHead>
                <TableHead className="text-right">Joined</TableHead>
                <TableHead className="text-right">Control</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users?.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center h-32 text-muted-foreground">No users found.</TableCell></TableRow>
              ) : users?.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-mono text-sm text-muted-foreground">{user.userId}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 bg-primary/10 rounded-full flex items-center justify-center"><UserCircle className="h-5 w-5 text-primary" /></div>
                      <div><div className="font-medium">{user.fullName}</div>{user.username && <div className="text-xs text-muted-foreground">@{user.username}</div>}</div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {isPremium(user) ? (
                      <div className="space-y-1">
                        <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 border-none"><Trophy className="h-3 w-3 mr-1" />Premium</Badge>
                        <div className="text-xs text-muted-foreground">{premiumExpiryLabel(user)}</div>
                      </div>
                    ) : <Badge variant="secondary">Free</Badge>}
                  </TableCell>
                  <TableCell>{user.targetExamSub ? <span className="text-sm font-medium">{user.targetExamSub}</span> : <span className="text-sm text-muted-foreground italic">Not set</span>}</TableCell>
                  <TableCell className="text-right font-medium">{user.totalTestsTaken}</TableCell>
                  <TableCell className="text-right text-muted-foreground text-sm">{format(new Date(user.joinedAt), "MMM d, yyyy")}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" onClick={() => openControls(user)}><Settings2 className="h-4 w-4 mr-1" />Control</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Sheet open={!!selectedUser} onOpenChange={(open) => !open && setSelectedUser(null)}>
        <SheetContent className="w-full sm:max-w-3xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2"><Settings2 className="h-5 w-5 text-primary" />Manage user</SheetTitle>
            <SheetDescription>{selectedUser?.fullName} · Telegram ID {selectedUser?.userId}</SheetDescription>
          </SheetHeader>

          {selectedUser && (
            <div className="space-y-5 py-5">
              {user360Loading && <Skeleton className="h-56 w-full" />}
              {user360 && (
                <>
              <div className="flex gap-1 overflow-x-auto rounded-lg bg-muted p-1">
                {([
                  ["overview", "Overview"],
                  ["activity", "Tests & AI"],
                  ["commerce", "Payments & Coupons"],
                  ["support", "Support & Sets"],
                ] as const).map(([value, label]) => (
                  <Button key={value} variant={activeSection === value ? "default" : "ghost"} size="sm" className="whitespace-nowrap" onClick={() => setActiveSection(value)}>{label}</Button>
                ))}
              </div>
              <div className="rounded-xl border bg-muted/30 p-4">
                <div className="flex items-center justify-between">
                  <div><p className="font-semibold">{selectedUser.fullName}</p><p className="text-sm text-muted-foreground">{selectedUser.username ? `@${selectedUser.username}` : "No username"}</p></div>
                  {isPremium(selectedUser) ? <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100"><Crown className="h-3 w-3 mr-1" />Premium</Badge> : <Badge variant="secondary">Free</Badge>}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 text-sm">
                  <div><span className="text-muted-foreground">Premium till</span><p className="font-medium">{premiumExpiryLabel(selectedUser)}</p></div>
                  <div><span className="text-muted-foreground">Avg accuracy</span><p className="font-medium">{user360.summary.averageAccuracy.toFixed(1)}%</p></div>
                  <div><span className="text-muted-foreground">Tests attempted</span><p className="font-medium">{user360.summary.totalAttempts}</p></div>
                  <div><span className="text-muted-foreground">Referrals</span><p className="font-medium">{selectedUser.referralCount}</p></div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Badge variant={user360.access.activePremium ? "default" : "secondary"}>{user360.access.activePremium ? `💎 ${user360.access.premiumDaysLeft} days left` : "Free access"}</Badge>
                  <Badge variant={user360.access.vipEligible ? "default" : "secondary"}>{user360.access.vipEligible ? "VIP eligible" : "No VIP access"}</Badge>
                  <Badge variant="outline">{user360.summary.wrongQuestions} wrong questions</Badge>
                  <Badge variant="outline">{user360.summary.supportOpen} open tickets</Badge>
                </div>
              </div>

              <section className="space-y-3 rounded-xl border p-4">
                <div className="flex items-center gap-2"><Crown className="h-4 w-4 text-amber-500" /><h3 className="font-semibold">Premium access</h3></div>
                <p className="text-xs text-muted-foreground">Existing active premium time is extended; it will not be shortened.</p>
                <div className="flex gap-2">
                  <Input type="number" min={1} max={3650} value={premiumDays} onChange={(e) => setPremiumDays(e.target.value)} className="max-w-32" />
                  <Button onClick={handleGrant} disabled={grantPremium.isPending}><CalendarDays className="h-4 w-4 mr-1" />{grantPremium.isPending ? "Applying…" : "Grant days"}</Button>
                </div>
                {isPremium(selectedUser) && <Button variant="outline" className="w-full text-destructive" onClick={() => revokePremium.mutate({ userId: selectedUser.userId })} disabled={revokePremium.isPending}><ShieldOff className="h-4 w-4 mr-2" />Revoke premium now</Button>}
              </section>

              <section className="space-y-3 rounded-xl border p-4">
                <div className="flex items-center gap-2"><MessageSquare className="h-4 w-4 text-primary" /><h3 className="font-semibold">Send direct message</h3></div>
                <Textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={4000} placeholder="Write a Telegram message for this user…" />
                <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{message.length}/4000</span><Button onClick={handleSendMessage} disabled={!message.trim() || sendMessage.isPending}><MessageSquare className="h-4 w-4 mr-1" />{sendMessage.isPending ? "Sending…" : "Send on Telegram"}</Button></div>
              </section>

              <section className="space-y-3 rounded-xl border p-4">
                <div className="flex items-center gap-2"><Activity className="h-4 w-4 text-primary" /><h3 className="font-semibold">Daily usage controls</h3></div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><span className="text-muted-foreground">AI doubts used</span><p className="font-medium">{selectedUser.aiDoubtCount} {selectedUser.aiDoubtDate ? `(${selectedUser.aiDoubtDate})` : ""}</p></div>
                  <div><span className="text-muted-foreground">Anonymous doubts</span><p className="font-medium">{selectedUser.anonDoubtsUsed} {selectedUser.anonDoubtDate ? `(${selectedUser.anonDoubtDate})` : ""}</p></div>
                </div>
                <Button variant="outline" className="w-full" onClick={() => resetUsage.mutate({ userId: selectedUser.userId })} disabled={resetUsage.isPending}><RotateCcw className="h-4 w-4 mr-2" />{resetUsage.isPending ? "Resetting…" : "Reset today's AI limits"}</Button>
              </section>

              {activeSection === "overview" && (
                <div className="grid gap-4 md:grid-cols-2">
                  <Card><CardContent className="p-4"><h3 className="font-semibold flex items-center gap-2"><Activity className="h-4 w-4" />Account intelligence</h3><div className="mt-3 space-y-2 text-sm"><p>Joined: {format(new Date(selectedUser.joinedAt), "MMM d, yyyy HH:mm")}</p><p>Exam: {selectedUser.targetExamMain ?? "Not set"} / {selectedUser.targetExamSub ?? "Not set"}</p><p>AI doubts today: {selectedUser.aiDoubtCount}</p><p>Anonymous doubts: {selectedUser.anonDoubtsUsed}</p></div></CardContent></Card>
                  <Card><CardContent className="p-4"><h3 className="font-semibold flex items-center gap-2"><Trophy className="h-4 w-4" />Achievements</h3><div className="mt-3 space-y-2 text-sm">{user360.achievements.length ? user360.achievements.slice(0, 6).map((a) => <div key={a.id} className="flex justify-between"><span>{a.title ?? a.name ?? "Achievement"}</span><span className="text-muted-foreground">{format(new Date(a.awardedAt), "MMM d")}</span></div>) : <p className="text-muted-foreground">No achievements yet.</p>}</div></CardContent></Card>
                </div>
              )}
              {activeSection === "activity" && (
                <section className="rounded-xl border p-4"><h3 className="font-semibold flex items-center gap-2"><FileText className="h-4 w-4" />Recent test history</h3><div className="mt-3 overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Test</TableHead><TableHead>Score</TableHead><TableHead>Accuracy</TableHead><TableHead>Completed</TableHead></TableRow></TableHeader><TableBody>{user360.history.slice(0, 15).map((h) => <TableRow key={h.id}><TableCell className="max-w-56 truncate">{h.testName}</TableCell><TableCell>{h.score}/{h.maxScore}</TableCell><TableCell>{Number(h.accuracy).toFixed(1)}%</TableCell><TableCell>{format(new Date(h.completedAt), "MMM d, HH:mm")}</TableCell></TableRow>)}</TableBody></Table>{!user360.history.length && <p className="text-sm text-muted-foreground py-4">No completed tests.</p>}</div></section>
              )}
              {activeSection === "commerce" && (
                <div className="grid gap-4 md:grid-cols-2">
                  <section className="rounded-xl border p-4"><h3 className="font-semibold flex items-center gap-2"><CreditCard className="h-4 w-4" />Payments</h3><div className="mt-3 space-y-2 text-sm">{user360.payments.map((p) => <div key={p.id} className="flex justify-between gap-2 border-b pb-2"><span>{p.method} · {p.amount}</span><Badge variant="outline">{p.status}</Badge></div>)}{!user360.payments.length && <p className="text-muted-foreground">No payments.</p>}</div></section>
                  <section className="rounded-xl border p-4"><h3 className="font-semibold flex items-center gap-2"><Crown className="h-4 w-4" />Coupons used</h3><div className="mt-3 space-y-2 text-sm">{user360.redemptions.map((r) => <div key={r.id} className="flex justify-between gap-2 border-b pb-2"><span><b>{r.code}</b><br /><span className="text-xs text-muted-foreground">{r.campaignName ?? "No campaign"}</span></span><span className="text-right">{r.grantedPremiumDays}d<br /><span className="text-xs text-muted-foreground">{format(new Date(r.redeemedAt), "MMM d")}</span></span></div>)}{!user360.redemptions.length && <p className="text-muted-foreground">No coupon redemptions.</p>}</div></section>
                </div>
              )}
              {activeSection === "support" && (
                <div className="grid gap-4 md:grid-cols-2">
                  <section className="rounded-xl border p-4"><h3 className="font-semibold flex items-center gap-2"><Ticket className="h-4 w-4" />Support tickets</h3><div className="mt-3 space-y-2 text-sm">{user360.tickets.map((t) => <div key={t.id} className="border-b pb-2"><div className="flex justify-between"><b>#{t.id} · {t.category}</b><Badge variant={t.priority === "urgent" ? "destructive" : "outline"}>{t.status}</Badge></div><p className="mt-1 line-clamp-2 text-muted-foreground">{t.message}</p></div>)}{!user360.tickets.length && <p className="text-muted-foreground">No support tickets.</p>}</div></section>
                  <section className="rounded-xl border p-4"><h3 className="font-semibold flex items-center gap-2"><FileText className="h-4 w-4" />Custom PDF sets</h3><div className="mt-3 space-y-2 text-sm">{user360.customSets.map((s) => <div key={s.id} className="flex justify-between gap-2 border-b pb-2"><span className="truncate">{s.title}<br /><span className="text-xs text-muted-foreground">{s.sourceFileName ?? "No source name"}</span></span><Badge variant={s.status === "failed" ? "destructive" : "outline"}>{s.status}</Badge></div>)}{!user360.customSets.length && <p className="text-muted-foreground">No custom sets.</p>}</div></section>
                </div>
              )}
              <div className="flex justify-end"><Button variant="outline" size="sm" onClick={() => void refetchUser360()}><RefreshCw className="h-4 w-4 mr-2" />Refresh profile</Button></div>
              </>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
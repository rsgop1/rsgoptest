import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Brain, Zap, MessageSquare, Info, Save, Trash2, Plus, Tag, RotateCcw, CheckCircle, XCircle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";

const BASE = "/api/admin";

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error((err as any).error ?? "Request failed");
  }
  return res.json();
}

interface AiSettings {
  aiEnabled: boolean;
  doubtPrompt: string;
  aiInfoPrompt: string;
  scannedPdfOcrEnabled: boolean;
  provider: "openrouter" | "openai" | "gemini";
  model: string;
  secrets: { openrouter: boolean; openai: boolean; gemini: boolean; groq: boolean };
}

interface CouponCode {
  id: number;
  code: string;
  discountInr: number;
  discountStars: number;
  discountPct: number;
  premiumDays: number;
  perUserLimit: number;
  grantPremium: boolean;
  campaignName: string | null;
  internalNote: string | null;
  redemptionCount: number;
  usageLimit: number;
  usedCount: number;
  expiresAt: string | null;
  isActive: boolean;
  createdAt: string;
}

const DEFAULT_DOUBT_PROMPT = `You are a sharp educational AI for Indian competitive exam students (SSC, Railway, Banking, Bihar/State Govt). Answer the question directly and concisely. No filler words. No markdown symbols (no **, no __, no #). Max 120 words. Give the direct answer first, then 1-2 supporting facts if needed. End with one exam tip if relevant.`;

const DEFAULT_AI_INFO_PROMPT = `You are an expert AI tutor for Indian competitive exams. Write a structured response with: correct answer, why it's correct (2-3 sentences), one exam tip, and one-liner for each wrong option. Max 180 words. Plain English, no markdown symbols.`;

const emptyCouponForm = {
  code: "",
  discountInr: 0,
  discountStars: 0,
  discountPct: 0,
  premiumDays: 30,
  perUserLimit: 1,
  grantPremium: false,
  campaignName: "",
  internalNote: "",
  usageLimit: 100,
  expiresAt: "",
};

export default function AiPage() {
  const qc = useQueryClient();
  const [couponOpen, setCouponOpen] = useState(false);
  const [couponForm, setCouponForm] = useState(emptyCouponForm);

  const [form, setForm] = useState<AiSettings>({
    aiEnabled: true,
    doubtPrompt: DEFAULT_DOUBT_PROMPT,
    aiInfoPrompt: DEFAULT_AI_INFO_PROMPT,
    scannedPdfOcrEnabled: false,
    provider: "openrouter",
    model: "",
    secrets: { openrouter: false, openai: false, gemini: false, groq: false },
  });

  const { data: settings, isLoading: settingsLoading } = useQuery<AiSettings>({
    queryKey: ["admin-ai-settings"],
    queryFn: () => apiFetch("/ai-settings"),
  });

  useEffect(() => {
    if (settings) {
      setForm({
        aiEnabled: settings.aiEnabled ?? true,
        doubtPrompt: settings.doubtPrompt || DEFAULT_DOUBT_PROMPT,
        aiInfoPrompt: settings.aiInfoPrompt || DEFAULT_AI_INFO_PROMPT,
        scannedPdfOcrEnabled: settings.scannedPdfOcrEnabled ?? false,
        provider: settings.provider ?? "openrouter",
        model: settings.model ?? "",
        secrets: settings.secrets,
      });
    }
  }, [settings]);

  const { data: coupons = [], isLoading: couponsLoading } = useQuery<CouponCode[]>({
    queryKey: ["admin-coupons"],
    queryFn: () => apiFetch("/coupons"),
  });

  const settingsMut = useMutation({
    mutationFn: (data: AiSettings) =>
      apiFetch("/ai-settings", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      toast.success("AI settings saved!");
      qc.invalidateQueries({ queryKey: ["admin-ai-settings"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const couponMut = useMutation({
    mutationFn: (data: typeof couponForm) =>
      apiFetch("/coupons", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      toast.success("Coupon created!");
      qc.invalidateQueries({ queryKey: ["admin-coupons"] });
      setCouponOpen(false);
      setCouponForm(emptyCouponForm);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteCouponMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/coupons/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Coupon deleted");
      qc.invalidateQueries({ queryKey: ["admin-coupons"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleCouponMut = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      apiFetch(`/coupons/${id}/toggle`, { method: "POST", body: JSON.stringify({ isActive }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-coupons"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (settingsLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">AI Settings</h1>
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const activeCoupons = coupons.filter(c => c.isActive && c.usedCount < c.usageLimit);
  const inactiveCoupons = coupons.filter(c => !c.isActive || c.usedCount >= c.usageLimit);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Brain className="h-6 w-6 text-primary" />
            AI & Coupon Settings
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Configure AI prompts, enable/disable features, and manage discount codes
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-yellow-500" />
              AI Features
            </div>
            <div className="flex items-center gap-3">
              <span className={`text-sm font-medium ${form.aiEnabled ? "text-green-600" : "text-red-500"}`}>
                {form.aiEnabled ? "✅ Enabled" : "❌ Disabled"}
              </span>
              <Switch
                checked={form.aiEnabled}
                onCheckedChange={(v) => setForm(f => ({ ...f, aiEnabled: v }))}
              />
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            When disabled, <code className="bg-muted px-1 rounded text-xs">/doubt</code> command and AI Info button will show a maintenance message to all users.
          </p>
          {!form.aiEnabled && (
            <div className="mt-3 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-sm text-red-600 dark:text-red-400 font-medium">⚠️ AI features are currently OFF for all users</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-purple-500" />
            AI Provider & Scanned PDF
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Active AI provider</Label>
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={form.provider}
                onChange={(e) => setForm(f => ({ ...f, provider: e.target.value as "openrouter" | "openai" | "gemini" }))}
              >
                <option value="openrouter">OpenRouter</option>
                <option value="openai">OpenAI</option>
                <option value="gemini">Gemini</option>
              </select>
              <p className="text-xs text-muted-foreground">Legacy provider setting for fallback integrations. Current feature routing is fixed: Gemini powers PDF tests, Smart Intelligence and AI Space; Groq powers AI Info and doubt solving.</p>
            </div>
            <div className="space-y-2">
              <Label>Model (optional)</Label>
              <Input value={form.model} onChange={(e) => setForm(f => ({ ...f, model: e.target.value }))} placeholder={form.provider === "openai" ? "gpt-4o-mini" : "openai/gpt-4o-mini"} />
              <p className="text-xs text-muted-foreground">Leave blank to use the safe default for the selected provider.</p>
            </div>
          </div>
          <div className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label className="text-base">Scan scanned/image PDFs with AI</Label>
                <p className="text-xs text-muted-foreground mt-1">OFF = text-layer PDFs only. ON = render scanned pages and send them to the configured vision-capable model.</p>
              </div>
              <Switch checked={form.scannedPdfOcrEnabled} onCheckedChange={(v) => setForm(f => ({ ...f, scannedPdfOcrEnabled: v }))} />
            </div>
            {form.scannedPdfOcrEnabled && <p className="text-xs text-amber-700 dark:text-amber-400">Vision scanning can use more credits and may take longer for multi-page PDFs.</p>}
          </div>
          <div className="rounded-lg bg-muted/50 p-4">
            <Label>Secure API key status</Label>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <Badge variant={form.secrets.openrouter ? "default" : "secondary"}>OpenRouter: {form.secrets.openrouter ? "configured" : "missing"}</Badge>
              <Badge variant={form.secrets.openai ? "default" : "secondary"}>OpenAI: {form.secrets.openai ? "configured" : "missing"}</Badge>
              <Badge variant={form.secrets.gemini ? "default" : "secondary"}>Gemini: {form.secrets.gemini ? "configured" : "missing"}</Badge>
              <Badge variant={form.secrets.groq ? "default" : "secondary"}>Groq: {form.secrets.groq ? "configured" : "missing"}</Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-2">Keys stay in Replit Secrets and are never stored in the app database or displayed here. Add/update them through the secure Secrets panel.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-blue-500" />
            /doubt Solver System Prompt
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            System message sent to AI when a user uses the <code className="bg-muted px-1 rounded text-xs">/doubt</code> command.
            Free users: 3/day. Premium: unlimited.
          </p>
          <Textarea
            rows={6}
            value={form.doubtPrompt}
            onChange={(e) => setForm(f => ({ ...f, doubtPrompt: e.target.value }))}
            className="font-mono text-xs"
            placeholder={DEFAULT_DOUBT_PROMPT}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setForm(f => ({ ...f, doubtPrompt: DEFAULT_DOUBT_PROMPT }))}
            className="gap-2"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset to Default
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="h-5 w-5 text-green-500" />
            AI Info (Solution Analysis) Prompt
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Guides the AI when analyzing quiz questions in the solution book (Premium users only).
          </p>
          <Textarea
            rows={6}
            value={form.aiInfoPrompt}
            onChange={(e) => setForm(f => ({ ...f, aiInfoPrompt: e.target.value }))}
            className="font-mono text-xs"
            placeholder={DEFAULT_AI_INFO_PROMPT}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setForm(f => ({ ...f, aiInfoPrompt: DEFAULT_AI_INFO_PROMPT }))}
            className="gap-2"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset to Default
          </Button>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          onClick={() => settingsMut.mutate(form)}
          disabled={settingsMut.isPending}
          className="gap-2"
          size="lg"
        >
          <Save className="h-4 w-4" />
          {settingsMut.isPending ? "Saving…" : "Save AI Settings"}
        </Button>
      </div>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Tag className="h-5 w-5 text-orange-500" />
              Coupon Codes
              <Badge variant="secondary" className="ml-1">{coupons.length} total</Badge>
              {activeCoupons.length > 0 && (
                <Badge className="bg-green-100 text-green-800 border-none">{activeCoupons.length} active</Badge>
              )}
            </div>
            <Button size="sm" onClick={() => setCouponOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New Coupon
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {couponsLoading ? (
            <div className="p-6"><Skeleton className="h-24 w-full" /></div>
          ) : coupons.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <Tag className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="font-medium">No coupon codes yet</p>
              <p className="text-sm mt-1">Create discount codes for your students</p>
              <Button className="mt-3" size="sm" onClick={() => setCouponOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Create First Coupon
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Discount</TableHead>
                  <TableHead>Usage</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {coupons.map((c) => {
                  const isExpired = c.expiresAt ? new Date(c.expiresAt) < new Date() : false;
                  const isExhausted = c.usedCount >= c.usageLimit;
                  const isEffectivelyActive = c.isActive && !isExpired && !isExhausted;

                  return (
                    <TableRow key={c.id} className={!isEffectivelyActive ? "opacity-60" : ""}>
                      <TableCell className="font-mono font-bold text-base tracking-wider">{c.code}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          {c.discountPct > 0 && (
                            <span className="text-green-600 dark:text-green-400 font-semibold">{c.discountPct}% off</span>
                          )}
                          {c.grantPremium && <span className="text-purple-600 dark:text-purple-400 font-semibold">💎 {c.premiumDays}d Premium</span>}
                          {c.discountInr > 0 && (
                            <span className="text-green-600 dark:text-green-400 font-semibold">₹{c.discountInr} off</span>
                          )}
                          {c.discountStars > 0 && (
                            <span className="text-yellow-600 dark:text-yellow-400 font-semibold">⭐ {c.discountStars} Stars off</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                           <span className="font-medium">{c.usedCount}/{c.usageLimit}</span>
                           <span className="text-xs text-muted-foreground">{c.redemptionCount ?? c.usedCount} redemptions · {c.perUserLimit}/user</span>
                          <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary rounded-full"
                              style={{ width: `${Math.min(100, (c.usedCount / c.usageLimit) * 100)}%` }}
                            />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {c.expiresAt ? (
                          <span className={isExpired ? "text-red-500" : "text-muted-foreground"}>
                            {isExpired ? "⚠️ Expired" : new Date(c.expiresAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Never</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {isEffectivelyActive ? (
                          <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-none">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Active
                          </Badge>
                        ) : isExhausted ? (
                          <Badge variant="secondary">Exhausted</Badge>
                        ) : isExpired ? (
                          <Badge variant="destructive" className="opacity-70">Expired</Badge>
                        ) : (
                          <Badge variant="secondary">
                            <XCircle className="h-3 w-3 mr-1" />
                            Disabled
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs h-7"
                            onClick={() => toggleCouponMut.mutate({ id: c.id, isActive: !c.isActive })}
                            disabled={toggleCouponMut.isPending}
                          >
                            {c.isActive ? "Disable" : "Enable"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:bg-destructive/10"
                            onClick={() => {
                              if (confirm(`Delete coupon "${c.code}"? This cannot be undone.`))
                                deleteCouponMut.mutate(c.id);
                            }}
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
          )}
        </CardContent>
      </Card>

      <Dialog open={couponOpen} onOpenChange={setCouponOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tag className="h-5 w-5 text-orange-500" />
              Create Coupon Code
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Coupon Code <span className="text-destructive">*</span></Label>
              <Input
                className="mt-1 uppercase font-mono tracking-widest"
                placeholder="e.g. SAVE50"
                value={couponForm.code}
                onChange={(e) => setCouponForm(f => ({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") }))}
              />
              <p className="text-xs text-muted-foreground mt-1">Only letters and numbers allowed</p>
            </div>
            <div>
              <Label className="text-sm text-muted-foreground mb-2 block">Discount Type (fill one or more)</Label>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">₹ Discount (INR)</Label>
                  <Input type="number" min="0" className="mt-1" value={couponForm.discountInr}
                    onChange={(e) => setCouponForm(f => ({ ...f, discountInr: parseInt(e.target.value) || 0 }))} />
                </div>
                <div>
                  <Label className="text-xs">% Discount</Label>
                  <Input type="number" min="0" max="100" className="mt-1" value={couponForm.discountPct}
                    onChange={(e) => setCouponForm(f => ({ ...f, discountPct: Math.min(100, parseInt(e.target.value) || 0) }))} />
                </div>
                <div>
                  <Label className="text-xs">⭐ Stars Off</Label>
                  <Input type="number" min="0" className="mt-1" value={couponForm.discountStars}
                    onChange={(e) => setCouponForm(f => ({ ...f, discountStars: parseInt(e.target.value) || 0 }))} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                💡 % discount takes priority over ₹ discount when both are set.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Max Usage (times)</Label>
                <Input type="number" min="1" className="mt-1" value={couponForm.usageLimit}
                  onChange={(e) => setCouponForm(f => ({ ...f, usageLimit: Math.max(1, parseInt(e.target.value) || 1) }))} />
              </div>
              <div>
                <Label className="text-xs">Expiry (optional)</Label>
                <Input type="datetime-local" className="mt-1" value={couponForm.expiresAt}
                  onChange={(e) => setCouponForm(f => ({ ...f, expiresAt: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Premium Days</Label>
                <Input type="number" min="1" max="3650" className="mt-1" value={couponForm.premiumDays}
                  onChange={(e) => setCouponForm(f => ({ ...f, premiumDays: Math.max(1, parseInt(e.target.value) || 1) }))} />
              </div>
              <div>
                <Label className="text-xs">Per-user Limit</Label>
                <Input type="number" min="1" className="mt-1" value={couponForm.perUserLimit}
                  onChange={(e) => setCouponForm(f => ({ ...f, perUserLimit: Math.max(1, parseInt(e.target.value) || 1) }))} />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label>Auto-grant Premium</Label>
                <p className="text-xs text-muted-foreground mt-1">100% discount coupons activate Premium and VIP instantly.</p>
              </div>
              <Switch checked={couponForm.grantPremium} onCheckedChange={(v) => setCouponForm(f => ({ ...f, grantPremium: v }))} />
            </div>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Campaign Name (optional)</Label>
                <Input className="mt-1" value={couponForm.campaignName} onChange={(e) => setCouponForm(f => ({ ...f, campaignName: e.target.value }))} placeholder="Launch week / Partner campaign" />
              </div>
              <div>
                <Label className="text-xs">Internal Note (optional)</Label>
                <Textarea rows={2} className="mt-1" value={couponForm.internalNote} onChange={(e) => setCouponForm(f => ({ ...f, internalNote: e.target.value }))} placeholder="Only visible to admins" />
              </div>
            </div>
            {couponForm.grantPremium && couponForm.discountPct < 100 && (
              <p className="text-xs text-amber-700 dark:text-amber-400">Auto-grant is enabled, but instant activation requires a 100% percentage discount.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCouponOpen(false)}>Cancel</Button>
            <Button
              disabled={!couponForm.code || (couponForm.discountInr === 0 && couponForm.discountPct === 0 && couponForm.discountStars === 0) || couponMut.isPending}
              onClick={() => couponMut.mutate(couponForm)}
            >
              {couponMut.isPending ? "Creating…" : "Create Coupon"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

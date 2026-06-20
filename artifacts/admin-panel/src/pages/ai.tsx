import { useState } from "react";
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
import { Brain, Zap, MessageSquare, Info, Save, Trash2, Plus, Tag } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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
}

interface CouponCode {
  id: number;
  code: string;
  discountInr: number;
  discountStars: number;
  discountPct: number;
  usageLimit: number;
  usedCount: number;
  expiresAt: string | null;
  isActive: boolean;
  createdAt: string;
}

const DEFAULT_DOUBT_PROMPT = `You are a sharp educational AI for Indian competitive exam students (SSC, Railway, Banking, Bihar/State Govt). Answer the question directly and concisely. No filler words. No markdown symbols (no **, no __, no #). Max 120 words. Give the direct answer first, then 1-2 supporting facts if needed. End with one exam tip if relevant.`;

const DEFAULT_AI_INFO_PROMPT = `You are an expert AI tutor for Indian competitive exams. Write a structured response with: correct answer, why it's correct (2-3 sentences), one exam tip, and one-liner for each wrong option. Max 180 words. Plain English, no markdown symbols.`;

export default function AiPage() {
  const qc = useQueryClient();
  const [couponOpen, setCouponOpen] = useState(false);
  const [couponForm, setCouponForm] = useState({
    code: "",
    discountInr: 0,
    discountStars: 0,
    discountPct: 0,
    usageLimit: 100,
    expiresAt: "",
  });

  const { data: settings, isLoading: settingsLoading } = useQuery<AiSettings>({
    queryKey: ["admin-ai-settings"],
    queryFn: () => apiFetch("/ai-settings"),
  });

  const { data: coupons = [], isLoading: couponsLoading } = useQuery<CouponCode[]>({
    queryKey: ["admin-coupons"],
    queryFn: () => apiFetch("/coupons"),
  });

  const [form, setForm] = useState<AiSettings>({
    aiEnabled: true,
    doubtPrompt: DEFAULT_DOUBT_PROMPT,
    aiInfoPrompt: DEFAULT_AI_INFO_PROMPT,
  });

  const settingsMut = useMutation({
    mutationFn: (data: AiSettings) => apiFetch("/ai-settings", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      toast.success("AI settings saved!");
      qc.invalidateQueries({ queryKey: ["admin-ai-settings"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const couponMut = useMutation({
    mutationFn: (data: typeof couponForm) => apiFetch("/coupons", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      toast.success("Coupon created!");
      qc.invalidateQueries({ queryKey: ["admin-coupons"] });
      setCouponOpen(false);
      setCouponForm({ code: "", discountInr: 0, discountStars: 0, discountPct: 0, usageLimit: 100, expiresAt: "" });
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

  const current = settings ?? form;
  const displayForm = settingsLoading ? form : { ...form, ...settings };

  const handleSave = () => {
    settingsMut.mutate(displayForm);
  };

  if (settingsLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">AI Settings</h1>
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Brain className="h-6 w-6 text-primary" />
            AI & Coupon Settings
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Configure AI prompts, enable/disable AI features, and manage coupon codes
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-yellow-500" />
              AI Features Toggle
            </div>
            <div className="flex items-center gap-3">
              <Label className="text-sm font-normal">
                {(settings?.aiEnabled ?? true) ? "Enabled" : "Disabled"}
              </Label>
              <Switch
                checked={displayForm.aiEnabled}
                onCheckedChange={(v) => setForm(f => ({ ...f, aiEnabled: v }))}
              />
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            When disabled, /doubt command and AI Info button will show a maintenance message to all users.
          </p>
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
          <p className="text-sm text-muted-foreground">This prompt is sent as the system message when a user uses /doubt command.</p>
          <Textarea
            rows={6}
            value={displayForm.doubtPrompt || DEFAULT_DOUBT_PROMPT}
            onChange={(e) => setForm(f => ({ ...f, doubtPrompt: e.target.value }))}
            className="font-mono text-xs"
            placeholder={DEFAULT_DOUBT_PROMPT}
          />
          <Button variant="outline" size="sm" onClick={() => setForm(f => ({ ...f, doubtPrompt: DEFAULT_DOUBT_PROMPT }))}>
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
          <p className="text-sm text-muted-foreground">This prompt guides the AI when analyzing quiz questions in the solution book.</p>
          <Textarea
            rows={6}
            value={displayForm.aiInfoPrompt || DEFAULT_AI_INFO_PROMPT}
            onChange={(e) => setForm(f => ({ ...f, aiInfoPrompt: e.target.value }))}
            className="font-mono text-xs"
            placeholder={DEFAULT_AI_INFO_PROMPT}
          />
          <Button variant="outline" size="sm" onClick={() => setForm(f => ({ ...f, aiInfoPrompt: DEFAULT_AI_INFO_PROMPT }))}>
            Reset to Default
          </Button>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={settingsMut.isPending} className="gap-2">
          <Save className="h-4 w-4" />
          {settingsMut.isPending ? "Saving…" : "Save AI Settings"}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Tag className="h-5 w-5 text-orange-500" />
              Coupon Codes
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
              <p>No coupon codes yet.</p>
              <Button className="mt-3" size="sm" onClick={() => setCouponOpen(true)}>Create First Coupon</Button>
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
                {coupons.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono font-bold">{c.code}</TableCell>
                    <TableCell>
                      {c.discountPct > 0 && <span className="text-green-600 font-medium">{c.discountPct}% off</span>}
                      {c.discountInr > 0 && <span className="text-green-600 font-medium">₹{c.discountInr} off</span>}
                      {c.discountStars > 0 && <span className="text-yellow-600 font-medium ml-1">{c.discountStars}⭐ off</span>}
                    </TableCell>
                    <TableCell>{c.usedCount}/{c.usageLimit}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {c.expiresAt ? new Date(c.expiresAt).toLocaleDateString("en-IN") : "Never"}
                    </TableCell>
                    <TableCell>
                      {c.isActive && c.usedCount < c.usageLimit ? (
                        <Badge className="bg-green-100 text-green-800 border-none">Active</Badge>
                      ) : (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:bg-destructive/10"
                        onClick={() => {
                          if (confirm(`Delete coupon ${c.code}?`)) deleteCouponMut.mutate(c.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={couponOpen} onOpenChange={setCouponOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Coupon Code</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Coupon Code *</Label>
              <Input
                className="mt-1 uppercase font-mono"
                placeholder="e.g. SAVE50"
                value={couponForm.code}
                onChange={(e) => setCouponForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>₹ Discount (INR)</Label>
                <Input type="number" className="mt-1" value={couponForm.discountInr}
                  onChange={(e) => setCouponForm(f => ({ ...f, discountInr: parseInt(e.target.value) || 0 }))} />
              </div>
              <div>
                <Label>% Discount</Label>
                <Input type="number" className="mt-1" value={couponForm.discountPct}
                  onChange={(e) => setCouponForm(f => ({ ...f, discountPct: parseInt(e.target.value) || 0 }))} />
              </div>
              <div>
                <Label>⭐ Stars Off</Label>
                <Input type="number" className="mt-1" value={couponForm.discountStars}
                  onChange={(e) => setCouponForm(f => ({ ...f, discountStars: parseInt(e.target.value) || 0 }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Usage Limit</Label>
                <Input type="number" className="mt-1" value={couponForm.usageLimit}
                  onChange={(e) => setCouponForm(f => ({ ...f, usageLimit: parseInt(e.target.value) || 1 }))} />
              </div>
              <div>
                <Label>Expires At (optional)</Label>
                <Input type="datetime-local" className="mt-1" value={couponForm.expiresAt}
                  onChange={(e) => setCouponForm(f => ({ ...f, expiresAt: e.target.value }))} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Set either % discount OR ₹ discount (not both). % takes priority.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCouponOpen(false)}>Cancel</Button>
            <Button
              disabled={!couponForm.code || couponMut.isPending}
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

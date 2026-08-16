import { useState, useEffect } from "react";
import {
  useAdminListTests,
  useAdminDeleteTest,
  useAdminToggleTest,
  getAdminListTestsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, BarChart2, Clock, Pencil, ChevronDown, WandSparkles, Save, PlusCircle, X } from "lucide-react";
import { useLocation } from "wouter";
import { QuestionAnalyticsPanel } from "@/components/question-analytics-panel";

const BASE = "/api/admin";

type CategoryMap = Record<string, string[]>;

interface TestForm {
  testName: string;
  mainCategory: string;
  subCategory: string;
  priceInr: number;
  priceInStars: number;
  positiveMarking: number;
  negativeMarking: number;
  timerSeconds: number;
  webTimerSeconds: number;
  language: string;
  questionsJson: string;
}

interface StudioQuestion {
  id?: string;
  question: string;
  options: string[];
  correctOptionIndex: number;
  explanation: string;
  language?: string;
}

const emptyForm = (): TestForm => ({
  testName: "",
  mainCategory: "",
  subCategory: "",
  priceInr: 0,
  priceInStars: 0,
  positiveMarking: 1,
  negativeMarking: 0.25,
  timerSeconds: 30,
  webTimerSeconds: 3600,
  language: "en",
  questionsJson: "",
});

export default function Tests() {
  const { data: tests, isLoading } = useAdminListTests();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [categories, setCategories] = useState<CategoryMap>({});
  const [importOpen, setImportOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editTestId, setEditTestId] = useState<string | null>(null);
  const [formData, setFormData] = useState<TestForm>(emptyForm());
  const [submitting, setSubmitting] = useState(false);
  const [studioTest, setStudioTest] = useState<any | null>(null);
  const [studioQuestions, setStudioQuestions] = useState<StudioQuestion[]>([]);
  const [studioSaving, setStudioSaving] = useState(false);
  const [analyticsTestId, setAnalyticsTestId] = useState<string | null>(null);
  const [analyticsData, setAnalyticsData] = useState<any | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  const [newMainCat, setNewMainCat] = useState("");
  const [newSubCat, setNewSubCat] = useState("");
  const [showNewMain, setShowNewMain] = useState(false);
  const [showNewSub, setShowNewSub] = useState(false);

  useEffect(() => {
    fetch(`${BASE}/categories`, { credentials: "include" })
      .then(r => r.json())
      .then((cats: CategoryMap) => setCategories(cats))
      .catch(() => {});
  }, []);

  const toggleMutation = useAdminToggleTest({
    mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getAdminListTestsQueryKey() }) }
  });

  const deleteMutation = useAdminDeleteTest({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getAdminListTestsQueryKey() });
        toast({ title: "Test deleted" });
      }
    }
  });

  const addCategory = async () => {
    if (!newMainCat.trim()) return;
    const r = await fetch(`${BASE}/categories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ main: newMainCat.trim() }),
    });
    if (r.ok) {
      const cats = await r.json() as CategoryMap;
      setCategories(cats);
      setFormData({ ...formData, mainCategory: newMainCat.trim(), subCategory: "" });
      setNewMainCat("");
      setShowNewMain(false);
    }
  };

  const addSubCategory = async () => {
    if (!formData.mainCategory || !newSubCat.trim()) return;
    const r = await fetch(`${BASE}/categories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ main: formData.mainCategory, sub: newSubCat.trim() }),
    });
    if (r.ok) {
      const cats = await r.json() as CategoryMap;
      setCategories(cats);
      setFormData({ ...formData, subCategory: newSubCat.trim() });
      setNewSubCat("");
      setShowNewSub(false);
    }
  };

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    try { JSON.parse(formData.questionsJson); } catch {
      toast({ title: "Invalid JSON", description: "Questions JSON must be valid.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    const r = await fetch(`${BASE}/tests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(formData),
    });
    setSubmitting(false);
    if (r.ok) {
      queryClient.invalidateQueries({ queryKey: getAdminListTestsQueryKey() });
      toast({ title: "✅ Test imported successfully" });
      setImportOpen(false);
      setFormData(emptyForm());
    } else {
      const err = await r.json() as { error: string };
      toast({ title: "Import failed", description: err.error, variant: "destructive" });
    }
  };

  const openEdit = (test: any) => {
    setEditTestId(test.testId);
    setFormData({
      testName: test.testName,
      mainCategory: test.mainCategory,
      subCategory: test.subCategory,
      priceInr: test.priceInr,
      priceInStars: test.priceInStars,
      positiveMarking: test.positiveMarking,
      negativeMarking: test.negativeMarking,
      timerSeconds: test.timerSeconds ?? 30,
      webTimerSeconds: test.webTimerSeconds ?? 3600,
      language: "en",
      questionsJson: "",
    });
    setEditOpen(true);
  };

  const openStudio = (test: any) => {
    setStudioTest(test);
    setStudioQuestions((Array.isArray(test.questionsData) ? test.questionsData : []).map((q: any, index: number) => ({
      id: q.id ?? `${test.testId}_q${index}`,
      question: q.question ?? "",
      options: Array.isArray(q.options) && q.options.length ? [...q.options] : ["", "", "", ""],
      correctOptionIndex: Number.isInteger(q.correctOptionIndex) ? q.correctOptionIndex : 0,
      explanation: q.explanation ?? "",
      language: q.language,
    })));
  };

  const updateQuestion = (index: number, patch: Partial<StudioQuestion>) => {
    setStudioQuestions((current) => current.map((question, qIndex) => qIndex === index ? { ...question, ...patch } : question));
  };

  const updateOption = (questionIndex: number, optionIndex: number, value: string) => {
    setStudioQuestions((current) => current.map((question, index) => {
      if (index !== questionIndex) return question;
      const options = [...question.options];
      options[optionIndex] = value;
      return { ...question, options };
    }));
  };

  const addStudioQuestion = () => {
    setStudioQuestions((current) => [...current, { question: "", options: ["", "", "", ""], correctOptionIndex: 0, explanation: "" }]);
  };

  const removeStudioQuestion = (index: number) => {
    setStudioQuestions((current) => current.filter((_, qIndex) => qIndex !== index));
  };

  const saveStudio = async () => {
    if (!studioTest) return;
    if (studioQuestions.some((question) => !question.question.trim() || question.options.some((option) => !option.trim()))) {
      toast({ title: "Incomplete question", description: "Every question and all four options are required.", variant: "destructive" });
      return;
    }
    setStudioSaving(true);
    try {
      const response = await fetch(`${BASE}/tests/${studioTest.testId}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionsJson: JSON.stringify(studioQuestions), language: "en" }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? "Failed to save questions");
      queryClient.invalidateQueries({ queryKey: getAdminListTestsQueryKey() });
      setStudioTest(null);
      toast({ title: "✅ Studio changes saved", description: `${studioQuestions.length} questions updated.` });
    } catch (error) {
      toast({ title: "Studio save failed", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" });
    } finally {
      setStudioSaving(false);
    }
  };

  const openAnalytics = async (testId: string) => {
    setAnalyticsTestId(testId);
    setAnalyticsData(null);
    setAnalyticsLoading(true);
    try {
      const response = await fetch(`${BASE}/tests/${testId}/analytics`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load analytics");
      setAnalyticsData(await response.json());
    } catch (error) {
      toast({ title: "Analytics unavailable", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" });
    } finally {
      setAnalyticsLoading(false);
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTestId) return;
    if (formData.questionsJson) {
      try { JSON.parse(formData.questionsJson); } catch {
        toast({ title: "Invalid JSON", variant: "destructive" });
        return;
      }
    }
    setSubmitting(true);
    const payload: Record<string, unknown> = { ...formData };
    if (!formData.questionsJson) delete payload["questionsJson"];
    const r = await fetch(`${BASE}/tests/${editTestId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    setSubmitting(false);
    if (r.ok) {
      queryClient.invalidateQueries({ queryKey: getAdminListTestsQueryKey() });
      toast({ title: "✅ Test updated" });
      setEditOpen(false);
    } else {
      const err = await r.json() as { error: string };
      toast({ title: "Update failed", description: err.error, variant: "destructive" });
    }
  };

  const mainCategories = Object.keys(categories);
  const subCategories = formData.mainCategory ? (categories[formData.mainCategory] ?? []) : [];

  const renderFormFields = (isEdit = false) => (
    <div className="space-y-6 mt-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2 space-y-2">
          <Label>Test Name</Label>
          <Input required value={formData.testName} onChange={e => setFormData({ ...formData, testName: e.target.value })} placeholder="SSC CGL Tier 1 Mock 1" />
        </div>

        <div className="space-y-2">
          <Label>Main Category</Label>
          {!showNewMain ? (
            <div className="flex gap-2">
              <Select value={formData.mainCategory} onValueChange={v => setFormData({ ...formData, mainCategory: v, subCategory: "" })}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {mainCategories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button type="button" variant="outline" size="sm" onClick={() => setShowNewMain(true)} className="shrink-0">
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input value={newMainCat} onChange={e => setNewMainCat(e.target.value)} placeholder="New category name" className="flex-1" />
              <Button type="button" size="sm" onClick={addCategory}>Add</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowNewMain(false)}>✕</Button>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label>Sub Category</Label>
          {!showNewSub ? (
            <div className="flex gap-2">
              <Select
                value={formData.subCategory}
                onValueChange={v => setFormData({ ...formData, subCategory: v })}
                disabled={!formData.mainCategory}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder={!formData.mainCategory ? "Select main first" : "Select subcategory"} />
                </SelectTrigger>
                <SelectContent>
                  {subCategories.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button type="button" variant="outline" size="sm" onClick={() => setShowNewSub(true)} disabled={!formData.mainCategory} className="shrink-0">
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input value={newSubCat} onChange={e => setNewSubCat(e.target.value)} placeholder="New subcategory" className="flex-1" />
              <Button type="button" size="sm" onClick={addSubCategory}>Add</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowNewSub(false)}>✕</Button>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label>Price (INR) — 0 = Free</Label>
          <Input type="number" min={0} value={formData.priceInr} onChange={e => setFormData({ ...formData, priceInr: parseInt(e.target.value) })} />
        </div>
        <div className="space-y-2">
          <Label>Price (Stars) — 0 = Free</Label>
          <Input type="number" min={0} value={formData.priceInStars} onChange={e => setFormData({ ...formData, priceInStars: parseInt(e.target.value) })} />
        </div>
        <div className="space-y-2">
          <Label>Positive Marking</Label>
          <Input type="number" step="0.5" value={formData.positiveMarking} onChange={e => setFormData({ ...formData, positiveMarking: parseFloat(e.target.value) })} />
        </div>
        <div className="space-y-2">
          <Label>Negative Marking</Label>
          <Input type="number" step="0.25" value={formData.negativeMarking} onChange={e => setFormData({ ...formData, negativeMarking: parseFloat(e.target.value) })} />
        </div>
        <div className="space-y-2">
          <Label className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> Telegram question timer (seconds)</Label>
          <Input type="number" min={10} max={300} value={formData.timerSeconds} onChange={e => setFormData({ ...formData, timerSeconds: parseInt(e.target.value) })} />
          <p className="text-xs text-muted-foreground">Used by the Telegram per-question quiz.</p>
        </div>
        <div className="space-y-2">
          <Label className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> Web test duration (seconds)</Label>
          <Input type="number" min={60} max={14400} value={formData.webTimerSeconds} onChange={e => setFormData({ ...formData, webTimerSeconds: parseInt(e.target.value) || 3600 })} />
          <p className="text-xs text-muted-foreground">Overall countdown shown in the Premium web app.</p>
        </div>
        <div className="space-y-2">
          <Label>Language</Label>
          <Select value={formData.language} onValueChange={v => setFormData({ ...formData, language: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="en">🇬🇧 English</SelectItem>
              <SelectItem value="hi">🇮🇳 Hindi</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label>
          Questions JSON Array
          {isEdit && <span className="ml-2 text-xs text-muted-foreground">(leave empty to keep existing questions)</span>}
        </Label>
        <div className="text-xs text-muted-foreground mb-2 font-mono bg-muted p-2 rounded">
          {`[{"question":"...","options":["A","B","C","D"],"correctOptionIndex":0,"explanation":"..."}]`}
        </div>
        <Textarea
          required={!isEdit}
          className="font-mono h-52 text-sm"
          value={formData.questionsJson}
          onChange={e => setFormData({ ...formData, questionsJson: e.target.value })}
          placeholder="Paste JSON array here..."
        />
        <p className="text-xs text-muted-foreground">
          ⚠️ <strong>correctOptionIndex</strong> is 0-based (0 = first option). Explanation max 200 chars.
        </p>
      </div>
    </div>
  );

  if (isLoading) return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Test Series</h1>
      <Skeleton className="h-64 w-full" />
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Test Series Management</h1>
          <p className="text-muted-foreground mt-1">Manage mock tests, question banks, and pricing.</p>
        </div>
        <Button className="bg-primary hover:bg-primary/90" onClick={() => { setFormData(emptyForm()); setImportOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" /> Import Test
        </Button>
      </div>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Import New Test Series</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground -mt-2">
            🔑 Test ID will be auto-generated (6-char hex).
          </p>
          <form onSubmit={handleImport}>
            {renderFormFields()}
            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => setImportOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Importing..." : "Import Test"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Test Series</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground -mt-2 font-mono">ID: {editTestId}</p>
          <form onSubmit={handleEdit}>
            {renderFormFields(true)}
            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Sheet open={!!studioTest} onOpenChange={(open) => !open && setStudioTest(null)}>
        <SheetContent className="w-full sm:max-w-3xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2"><WandSparkles className="h-5 w-5 text-primary" /> Test Studio</SheetTitle>
            <SheetDescription>{studioTest?.testName} · Edit questions, options, correct answers and solutions.</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 py-5">
            <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-3">
              <div><p className="font-semibold">{studioQuestions.length} questions</p><p className="text-xs text-muted-foreground">Changes replace the question bank used by this test.</p></div>
              <Button variant="outline" size="sm" onClick={addStudioQuestion}><PlusCircle className="h-4 w-4 mr-1" /> Add question</Button>
            </div>
            {studioQuestions.map((question, questionIndex) => (
              <div key={question.id ?? `new-${questionIndex}`} className="rounded-xl border p-4 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1"><Label>Question {questionIndex + 1}</Label><Textarea className="mt-1 min-h-20" value={question.question} onChange={(event) => updateQuestion(questionIndex, { question: event.target.value })} /></div>
                  <Button variant="ghost" size="icon" className="text-destructive" title="Remove question" onClick={() => removeStudioQuestion(questionIndex)}><X className="h-4 w-4" /></Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {question.options.map((option, optionIndex) => (
                    <div key={optionIndex} className={`rounded-lg border p-2 ${question.correctOptionIndex === optionIndex ? "border-emerald-500 bg-emerald-500/5" : ""}`}>
                      <div className="flex items-center gap-2"><input type="radio" name={`correct-${questionIndex}`} checked={question.correctOptionIndex === optionIndex} onChange={() => updateQuestion(questionIndex, { correctOptionIndex: optionIndex })} /><Label className="text-xs">Option {String.fromCharCode(65 + optionIndex)} {question.correctOptionIndex === optionIndex ? "(correct)" : ""}</Label></div>
                      <Input className="mt-1" value={option} onChange={(event) => updateOption(questionIndex, optionIndex, event.target.value)} />
                    </div>
                  ))}
                </div>
                <div><Label>Solution / explanation</Label><Textarea className="mt-1 min-h-16" value={question.explanation} onChange={(event) => updateQuestion(questionIndex, { explanation: event.target.value })} placeholder="Explain why the correct option is right…" /></div>
              </div>
            ))}
            {!studioQuestions.length && <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No questions yet. Add the first question to this test.</div>}
            <Button className="w-full" onClick={saveStudio} disabled={studioSaving}><Save className="h-4 w-4 mr-2" />{studioSaving ? "Saving studio…" : "Save studio changes"}</Button>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={!!analyticsTestId} onOpenChange={(open) => !open && setAnalyticsTestId(null)}>
        <SheetContent className="w-full sm:max-w-5xl overflow-y-auto">
          <SheetHeader><SheetTitle>Test analytics</SheetTitle><SheetDescription>{analyticsData?.testName ?? "Performance insights for this test series."}</SheetDescription></SheetHeader>
          <div className="py-5 space-y-5">
            {analyticsLoading && <p className="text-sm text-muted-foreground">Loading analytics…</p>}
            {analyticsData && <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[["Attempts", analyticsData.totalAttempts], ["Avg score", analyticsData.avgScore], ["Accuracy", `${analyticsData.avgAccuracy}%`], ["Best score", analyticsData.bestScore]].map(([label, value]) => <div key={String(label)} className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-bold mt-1">{value}</p></div>)}</div>
              <div className="rounded-lg border p-4 space-y-3"><h3 className="font-semibold">Score distribution</h3>{analyticsData.scoreDistribution.map((item: any) => <div key={item.range} className="flex justify-between text-sm"><span>{item.range}</span><span className="font-semibold">{item.count}</span></div>)}</div>
              <div className="rounded-lg border p-4"><h3 className="font-semibold mb-3">Top scorers</h3>{analyticsData.topScorers.length ? analyticsData.topScorers.map((item: any) => <div key={item.userId} className="flex justify-between text-sm py-1"><span>{item.name}</span><span className="font-semibold">{item.score}</span></div>) : <p className="text-sm text-muted-foreground">No attempts yet.</p>}</div>
              <QuestionAnalyticsPanel questions={analyticsData.questions} insights={analyticsData.insights} totalAttempts={analyticsData.totalAttempts} />
            </div>}
          </div>
        </SheetContent>
      </Sheet>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Qs</TableHead>
                  <TableHead>Timers</TableHead>
                <TableHead>Pricing</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tests?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center h-32 text-muted-foreground">
                    No tests found. Import your first test above.
                  </TableCell>
                </TableRow>
              ) : tests?.map((test) => (
                <TableRow key={test.id}>
                  <TableCell>
                    <div className="font-semibold">{test.testName}</div>
                    <div className="text-xs text-muted-foreground font-mono">{test.testId}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="mr-1">{test.mainCategory}</Badge>
                    <div className="text-xs text-muted-foreground mt-1">{test.subCategory}</div>
                  </TableCell>
                  <TableCell className="font-semibold">{test.questionCount}</TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1 text-sm">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>{(test as any).timerSeconds ?? 30}s / Q</span>
                      <span className="text-xs text-primary">Web {Math.round(((test as any).webTimerSeconds ?? 3600) / 60)} min</span>
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">
                    {test.priceInr === 0 ? (
                      <Badge className="bg-green-100 text-green-800 border-green-200">Free</Badge>
                    ) : (
                      <span>₹{test.priceInr} / {test.priceInStars}⭐</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={test.isActive}
                        onCheckedChange={() => toggleMutation.mutate({ testId: test.testId })}
                        disabled={toggleMutation.isPending}
                      />
                      <span className="text-sm text-muted-foreground">{test.isActive ? "Active" : "Draft"}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Edit Test"
                        onClick={() => openEdit(test)}
                      >
                        <Pencil className="h-4 w-4 text-amber-500" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="View Analytics"
                        onClick={() => openAnalytics(test.testId)}
                      >
                        <BarChart2 className="h-4 w-4 text-blue-500" />
                      </Button>
                      <Button variant="ghost" size="icon" title="Open Test Studio" onClick={() => openStudio(test)}>
                        <WandSparkles className="h-4 w-4 text-violet-500" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:bg-destructive/10"
                        onClick={() => {
                          if (confirm(`Delete "${test.testName}"? This cannot be undone.`)) {
                            deleteMutation.mutate({ testId: test.testId });
                          }
                        }}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

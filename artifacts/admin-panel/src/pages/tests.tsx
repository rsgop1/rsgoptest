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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, BarChart2, Clock, Pencil, ChevronDown } from "lucide-react";
import { useLocation } from "wouter";

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
  language: string;
  questionsJson: string;
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
      language: "en",
      questionsJson: "",
    });
    setEditOpen(true);
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

  const FormFields = ({ isEdit = false }: { isEdit?: boolean }) => (
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
          <Label className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> Timer (seconds)</Label>
          <Input type="number" min={10} max={300} value={formData.timerSeconds} onChange={e => setFormData({ ...formData, timerSeconds: parseInt(e.target.value) })} />
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
            <FormFields />
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
            <FormFields isEdit />
            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Qs</TableHead>
                <TableHead>Timer</TableHead>
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
                      {(test as any).timerSeconds ?? 30}s
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
                        onClick={() => navigate(`/analytics?testId=${test.testId}`)}
                      >
                        <BarChart2 className="h-4 w-4 text-blue-500" />
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

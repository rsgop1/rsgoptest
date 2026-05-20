import { useState } from "react";
import {
  useAdminListTests,
  useAdminImportTest,
  useAdminDeleteTest,
  useAdminToggleTest,
  getAdminListTestsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, BarChart2, Clock } from "lucide-react";
import { useLocation } from "wouter";

export default function Tests() {
  const { data: tests, isLoading } = useAdminListTests();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [importOpen, setImportOpen] = useState(false);
  const [importData, setImportData] = useState({
    testId: "",
    testName: "",
    mainCategory: "",
    subCategory: "",
    priceInr: 0,
    priceInStars: 0,
    positiveMarking: 1,
    negativeMarking: 0.25,
    timerSeconds: 30,
    language: "en",
    questionsJson: ""
  });

  const importMutation = useAdminImportTest({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getAdminListTestsQueryKey() });
        toast({ title: "✅ Test imported successfully" });
        setImportOpen(false);
        setImportData({
          testId: "", testName: "", mainCategory: "", subCategory: "",
          priceInr: 0, priceInStars: 0, positiveMarking: 1, negativeMarking: 0.25,
          timerSeconds: 30, language: "en", questionsJson: ""
        });
      },
      onError: (err: any) => {
        toast({ title: "Import failed", description: err.message, variant: "destructive" });
      }
    }
  });

  const toggleMutation = useAdminToggleTest({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getAdminListTestsQueryKey() })
    }
  });

  const deleteMutation = useAdminDeleteTest({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getAdminListTestsQueryKey() });
        toast({ title: "Test deleted" });
      }
    }
  });

  const handleImport = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      JSON.parse(importData.questionsJson);
      importMutation.mutate({ data: importData });
    } catch {
      toast({ title: "Invalid JSON", description: "Questions JSON must be a valid array.", variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Test Series</h1>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Test Series Management</h1>
          <p className="text-muted-foreground mt-1">Manage mock tests, question banks, and pricing.</p>
        </div>
        <Dialog open={importOpen} onOpenChange={setImportOpen}>
          <DialogTrigger asChild>
            <Button className="bg-primary hover:bg-primary/90">
              <Plus className="h-4 w-4 mr-2" />
              Import Test
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Import New Test Series</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleImport} className="space-y-6 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Test ID (Unique slug)</Label>
                  <Input required value={importData.testId} onChange={e => setImportData({...importData, testId: e.target.value})} placeholder="e.g. ssc_cgl_mock_1" />
                </div>
                <div className="space-y-2">
                  <Label>Test Name</Label>
                  <Input required value={importData.testName} onChange={e => setImportData({...importData, testName: e.target.value})} placeholder="SSC CGL Tier 1 Mock 1" />
                </div>
                <div className="space-y-2">
                  <Label>Main Category</Label>
                  <Input required value={importData.mainCategory} onChange={e => setImportData({...importData, mainCategory: e.target.value})} placeholder="SSC" />
                </div>
                <div className="space-y-2">
                  <Label>Sub Category</Label>
                  <Input required value={importData.subCategory} onChange={e => setImportData({...importData, subCategory: e.target.value})} placeholder="CGL Tier 1" />
                </div>
                <div className="space-y-2">
                  <Label>Price (INR) — 0 = Free</Label>
                  <Input type="number" min={0} required value={importData.priceInr} onChange={e => setImportData({...importData, priceInr: parseInt(e.target.value)})} />
                </div>
                <div className="space-y-2">
                  <Label>Price (Stars) — 0 = Free</Label>
                  <Input type="number" min={0} required value={importData.priceInStars} onChange={e => setImportData({...importData, priceInStars: parseInt(e.target.value)})} />
                </div>
                <div className="space-y-2">
                  <Label>Positive Marking</Label>
                  <Input type="number" step="0.5" required value={importData.positiveMarking} onChange={e => setImportData({...importData, positiveMarking: parseFloat(e.target.value)})} />
                </div>
                <div className="space-y-2">
                  <Label>Negative Marking</Label>
                  <Input type="number" step="0.25" required value={importData.negativeMarking} onChange={e => setImportData({...importData, negativeMarking: parseFloat(e.target.value)})} />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> Timer per Question (seconds)</Label>
                  <Input type="number" min={10} max={300} required value={importData.timerSeconds} onChange={e => setImportData({...importData, timerSeconds: parseInt(e.target.value)})} placeholder="30" />
                </div>
                <div className="space-y-2">
                  <Label>Questions Language</Label>
                  <Select value={importData.language} onValueChange={v => setImportData({...importData, language: v})}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">🇬🇧 English</SelectItem>
                      <SelectItem value="hi">🇮🇳 Hindi</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Questions JSON Array</Label>
                <div className="text-xs text-muted-foreground mb-2 font-mono bg-muted p-2 rounded">
                  {`[{ "question": "...", "options": ["A","B","C","D"], "correctOptionIndex": 0, "explanation": "..." }]`}
                </div>
                <Textarea
                  required
                  className="font-mono h-52 text-sm"
                  value={importData.questionsJson}
                  onChange={e => setImportData({...importData, questionsJson: e.target.value})}
                  placeholder="Paste JSON array here..."
                />
                <p className="text-xs text-muted-foreground">
                  ⚠️ <strong>correctOptionIndex</strong> is 0-based (first option = 0, second = 1, etc.)
                  <br />⚠️ Explanation max 200 chars for Telegram polls
                </p>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setImportOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={importMutation.isPending}>
                  {importMutation.isPending ? "Importing..." : "Import Test"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

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
              ) : (
                tests?.map((test) => (
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
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

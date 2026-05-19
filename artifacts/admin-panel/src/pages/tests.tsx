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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, FileText, CheckCircle2 } from "lucide-react";

export default function Tests() {
  const { data: tests, isLoading } = useAdminListTests();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [importOpen, setImportOpen] = useState(false);
  const [importData, setImportData] = useState({
    testId: "",
    testName: "",
    mainCategory: "",
    subCategory: "",
    priceInr: 0,
    priceInStars: 0,
    positiveMarking: 1,
    negativeMarking: 0,
    questionsJson: ""
  });

  const importMutation = useAdminImportTest({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getAdminListTestsQueryKey() });
        toast({ title: "Test imported successfully" });
        setImportOpen(false);
        setImportData({
          testId: "", testName: "", mainCategory: "", subCategory: "", 
          priceInr: 0, priceInStars: 0, positiveMarking: 1, negativeMarking: 0, questionsJson: ""
        });
      },
      onError: (err: any) => {
        toast({ title: "Import failed", description: err.message, variant: "destructive" });
      }
    }
  });

  const toggleMutation = useAdminToggleTest({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getAdminListTestsQueryKey() });
      }
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
    } catch (err) {
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
                  <Label>Test ID (Unique)</Label>
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
                  <Label>Price (INR)</Label>
                  <Input type="number" required value={importData.priceInr} onChange={e => setImportData({...importData, priceInr: parseInt(e.target.value)})} />
                </div>
                <div className="space-y-2">
                  <Label>Price (Stars)</Label>
                  <Input type="number" required value={importData.priceInStars} onChange={e => setImportData({...importData, priceInStars: parseInt(e.target.value)})} />
                </div>
                <div className="space-y-2">
                  <Label>Positive Marking</Label>
                  <Input type="number" step="0.5" required value={importData.positiveMarking} onChange={e => setImportData({...importData, positiveMarking: parseFloat(e.target.value)})} />
                </div>
                <div className="space-y-2">
                  <Label>Negative Marking</Label>
                  <Input type="number" step="0.25" required value={importData.negativeMarking} onChange={e => setImportData({...importData, negativeMarking: parseFloat(e.target.value)})} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Questions JSON Array</Label>
                <div className="text-xs text-muted-foreground mb-2">
                  Format: {`[{ "question": "...", "options": ["A","B","C","D"], "correctOptionIndex": 0, "explanation": "..." }]`}
                </div>
                <Textarea 
                  required 
                  className="font-mono h-48 text-sm"
                  value={importData.questionsJson} 
                  onChange={e => setImportData({...importData, questionsJson: e.target.value})}
                  placeholder="Paste JSON array here..."
                />
              </div>
              <DialogFooter>
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
                <TableHead>Test ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Questions</TableHead>
                <TableHead>Pricing</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tests?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center h-32 text-muted-foreground">
                    No tests found.
                  </TableCell>
                </TableRow>
              ) : (
                tests?.map((test) => (
                  <TableRow key={test.id}>
                    <TableCell className="font-mono text-sm">{test.testId}</TableCell>
                    <TableCell className="font-semibold">{test.testName}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="mr-1">{test.mainCategory}</Badge>
                      <span className="text-xs text-muted-foreground">{test.subCategory}</span>
                    </TableCell>
                    <TableCell>{test.questionCount}</TableCell>
                    <TableCell className="text-sm">
                      ₹{test.priceInr} / {test.priceInStars} ⭐
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center space-x-2">
                        <Switch 
                          checked={test.isActive} 
                          onCheckedChange={() => toggleMutation.mutate({ testId: test.testId })}
                          disabled={toggleMutation.isPending}
                        />
                        <span className="text-sm text-muted-foreground">{test.isActive ? "Active" : "Draft"}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="text-destructive hover:bg-destructive/10"
                        onClick={() => {
                          if (confirm("Are you sure you want to delete this test?")) {
                            deleteMutation.mutate({ testId: test.testId });
                          }
                        }}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
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

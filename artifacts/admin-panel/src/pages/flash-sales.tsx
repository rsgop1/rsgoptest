import { useState } from "react";
import { 
  useAdminListFlashSales, 
  useAdminCreateFlashSale, 
  useAdminDeleteFlashSale,
  getAdminListFlashSalesQueryKey,
  useAdminListTests
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Tag, Trash2, Clock, Plus } from "lucide-react";

export default function FlashSales() {
  const { data: flashSales, isLoading } = useAdminListFlashSales();
  const { data: tests } = useAdminListTests();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState({
    testId: "",
    discountInr: 0,
    discountStars: 0,
    endsAt: ""
  });

  const createMutation = useAdminCreateFlashSale({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getAdminListFlashSalesQueryKey() });
        toast({ title: "Flash sale created" });
        setOpen(false);
        setFormData({ testId: "", discountInr: 0, discountStars: 0, endsAt: "" });
      }
    }
  });

  const deleteMutation = useAdminDeleteFlashSale({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getAdminListFlashSalesQueryKey() });
        toast({ title: "Flash sale deleted" });
      }
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({ data: formData });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Flash Sales</h1>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const activeSales = flashSales?.filter(fs => fs.isActive) || [];
  const pastSales = flashSales?.filter(fs => !fs.isActive) || [];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Flash Sales</h1>
          <p className="text-muted-foreground mt-1">Create limited-time discounts for test series.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-primary hover:bg-primary/90">
              <Plus className="h-4 w-4 mr-2" />
              New Flash Sale
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Flash Sale</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Target Test Series</Label>
                <Select value={formData.testId} onValueChange={(val) => setFormData({...formData, testId: val})}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a test series" />
                  </SelectTrigger>
                  <SelectContent>
                    {tests?.map(test => (
                      <SelectItem key={test.testId} value={test.testId}>{test.testName} ({test.testId})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Discount (INR)</Label>
                  <Input type="number" required value={formData.discountInr} onChange={e => setFormData({...formData, discountInr: parseInt(e.target.value)})} />
                </div>
                <div className="space-y-2">
                  <Label>Discount (Stars)</Label>
                  <Input type="number" required value={formData.discountStars} onChange={e => setFormData({...formData, discountStars: parseInt(e.target.value)})} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>End Date & Time</Label>
                <Input type="datetime-local" required value={formData.endsAt} onChange={e => setFormData({...formData, endsAt: e.target.value})} />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={createMutation.isPending || !formData.testId}>
                  {createMutation.isPending ? "Creating..." : "Create Flash Sale"}
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
                <TableHead>Discounts</TableHead>
                <TableHead>Ends At</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {flashSales?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center h-32 text-muted-foreground">
                    No flash sales found.
                  </TableCell>
                </TableRow>
              ) : (
                flashSales?.map((sale) => (
                  <TableRow key={sale.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center">
                        <Tag className="h-4 w-4 mr-2 text-primary" />
                        {sale.testId}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-green-600 font-medium">₹{sale.discountInr}</span>
                      <span className="mx-2 text-muted-foreground">|</span>
                      <span className="text-yellow-600 font-medium">{sale.discountStars} ⭐</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground flex items-center">
                      <Clock className="h-4 w-4 mr-2" />
                      {format(new Date(sale.endsAt), "MMM d, HH:mm")}
                    </TableCell>
                    <TableCell>
                      {sale.isActive ? (
                        <Badge className="bg-green-100 text-green-800 hover:bg-green-100 border-none animate-pulse">Live Now</Badge>
                      ) : (
                        <Badge variant="secondary">Expired</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button 
                        variant="ghost" 
                        size="icon"
                        className="text-destructive hover:bg-destructive/10"
                        onClick={() => {
                          if (confirm("Are you sure you want to end/delete this flash sale?")) {
                            deleteMutation.mutate({ id: sale.id });
                          }
                        }}
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

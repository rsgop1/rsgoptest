import { useState } from "react";
import {
  useAdminListPayments,
  useAdminApprovePayment,
  useAdminRejectPayment,
  getAdminListPaymentsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle, XCircle, Image as ImageIcon } from "lucide-react";

export default function Payments() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const { data: payments, isLoading } = useAdminListPayments(
    statusFilter !== "all" ? { params: { status: statusFilter } } : {}
  );
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  const approveMutation = useAdminApprovePayment({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getAdminListPaymentsQueryKey() });
        toast({ title: "✅ Payment approved successfully" });
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to approve payment", variant: "destructive" });
      }
    }
  });

  const rejectMutation = useAdminRejectPayment({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getAdminListPaymentsQueryKey() });
        toast({ title: "Payment rejected" });
      }
    }
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Payments</h1>
        <Card><CardContent className="p-6 space-y-4">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </CardContent></Card>
      </div>
    );
  }

  const getStatusBadge = (status: string) => {
    const s = status.toLowerCase();
    if (s === "pending") return <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100 border-yellow-200">Pending</Badge>;
    if (s === "approved") return <Badge className="bg-green-100 text-green-800 hover:bg-green-100 border-green-200">Approved</Badge>;
    if (s === "rejected") return <Badge variant="destructive">Rejected</Badge>;
    return <Badge variant="outline">{status}</Badge>;
  };

  const isPending = (status: string) => status.toLowerCase() === "pending";

  const pendingCount = payments?.filter(p => isPending(p.status)).length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Payments Queue</h1>
          <p className="text-muted-foreground mt-1">
            Approve or reject manual UPI transactions.
            {pendingCount > 0 && (
              <span className="ml-2 text-yellow-600 font-semibold">{pendingCount} pending</span>
            )}
          </p>
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Payments</SelectItem>
            <SelectItem value="Pending">Pending</SelectItem>
            <SelectItem value="Approved">Approved</SelectItem>
            <SelectItem value="Rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User ID</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Screenshot</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!payments?.length ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center h-32 text-muted-foreground">
                    No payments found.
                  </TableCell>
                </TableRow>
              ) : (
                payments.map((payment) => (
                  <TableRow key={payment.id} className={isPending(payment.status) ? "bg-yellow-50/50" : ""}>
                    <TableCell className="font-mono text-sm">{payment.userId}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{payment.method === "TG_Stars" ? "⭐ Stars" : "💳 UPI"}</Badge>
                    </TableCell>
                    <TableCell className="font-semibold">
                      {payment.method === "TG_Stars" ? `${payment.amount} ⭐` : `₹${payment.amount}`}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {format(new Date(payment.submittedAt), "MMM d, HH:mm")}
                    </TableCell>
                    <TableCell>{getStatusBadge(payment.status)}</TableCell>
                    <TableCell>
                      {payment.screenshotFileId ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedImage(`/api/admin/payment-image/${payment.screenshotFileId}`)}
                        >
                          <ImageIcon className="h-4 w-4 mr-1" />
                          View
                        </Button>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {isPending(payment.status) && (
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="default"
                            size="sm"
                            className="bg-green-600 hover:bg-green-700 text-white"
                            onClick={() => approveMutation.mutate({ paymentId: payment.paymentId })}
                            disabled={approveMutation.isPending || rejectMutation.isPending}
                          >
                            <CheckCircle className="h-4 w-4 mr-1" />
                            Approve
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => rejectMutation.mutate({ paymentId: payment.paymentId })}
                            disabled={approveMutation.isPending || rejectMutation.isPending}
                          >
                            <XCircle className="h-4 w-4 mr-1" />
                            Reject
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!selectedImage} onOpenChange={() => setSelectedImage(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Payment Screenshot</DialogTitle>
          </DialogHeader>
          <div className="flex justify-center p-4 bg-muted/30 rounded-md">
            {selectedImage && (
              <img src={selectedImage} alt="Payment proof" className="max-h-[70vh] object-contain rounded-md" />
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setSelectedImage(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

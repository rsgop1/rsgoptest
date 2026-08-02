import { useMemo, useState } from "react";
import {
  getAdminListSupportTicketsQueryKey,
  useAdminListSupportTickets,
  useAdminUpdateSupportTicket,
} from "@workspace/api-client-react";
import type { SupportTicket } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Inbox,
  LifeBuoy,
  MessageSquare,
  Search,
  ShieldAlert,
  UserRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

const statusLabels: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed",
};

function StatusBadge({ value }: { value: string }) {
  const styles: Record<string, string> = {
    open: "bg-amber-500/10 text-amber-700 border-amber-500/20",
    in_progress: "bg-blue-500/10 text-blue-700 border-blue-500/20",
    resolved: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20",
    closed: "bg-muted text-muted-foreground",
  };
  return <Badge variant="outline" className={styles[value] ?? ""}>{statusLabels[value] ?? value}</Badge>;
}

function PriorityBadge({ value }: { value: string }) {
  const styles: Record<string, string> = {
    urgent: "bg-rose-500/10 text-rose-700 border-rose-500/20",
    high: "bg-orange-500/10 text-orange-700 border-orange-500/20",
    normal: "bg-slate-500/10 text-slate-700 border-slate-500/20",
    low: "bg-muted text-muted-foreground",
  };
  return <Badge variant="outline" className={styles[value] ?? ""}>{value}</Badge>;
}

export default function Support() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("all");
  const [category, setCategory] = useState("all");
  const [priority, setPriority] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<SupportTicket | null>(null);
  const [note, setNote] = useState("");

  const { data: tickets = [], isLoading, isError } = useAdminListSupportTickets(
    { status, category, priority, search: search || undefined },
    {
      query: {
        queryKey: getAdminListSupportTicketsQueryKey({ status, category, priority, search: search || undefined }),
        refetchInterval: 20_000,
      },
    },
  );
  const updateTicket = useAdminUpdateSupportTicket({
    mutation: {
      onSuccess: () => {
        toast.success("Ticket updated");
        queryClient.invalidateQueries({ queryKey: getAdminListSupportTicketsQueryKey() });
        setSelected(null);
      },
      onError: (error) => toast.error(error.message),
    },
  });

  const stats = useMemo(() => ({
    open: tickets.filter((ticket) => ticket.status === "open").length,
    progress: tickets.filter((ticket) => ticket.status === "in_progress").length,
    urgent: tickets.filter((ticket) => ["urgent", "high"].includes(ticket.priority)).length,
    resolved: tickets.filter((ticket) => ["resolved", "closed"].includes(ticket.status)).length,
  }), [tickets]);

  const categories = [...new Set(tickets.map((ticket) => ticket.category))].sort();

  const openTicket = (ticket: SupportTicket) => {
    setSelected(ticket);
    setNote(ticket.adminNote ?? "");
  };

  const saveTicket = (nextStatus?: string) => {
    if (!selected) return;
    updateTicket.mutate({
      id: selected.id,
      data: {
        status: nextStatus ?? selected.status,
        priority: selected.priority,
        adminNote: note.trim() || null,
      },
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-primary text-sm font-semibold uppercase tracking-wider">
            <LifeBuoy className="h-4 w-4" /> Operations
          </div>
          <h1 className="text-3xl font-bold tracking-tight mt-2">Support Inbox</h1>
          <p className="text-muted-foreground mt-1">Triage, respond to, and resolve Telegram support tickets.</p>
        </div>
        <Button variant="outline" onClick={() => queryClient.invalidateQueries({ queryKey: getAdminListSupportTicketsQueryKey() })}>
          Refresh inbox
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {([
          ["Open", stats.open, Inbox, "text-amber-600"],
          ["In progress", stats.progress, Clock3, "text-blue-600"],
          ["High attention", stats.urgent, ShieldAlert, "text-rose-600"],
          ["Resolved", stats.resolved, CheckCircle2, "text-emerald-600"],
        ] as const).map(([label, value, Icon, color]) => (
          <Card key={String(label)} className="border-border/70">
            <CardContent className="p-5 flex items-center justify-between">
              <div><p className="text-sm text-muted-foreground">{label}</p><p className="text-2xl font-bold mt-1">{value}</p></div>
              <div className={`rounded-xl bg-muted p-3 ${color}`}><Icon className="h-5 w-5" /></div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="border-b bg-muted/20 pb-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <CardTitle className="mr-auto flex items-center gap-2"><MessageSquare className="h-5 w-5 text-primary" /> Ticket queue</CardTitle>
            <div className="relative w-full lg:w-72">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search ticket, user, message" value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
            <Select value={status} onValueChange={setStatus}><SelectTrigger className="w-full lg:w-36"><SelectValue /></SelectTrigger><SelectContent>
              <SelectItem value="all">All status</SelectItem><SelectItem value="open">Open</SelectItem><SelectItem value="in_progress">In progress</SelectItem><SelectItem value="resolved">Resolved</SelectItem><SelectItem value="closed">Closed</SelectItem>
            </SelectContent></Select>
            <Select value={priority} onValueChange={setPriority}><SelectTrigger className="w-full lg:w-36"><SelectValue /></SelectTrigger><SelectContent>
              <SelectItem value="all">All priority</SelectItem><SelectItem value="urgent">Urgent</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="normal">Normal</SelectItem><SelectItem value="low">Low</SelectItem>
            </SelectContent></Select>
            <Select value={category} onValueChange={setCategory}><SelectTrigger className="w-full lg:w-36"><SelectValue /></SelectTrigger><SelectContent>
              <SelectItem value="all">All category</SelectItem>{categories.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
            </SelectContent></Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? <div className="p-10 text-center text-muted-foreground">Loading support inbox...</div> :
            isError ? <div className="p-10 text-center text-destructive">Could not load support tickets. Check the API server.</div> :
            tickets.length === 0 ? <div className="p-14 text-center"><LifeBuoy className="h-10 w-10 mx-auto text-muted-foreground/50" /><p className="font-semibold mt-3">No tickets match these filters</p><p className="text-sm text-muted-foreground mt-1">New tickets from Telegram will appear here automatically.</p></div> :
            <div className="divide-y">
              {tickets.map((ticket) => (
                <button key={ticket.id} onClick={() => openTicket(ticket)} className="w-full text-left p-4 md:p-5 hover:bg-muted/30 transition-colors">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start">
                    <div className="flex items-center gap-3 md:w-56 shrink-0">
                      <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-primary"><UserRound className="h-4 w-4" /></div>
                      <div><p className="font-semibold truncate max-w-40">{ticket.fullName || `User ${ticket.userId}`}</p><p className="text-xs text-muted-foreground font-mono">#{ticket.id} · {ticket.username ? `@${ticket.username}` : ticket.userId}</p></div>
                    </div>
                    <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2 mb-1"><StatusBadge value={ticket.status} /><PriorityBadge value={ticket.priority} /><Badge variant="secondary">{ticket.category}</Badge></div><p className="text-sm line-clamp-2">{ticket.message}</p></div>
                    <div className="text-xs text-muted-foreground md:text-right shrink-0">{formatDistanceToNow(new Date(ticket.updatedAt), { addSuffix: true })}</div>
                  </div>
                </button>
              ))}
            </div>}
        </CardContent>
      </Card>

      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {selected && <><SheetHeader><div className="flex items-center gap-2"><StatusBadge value={selected.status} /><PriorityBadge value={selected.priority} /></div><SheetTitle className="mt-2">Ticket #{selected.id}</SheetTitle><SheetDescription>Created {formatDistanceToNow(new Date(selected.createdAt), { addSuffix: true })}</SheetDescription></SheetHeader>
            <div className="space-y-6 py-6">
              <div className="rounded-xl border bg-muted/20 p-4"><p className="text-xs uppercase tracking-wider text-muted-foreground">From</p><p className="font-semibold mt-1">{selected.fullName || `User ${selected.userId}`}</p><p className="text-sm text-muted-foreground">{selected.username ? `@${selected.username}` : `Telegram ID ${selected.userId}`} · {selected.tier ?? "Free"} plan</p></div>
              <div><p className="text-sm font-semibold mb-2">User message</p><div className="rounded-xl bg-primary/5 border border-primary/10 p-4 text-sm leading-6 whitespace-pre-wrap">{selected.message}</div></div>
              <div className="grid grid-cols-2 gap-3"><div><p className="text-sm font-semibold mb-2">Status</p><Select value={selected.status} onValueChange={(value) => setSelected({ ...selected, status: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="open">Open</SelectItem><SelectItem value="in_progress">In progress</SelectItem><SelectItem value="resolved">Resolved</SelectItem><SelectItem value="closed">Closed</SelectItem></SelectContent></Select></div><div><p className="text-sm font-semibold mb-2">Priority</p><Select value={selected.priority} onValueChange={(value) => setSelected({ ...selected, priority: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="urgent">Urgent</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="normal">Normal</SelectItem><SelectItem value="low">Low</SelectItem></SelectContent></Select></div></div>
              <div><p className="text-sm font-semibold mb-2">Internal note</p><Textarea rows={5} placeholder="Add context for the support team..." value={note} onChange={(event) => setNote(event.target.value)} /></div>
            </div>
            <SheetFooter className="gap-2 sm:gap-2"><Button variant="outline" onClick={() => saveTicket()} disabled={updateTicket.isPending}>Save changes</Button><Button onClick={() => saveTicket("resolved")} disabled={updateTicket.isPending}><CheckCircle2 className="h-4 w-4 mr-2" />Resolve & notify</Button></SheetFooter>
          </>}
        </SheetContent>
      </Sheet>
    </div>
  );
}
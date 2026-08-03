import { useAdminGetStats } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, UserPlus, FileText, CreditCard, IndianRupee, Star, PlayCircle, Trophy, AlertTriangle, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type AdminAlert = { id: string; severity: "high" | "medium"; type: string; title: string; detail: string; href: string };

export default function Dashboard() {
  const { data: stats, isLoading } = useAdminGetStats();
  const { data: alertData } = useQuery<{ alerts: AdminAlert[] }>({
    queryKey: ["admin-alerts"],
    queryFn: async () => {
      const response = await fetch("/api/admin/alerts", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load alerts");
      return response.json();
    },
    refetchInterval: 60_000,
  });

  if (isLoading || !stats) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Overview</h1>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(8)].map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  const statCards = [
    {
      title: "Total Users",
      value: stats.totalUsers.toLocaleString(),
      icon: Users,
      description: "All registered bot users"
    },
    {
      title: "New Users Today",
      value: stats.newUsersToday.toLocaleString(),
      icon: UserPlus,
      description: "Joined in the last 24h"
    },
    {
      title: "Premium Users",
      value: stats.premiumUsers.toLocaleString(),
      icon: Trophy,
      description: "Active paid subscribers"
    },
    {
      title: "Total Test Attempts",
      value: stats.totalTestAttempts.toLocaleString(),
      icon: PlayCircle,
      description: "Tests taken by all users"
    },
    {
      title: "Pending Payments",
      value: stats.pendingPayments.toLocaleString(),
      icon: CreditCard,
      description: "Require manual approval"
    },
    {
      title: "Total Tests",
      value: stats.totalTests.toLocaleString(),
      icon: FileText,
      description: "Available in the platform"
    },
    {
      title: "UPI Earnings",
      value: `₹${stats.upiEarnings.toLocaleString()}`,
      icon: IndianRupee,
      description: "Total fiat revenue"
    },
    {
      title: "Stars Earnings",
      value: stats.starsEarnings.toLocaleString(),
      icon: Star,
      description: "Telegram Stars collected"
    }
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Overview</h1>
        <p className="text-muted-foreground mt-1">Live platform statistics and performance metrics.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {statCards.map((card, idx) => (
          <Card key={idx} className="hover-elevate">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.title}
              </CardTitle>
              <card.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{card.value}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {card.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Needs attention
            {(alertData?.alerts.length ?? 0) > 0 && <Badge variant="destructive">{alertData?.alerts.length}</Badge>}
          </CardTitle>
          <span className="text-xs text-muted-foreground">Refreshes every minute</span>
        </CardHeader>
        <CardContent>
          {!alertData?.alerts.length ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No urgent admin alerts right now.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {alertData.alerts.slice(0, 10).map((alert) => (
                <div key={alert.id} className={`flex items-start justify-between gap-3 rounded-lg border p-3 ${alert.severity === "high" ? "border-red-200 bg-red-50/60 dark:bg-red-950/20" : "border-amber-200 bg-amber-50/50 dark:bg-amber-950/20"}`}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant={alert.severity === "high" ? "destructive" : "outline"}>{alert.severity}</Badge>
                      <span className="text-xs uppercase text-muted-foreground">{alert.type}</span>
                    </div>
                    <p className="mt-2 text-sm font-medium">{alert.title}</p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{alert.detail}</p>
                  </div>
                  <Button asChild variant="ghost" size="icon" className="shrink-0">
                    <Link href={alert.href} aria-label={`Open ${alert.type} alert`}>
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

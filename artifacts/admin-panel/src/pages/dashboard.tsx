import { useAdminGetStats } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, UserPlus, FileText, CreditCard, IndianRupee, Star, PlayCircle, Trophy } from "lucide-react";

export default function Dashboard() {
  const { data: stats, isLoading } = useAdminGetStats();

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
    </div>
  );
}

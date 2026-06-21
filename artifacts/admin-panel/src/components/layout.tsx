import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { useAdminGetMe, useAdminLogout, getAdminGetMeQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  LayoutDashboard,
  CreditCard,
  FileText,
  Tag,
  Settings,
  Users,
  LogOut,
  Menu,
  BarChart2,
  Megaphone,
  Terminal,
  Flag,
  Radio,
  Brain,
} from "lucide-react";
import { ReactNode } from "react";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/payments", label: "Payments", icon: CreditCard },
  { href: "/tests", label: "Test Series", icon: FileText },
  { href: "/analytics", label: "Analytics", icon: BarChart2 },
  { href: "/flash-sales", label: "Flash Sales", icon: Tag },
  { href: "/ads", label: "Ad Gateway", icon: Megaphone },
  { href: "/reports", label: "Reports", icon: Flag },
  { href: "/live-tests", label: "Live Tests", icon: Radio },
  { href: "/users", label: "Users", icon: Users },
  { href: "/ai", label: "AI & Coupons", icon: Brain },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/telemetry", label: "Live Terminal", icon: Terminal },
];

function NavLinks({ location, onNavigate }: { location: string; onNavigate?: () => void }) {
  return (
    <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
      {navItems.map((item) => {
        const isActive = location === item.href || location.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
              isActive
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: user, isLoading, isError } = useAdminGetMe({ query: { retry: false, staleTime: 30_000 } });

  const logoutMutation = useAdminLogout({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getAdminGetMeQueryKey() });
        setLocation("/login");
      },
    },
  });

  useEffect(() => {
    if ((isError || !user?.authenticated) && !isLoading && location !== "/login") {
      setLocation("/login");
    }
  }, [isError, user, isLoading, location, setLocation]);

  if (isLoading) {
    return (
      <div className="flex h-screen w-full bg-background items-center justify-center">
        <Skeleton className="h-32 w-32 rounded-full" />
      </div>
    );
  }

  if (isError || !user?.authenticated) {
    return null;
  }

  const currentPage = navItems.find(
    (n) => location === n.href || location.startsWith(n.href + "/")
  );

  return (
    <div className="flex h-screen overflow-hidden bg-muted/40">
      <aside className="w-64 border-r bg-card flex-col hidden md:flex">
        <div className="p-6 border-b">
          <h1 className="text-xl font-bold tracking-tight text-primary">Series TestPro</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Admin Panel</p>
        </div>
        <NavLinks location={location} />
        <div className="p-4 border-t">
          <Button
            variant="ghost"
            className="w-full justify-start text-muted-foreground hover:text-destructive"
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
          >
            <LogOut className="h-4 w-4 mr-2" />
            Sign Out
          </Button>
        </div>
      </aside>

      <div className="flex flex-col flex-1 overflow-hidden md:contents">
        <header className="flex md:hidden items-center justify-between px-4 py-3 bg-card border-b shrink-0">
          <div>
            <h1 className="text-base font-bold text-primary">Series TestPro</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground font-medium">
              {currentPage?.label ?? "Admin"}
            </span>
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-64 p-0 flex flex-col">
                <div className="p-6 border-b">
                  <h1 className="text-xl font-bold tracking-tight text-primary">Series TestPro</h1>
                  <p className="text-xs text-muted-foreground mt-0.5">Admin Panel</p>
                </div>
                <NavLinks location={location} onNavigate={() => setMobileOpen(false)} />
                <div className="p-4 border-t">
                  <Button
                    variant="ghost"
                    className="w-full justify-start text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      setMobileOpen(false);
                      logoutMutation.mutate();
                    }}
                    disabled={logoutMutation.isPending}
                  >
                    <LogOut className="h-4 w-4 mr-2" />
                    Sign Out
                  </Button>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-8">
          <div className="mx-auto max-w-6xl space-y-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

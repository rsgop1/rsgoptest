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
  Radio,
  Brain,
  Sparkles,
  LifeBuoy,
  ShieldAlert
} from "lucide-react";
import { ReactNode } from "react";

const navGroups = [
  {
    title: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/analytics", label: "Analytics", icon: BarChart2 },
      { href: "/telemetry", label: "Live Terminal", icon: Terminal },
    ]
  },
  {
    title: "Commerce",
    items: [
      { href: "/payments", label: "Payments", icon: CreditCard },
      { href: "/flash-sales", label: "Flash Sales", icon: Tag },
      { href: "/ads", label: "Ad Gateway", icon: Megaphone },
    ]
  },
  {
    title: "Content",
    items: [
      { href: "/tests", label: "Test Series", icon: FileText },
      { href: "/live-tests", label: "Live Tests", icon: Radio },
      { href: "/custom-sets", label: "AI Custom Sets", icon: Brain },
      { href: "/ai", label: "AI & Coupons", icon: Sparkles },
    ]
  },
  {
    title: "Operations",
    items: [
      { href: "/users", label: "Users", icon: Users },
      { href: "/support", label: "Support Inbox", icon: LifeBuoy },
      { href: "/reports", label: "Question Reports", icon: ShieldAlert },
    ]
  },
  {
    title: "System",
    items: [
      { href: "/settings", label: "Settings", icon: Settings },
    ]
  }
];

const allNavItems = navGroups.flatMap(g => g.items);

function NavLinks({ location, onNavigate }: { location: string; onNavigate?: () => void }) {
  return (
    <nav className="flex-1 overflow-y-auto py-6 px-4 space-y-8 no-scrollbar">
      {navGroups.map((group) => (
        <div key={group.title}>
          <h4 className="mb-3 px-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            {group.title}
          </h4>
          <div className="space-y-1">
            {group.items.map((item) => {
              const isActive = location === item.href || location.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                    isActive
                      ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  }`}
                >
                  <item.icon className={`h-4 w-4 ${isActive ? "text-primary-foreground" : "text-sidebar-foreground/50"}`} />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: user, isLoading, isError } = useAdminGetMe({ query: { retry: false, staleTime: 30_000, queryKey: getAdminGetMeQueryKey() } });

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
        <Skeleton className="h-16 w-16 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (isError || !user?.authenticated) {
    return null;
  }

  const currentPage = allNavItems.find(
    (n) => location === n.href || location.startsWith(n.href + "/")
  );

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-background">
      {/* Desktop Sidebar */}
      <aside className="w-[280px] border-r border-sidebar-border bg-sidebar flex-col hidden md:flex shrink-0">
        <div className="p-6">
          <Link href="/dashboard" className="flex items-center gap-3 group">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary text-primary-foreground font-bold text-sm shadow-sm group-hover:scale-105 transition-transform">
              S
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight text-sidebar-foreground leading-tight">Series TestPro</h1>
              <p className="text-[11px] text-sidebar-foreground/50 font-medium">Ops Console</p>
            </div>
          </Link>
        </div>
        
        <NavLinks location={location} />
        
        <div className="p-4 border-t border-sidebar-border bg-sidebar/50">
          <div className="flex items-center justify-between px-3 py-2">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-sidebar-accent flex items-center justify-center text-sidebar-foreground text-xs font-bold border border-sidebar-border">
                A
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-sidebar-foreground leading-none">Admin</span>
                <span className="text-[10px] text-sidebar-foreground/50 mt-1">Authorized</span>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-sidebar-foreground/50 hover:text-destructive hover:bg-destructive/10 rounded-full"
              onClick={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
              title="Sign Out"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </aside>

      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        <header className="flex md:hidden items-center justify-between px-4 py-3 bg-sidebar border-b border-sidebar-border shrink-0">
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center w-7 h-7 rounded-md bg-primary text-primary-foreground font-bold text-xs">
              S
            </div>
            <h1 className="text-sm font-bold text-sidebar-foreground">Series TestPro</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-sidebar-foreground/70 font-medium mr-2">
              {currentPage?.label}
            </span>
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="text-sidebar-foreground">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[280px] p-0 flex flex-col bg-sidebar border-r-sidebar-border">
                <div className="p-6 border-b border-sidebar-border">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary text-primary-foreground font-bold text-sm shadow-sm">
                      S
                    </div>
                    <div>
                      <h1 className="text-sm font-bold tracking-tight text-sidebar-foreground leading-tight">Series TestPro</h1>
                      <p className="text-[11px] text-sidebar-foreground/50 font-medium">Ops Console</p>
                    </div>
                  </div>
                </div>
                <NavLinks location={location} onNavigate={() => setMobileOpen(false)} />
                <div className="p-4 border-t border-sidebar-border">
                  <Button
                    variant="ghost"
                    className="w-full justify-start text-sidebar-foreground/70 hover:text-destructive hover:bg-destructive/10"
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

        <main className="flex-1 overflow-y-auto bg-muted/30 relative">
          <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-[0.02] pointer-events-none mix-blend-overlay"></div>
          <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-8 relative z-10 min-h-full">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

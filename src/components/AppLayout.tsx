import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { FileSearch, LayoutDashboard, Plus, LogOut, User } from "lucide-react";

export const AppLayout = ({ children }: { children: React.ReactNode }) => {
  const { signOut, user } = useAuth();
  const location = useLocation();

  const navItems = [
    { to: "/dashboard", label: "Дашборд", icon: LayoutDashboard },
    { to: "/analysis/new", label: "Новый анализ", icon: Plus },
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-card/80 backdrop-blur-sm">
        <div className="container flex h-16 items-center justify-between">
          <Link to="/dashboard" className="flex items-center gap-2.5">
            <div className="rounded-lg bg-primary p-1.5">
              <FileSearch className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-lg font-bold">ТендерАнализ</span>
          </Link>

          <nav className="flex items-center gap-1">
            {navItems.map((item) => (
              <Link key={item.to} to={item.to}>
                <Button
                  variant={location.pathname === item.to ? "secondary" : "ghost"}
                  size="sm"
                  className="gap-2"
                >
                  <item.icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{item.label}</span>
                </Button>
              </Link>
            ))}
            <div className="ml-2 h-6 w-px bg-border" />
            <div className="flex items-center gap-2 ml-2">
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <User className="h-4 w-4" />
                <span className="hidden md:inline max-w-[150px] truncate">{user?.email}</span>
              </div>
              <Button variant="ghost" size="sm" onClick={signOut}>
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </nav>
        </div>
      </header>
      <main className="container py-6">{children}</main>
    </div>
  );
};

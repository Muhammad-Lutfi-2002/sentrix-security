import { HeaderActionsProvider } from "@agent-native/toolkit/app-shell";
import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import {
  IconBell,
  IconBug,
  IconChevronRight,
  IconClipboardList,
  IconLayoutDashboard,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconMenu2,
  IconPlus,
  IconSearch,
  IconShieldLock,
  IconUserCircle,
} from "@tabler/icons-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Toaster } from "@/components/ui/sonner";
import { formatDateTime, labelize } from "@/lib/format";
import { cn } from "@/lib/utils";

interface LayoutProps {
  children: ReactNode;
}

const navItems = [
  { to: "/", label: "Dashboard", icon: IconLayoutDashboard, end: true },
  { to: "/assessments", label: "Assessments", icon: IconClipboardList, end: false },
  { to: "/findings", label: "Vulnerabilities", icon: IconBug, end: false },
];

const crumbLabels: Record<string, string> = {
  assessments: "Assessments",
  findings: "Vulnerabilities",
  new: "New assessment",
};

function Breadcrumbs() {
  const { pathname } = useLocation();
  const segments = pathname.split("/").filter(Boolean);
  const crumbs = [{ label: "Home", to: "/" }];
  segments.forEach((segment, index) => {
    const to = "/" + segments.slice(0, index + 1).join("/");
    const label = crumbLabels[segment] ?? "Detail";
    crumbs.push({ label, to });
  });
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <li key={crumb.to} className="flex min-w-0 items-center gap-1">
              {index > 0 ? (
                <IconChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
              ) : null}
              {last ? (
                <span aria-current="page" className="truncate text-foreground">
                  {crumb.label}
                </span>
              ) : (
                <Link to={crumb.to} className="truncate rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {crumb.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <ul className="flex flex-col gap-1">
      {navItems.map((item) => (
        <li key={item.to}>
          <NavLink
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_2px_0_0_hsl(var(--sidebar-primary))]"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
              )
            }
          >
            <item.icon className="size-5 shrink-0" aria-hidden="true" />
            <span className="truncate">{item.label}</span>
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

function SidebarBrand({ collapsed }: { collapsed: boolean }) {
  return (
    <div className="flex items-center gap-2 px-3 py-4">
      <IconShieldLock className="size-6 shrink-0 text-primary" aria-hidden="true" />
      {collapsed ? null : (
        <span className="text-base font-semibold tracking-wide text-foreground">
          SENTRIX
        </span>
      )}
    </div>
  );
}

function NotificationCenter() {
  const { data, isLoading, isError } = useActionQuery("list-activity", { limit: 10 });
  const events = (data ?? []) as Array<{
    id: string;
    kind: string;
    message: string;
    createdAt: string;
  }>;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Notifications">
          <IconBell className="size-5" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Notifications</h2>
          <p className="text-xs text-muted-foreground">Recent assessment and finding activity</p>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {isLoading ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">Loading activity…</p>
          ) : isError ? (
            <p className="px-4 py-6 text-sm text-red-200">Could not load notifications. Try again later.</p>
          ) : events.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">No activity yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {events.map((event) => (
                <li key={event.id} className="px-4 py-3">
                  <p className="text-sm text-foreground">{event.message}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {labelize(event.kind)} · {formatDateTime(event.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function useWorkspace() {
  return useActionQuery("get-workspace", {});
}

async function signOut() {
  try {
    await fetch("/api/auth/logout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}", credentials: "same-origin" });
  } finally {
    window.location.assign("/login");
  }
}

function ProfileMenu() {
  const { data } = useWorkspace();
  const email = data?.user.email ?? "";
  const role = data?.workspace?.role ?? null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2" aria-label="Open profile menu">
          <IconUserCircle className="size-5" aria-hidden="true" />
          <span className="hidden max-w-32 truncate sm:inline">{email || "Account"}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate text-sm font-medium">{email || "Signed in"}</span>
          <span className="text-xs font-normal text-muted-foreground">
            {role ? `Role: ${labelize(role)}` : "No workspace yet"}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function WorkspaceBadge() {
  const { data } = useWorkspace();
  return (
    <Badge variant="outline" className="hidden whitespace-nowrap border-violet-300/40 text-violet-100 lg:inline-flex">
      Workspace: {data?.workspace?.name ?? "—"}
    </Badge>
  );
}

/** First sign-in: the user has no workspace yet. Creating one makes them its owner. */
function WorkspaceGate({ children }: { children: ReactNode }) {
  const { data, isLoading, isError, refetch } = useWorkspace();
  const create = useActionMutation("create-workspace");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading your workspace…</p>;
  if (isError) return <p role="alert" className="text-sm text-red-200">Could not load your account. Refresh, or sign in again.</p>;
  if (data?.workspace) return <>{children}</>;

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    create.mutate({ name: name.trim() }, {
      onSuccess: () => { void refetch(); window.location.assign("/"); },
      onError: (e) => setError(e instanceof Error ? e.message : "Could not create the workspace."),
    });
  }
  return (
    <Card className="mx-auto mt-10 max-w-md gap-4 border-border/80 bg-card/80 p-6">
      <h1 className="text-lg font-semibold">Create your workspace</h1>
      <p className="text-sm text-muted-foreground">
        A workspace holds your projects, targets, assessments and findings. You become its owner and can invite teammates later.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Label htmlFor="ws-name">Workspace name</Label>
        <Input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Security" maxLength={120} required />
        {error ? <p role="alert" className="text-sm text-red-200">{error}</p> : null}
        <Button type="submit" disabled={create.isPending || !name.trim()}>{create.isPending ? "Creating…" : "Create workspace"}</Button>
      </form>
    </Card>
  );
}

function GlobalSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = query.trim();
    navigate(q ? `/findings?q=${encodeURIComponent(q)}` : "/findings");
  }
  return (
    <form role="search" onSubmit={submit} className="relative hidden w-full max-w-xs md:block">
      <IconSearch
        className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search findings and assets"
        aria-label="Search findings and assets"
        className="h-9 pl-8"
      />
    </form>
  );
}

export function Layout({ children }: LayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <HeaderActionsProvider>
      <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
        <aside
          aria-label="Primary"
          className={cn(
            "hidden h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar-background transition-[width] duration-200 motion-reduce:transition-none md:flex",
            collapsed ? "w-16" : "w-60",
          )}
        >
          <SidebarBrand collapsed={collapsed} />
          <div className="flex-1 overflow-y-auto px-2">
            <NavList />
          </div>
          <div className="border-t border-sidebar-border p-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-3 text-sidebar-foreground"
              onClick={() => setCollapsed((value) => !value)}
              aria-expanded={!collapsed}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? (
                <IconLayoutSidebarLeftExpand className="size-5" aria-hidden="true" />
              ) : (
                <IconLayoutSidebarLeftCollapse className="size-5" aria-hidden="true" />
              )}
              {collapsed ? null : <span>Collapse</span>}
            </Button>
          </div>
        </aside>

        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-64 bg-sidebar-background p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SidebarBrand collapsed={false} />
            <div className="px-2">
              <NavList onNavigate={() => setMobileOpen(false)} />
            </div>
          </SheetContent>
        </Sheet>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/95 px-3 sm:px-5">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              aria-label="Open navigation"
              onClick={() => setMobileOpen(true)}
            >
              <IconMenu2 className="size-5" aria-hidden="true" />
            </Button>
            <div className="hidden min-w-0 flex-1 items-center gap-3 sm:flex">
              <Breadcrumbs />
            </div>
            <div className="flex flex-1 items-center justify-end gap-2 sm:flex-none">
              <WorkspaceBadge />
              <GlobalSearch />
              <Button asChild size="sm" className="hidden gap-1.5 sm:inline-flex">
                <Link to="/assessments/new">
                  <IconPlus className="size-4" aria-hidden="true" />
                  New assessment
                </Link>
              </Button>
              <NotificationCenter />
              <ProfileMenu />
            </div>
          </header>
          <main className="agent-native-app-main min-w-0 flex-1 overflow-y-auto overscroll-contain">
            <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8"><WorkspaceGate>{children}</WorkspaceGate></div>
          </main>
        </div>
        <Toaster />
      </div>
    </HeaderActionsProvider>
  );
}

import { Link } from "@tanstack/react-router";
import {
  History,
  ListOrdered,
  LogOut,
  Menu,
  TrendingUp,
  UserCircle,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

export type NavAccount = {
  id: string;
  nickname: string;
  login: number;
  currency: string;
  leverage: number;
};

type NavTo = "/accounts" | "/trade" | "/orders" | "/history" | "/wallet" | "/profile";

const navItems: { to: NavTo; label: string; icon: LucideIcon }[] = [
  { to: "/accounts", label: "Accounts", icon: Users },
  { to: "/trade", label: "Trade", icon: TrendingUp },
  { to: "/orders", label: "Orders", icon: ListOrdered },
  { to: "/history", label: "History", icon: History },
  { to: "/wallet", label: "Wallet", icon: Wallet },
  { to: "/profile", label: "Profile", icon: UserCircle },
];

const bottomItems = navItems.filter((item) => ["/accounts", "/trade", "/orders", "/profile"].includes(item.to));

export function AccountPicker({
  accounts,
  activeAccount,
  onSelect,
  compact = false,
}: {
  accounts: NavAccount[];
  activeAccount: NavAccount | null;
  onSelect: (id: string) => void;
  compact?: boolean;
}) {
  if (accounts.length === 0) {
    return (
      <Link
        to="/accounts"
        className={compact ? "text-xs text-primary underline-offset-2 hover:underline" : "text-sm text-primary underline-offset-2 hover:underline"}
      >
        Open account
      </Link>
    );
  }
  return (
    <select
      aria-label="Trading account"
      value={activeAccount?.id ?? ""}
      onChange={(event) => onSelect(event.target.value)}
      className={
        compact
          ? "w-full truncate rounded-md border border-secondary-foreground/20 bg-secondary-foreground/10 px-2 py-1.5 text-xs text-secondary-foreground"
          : "w-full rounded-md border border-secondary-foreground/20 bg-secondary-foreground/10 px-2 py-2 text-sm text-secondary-foreground"
      }
    >
      {accounts.map((account) => (
        <option key={account.id} value={account.id} className="text-foreground">
          {compact
            ? `${account.nickname} · #${account.login}`
            : `${account.nickname} · #${account.login} · ${account.currency}`}
        </option>
      ))}
    </select>
  );
}

const desktopLink = "flex items-center gap-3 rounded-md px-3 py-2 text-sm opacity-75 transition hover:bg-secondary-foreground/10 hover:opacity-100";
const desktopActive = "flex items-center gap-3 rounded-md bg-secondary-foreground/10 px-3 py-2 text-sm font-medium text-primary";

export function DesktopSidebar({
  accounts,
  activeAccount,
  onSelect,
  onSignOut,
  ordersActive,
}: {
  accounts: NavAccount[];
  activeAccount: NavAccount | null;
  onSelect: (id: string) => void;
  onSignOut: () => void;
  ordersActive: boolean;
}) {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-secondary-foreground/10 bg-secondary px-3 py-4 text-secondary-foreground lg:flex">
      <Link to="/trade" className="px-2 text-2xl font-extrabold tracking-tight text-primary">vantor</Link>
      <div className="mt-5 rounded-lg border border-secondary-foreground/10 bg-secondary-foreground/5 p-2">
        <p className="mb-1.5 px-1 text-[10px] uppercase tracking-wide text-secondary-foreground/50">Trading account</p>
        <AccountPicker accounts={accounts} activeAccount={activeAccount} onSelect={onSelect} />
      </div>
      <nav className="mt-4 flex flex-1 flex-col gap-0.5">
        {navItems.map((item) => {
          const showDot = item.to === "/orders" && ordersActive;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={desktopLink}
              activeProps={{ className: desktopActive }}
              aria-label={showDot ? `${item.label} (open orders)` : undefined}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
              {showDot && <span className="ml-auto h-2 w-2 rounded-full bg-red-500" aria-hidden="true" />}
            </Link>
          );
        })}
      </nav>
      <button
        type="button"
        onClick={onSignOut}
        className="flex items-center gap-3 rounded-md px-3 py-2 text-sm opacity-75 transition hover:bg-secondary-foreground/10 hover:opacity-100"
      >
        <LogOut className="h-4 w-4" />
        Sign out
      </button>
    </aside>
  );
}

const sheetLink = "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm opacity-80 transition hover:bg-secondary-foreground/10 hover:opacity-100";
const sheetActive = "flex items-center gap-3 rounded-md bg-secondary-foreground/10 px-3 py-2.5 text-sm font-medium text-primary";

export function MobileHeader({
  accounts,
  activeAccount,
  onSelect,
  onSignOut,
  ordersActive,
}: {
  accounts: NavAccount[];
  activeAccount: NavAccount | null;
  onSelect: (id: string) => void;
  onSignOut: () => void;
  ordersActive: boolean;
}) {
  return (
    <header className="sticky top-0 z-40 bg-secondary text-secondary-foreground lg:hidden">
      <div className="flex h-14 items-center gap-2 px-3">
        <Sheet>
          <SheetTrigger asChild>
            <button type="button" aria-label="Open menu" className="rounded-md p-2 transition hover:bg-secondary-foreground/10">
              <Menu className="h-5 w-5" />
            </button>
          </SheetTrigger>
          <SheetContent side="left" className="flex w-72 max-w-[85vw] flex-col bg-secondary p-5 text-secondary-foreground">
            <SheetTitle className="text-2xl font-extrabold tracking-tight text-primary">vantor</SheetTitle>
            <SheetDescription className="sr-only">Account navigation</SheetDescription>
            <nav className="mt-5 flex flex-col gap-0.5">
              {navItems.map((item) => {
                const showDot = item.to === "/orders" && ordersActive;
                return (
                  <SheetClose asChild key={item.to}>
                    <Link
                      to={item.to}
                      className={sheetLink}
                      activeProps={{ className: sheetActive }}
                      aria-label={showDot ? `${item.label} (open orders)` : undefined}
                    >
                      <item.icon className="h-4 w-4" />
                      {item.label}
                      {showDot && <span className="ml-auto h-2 w-2 rounded-full bg-red-500" aria-hidden="true" />}
                    </Link>
                  </SheetClose>
                );
              })}
            </nav>
            <div className="mt-auto border-t border-secondary-foreground/10 pt-4">
              <SheetClose asChild>
                <button
                  type="button"
                  onClick={onSignOut}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm opacity-75 transition hover:bg-secondary-foreground/10 hover:opacity-100"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              </SheetClose>
            </div>
          </SheetContent>
        </Sheet>
        <Link to="/trade" className="text-xl font-extrabold tracking-tight text-primary">vantor</Link>
        <div className="ml-auto min-w-0 max-w-[55vw]">
          <AccountPicker compact accounts={accounts} activeAccount={activeAccount} onSelect={onSelect} />
        </div>
      </div>
    </header>
  );
}

const bottomLink = "flex flex-col items-center justify-center gap-1 py-2 text-[11px] text-muted-foreground transition hover:text-foreground";
const bottomActive = "flex flex-col items-center justify-center gap-1 py-2 text-[11px] font-semibold text-primary";

export function MobileBottomNav({ ordersActive }: { ordersActive: boolean }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background pb-[env(safe-area-inset-bottom)] lg:hidden">
      <div className="grid grid-cols-4">
        {bottomItems.map((item) => {
          const showDot = item.to === "/orders" && ordersActive;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={bottomLink}
              activeProps={{ className: bottomActive }}
              aria-label={showDot ? `${item.label} (open orders)` : undefined}
            >
              <span className="relative">
                <item.icon className="h-5 w-5" />
                {showDot && (
                  <span
                    className="absolute -right-1 -top-0.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-background"
                    aria-hidden="true"
                  />
                )}
              </span>
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

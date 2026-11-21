import { Link } from "@tanstack/react-router";
import {
  History,
  ListOrdered,
  LogOut,
  Menu,
  Server,
  TrendingUp,
  UserCircle,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

export type NavAccount = {
  id: string;
  nickname: string;
  login: number;
  server: string;
  currency: string;
  leverage: number;
};

type NavTo =
  | "/accounts"
  | "/trade"
  | "/orders"
  | "/history"
  | "/wallet"
  | "/partner"
  | "/partner/accounts"
  | "/profile";

const navItems: { to: NavTo; label: string; icon: LucideIcon }[] = [
  { to: "/accounts", label: "Accounts", icon: Users },
  { to: "/trade", label: "Trade", icon: TrendingUp },
  { to: "/orders", label: "Orders", icon: ListOrdered },
  { to: "/history", label: "History", icon: History },
  { to: "/wallet", label: "Wallet", icon: Wallet },
  { to: "/partner", label: "Partner", icon: Server },
  { to: "/partner/accounts", label: "Accounts", icon: Users },
  { to: "/profile", label: "Profile", icon: UserCircle },
];

const bottomItems = navItems.filter((item) =>
  ["/accounts", "/trade", "/orders", "/profile"].includes(item.to),
);

function visibleNavItems(partner: boolean) {
  return partner
    ? navItems.filter((item) => item.to === "/partner" || item.to === "/partner/accounts")
    : navItems.filter((item) => item.to !== "/partner" && item.to !== "/partner/accounts");
}

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
        className={
          compact
            ? "text-xs font-semibold text-primary underline-offset-2 hover:underline"
            : "text-sm font-semibold text-primary underline-offset-2 hover:underline"
        }
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
          ? "h-9 w-full truncate rounded-md border border-sidebar-border bg-sidebar-accent px-2 text-xs text-sidebar-foreground outline-none focus:border-primary"
          : "h-10 w-full rounded-md border border-sidebar-border bg-sidebar-accent px-2.5 text-sm text-sidebar-foreground outline-none focus:border-primary"
      }
    >
      {accounts.map((account) => (
        <option key={account.id} value={account.id} className="bg-popover text-popover-foreground">
          {compact
            ? `${account.nickname} · #${account.login} · ${account.server}`
            : `${account.nickname} · #${account.login} · ${account.server} · ${account.currency}`}
        </option>
      ))}
    </select>
  );
}

const desktopLink =
  "flex h-10 items-center gap-3 rounded-md px-3 text-[13px] font-medium text-sidebar-foreground/65 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring";
const desktopActive =
  "flex h-10 items-center gap-3 rounded-md border border-sidebar-border bg-sidebar-accent px-3 text-[13px] font-semibold text-primary shadow-[inset_2px_0_0_var(--color-primary)]";

export function DesktopSidebar({
  accounts,
  activeAccount,
  onSelect,
  onSignOut,
  ordersActive,
  partner = false,
}: {
  accounts: NavAccount[];
  activeAccount: NavAccount | null;
  onSelect: (id: string) => void;
  onSignOut: () => void;
  ordersActive: boolean;
  partner?: boolean;
}) {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-52 flex-col border-r border-sidebar-border bg-sidebar px-3 py-4 text-sidebar-foreground xl:flex">
      <Link
        to={partner ? "/partner" : "/trade"}
        className="flex h-10 items-center gap-2 px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      >
        <span className="grid h-7 w-7 place-items-center rounded-md border border-primary/35 bg-primary/10 text-xs font-extrabold text-primary">
          V
        </span>
        <span className="text-lg font-extrabold tracking-[-0.03em] text-sidebar-foreground">
          vantor
        </span>
      </Link>
      {!partner && (
        <div className="mt-5 border-y border-sidebar-border py-3">
          <p className="mb-2 px-1 text-[11px] font-medium text-sidebar-foreground/45">
            Trading account
          </p>
          <AccountPicker accounts={accounts} activeAccount={activeAccount} onSelect={onSelect} />
          {activeAccount ? (
            <div className="mt-2 flex items-center justify-between px-1 font-mono text-[10px] text-sidebar-foreground/45">
              <span>#{activeAccount.login}</span>
              <span>1:{activeAccount.leverage}</span>
            </div>
          ) : null}
        </div>
      )}
      <nav className="mt-4 flex flex-1 flex-col gap-1">
        {visibleNavItems(partner).map((item) => {
          const showDot = item.to === "/orders" && ordersActive;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={desktopLink}
              activeProps={{ className: desktopActive }}
              activeOptions={{ exact: true }}
              aria-label={showDot ? `${item.label} (open orders)` : undefined}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
              {showDot && (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-negative" aria-hidden="true" />
              )}
            </Link>
          );
        })}
      </nav>
      <button
        type="button"
        onClick={onSignOut}
        className="flex h-10 items-center gap-3 rounded-md px-3 text-[13px] font-medium text-sidebar-foreground/55 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      >
        <LogOut className="h-4 w-4" />
        Sign out
      </button>
    </aside>
  );
}

const sheetLink =
  "flex h-11 items-center gap-3 rounded-md px-3 text-sm text-sidebar-foreground/70 transition hover:bg-sidebar-accent hover:text-sidebar-foreground";
const sheetActive =
  "flex h-11 items-center gap-3 rounded-md border border-sidebar-border bg-sidebar-accent px-3 text-sm font-semibold text-primary";

export function MobileHeader({
  accounts,
  activeAccount,
  onSelect,
  onSignOut,
  ordersActive,
  partner = false,
}: {
  accounts: NavAccount[];
  activeAccount: NavAccount | null;
  onSelect: (id: string) => void;
  onSignOut: () => void;
  ordersActive: boolean;
  partner?: boolean;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-sidebar-border bg-sidebar/95 text-sidebar-foreground backdrop-blur xl:hidden">
      <div className="flex h-14 items-center gap-2 px-3">
        <Sheet>
          <SheetTrigger asChild>
            <button
              type="button"
              aria-label="Open menu"
              className="rounded-md p-2 transition hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Menu className="h-5 w-5" />
            </button>
          </SheetTrigger>
          <SheetContent
            side="left"
            className="flex w-72 max-w-[85vw] flex-col border-sidebar-border bg-sidebar p-4 text-sidebar-foreground"
          >
            <SheetTitle className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-sidebar-foreground">
              <span className="grid h-7 w-7 place-items-center rounded-md border border-primary/35 bg-primary/10 text-xs text-primary">
                V
              </span>
              vantor
            </SheetTitle>
            <SheetDescription className="sr-only">
              {partner ? "Partner navigation" : "Account navigation"}
            </SheetDescription>
            <nav className="mt-5 flex flex-col gap-0.5">
              {visibleNavItems(partner).map((item) => {
                const showDot = item.to === "/orders" && ordersActive;
                return (
                  <SheetClose asChild key={item.to}>
                    <Link
                      to={item.to}
                      className={sheetLink}
                      activeProps={{ className: sheetActive }}
                      activeOptions={{ exact: true }}
                      aria-label={showDot ? `${item.label} (open orders)` : undefined}
                    >
                      <item.icon className="h-4 w-4" />
                      {item.label}
                      {showDot && (
                        <span
                          className="ml-auto h-2 w-2 rounded-full bg-negative"
                          aria-hidden="true"
                        />
                      )}
                    </Link>
                  </SheetClose>
                );
              })}
            </nav>
            <div className="mt-auto border-t border-sidebar-border pt-4">
              <SheetClose asChild>
                <button
                  type="button"
                  onClick={onSignOut}
                  className="flex h-11 w-full items-center gap-3 rounded-md px-3 text-sm text-sidebar-foreground/65 transition hover:bg-sidebar-accent hover:text-sidebar-foreground"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              </SheetClose>
            </div>
          </SheetContent>
        </Sheet>
        <Link
          to={partner ? "/partner" : "/trade"}
          className="text-lg font-extrabold tracking-[-0.03em] text-sidebar-foreground"
        >
          vantor
        </Link>
        {!partner && (
          <div className="ml-auto min-w-0 max-w-[55vw]">
            <AccountPicker
              compact
              accounts={accounts}
              activeAccount={activeAccount}
              onSelect={onSelect}
            />
          </div>
        )}
      </div>
    </header>
  );
}

const bottomLink =
  "flex min-h-14 flex-col items-center justify-center gap-1 py-2 text-[10px] font-medium text-muted-foreground transition hover:text-foreground";
const bottomActive =
  "flex min-h-14 flex-col items-center justify-center gap-1 border-t-2 border-primary py-2 text-[10px] font-semibold text-primary";

export function MobileBottomNav({ ordersActive }: { ordersActive: boolean }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur xl:hidden">
      <div className="grid grid-cols-4">
        {bottomItems.map((item) => {
          const showDot = item.to === "/orders" && ordersActive;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={bottomLink}
              activeProps={{ className: bottomActive }}
              activeOptions={{ exact: true }}
              aria-label={showDot ? `${item.label} (open orders)` : undefined}
            >
              <span className="relative">
                <item.icon className="h-5 w-5" />
                {showDot && (
                  <span
                    className="absolute -right-1 -top-0.5 h-2 w-2 rounded-full bg-negative ring-2 ring-card"
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

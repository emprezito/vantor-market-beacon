import { createFileRoute, redirect, Outlet, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: Layout,
});

function Layout() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };
  const link = "px-3 py-2 rounded-md text-sm opacity-75 hover:opacity-100";
  const active = { className: "px-3 py-2 rounded-md text-sm bg-secondary-foreground/10 text-primary" };
  return (
    <div className="min-h-screen bg-background">
      <header className="bg-secondary text-secondary-foreground">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <Link to="/" className="text-2xl font-extrabold tracking-tight text-primary">vantor</Link>
          <nav className="flex gap-1">
            <Link to="/trade" className={link} activeProps={active}>Trade</Link>
            <Link to="/history" className={link} activeProps={active}>History</Link>
            <Link to="/wallet" className={link} activeProps={active}>Wallet</Link>
          </nav>
          <button onClick={signOut} className="text-sm opacity-75 hover:opacity-100">Sign out</button>
        </div>
      </header>
      <div className="bg-primary/20 py-1 text-center text-xs text-foreground">Demo account — virtual money only</div>
      <Outlet />
    </div>
  );
}

import { createFileRoute, redirect, Outlet, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAccount } from "@/hooks/use-account";
import { DesktopSidebar, MobileBottomNav, MobileHeader } from "@/components/app-nav";

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
  const { accounts, activeAccount, setActiveAccount } = useAccount();
  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };
  const selectAccount = (id: string) => setActiveAccount(id);

  return (
    <div className="min-h-screen bg-background lg:pl-64">
      <DesktopSidebar
        accounts={accounts}
        activeAccount={activeAccount}
        onSelect={selectAccount}
        onSignOut={signOut}
      />
      <MobileHeader
        accounts={accounts}
        activeAccount={activeAccount}
        onSelect={selectAccount}
        onSignOut={signOut}
      />
      <div className="pb-20 lg:pb-0">
        <Outlet />
      </div>
      <MobileBottomNav />
    </div>
  );
}

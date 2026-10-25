import { createFileRoute, redirect, Outlet, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAccount } from "@/hooks/use-account";
import { DesktopSidebar, MobileBottomNav, MobileHeader } from "@/components/app-nav";
import { isPartnerRole } from "@/lib/partner";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    const { data: appRole } = await supabase
      .from("app_roles")
      .select("role")
      .eq("user_id", data.user.id)
      .maybeSingle();
    const partner = isPartnerRole(appRole?.role);
    if (partner && !location.pathname.startsWith("/partner")) {
      throw redirect({ to: "/partner" });
    }
    if (!partner && location.pathname.startsWith("/partner")) {
      throw redirect({ to: "/trade" });
    }
    return { user: data.user, partner };
  },
  component: Layout,
});

function Layout() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { partner } = Route.useRouteContext();
  const { accounts, activeAccount, setActiveAccount, data } = useAccount();
  const ordersActive = (data?.open?.length ?? 0) > 0 || (data?.pending?.length ?? 0) > 0;
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
        ordersActive={ordersActive}
        partner={partner}
      />
      <MobileHeader
        accounts={accounts}
        activeAccount={activeAccount}
        onSelect={selectAccount}
        onSignOut={signOut}
        ordersActive={ordersActive}
        partner={partner}
      />
      <div className={partner ? "pb-0" : "pb-20 lg:pb-0"}>
        <Outlet />
      </div>
      {!partner && <MobileBottomNav ordersActive={ordersActive} />}
    </div>
  );
}

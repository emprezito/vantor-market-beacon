import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/partner")({
  beforeLoad: ({ context }) => {
    if (!context.partner) throw redirect({ to: "/trade" });
  },
  component: PartnerLayout,
});

function PartnerLayout() {
  return <Outlet />;
}

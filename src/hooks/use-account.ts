import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listMyAccounts } from "@/lib/accounts.functions";
import { getAccount } from "@/lib/trading.functions";
import { useActiveAccount } from "./use-active-account";

export function useAccount() {
  const listFn = useServerFn(listMyAccounts);
  const getFn = useServerFn(getAccount);
  const [storedId, setActiveAccount] = useActiveAccount();
  const accountsQuery = useQuery({ queryKey: ["my-accounts"], queryFn: () => listFn() });
  const accounts = accountsQuery.data ?? [];
  const active = accounts.find((a) => a.id === storedId) ?? accounts[0] ?? null;
  const accountQuery = useQuery({
    queryKey: ["account", active?.id ?? "none"],
    queryFn: () => getFn({ data: { accountId: active!.id } }),
    enabled: !!active,
    refetchInterval: 5000,
  });
  return {
    accounts,
    activeAccount: active,
    setActiveAccount,
    data: accountQuery.data,
    isPending: accountsQuery.isPending || (!!active && accountQuery.isPending),
    error: accountsQuery.error ?? accountQuery.error,
    refetch: async () => {
      await accountsQuery.refetch();
      if (active) await accountQuery.refetch();
    },
  };
}

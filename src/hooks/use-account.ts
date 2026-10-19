import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getAccount } from "@/lib/trading.functions";

export function useAccount() {
  const fn = useServerFn(getAccount);
  return useQuery({ queryKey: ["account"], queryFn: () => fn(), refetchInterval: 5000 });
}
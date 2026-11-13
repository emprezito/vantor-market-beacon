import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMarketCatalog } from "@/lib/market.functions";
import { marketInstruments, registerMarketInstruments } from "@/lib/market";

export function useMarketCatalog(enabled = true) {
  const catalogFn = useServerFn(getMarketCatalog);
  const query = useQuery({
    queryKey: ["market-catalog"],
    queryFn: () => catalogFn(),
    enabled,
    staleTime: 5 * 60_000,
    retry: 2,
  });

  if (query.data?.instruments) registerMarketInstruments(query.data.instruments);

  return {
    instruments: query.data?.instruments ?? marketInstruments(),
    fetchedAt: query.data?.fetchedAt ?? 0,
    isLoading: query.isPending,
    error: query.error,
  };
}

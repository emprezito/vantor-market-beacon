import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { withIdempotency } from "@/lib/terminal-api/idempotency";

const accountId = "11111111-1111-4111-8111-111111111111";
const key = "66666666-6666-4666-8666-666666666666";

type Row = {
  request_hash: string;
  status: string;
  response: unknown;
  expires_at: string;
};

function fakeAdmin(row: Row | null, insertError: { code?: string } | null = null) {
  const insert = vi.fn(
    async (_row: { account_id: string; idempotency_key: string; request_hash: string }) => ({
      error: insertError,
    }),
  );
  const update = vi.fn(() => chain);
  const remove = vi.fn(() => chain);
  const chain = {
    insert,
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: row, error: null }),
    update,
    delete: remove,
    then: (resolve: (value: { error: null }) => void) => resolve({ error: null }),
  };
  return {
    admin: { from: () => chain } as unknown as SupabaseClient<Database>,
    insert,
    update,
    remove,
  };
}

function request(idempotencyKey?: string) {
  return new Request("https://vantor.test/api/v1/terminal/orders", {
    method: "POST",
    headers: idempotencyKey ? { "idempotency-key": idempotencyKey } : {},
  });
}

async function storedHash(insert: ReturnType<typeof fakeAdmin>["insert"]) {
  const call = insert.mock.calls[0]?.[0] as { request_hash?: string } | undefined;
  if (!call?.request_hash) throw new Error("No idempotency hash was stored");
  return call.request_hash;
}

describe("terminal idempotency", () => {
  it("runs without an idempotency key", async () => {
    const { admin, insert } = fakeAdmin(null);
    const run = vi.fn(async () => ({ ok: true }));
    await expect(withIdempotency(admin, accountId, request(), {}, run)).resolves.toEqual({
      ok: true,
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects a non-UUID idempotency key", async () => {
    const { admin } = fakeAdmin(null);
    const run = vi.fn(async () => ({ ok: true }));
    await expect(withIdempotency(admin, accountId, request("not-a-uuid"), {}, run)).rejects.toThrow(
      "Idempotency-Key must be a UUID",
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("runs and stores the response for a new key", async () => {
    const { admin, update } = fakeAdmin(null);
    const run = vi.fn(async () => ({ ok: true }));
    await expect(withIdempotency(admin, accountId, request(key), {}, run)).resolves.toEqual({
      ok: true,
    });
    expect(run).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith({ status: "completed", response: { ok: true } });
  });

  it("replays a completed response", async () => {
    const first = fakeAdmin(null);
    await withIdempotency(first.admin, accountId, request(key), {}, async () => ({ ok: true }));
    const hash = await storedHash(first.insert);

    const replay = fakeAdmin(
      {
        request_hash: hash,
        status: "completed",
        response: { ok: true },
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
      { code: "23505" },
    );
    const run = vi.fn(async () => ({ ok: false }));
    await expect(withIdempotency(replay.admin, accountId, request(key), {}, run)).resolves.toEqual({
      ok: true,
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects a key used for a different request", async () => {
    const { admin } = fakeAdmin(
      {
        request_hash: "different",
        status: "pending",
        response: null,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
      { code: "23505" },
    );
    const run = vi.fn(async () => ({ ok: true }));
    await expect(withIdempotency(admin, accountId, request(key), {}, run)).rejects.toThrow(
      "This idempotency key was used for a different request",
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects a request already in progress", async () => {
    const first = fakeAdmin(null);
    await withIdempotency(first.admin, accountId, request(key), {}, async () => ({ ok: true }));
    const hash = await storedHash(first.insert);

    const { admin } = fakeAdmin(
      {
        request_hash: hash,
        status: "pending",
        response: null,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
      { code: "23505" },
    );
    const run = vi.fn(async () => ({ ok: true }));
    await expect(withIdempotency(admin, accountId, request(key), {}, run)).rejects.toThrow(
      "This request is already being processed",
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("removes the reservation when the operation fails", async () => {
    const { admin, remove } = fakeAdmin(null);
    const run = vi.fn(async () => {
      throw new Error("operation failed");
    });
    await expect(withIdempotency(admin, accountId, request(key), {}, run)).rejects.toThrow(
      "operation failed",
    );
    expect(remove).toHaveBeenCalled();
  });
});

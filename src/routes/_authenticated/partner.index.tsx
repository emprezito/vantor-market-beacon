import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import {
  createPartnerServer,
  listMyServers,
  listServerMembers,
  removeServerMember,
  updatePartnerServer,
} from "@/lib/partner.functions";
import { canManageServer, canRemoveServerMember } from "@/lib/partner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/partner/")({
  head: () => ({
    meta: [
      { title: "Partner servers — Vantor" },
      { name: "description", content: "Create and manage Vantor partner servers." },
    ],
  }),
  component: PartnerPage,
});

const inputCls = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

type ServerSettings = {
  name: string;
  description: string;
  status: string;
  visibility: string;
};

function PartnerPage() {
  const qc = useQueryClient();
  const listServers = useServerFn(listMyServers);
  const createServer = useServerFn(createPartnerServer);
  const updateServer = useServerFn(updatePartnerServer);
  const listMembers = useServerFn(listServerMembers);
  const removeMember = useServerFn(removeServerMember);

  const serversQuery = useQuery({ queryKey: ["my-servers"], queryFn: () => listServers() });
  const servers = serversQuery.data ?? [];
  const [selectedId, setSelectedId] = useState("");
  const selected = servers.find((server) => server.id === selectedId) ?? servers[0] ?? null;
  const canManage = selected ? canManageServer(selected.role) : false;

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newVisibility, setNewVisibility] = useState<"private" | "public">("private");
  const [settings, setSettings] = useState<ServerSettings>({
    name: "",
    description: "",
    status: "active",
    visibility: "private",
  });
  const [serverTab, setServerTab] = useState<"settings" | "members">("settings");

  const membersQuery = useQuery({
    queryKey: ["server-members", selected?.id],
    queryFn: () => listMembers({ data: { serverId: selected!.id } }),
    enabled: !!selected && canManage,
  });

  useEffect(() => {
    const available = serversQuery.data ?? [];
    setSelectedId((current) =>
      available.length === 0
        ? ""
        : current && available.some((server) => server.id === current)
          ? current
          : available[0]!.id,
    );
  }, [serversQuery.data]);

  useEffect(() => {
    if (!selected) return;
    setSettings({
      name: selected.name,
      description: selected.description,
      status: selected.status,
      visibility: selected.visibility,
    });
    setServerTab("settings");
  }, [selected]);

  const createServerMut = useMutation({
    mutationFn: () =>
      createServer({
        data: {
          name: newName,
          ...(newSlug ? { slug: newSlug } : {}),
          description: newDescription,
          visibility: newVisibility,
        },
      }),
    onSuccess: (server) => {
      qc.invalidateQueries({ queryKey: ["my-servers"] });
      setSelectedId(server.id);
      setCreateOpen(false);
      setNewName("");
      setNewSlug("");
      setNewDescription("");
      toast.success(`${server.name} created`);
    },
    onError: (e) => toast.error(e.message),
  });

  const updateServerMut = useMutation({
    mutationFn: () => updateServer({ data: { serverId: selected!.id, ...settings } }),
    onSuccess: (server) => {
      qc.invalidateQueries({ queryKey: ["my-servers"] });
      toast.success(`${server.name} updated`);
    },
    onError: (e) => toast.error(e.message),
  });

  const removeMemberMut = useMutation({
    mutationFn: (userId: string) => removeMember({ data: { serverId: selected!.id, userId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["server-members", selected!.id] });
      qc.invalidateQueries({ queryKey: ["my-servers"] });
      toast.success("Member removed");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <main className="mx-auto max-w-5xl space-y-4 px-3 pb-6 pt-3 sm:space-y-6 sm:px-6 sm:py-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Partner servers</h1>
          <p className="text-sm text-muted-foreground">
            Run private or public servers, manage your team and configure each server.
          </p>
        </div>
        <Button onClick={() => setCreateOpen((v) => !v)}>
          <Plus className="h-4 w-4" /> Create server
        </Button>
      </div>

      {createOpen && (
        <section className="rounded-lg border bg-card p-4 sm:p-5">
          <h2 className="font-bold">Create a partner server</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Private servers stay hidden from traders. Public servers appear in the account form.
          </p>
          <form
            className="mt-3 grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              createServerMut.mutate();
            }}
          >
            <div>
              <Label htmlFor="server-name">Name</Label>
              <Input
                id="server-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Acme Prop"
                minLength={2}
                maxLength={64}
                required
              />
            </div>
            <div>
              <Label htmlFor="server-slug">Slug (optional)</Label>
              <Input
                id="server-slug"
                value={newSlug}
                onChange={(e) => setNewSlug(e.target.value)}
                placeholder="acme-prop"
                maxLength={48}
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="server-description">Description</Label>
              <Input
                id="server-description"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="What traders can expect on this server"
                maxLength={280}
              />
            </div>
            <div>
              <Label htmlFor="server-visibility">Visibility</Label>
              <select
                id="server-visibility"
                className={inputCls}
                value={newVisibility}
                onChange={(e) =>
                  setNewVisibility(e.target.value === "public" ? "public" : "private")
                }
              >
                <option value="private">Private (hidden)</option>
                <option value="public">Public</option>
              </select>
            </div>
            <div className="flex items-end">
              <Button
                type="submit"
                disabled={createServerMut.isPending || newName.trim().length < 2}
              >
                {createServerMut.isPending ? "Creating…" : "Create server"}
              </Button>
            </div>
          </form>
        </section>
      )}

      {serversQuery.isPending && <p className="text-sm opacity-75">Loading your servers…</p>}
      {serversQuery.error && (
        <p role="alert" className="text-sm text-destructive">
          {(serversQuery.error as Error).message}
        </p>
      )}

      {!serversQuery.isPending && servers.length === 0 && (
        <section className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          You don’t own or belong to a partner server yet. Create one above to get started.
        </section>
      )}

      {servers.length > 0 && (
        <>
          <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {servers.map((server) => (
              <button
                key={server.id}
                type="button"
                onClick={() => setSelectedId(server.id)}
                className={`rounded-lg border p-3 text-left transition ${
                  selected?.id === server.id ? "border-primary bg-primary/5" : "hover:bg-muted"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-semibold">{server.name}</span>
                  <span className="shrink-0 rounded border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {server.visibility}
                  </span>
                </div>
                <p className="truncate text-xs text-muted-foreground">{server.slug}</p>
                <div className="mt-2 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                  <span>{server.role}</span>
                  <span>·</span>
                  <span>{server.member_count} members</span>
                  <span>·</span>
                  <span>{server.account_count} accounts</span>
                </div>
              </button>
            ))}
          </section>

          {selected && (
            <section className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold">{selected.name}</h2>
                <Badge variant="outline">{selected.role}</Badge>
                <Badge variant={selected.status === "active" ? "secondary" : "destructive"}>
                  {selected.status}
                </Badge>
                <Badge variant="outline">{selected.visibility}</Badge>
              </div>

              {!canManage ? (
                <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
                  You are a member of this server. Only owners and admins can manage it.
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap gap-1 rounded-lg border bg-card p-1">
                    {(["settings", "members"] as const).map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setServerTab(tab)}
                        className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize transition ${
                          serverTab === tab
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>

                  {serverTab === "settings" && (
                    <section className="rounded-lg border bg-card p-4 sm:p-5">
                      <h3 className="font-bold">Server settings</h3>
                      <form
                        className="mt-3 grid gap-3 sm:grid-cols-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          updateServerMut.mutate();
                        }}
                      >
                        <div>
                          <Label htmlFor="edit-name">Name</Label>
                          <Input
                            id="edit-name"
                            value={settings.name}
                            onChange={(e) => setSettings((s) => ({ ...s, name: e.target.value }))}
                            minLength={2}
                            maxLength={64}
                            required
                          />
                        </div>
                        <div>
                          <Label htmlFor="edit-status">Status</Label>
                          <select
                            id="edit-status"
                            className={inputCls}
                            value={settings.status}
                            onChange={(e) => setSettings((s) => ({ ...s, status: e.target.value }))}
                          >
                            <option value="active">Active</option>
                            <option value="paused">Paused</option>
                          </select>
                        </div>
                        <div className="sm:col-span-2">
                          <Label htmlFor="edit-description">Description</Label>
                          <Input
                            id="edit-description"
                            value={settings.description}
                            onChange={(e) =>
                              setSettings((s) => ({ ...s, description: e.target.value }))
                            }
                            maxLength={280}
                          />
                        </div>
                        <div>
                          <Label htmlFor="edit-visibility">Visibility</Label>
                          <select
                            id="edit-visibility"
                            className={inputCls}
                            value={settings.visibility}
                            onChange={(e) =>
                              setSettings((s) => ({ ...s, visibility: e.target.value }))
                            }
                          >
                            <option value="private">Private</option>
                            <option value="public">Public</option>
                          </select>
                        </div>
                        <div className="flex items-end">
                          <Button type="submit" disabled={updateServerMut.isPending}>
                            {updateServerMut.isPending ? "Saving…" : "Save settings"}
                          </Button>
                        </div>
                      </form>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Paused servers stop accepting new accounts and members. Existing accounts
                        keep trading.
                      </p>
                    </section>
                  )}

                  {serverTab === "members" && (
                    <section className="rounded-lg border bg-card p-4 sm:p-5">
                      <h3 className="font-bold">Members</h3>
                      {membersQuery.isPending && (
                        <p className="mt-2 text-sm opacity-75">Loading members…</p>
                      )}
                      {membersQuery.error && (
                        <p role="alert" className="mt-2 text-sm text-destructive">
                          {(membersQuery.error as Error).message}
                        </p>
                      )}
                      <div className="mt-3 space-y-2">
                        {membersQuery.data?.map((member) => {
                          const canRemove = canRemoveServerMember(selected.role, member.role);
                          return (
                            <div
                              key={member.user_id}
                              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium">
                                  {member.email ?? member.user_id}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {member.role} · joined{" "}
                                  {new Date(member.created_at).toLocaleDateString()}
                                </p>
                              </div>
                              {canRemove && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => removeMemberMut.mutate(member.user_id)}
                                  disabled={removeMemberMut.isPending}
                                >
                                  <Trash2 className="h-3.5 w-3.5" /> Remove
                                </Button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  )}
                </>
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}

export type ServerRole = "owner" | "admin" | "member";

export type AppRole = "partner" | "platform_admin";

export function isPartnerRole(value: string | null | undefined): value is "partner" {
  return value === "partner";
}

export function asServerRole(value: string): ServerRole {
  return value === "owner" || value === "admin" ? value : "member";
}

export function slugifyServerName(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}

export function canManageServer(role: ServerRole | null) {
  return role === "owner" || role === "admin";
}

export function canRemoveServerMember(caller: ServerRole, target: ServerRole) {
  if (target === "owner") return false;
  if (target === "admin") return caller === "owner";
  return caller === "owner" || caller === "admin";
}

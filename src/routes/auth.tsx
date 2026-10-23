import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/auth")({
  validateSearch: (search: Record<string, unknown>): { mode?: "in" | "up" } => ({ mode: search['mode'] === "up" ? "up" : "in" }),
  head: () => ({
    meta: [
      { title: "Sign in — Vantor" },
      { name: "description", content: "Sign in or open a Vantor trading account." },
      { property: "og:title", content: "Sign in — Vantor" },
      { property: "og:description", content: "Open a Vantor trading account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { mode } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => data.session && navigate({ to: "/accounts" }));
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    if (mode === "up") {
      const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin + "/auth" } });
      if (error) toast.error(error.message);
      else if (data.session) navigate({ to: "/accounts" });
      else toast.success("Check your email to confirm your account.");
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) toast.error(error.message);
      else navigate({ to: "/accounts" });
    }
    setBusy(false);
  };

  const social = async (provider: "google" | "lovable") => {
    const r = await lovable.auth.signInWithOAuth(provider, { redirect_uri: window.location.origin + "/auth" });
    if (r.error) toast.error(r.error.message ?? "Google sign-in failed");
    else {
      const { data } = await supabase.auth.getSession();
      if (data.session) navigate({ to: "/accounts" });
    }
  };

  const input = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary px-4">
      <div className="w-full max-w-sm rounded-2xl bg-background p-6 sm:p-8">
        <Link to="/" className="text-2xl font-extrabold text-foreground">vantor</Link>
        <h1 className="mt-6 text-xl font-bold sm:text-2xl">{mode === "in" ? "Sign in" : "Create an account"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Open your account to start trading global markets.</p>
        <form onSubmit={submit} className="mt-6 space-y-3">
          <input className={input} aria-label="Email" autoComplete="email" type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className={input} aria-label="Password" autoComplete={mode === "in" ? "current-password" : "new-password"} type="password" required minLength={6} placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Button disabled={busy} className="w-full">{busy ? "Please wait…" : mode === "in" ? "Sign in" : "Create account"}</Button>
        </form>
        <Button variant="outline" onClick={() => social("google")} className="mt-3 w-full">Continue with Google</Button>
        <Button variant="outline" onClick={() => social("lovable")} className="mt-3 w-full">Sign in with Lovable</Button>
        <Button variant="ghost" asChild className="mt-4 w-full text-muted-foreground"><Link to="/auth" search={{ mode: mode === "in" ? "up" : "in" }}>
          {mode === "in" ? "No account? Register" : "Already have an account? Sign in"}
        </Link></Button>
      </div>
    </div>
  );
}

import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Vantor" },
      { name: "description", content: "Sign in or open a free Vantor demo trading account." },
      { property: "og:title", content: "Sign in — Vantor" },
      { property: "og:description", content: "Open a free demo trading account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => data.session && navigate({ to: "/trade" }));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => s && navigate({ to: "/trade" }));
    return () => data.subscription.unsubscribe();
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    if (mode === "up") {
      const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin + "/trade" } });
      if (error) toast.error(error.message);
      else toast.success("Check your email to confirm your account.");
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) toast.error(error.message);
    }
    setBusy(false);
  };

  const google = async () => {
    const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin + "/auth" });
    if (r.error) toast.error(r.error.message ?? "Google sign-in failed");
  };

  const input = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary px-4">
      <div className="w-full max-w-sm rounded-2xl bg-background p-8">
        <Link to="/" className="text-2xl font-extrabold text-foreground">vantor</Link>
        <h1 className="mt-6 text-2xl font-bold">{mode === "in" ? "Sign in" : "Open a demo account"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">New accounts start with $10,000 virtual money.</p>
        <form onSubmit={submit} className="mt-6 space-y-3">
          <input className={input} type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className={input} type="password" required minLength={6} placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button disabled={busy} className="w-full rounded-md bg-primary py-2 font-semibold text-primary-foreground disabled:opacity-50">
            {mode === "in" ? "Sign in" : "Create account"}
          </button>
        </form>
        <button onClick={google} className="mt-3 w-full rounded-md border border-input py-2 text-sm font-semibold">Continue with Google</button>
        <button onClick={() => setMode(mode === "in" ? "up" : "in")} className="mt-4 w-full text-sm text-muted-foreground">
          {mode === "in" ? "No account? Register" : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}

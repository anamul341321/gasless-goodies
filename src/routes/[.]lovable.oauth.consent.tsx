import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

type OAuthApi = {
  getAuthorizationDetails: (id: string) => Promise<{ data: any; error: { message: string } | null }>;
  approveAuthorization: (id: string) => Promise<{ data: any; error: { message: string } | null }>;
  denyAuthorization: (id: string) => Promise<{ data: any; error: { message: string } | null }>;
};
const oauth = () => (supabase.auth as unknown as { oauth: OAuthApi }).oauth;

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  head: () => ({ meta: [{ title: "Connect an app — Good-App" }, { name: "robots", content: "noindex" }] }),
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("This connection link is missing or invalid.");
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw redirect({ href: "/auth?next=" + encodeURIComponent(location.pathname + location.searchStr) });
    }
  },
  loader: async ({ location }) => {
    const id = new URLSearchParams(location.search).get("authorization_id")!;
    const { data, error } = await oauth().getAuthorizationDetails(id);
    if (error) throw new Error(error.message || "This connection request expired.");
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: immediate });
    const { data: u } = await supabase.auth.getUser();
    return { details: data, email: u.user?.email ?? "" };
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <main className="min-h-screen grid place-items-center p-6">
      <div className="glass rounded-2xl p-6 max-w-md text-center">
        <h1 className="text-lg font-semibold mb-2">Could not load this connection request</h1>
        <p className="text-sm text-muted-foreground">{error instanceof Error ? error.message : String(error)}</p>
      </div>
    </main>
  ),
});

function Consent() {
  const { details, email } = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const client = details?.client?.name ?? "An app";
  const scopes: string[] = String(details?.scope ?? "").split(" ").filter(Boolean);
  const label = (s: string) =>
    s === "openid" ? "Confirm your identity" : s === "email" ? "Share your email address" : s === "profile" ? "Share your basic profile" : `Additional permission requested: ${s}`;

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const { data, error } = approve
      ? await oauth().approveAuthorization(authorization_id)
      : await oauth().denyAuthorization(authorization_id);
    if (error) { setBusy(false); setError(error.message); return; }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) { setBusy(false); setError("No redirect returned. Please try again."); return; }
    window.location.href = target;
  }

  return (
    <main className="min-h-screen grid place-items-center p-6">
      <div className="glass rounded-2xl p-6 max-w-md w-full space-y-4">
        <h1 className="text-xl font-semibold">Connect {client} to Good-App</h1>
        <p className="text-sm text-muted-foreground">Signed in as {email}</p>
        <p className="text-sm">{client} will be able to call this app's enabled tools as you: read your profile and list your Daily Auto Claim groups.</p>
        {details?.redirect_uri && <p className="text-xs text-muted-foreground break-all">Redirect: {details.redirect_uri}</p>}
        {scopes.length > 0 && (
          <ul className="text-sm list-disc pl-5">{scopes.map((s) => <li key={s}>{label(s)}</li>)}</ul>
        )}
        <p className="text-xs text-muted-foreground">This does not bypass this app's permissions or backend policies.</p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button className="flex-1" disabled={busy} onClick={() => decide(true)}>Approve</Button>
          <Button className="flex-1" variant="outline" disabled={busy} onClick={() => decide(false)}>Cancel connection</Button>
        </div>
      </div>
    </main>
  );
}

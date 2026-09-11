import { Link } from "@/lib/router-compat";
import {
  ArrowLeft, Eye, Lock, Database, Trash2, Shield, Cookie, Globe, FileText,
} from "lucide-react";

export default function Privacy() {
  return (
    <div className="aurora-bg min-h-screen bg-background relative overflow-hidden">
      <header className="border-b border-border/40 backdrop-blur-2xl bg-card/60 sticky top-0 z-10">
        <div className="container max-w-3xl mx-auto py-3.5 px-4">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-primary font-semibold hover:underline underline-offset-4"
          >
            <ArrowLeft className="h-4 w-4" /> Back to Home
          </Link>
        </div>
      </header>

      <main className="container max-w-3xl mx-auto py-8 px-4 space-y-6 relative z-10">
        {/* Hero */}
        <section className="color-card card-emerald shimmer-sheen p-6 space-y-3">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 border border-primary/20">
            <FileText className="h-3 w-3 text-primary" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-primary">Legal</span>
          </div>
          <h1 className="text-3xl font-extrabold heading-shimmer leading-tight">Privacy Policy</h1>
          <p className="text-sm text-muted-foreground">Last updated: April 25, 2026</p>
          <p className="text-sm text-foreground/85 leading-relaxed">
            We collect the minimum data required to deliver gas loads, Buy IP memberships,
            savings deposits and mobile recharge — nothing more.
          </p>
        </section>

        <Section icon={Eye} title="1. What We Collect">
          <p>To operate the platform we store only what is needed to fulfill your request:</p>
          <Bullets items={[
            "<strong>Public wallet addresses</strong> — the wallet you connect, plus locked wallets you add for Buy IP gas loads.",
            "<strong>On-chain transaction hashes</strong> — used to verify Buy IP payments, savings deposits and recharge orders.",
            "<strong>Service request details</strong> — for Mobile Recharge: the target phone number and operator. For Savings: deposit amounts and token.",
            "<strong>Gas-load job metadata</strong> — wallet list, chosen delay, batch progress, success/failure counts and tx hashes per wallet.",
            "<strong>Operational logs</strong> — minimal admin notes, request status and timestamps required to deliver and support the service.",
          ]} />
        </Section>

        <Section icon={Lock} title="2. What We Never Collect">
          <Bullets items={[
            "<strong>Private keys or seed phrases</strong> — we never ask for, transmit, or store them. Ever.",
            "<strong>Government IDs, photos, or biometrics</strong> — no KYC documents are required.",
            "<strong>Names, emails, or phone numbers</strong> beyond what you voluntarily submit for a recharge.",
            "<strong>Advertising trackers, third-party pixels, or behavioral profiles</strong>.",
            "<strong>Browser fingerprints or device IDs</strong> for marketing purposes.",
          ]} />
        </Section>

        <Section icon={Database} title="3. How We Use Your Data">
          <Bullets items={[
            "Match your wallet to its Buy IP membership and locked-wallet slots.",
            "Verify USDT payments on Celo Mainnet against your Buy IP package or savings deposit.",
            "Process Mobile Recharge requests and route them to the correct telecom provider.",
            "Run background gas-load workers — even when your app is closed — and show you progress when you return.",
            "Detect abuse of the Free Gas Loader (e.g. bot wallets bypassing the daily 2-load limit).",
            "Provide customer support and resolve failed transactions.",
          ]} />
        </Section>

        <Section icon={Cookie} title="4. Cookies & Local Storage">
          <Bullets items={[
            "We use minimal local storage to remember your connected wallet and UI preferences (e.g. theme, gas-load delay).",
            "No advertising cookies. No cross-site tracking. No analytics that build a personal profile.",
            "You can clear local storage at any time from your browser settings — the app will simply ask you to reconnect.",
          ]} />
        </Section>

        <Section icon={Globe} title="5. Third-Party Services">
          <p>To deliver the service we interact with these external systems:</p>
          <Bullets items={[
            "<strong>Celo Mainnet (chain 42220)</strong> — all blockchain payments are public on-chain and visible on Celoscan.",
            "<strong>Telecom fulfillment partners</strong> — Mobile Recharge requests are forwarded to licensed providers in Bangladesh, who only receive the phone number and amount.",
            "<strong>Yield protocols</strong> — Savings deposits may be routed to on-chain DeFi protocols. Their smart-contract terms apply once funds are deposited.",
            "<strong>Backend infrastructure</strong> — service data is stored on secured cloud infrastructure with row-level access controls.",
          ]} />
        </Section>

        <Section icon={Trash2} title="6. Data Retention & Your Rights">
          <Bullets items={[
            "Off-chain records (jobs, recharge orders, admin notes) are kept as long as needed for support, fraud prevention and accounting.",
            "On-chain payments cannot be deleted — they are permanently public on Celo Mainnet by design.",
            "You may request deletion of off-chain support data tied to your wallet by contacting us through Good-App community channels.",
            "We do not sell your data. We do not share it with advertisers.",
          ]} />
        </Section>

        <Section icon={Shield} title="7. Security">
          <Bullets items={[
            "All payments are signed in your own wallet — we never have signing power over your funds.",
            "Backend services use Row-Level Security and dedicated server-side keys for sensitive operations.",
            "Admin tools require a server-side admin password and never expose secrets to the browser.",
            "If you suspect a phishing attempt or compromised flow, stop and verify the URL before approving any transaction.",
          ]} />
        </Section>

        <section className="color-card card-violet shimmer-sheen p-5 space-y-2">
          <h2 className="text-base font-extrabold text-foreground">Changes to this Policy</h2>
          <p className="text-sm text-foreground/85 leading-relaxed">
            We may update this Privacy Policy from time to time. Material changes will be reflected by updating the
            "Last updated" date at the top. Continued use of the platform means you accept the latest version.
          </p>
        </section>

        <p className="text-xs text-muted-foreground text-center pt-4">
          © 2026 Celo Gas Sponsor by Good-App. All rights reserved.
        </p>
      </main>
    </div>
  );
}

function Section({
  icon: Icon, title, children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-border/50 bg-card/80 backdrop-blur p-6 space-y-3 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <h2 className="text-base font-extrabold text-foreground">{title}</h2>
      </div>
      <div className="text-sm text-foreground/85 leading-relaxed space-y-3">{children}</div>
    </section>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2.5">
          <span className="h-1.5 w-1.5 rounded-full bg-primary mt-2 shrink-0" />
          <span dangerouslySetInnerHTML={{ __html: item }} />
        </li>
      ))}
    </ul>
  );
}

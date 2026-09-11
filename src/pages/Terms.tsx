import { Link } from "@/lib/router-compat";
import {
  ArrowLeft, AlertTriangle, Scale, ShieldCheck, UserCheck, Crown, Fuel,
  PiggyBank, Smartphone, FileText,
} from "lucide-react";

export default function Terms() {
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
        <section className="color-card card-violet shimmer-sheen p-6 space-y-3">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 border border-primary/20">
            <FileText className="h-3 w-3 text-primary" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-primary">Legal</span>
          </div>
          <h1 className="text-3xl font-extrabold heading-shimmer leading-tight">Terms & Conditions</h1>
          <p className="text-sm text-muted-foreground">Last updated: April 25, 2026</p>
        </section>

        {/* Notice */}
        <div className="color-card card-amber shimmer-sheen p-5 flex items-start gap-3">
          <span className="icon-chip icon-amber h-10 w-10 rounded-2xl shrink-0">
            <AlertTriangle className="h-4 w-4" />
          </span>
          <div className="space-y-1">
            <p className="text-sm font-bold text-foreground">Important</p>
            <p className="text-sm text-foreground/85 leading-relaxed">
              By using Celo Gas Sponsor by Good-App you agree to these terms. Please read them carefully —
              they cover Free Gas Loader, Buy IP Membership, In-App Savings, and Mobile Recharge.
            </p>
          </div>
        </div>

        <Section icon={UserCheck} title="1. Acceptable Use">
          <p>You agree to use the platform only for lawful purposes and accurate service requests:</p>
          <Bullets items={[
            "Submit only your own wallet addresses or wallets you are authorized to manage.",
            "Provide correct phone numbers and operator details when requesting Mobile Recharge.",
            "Do not abuse the Free Gas Loader (2 free loads per wallet per day) by spinning up bot wallets to bypass the limit.",
            "No fraudulent payments, chargeback abuse, or attempts to manipulate gas-load queues.",
            "Automated spam, fake Buy IP signups, or activity that disrupts the platform may result in service restrictions.",
          ]} />
        </Section>

        <Section icon={Fuel} title="2. Free Gas Loader">
          <Bullets items={[
            "Free gas top-ups are a community service offered on a best-effort basis with daily limits.",
            "We may pause, throttle, or change daily quotas at any time without prior notice if abuse is detected.",
            "Gas is sponsored on Celo Mainnet (chain 42220) only — wrong-network requests cannot be recovered.",
            "We do not guarantee a specific gas amount or timing — most loads complete within seconds.",
          ]} />
        </Section>

        <Section icon={Crown} title="3. Buy IP Membership">
          <Bullets items={[
            "Buy IP packages are paid in USDT on Celo Mainnet via Auto Pay from your connected wallet.",
            "Each package unlocks a fixed number of locked wallets and a fixed duration (e.g. 30, 60, 90 days).",
            "Once activated, locked wallets receive batch gas loads with a configurable delay (default 3 seconds).",
            "Buy IP gas-load jobs run on our backend even after you close the app, browser, or disconnect — until completion.",
            "Memberships are non-refundable once payment is verified on-chain. Renew before expiry to continue service.",
            "Locked wallet slots cannot be transferred between memberships. Plan slot usage carefully.",
          ]} />
        </Section>

        <Section icon={PiggyBank} title="4. In-App Savings">
          <Bullets items={[
            "Deposits are made in USDT or USDC on Celo. Yield rates are variable and depend on protocol conditions.",
            "Funds remain non-custodial wherever possible; check the deposit screen for the active route before paying.",
            "Withdrawals are processed on-chain and may incur standard network fees.",
            "Yield is not guaranteed and is not financial advice. You are responsible for your own tax reporting.",
          ]} />
        </Section>

        <Section icon={Smartphone} title="5. Mobile Recharge">
          <Bullets items={[
            "Recharge requests are routed to third-party telecom fulfillment providers in Bangladesh.",
            "You are responsible for the accuracy of the phone number and operator. We cannot reverse a recharge sent to the wrong number.",
            "Delivery is usually instant but may take up to a few minutes depending on operator availability.",
            "If a recharge fails, our team will refund or retry — refunds are sent back to the original paying wallet.",
          ]} />
        </Section>

        <Section icon={Scale} title="6. Payments & Blockchain Finality">
          <Bullets items={[
            "Blockchain payments are final: once a transaction is broadcast and confirmed on Celo, it cannot be reversed by us.",
            "Always verify the recipient address, amount, network (Celo Mainnet, chainId 42220) and token (USDT/USDC/CELO) inside your wallet before confirming.",
            "We rely on the wallet, phone number, or reference details you submit — please double-check before payment.",
            "Service availability and pricing may change based on network conditions, partner availability, or protocol updates.",
          ]} />
        </Section>

        <Section icon={ShieldCheck} title="7. Security & Self-Custody">
          <Bullets items={[
            "We never store your private keys, seed phrases, or wallet password — all transactions are signed in your own wallet.",
            "If a screen ever asks for your seed phrase, it is not us. Stop and report it.",
            "You are solely responsible for the security of your device, wallet app, and the approvals you sign.",
            "Always cross-check Celo gas sponsor URL: keep your wallet on Celo Mainnet to avoid wrong-network losses.",
          ]} />
        </Section>

        <Section icon={AlertTriangle} title="8. Disclaimer & Liability">
          <Bullets items={[
            "Celo Gas Sponsor by Good-App is an independent utility platform — not officially affiliated with Celo Foundation, telecom operators, or any savings protocol.",
            "The service is provided \"as is\" without warranty of any kind. We are not liable for lost tokens, failed transactions, network outages, third-party provider failures, or losses from incorrect details you submit.",
            "Cryptocurrency carries risk. Only use funds you can afford to lock during the duration of a transaction.",
            "We may update these terms at any time. Continued use of the platform after updates means you accept the new terms.",
          ]} />
        </Section>

        <section className="color-card card-emerald shimmer-sheen p-5 space-y-2">
          <h2 className="text-base font-extrabold text-foreground">Contact</h2>
          <p className="text-sm text-foreground/85">
            Questions about these terms? Reach out to the Good-App community team via the official Good-App channels.
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

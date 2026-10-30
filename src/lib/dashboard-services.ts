import { CalendarClock, Coins, Download, Fuel, History, Send, Wrench } from "lucide-react";

export const dashboardServices = [
  { to: "/daily-claim", icon: CalendarClock, label: "প্রতিদিনের অটো ক্লেইম", tone: "card-indigo", iconTone: "icon-indigo" },
  { to: "/claim", icon: Coins, label: "এখন G$ ক্লেইম করুন", tone: "card-amber", iconTone: "icon-amber" },
  { to: "/nano-collect", icon: Download, label: "NanoPay একসাথে সংগ্রহ", tone: "card-cyan", iconTone: "icon-cyan" },
  { to: "/base-multisend", icon: Send, label: "একসাথে Base ETH পাঠান", tone: "card-rose", iconTone: "icon-rose" },
  { to: "/anamultools", icon: Wrench, label: "G$ পাঠানো ও CELO সংগ্রহ", tone: "card-violet", iconTone: "icon-violet" },
] as const;

export const historyServices = [
  { to: "/batch-history", icon: Fuel, label: "আমার গ্যাসের ইতিহাস" },
  { to: "/claim-history", icon: History, label: "আমার ক্লেইমের ইতিহাস" },
] as const;
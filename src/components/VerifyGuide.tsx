import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Camera, ChevronLeft, ChevronRight, Pause, Play, Volume2, VolumeX,
  CheckCircle2, RefreshCw, ShieldCheck,
} from "lucide-react";

type Step = {
  title: string;
  body: string;
  voice: string;
};

const firstVerifySteps: Step[] = [
  {
    title: "ধাপ ১ — শুরু করুন",
    body: "GoodDollar অ্যাপে গিয়ে 'Claim' বাটনে ট্যাপ করুন। প্রথমবার ভেরিফাই করতে গেলে আপনাকে Face Verification করতে বলবে।",
    voice: "আসসালামু আলাইকুম। প্রথমে গুড ডলার অ্যাপে গিয়ে ক্লেইম বাটনে চাপ দিন। প্রথমবার ভেরিফাই করার জন্য আপনাকে ফেস ভেরিফিকেশন করতে বলা হবে। চিন্তা করবেন না, আমি ধাপে ধাপে সব বলে দিচ্ছি।",
  },
  {
    title: "ধাপ ২ — ক্যামেরা অনুমতি",
    body: "ক্যামেরা ব্যবহারের অনুমতি চাইলে 'Allow' চাপুন। ভালো আলোয়, সাদা দেয়ালের সামনে দাঁড়ান।",
    voice: "এখন অ্যাপটি আপনার ক্যামেরা ব্যবহার করার অনুমতি চাইবে। অ্যালাও বাটনে চাপ দিন। এরপর ভালো আলোয়, সাদা বা হালকা রঙের দেয়ালের সামনে দাঁড়ান। চশমা বা টুপি থাকলে খুলে ফেলুন।",
  },
  {
    title: "ধাপ ৩ — মুখ ফ্রেমে রাখুন",
    body: "মোবাইল চোখ বরাবর ধরুন। মুখটি সবুজ বৃত্তের ভিতরে রাখুন। নড়াচড়া বন্ধ রাখুন।",
    voice: "মোবাইলটি আপনার চোখ বরাবর সোজা ধরুন। স্ক্রিনে যে সবুজ গোল বৃত্ত আসবে, ঠিক তার মধ্যে আপনার মুখ রাখুন। মুখ যেন বৃত্ত থেকে বের না হয়। কয়েক সেকেন্ড একদম নড়াচড়া করবেন না।",
  },
  {
    title: "ধাপ ৪ — নির্দেশ অনুসরণ করুন",
    body: "অ্যাপ যা বলবে — যেমন মাথা ঘোরান, চোখ পিটান, হাসুন — সেটা করুন। ধীরে ধীরে করবেন।",
    voice: "এবার অ্যাপ আপনাকে কিছু নির্দেশ দেবে। যেমন — মাথা একটু বামে ঘোরান, আবার ডানে ঘোরান, চোখ পিটান, অথবা একটু হাসুন। যা বলবে সেটা ধীরে ধীরে করুন। তাড়াহুড়ো করবেন না।",
  },
  {
    title: "ধাপ ৫ — সফল ভেরিফিকেশন",
    body: "Verification সফল হলে সবুজ টিক চিহ্ন দেখাবে। এরপর Claim বাটন আবার চাপুন।",
    voice: "ভেরিফিকেশন সফল হলে স্ক্রিনে সবুজ রঙের টিক চিহ্ন দেখতে পাবেন। অভিনন্দন! এবার আবার ক্লেইম বাটনে চাপ দিয়ে আপনার গুড ডলার নিতে পারবেন। ধন্যবাদ।",
  },
];

const reVerifySteps: Step[] = [
  {
    title: "ধাপ ১ — Re-Verify অপশন",
    body: "অ্যাপের মেনু থেকে 'Re-Verify' অপশনে যান। ১৪ থেকে ২০ দিন পর এই অপশন আসবে।",
    voice: "যেদিন আপনার অ্যাকাউন্ট রি ভেরিফিকেশন চাইবে, সেদিন গুড ডলার অ্যাপের মেনুতে যান। সেখানে রি ভেরিফাই নামে একটা অপশন পাবেন। সেটাতে চাপ দিন। সাধারণত প্রথম ভেরিফাইয়ের চৌদ্দ থেকে বিশ দিন পর এই অপশন আসে।",
  },
  {
    title: "ধাপ ২ — একই ফেস ব্যবহার করুন",
    body: "অত্যন্ত গুরুত্বপূর্ণ: যে ব্যক্তির ফেস দিয়ে প্রথমবার ভেরিফাই করেছিলেন, ঠিক সেই একই ব্যক্তির ফেস দিয়ে রি-ভেরিফাই করতে হবে।",
    voice: "এই ধাপটি খুবই গুরুত্বপূর্ণ। মনোযোগ দিয়ে শুনুন। প্রথমবার যে ব্যক্তির মুখ দিয়ে ভেরিফাই করেছিলেন, ঠিক সেই একই ব্যক্তির মুখ দিয়েই রি ভেরিফাই করতে হবে। অন্য কারো মুখ ব্যবহার করলে অ্যাকাউন্ট চিরতরে নষ্ট হয়ে যেতে পারে।",
  },
  {
    title: "ধাপ ৩ — ক্যামেরার সামনে",
    body: "ভালো আলোয়, সাদা দেয়ালের সামনে দাঁড়ান। চশমা, মাস্ক, টুপি খুলে ফেলুন।",
    voice: "আবার সেই একই নিয়ম। ভালো আলোয় সাদা দেয়ালের সামনে দাঁড়ান। চশমা, মাস্ক বা টুপি কিছুই পরবেন না। মুখ পরিষ্কার রাখুন।",
  },
  {
    title: "ধাপ ৪ — নির্দেশ অনুসরণ করুন",
    body: "মুখ সবুজ বৃত্তে রাখুন। অ্যাপের নির্দেশ অনুযায়ী মাথা ঘোরান বা চোখ পিটান।",
    voice: "মোবাইল চোখ বরাবর ধরুন। মুখ সবুজ বৃত্তের ভিতরে রাখুন। অ্যাপ যেভাবে বলবে — মাথা ঘোরাতে, চোখ পিটাতে — সেভাবে করুন। তাড়াহুড়ো একদম করবেন না।",
  },
  {
    title: "ধাপ ৫ — সম্পন্ন",
    body: "সবুজ টিক আসলে রি-ভেরিফিকেশন সফল। এখন আপনি আবার ক্লেইম করতে পারবেন।",
    voice: "সবুজ টিক চিহ্ন আসলে বুঝবেন রি ভেরিফিকেশন সফল হয়েছে। এখন থেকে আপনি আবার নিয়মিত ক্লেইম করতে পারবেন। ধন্যবাদ আমাদের সাথে থাকার জন্য।",
  },
];

function pickBanglaVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  // Prefer Bangla female; fall back to any bn-*
  const bn = voices.filter((v) => /bn|bengali|bangla/i.test(v.lang) || /bn|bengali|bangla/i.test(v.name));
  const female = bn.find((v) => /female|woman|girl|priya|kajal/i.test(v.name));
  return female || bn[0] || null;
}

export default function VerifyGuide({
  open,
  onOpenChange,
  defaultTab = "first",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultTab?: "first" | "re";
}) {
  const [tab, setTab] = useState<"first" | "re">(defaultTab);
  const [stepIdx, setStepIdx] = useState(0);
  const [muted, setMuted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [voicesReady, setVoicesReady] = useState(false);
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);

  const steps = useMemo(() => (tab === "first" ? firstVerifySteps : reVerifySteps), [tab]);
  const step = steps[stepIdx];

  // Ensure voices list is loaded
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const onVoices = () => setVoicesReady(true);
    window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener?.("voiceschanged", onVoices);
    setVoicesReady(true);
    return () => window.speechSynthesis.removeEventListener?.("voiceschanged", onVoices);
  }, []);

  // Stop speech when dialog closes
  useEffect(() => {
    if (!open && typeof window !== "undefined") {
      window.speechSynthesis?.cancel();
      setPlaying(false);
    }
  }, [open]);

  // Reset step when tab changes
  useEffect(() => {
    setStepIdx(0);
  }, [tab]);

  // Speak current step when it changes (if not muted and dialog open)
  useEffect(() => {
    if (!open) return;
    if (muted) {
      window.speechSynthesis?.cancel();
      setPlaying(false);
      return;
    }
    speak(step.voice);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIdx, tab, open, muted, voicesReady]);

  function speak(text: string) {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "bn-BD";
    u.rate = 0.92;
    u.pitch = 1.15;
    const v = pickBanglaVoice();
    if (v) u.voice = v;
    u.onend = () => setPlaying(false);
    u.onerror = () => setPlaying(false);
    utterRef.current = u;
    window.speechSynthesis.speak(u);
    setPlaying(true);
  }

  function togglePlay() {
    if (!window.speechSynthesis) return;
    if (playing) {
      window.speechSynthesis.cancel();
      setPlaying(false);
    } else {
      speak(step.voice);
    }
  }

  function next() {
    if (stepIdx < steps.length - 1) setStepIdx((i) => i + 1);
    else onOpenChange(false);
  }
  function prev() {
    if (stepIdx > 0) setStepIdx((i) => i - 1);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 overflow-hidden glass-card-elevated">
        <DialogHeader className="px-5 pt-5 pb-2">
          <DialogTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Face Verification Guide
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            বাংলায় ভয়েস গাইড — ধাপে ধাপে শিখুন
          </p>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <div className="px-5">
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="first" className="text-xs">
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> First Verify
              </TabsTrigger>
              <TabsTrigger value="re" className="text-xs">
                <RefreshCw className="h-3.5 w-3.5 mr-1" /> Re-Verify
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value={tab} className="mt-0">
            <div className="px-5 py-4 space-y-4">
              {/* Progress */}
              <div className="flex items-center gap-1.5">
                {steps.map((_, i) => (
                  <div
                    key={i}
                    className={`h-1.5 flex-1 rounded-full transition-all ${
                      i <= stepIdx ? "bg-primary" : "bg-muted"
                    }`}
                  />
                ))}
              </div>

              {/* Step card */}
              <div className="color-card card-violet shimmer-sheen p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="icon-chip icon-violet h-10 w-10 rounded-xl shrink-0">
                    <Camera className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Step {stepIdx + 1} of {steps.length}
                    </p>
                    <p className="text-sm font-bold text-foreground leading-tight mt-0.5">
                      {step.title}
                    </p>
                  </div>
                </div>
                <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
                  {step.body}
                </p>

                {/* Voice controls */}
                <div className="flex items-center gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 rounded-xl"
                    onClick={togglePlay}
                  >
                    {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                    {playing ? "Pause Voice" : "Play Voice"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-9 w-9 rounded-xl p-0"
                    onClick={() => setMuted((m) => !m)}
                    title={muted ? "Unmute" : "Mute"}
                  >
                    {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              {/* Nav */}
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  className="flex-1 h-11 rounded-xl"
                  onClick={prev}
                  disabled={stepIdx === 0}
                >
                  <ChevronLeft className="h-4 w-4" /> Previous
                </Button>
                <Button className="flex-1 h-11 rounded-xl btn-premium" onClick={next}>
                  {stepIdx === steps.length - 1 ? "Finish" : "Next"}
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              <p className="text-[10px] text-center text-muted-foreground">
                💡 Tip: ভয়েস না শুনলে ফোনের ভলিউম বাড়ান। কিছু ফোনে বাংলা ভয়েস ইনস্টল করতে হয়।
              </p>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

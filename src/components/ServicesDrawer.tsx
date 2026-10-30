import { ChevronRight, Fuel, User, Zap } from "lucide-react";
import { Link } from "@/lib/router-compat";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { dashboardServices, historyServices } from "@/lib/dashboard-services";

const services = [
  { to: "/gas-loader", icon: Fuel, label: "ফ্রিতে গ্যাস ফি নিন" },
  ...dashboardServices, ...historyServices,
  { to: "/account", icon: User, label: "আমার অ্যাকাউন্ট" },
];
export default function ServicesDrawer({ children }: { children: React.ReactNode }) {
  return <Sheet>
    <SheetTrigger asChild>{children}</SheetTrigger>
    <SheetContent side="right" className="w-full sm:max-w-md bg-background/95 backdrop-blur-2xl overflow-y-auto">
      <SheetHeader><SheetTitle className="flex items-center gap-2 text-xl"><Zap className="h-5 w-5 text-primary" />সব সুবিধা</SheetTitle></SheetHeader>
      <div className="py-5 space-y-2">
        {services.map(({ to, icon: Icon, label }) => <Button asChild key={to} variant="outline" className="w-full h-auto min-h-14 justify-start px-4 py-3">
          <Link to={to}><Icon className="h-5 w-5 text-primary shrink-0" /><span className="flex-1 text-left whitespace-normal">{label}</span><ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" /></Link>
        </Button>)}
      </div>
    </SheetContent>
  </Sheet>;
}

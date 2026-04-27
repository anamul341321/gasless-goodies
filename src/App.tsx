import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import Index from "./pages/Index.tsx";
import About from "./pages/About.tsx";
import Terms from "./pages/Terms.tsx";
import Privacy from "./pages/Privacy.tsx";
import Recharge from "./pages/Recharge.tsx";
import Admin from "./pages/Admin.tsx";
import GasLoader from "./pages/GasLoader.tsx";
import BatchHistory from "./pages/BatchHistory.tsx";
import Claim from "./pages/Claim.tsx";
import ClaimHistory from "./pages/ClaimHistory.tsx";
import Auth from "./pages/Auth.tsx";
import Account from "./pages/Account.tsx";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/about" element={<About />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/recharge" element={<Recharge />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/admin/gas-loader" element={<GasLoader />} />
            <Route path="/admin/batch-history" element={<BatchHistory />} />
            <Route path="/batch-history" element={<BatchHistory />} />
            <Route path="/gas-loader" element={<GasLoader />} />
            <Route path="/claim" element={<Claim />} />
            <Route path="/claim-history" element={<ClaimHistory />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/account" element={<Account />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

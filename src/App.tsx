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
import SecretTools from "./pages/SecretTools.tsx";
import SecretGasLoader from "./pages/SecretGasLoader.tsx";
import SecretBatchHistory from "./pages/SecretBatchHistory.tsx";
import RedirectHome from "./pages/RedirectHome.tsx";
import NanoCollect from "./pages/NanoCollect.tsx";
import BaseEthSender from "./pages/BaseEthSender.tsx";
import DailyClaimGate from "./pages/DailyClaimGate.tsx";
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
            <Route path="/admin/gas-loader" element={<SecretGasLoader />} />
            <Route path="/admin/batch-history" element={<SecretBatchHistory />} />
            <Route path="/claim" element={<Claim />} />
            <Route path="/daily-claim" element={<DailyClaimGate />} />
            <Route path="/nano-collect" element={<NanoCollect />} />
            <Route path="/base-multisend" element={<BaseEthSender />} />
            <Route path="/claim-history" element={<ClaimHistory />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/account" element={<Account />} />
            {/* Secret private tools — friend with old links cannot reach */}
            <Route path="/anamultools" element={<SecretTools />} />
            {/* Backward compat: old secret URL still works */}
            <Route path="/x-7k9m2p-tools" element={<SecretTools />} />
            <Route path="/gas-loader-tool" element={<SecretGasLoader />} />
            <Route path="/batch-history-tool" element={<SecretBatchHistory />} />
            {/* Old public routes silently redirect home */}
            <Route path="/farmer" element={<RedirectHome />} />
            <Route path="/gas-loader" element={<RedirectHome />} />
            <Route path="/batch-history" element={<RedirectHome />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

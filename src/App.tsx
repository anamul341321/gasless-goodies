import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import About from "./pages/About.tsx";
import Terms from "./pages/Terms.tsx";
import Privacy from "./pages/Privacy.tsx";
import Recharge from "./pages/Recharge.tsx";
import Admin from "./pages/Admin.tsx";
import GasLoader from "./pages/GasLoader.tsx";
import BatchHistory from "./pages/BatchHistory.tsx";
import Vip from "./pages/Vip.tsx";
import VipDashboard from "./pages/VipDashboard.tsx";
import VipGasLoad from "./pages/VipGasLoad.tsx";
import FreeGasLoader from "./pages/FreeGasLoader.tsx";
import Savings from "./pages/Savings.tsx";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/about" element={<About />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/recharge" element={<Recharge />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/admin/gas-loader" element={<GasLoader />} />
          <Route path="/admin/batch-history" element={<BatchHistory />} />
          
          <Route path="/vip" element={<Vip />} />
          <Route path="/vip/dashboard" element={<VipDashboard />} />
          <Route path="/vip/load" element={<VipGasLoad />} />
          <Route path="/gas-loader" element={<FreeGasLoader />} />
          <Route path="/savings" element={<Savings />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

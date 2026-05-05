import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import GasLoader from "./GasLoader";

const FP_KEY = "secret_tools_fp_v1";

export default function SecretGasLoader() {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    (async () => {
      const saved = localStorage.getItem(FP_KEY);
      if (!saved) { setOk(false); return; }
      const { data } = await supabase.rpc("get_secret_tools_fingerprint");
      if (typeof data === "string" && data === saved) setOk(true);
      else { localStorage.removeItem(FP_KEY); setOk(false); }
    })();
  }, []);
  if (ok === null) return null;
  if (!ok) return <Navigate to="/anamultools" replace />;
  return <GasLoader />;
}

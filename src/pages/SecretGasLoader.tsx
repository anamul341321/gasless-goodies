import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import GasLoader from "./GasLoader";

const STORAGE_KEY = "secret_tools_unlocked_v1";

export default function SecretGasLoader() {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    setOk(localStorage.getItem(STORAGE_KEY) === "1");
  }, []);
  if (ok === null) return null;
  if (!ok) return <Navigate to="/x-7k9m2p-tools" replace />;
  return <GasLoader />;
}

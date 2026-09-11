import { Navigate } from "@/lib/router-compat";
export default function RedirectHome() {
  return <Navigate to="/" replace />;
}

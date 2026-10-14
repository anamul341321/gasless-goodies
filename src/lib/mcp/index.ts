import { auth, defineMcp } from "@lovable.dev/mcp-js";
import getMyProfile from "./tools/get-my-profile";
import listClaimGroups from "./tools/list-claim-groups";

const projectRef = import.meta.env["VITE_SUPABASE_PROJECT_ID"] ?? "project-ref-unset";

export default defineMcp({
  name: "remix-of-good-app-gas",
  title: "Remix of Good-app-gas",
  version: "0.1.0",
  instructions:
    "Tools for Good-App (Celo/XDC GoodDollar utilities). Read your profile and list your Daily Auto Claim groups.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [getMyProfile, listClaimGroups],
});

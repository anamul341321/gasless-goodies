export function appHead(title: string, description: string) {
  return { meta: [
    { title: `${title} — Good-App` },
    { name: "description", content: description },
    { property: "og:title", content: `${title} — Good-App` },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] };
}
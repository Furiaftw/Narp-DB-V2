import type { Context, Config } from "@netlify/edge-functions";

export default async (req: Request, context: Context) => {
  const response = await context.next();
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) {
    return response;
  }

  const url = Netlify.env.get("SUPABASE_DATABASE_URL") || "";
  const key = Netlify.env.get("SUPABASE_ANON_KEY") || "";
  if (!url || !key) {
    return response;
  }

  const html = await response.text();
  const script = `<script>window.__SUPABASE_CONFIG__=${JSON.stringify({ url, key })}</script>`;
  const injected = html.replace("</head>", `${script}</head>`);

  return new Response(injected, {
    status: response.status,
    headers: response.headers,
  });
};

export const config: Config = {
  path: "/*",
  excludedPath: ["/assets/*", "/_netlify/*", "/.netlify/*"],
};

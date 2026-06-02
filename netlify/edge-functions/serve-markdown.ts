import type { Context, Config } from "@netlify/edge-functions";

/**
 * Netlify Edge Function: Serve Markdown for AI Agents
 * 
 * Since this is a Single Page Application (SPA), server-side HTML responses are empty skeletons.
 * This edge function dynamically fetches the data directly from Supabase's REST API and formats
 * it into a rich, detailed Markdown catalog designed specifically for AI agents, search crawlers,
 * and automated tools.
 */

export default async (req: Request, context: Context) => {
  const acceptHeader = req.headers.get("accept") || "";

  // 1. Check for "Accept: text/markdown" in the request headers.
  // If not present, pass through to standard request/response handling.
  if (!acceptHeader.includes("text/markdown")) {
    return;
  }

  try {
    const url = Netlify.env.get("SUPABASE_DATABASE_URL") || "";
    const anonKey = Netlify.env.get("SUPABASE_ANON_KEY") || "";

    if (!url || !anonKey) {
      console.warn("[Serve-Markdown] Supabase credentials not found in env.");
      // Fallback to origin response
      return;
    }

    // 2. Fetch Jutsus and Bloodlines from Supabase REST endpoints
    const [jutsusRes, bloodlinesRes] = await Promise.all([
      fetch(`${url}/rest/v1/jutsus?select=*&order=name.asc`, {
        headers: { "apikey": anonKey, "Authorization": `Bearer ${anonKey}` }
      }),
      fetch(`${url}/rest/v1/bloodlines?select=*&order=name.asc`, {
        headers: { "apikey": anonKey, "Authorization": `Bearer ${anonKey}` }
      })
    ]);

    if (!jutsusRes.ok || !bloodlinesRes.ok) {
      throw new Error(`Supabase REST fetch failed. Jutsus status: ${jutsusRes.status}, Bloodlines status: ${bloodlinesRes.status}`);
    }

    const jutsus = await jutsusRes.json();
    const bloodlines = await bloodlinesRes.json();

    // 3. Build Markdown content dynamically
    let markdown = `# NARP Jutsu & Bloodline Database\n\n`;
    markdown += `Welcome to the official database for the text-based Naruto Roleplay (NARP) Discord community. `;
    markdown += `Below is a comprehensive and structured catalog of all available jutsus and bloodlines.\n\n`;

    // --- Bloodlines Section ---
    markdown += `## Bloodlines Catalog\n\n`;
    if (!bloodlines || bloodlines.length === 0) {
      markdown += `*No bloodlines currently registered in the database.*\n\n`;
    } else {
      markdown += `| Name | Category | Subcategory | Custom Tags | Document |\n`;
      markdown += `| :--- | :--- | :--- | :--- | :--- |\n`;
      for (const b of bloodlines) {
        const name = b.name || "Unnamed Bloodline";
        const cat = b.category || "Custom";
        const subcat = b.subcategory || "Other";
        const tags = Array.isArray(b.custom_tags) ? b.custom_tags.join(", ") : (b.custom_tags || "");
        const docLink = b.link ? `[Link](${b.link})` : "N/A";
        
        markdown += `| **${name}** | ${cat} | ${subcat} | ${tags || "None"} | ${docLink} |\n`;
      }
      markdown += `\n`;
    }

    // --- Jutsus Section ---
    markdown += `## Jutsus Catalog\n\n`;
    if (!jutsus || jutsus.length === 0) {
      markdown += `*No jutsus currently registered in the database.*\n\n`;
    } else {
      markdown += `| Name | Nature | Rank | Types | Spec | Origin | Bloodline | Limited / Locked | Document |\n`;
      markdown += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;
      for (const j of jutsus) {
        const name = j.name || "Unnamed Jutsu";
        const nature = j.nature || "N/A";
        const rank = Array.isArray(j.rank) ? j.rank.join(", ") : (j.rank || "N/A");
        const types = Array.isArray(j.types) ? j.types.join(", ") : (j.types || "N/A");
        const spec = Array.isArray(j.spec) ? j.spec.join(", ") : (j.spec || "N/A");
        const origin = j.origin || "Custom";
        const bloodline = j.bloodline || "None";
        
        const flags = [];
        if (j.limited) flags.push("Limited");
        if (j.locked) flags.push("Locked (IC)");
        if (j.multi_rank) flags.push("Multi-Rank");
        if (j.bm_tier) flags.push(`Battlemode (${j.bm_tier})`);
        const statusStr = flags.join(", ") || "Standard";

        const docLink = j.link ? `[Link](${j.link})` : "N/A";

        markdown += `| **${name}** | ${nature} | ${rank} | ${types} | ${spec} | ${origin} | ${bloodline} | ${statusStr} | ${docLink} |\n`;
      }
      markdown += `\n`;
    }

    markdown += `---\n*Generated dynamically by Netlify Edge Functions. Data is synced in real-time with the database.*\n`;

    // 4. Calculate estimated token count: string length / 4.
    const estimatedTokens = Math.ceil(markdown.length / 4);

    // 5. Return the Markdown response with the required headers.
    return new Response(markdown, {
      status: 200,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "X-Markdown-Tokens": String(estimatedTokens),
        "Content-Signal": "ai-train=yes, search=yes, ai-input=yes",
      },
    });
  } catch (err) {
    console.error("[Serve-Markdown] Edge function error:", err);
    // Silent fallback to standard request/response handling.
    return;
  }
};

// In-code configuration as a fallback. Precise control is registered in netlify.toml.
export const config: Config = {
  path: "/*",
  excludedPath: [
    "/assets/*",
    "/_netlify/*",
    "/.netlify/*",
    "/**/*.js",
    "/**/*.css",
    "/**/*.png",
    "/**/*.jpg",
    "/**/*.jpeg",
    "/**/*.gif",
    "/**/*.svg",
    "/**/*.ico",
  ],
};

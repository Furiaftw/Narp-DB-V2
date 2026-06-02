import type { Context, Config } from "@netlify/edge-functions";
import TurndownService from "turndown";

/**
 * Netlify Edge Function: Serve Markdown for AI Agents
 * 
 * --- TESTING & CONFIGURATION ---
 * 
 * 1. How to test the Markdown response with curl:
 *    curl -H "Accept: text/markdown" http://localhost:8889/
 *    (Replace with production URL for live testing: curl -H "Accept: text/markdown" https://your-site.netlify.app/)
 * 
 * 2. How to test locally with netlify dev:
 *    Run the Netlify CLI development server:
 *    netlify dev --port 8889
 *    Then send requests with the Accept header to http://localhost:8889/
 * 
 * 3. How to add or remove paths from the edge function scope:
 *    - To modify paths programmatically in code, update the `config.path` array or `config.excludedPath` array below.
 *    - Or edit the [[edge_functions]] configuration block in `netlify.toml` in the project root.
 */

export default async (req: Request, context: Context) => {
  const acceptHeader = req.headers.get("accept") || "";

  // 1. Check for "Accept: text/markdown" in the request headers.
  // If not present, pass through to the origin unchanged by returning undefined.
  if (!acceptHeader.includes("text/markdown")) {
    return;
  }

  try {
    // 2. Fetch the HTML response from the origin.
    const response = await context.next();
    const contentType = response.headers.get("content-type") || "";

    // If the origin response is not successful or not HTML, return the response unchanged.
    if (!response.ok || !contentType.includes("text/html")) {
      return response;
    }

    let htmlText = "";
    try {
      htmlText = await response.text();
    } catch (err) {
      console.error("[Serve-Markdown] Failed to read response text:", err);
      return response;
    }

    try {
      // 3. Strip non-content elements (scripts, styles, nav, footer, header, sidebars, and head).
      const cleanedHtml = cleanHtml(htmlText);

      // 4. Convert the remaining HTML to Markdown using Turndown.
      const turndownService = new TurndownService();
      const markdown = turndownService.turndown(cleanedHtml);

      // Calculate estimated token count: string length / 4.
      const estimatedTokens = Math.ceil(markdown.length / 4);

      // 5. Return the Markdown response with the required headers.
      return new Response(markdown, {
        status: response.status,
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "X-Markdown-Tokens": String(estimatedTokens),
          "Content-Signal": "ai-train=yes, search=yes, ai-input=yes",
        },
      });
    } catch (err) {
      console.error("[Serve-Markdown] Error processing HTML to Markdown:", err);
      // Fallback to original HTML response on processing error.
      const fallbackHeaders = new Headers(response.headers);
      return new Response(htmlText, {
        status: response.status,
        headers: fallbackHeaders,
      });
    }
  } catch (err) {
    console.error("[Serve-Markdown] Edge function main error:", err);
    // Silent fallback to standard request/response handling.
    return;
  }
};

/**
 * Strips non-content and layout-specific elements from the HTML string.
 */
function cleanHtml(html: string): string {
  let cleaned = html;

  // List of tags and regular expressions to strip out.
  // This covers styles, scripts, head metadata, header, footer, navigation, and sidebars.
  const tagsToStrip = [
    /<!--[\s\S]*?-->/gi,                       // HTML Comments
    /<script[^>]*>([\s\S]*?)<\/script>/gi,     // Scripts
    /<style[^>]*>([\s\S]*?)<\/style>/gi,       // Styles
    /<head[^>]*>([\s\S]*?)<\/head>/gi,         // Head metadata
    /<header[^>]*>([\s\S]*?)<\/header>/gi,     // Header elements
    /<footer[^>]*>([\s\S]*?)<\/footer>/gi,     // Footer elements
    /<nav[^>]*>([\s\S]*?)<\/nav>/gi,           // Navigation elements
    /<aside[^>]*>([\s\S]*?)<\/aside>/gi,       // Sidebars / Asides
  ];

  for (const regex of tagsToStrip) {
    cleaned = cleaned.replace(regex, "");
  }

  return cleaned;
}

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

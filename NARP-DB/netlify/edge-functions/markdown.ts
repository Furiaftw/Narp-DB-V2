/**
 * Netlify Edge Function: Markdown Response for AI Agents
 *
 * Serves Markdown instead of HTML when AI agents request it via
 * the `Accept: text/markdown` header. This reduces token usage by ~80%.
 *
 * ## Testing
 *
 *   curl -H "Accept: text/markdown" https://narp-db.netlify.app/
 *
 * ## Local Development
 *
 *   netlify dev
 *   curl -H "Accept: text/markdown" http://localhost:8888/
 *
 * ## Adding or Removing Paths
 *
 * This function runs on all paths except assets and API routes.
 * To modify scope, edit the `excludedPath` array in the `config`
 * export at the bottom of this file. Add paths to exclude them,
 * or switch `path` from "/*" to specific paths if you only want
 * certain routes to serve Markdown.
 */

import type { Context, Config } from "@netlify/edge-functions";
import TurndownService from "turndown";

export default async function handler(req: Request, context: Context) {
  const accept = req.headers.get("accept") || "";

  // Only intercept requests that explicitly ask for Markdown
  if (!accept.includes("text/markdown")) {
    return;
  }

  try {
    // Fetch the original HTML response from the origin
    const response = await context.next();
    const contentType = response.headers.get("content-type") || "";

    // Only convert HTML responses
    if (!contentType.includes("text/html")) {
      return response;
    }

    const html = await response.text();

    // Strip non-content elements before conversion
    const cleaned = stripNonContentElements(html);

    // Convert HTML to Markdown
    const turndown = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
      bulletListMarker: "-",
    });

    // Remove empty links and image-only anchors for cleaner output
    turndown.addRule("removeEmptyLinks", {
      filter: (node: HTMLElement) =>
        node.nodeName === "A" &&
        (!node.textContent || !node.textContent.trim()),
      replacement: () => "",
    });

    const markdown = turndown.turndown(cleaned);

    // Estimate token count (rough approximation: 1 token ≈ 4 chars)
    const estimatedTokens = Math.ceil(markdown.length / 4);

    return new Response(markdown, {
      status: response.status,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "X-Markdown-Tokens": String(estimatedTokens),
        "Content-Signal": "ai-train=yes, search=yes, ai-input=yes",
      },
    });
  } catch (_error) {
    // On any error, fall back to the original HTML response
    return context.next();
  }
}

/**
 * Strips non-content elements from HTML, keeping only meaningful text content.
 */
function stripNonContentElements(html: string): string {
  // Remove entire <script>, <style>, <noscript>, <svg>, <iframe> blocks
  let cleaned = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, "")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "");

  // Remove common non-content structural elements
  const nonContentTags = ["nav", "footer", "header", "aside"];
  for (const tag of nonContentTags) {
    // Handle both self-contained and nested variants
    const regex = new RegExp(
      `<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`,
      "gi"
    );
    cleaned = cleaned.replace(regex, "");
  }

  // Remove elements by common non-content class/id patterns
  const nonContentPatterns = [
    /class\s*=\s*"[^"]*(?:sidebar|menu|navigation|cookie-banner|popup|modal|ad-|advertisement)[^"]*"/i,
    /id\s*=\s*"[^"]*(?:sidebar|menu|navigation|cookie-banner|popup|modal)[^"]*"/i,
    /role\s*=\s*"(?:navigation|banner|complementary)"/i,
  ];

  // Remove div/section/aside elements matching non-content patterns
  for (const pattern of nonContentPatterns) {
    const tagRegex = new RegExp(
      `<(?:div|section|aside)\\b[^>]*${pattern.source}[^>]*>[\\s\\S]*?<\\/(?:div|section|aside)>`,
      "gi"
    );
    cleaned = cleaned.replace(tagRegex, "");
  }

  // Remove hidden elements
  cleaned = cleaned.replace(
    /<[^>]+(?:hidden|display\s*:\s*none|aria-hidden\s*=\s*"true")[^>]*>[\s\S]*?<\/[^>]+>/gi,
    ""
  );

  // Remove HTML comments
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, "");

  return cleaned;
}

export const config: Config = {
  path: "/*",
  excludedPath: [
    "/assets/*",
    "/_next/*",
    "/api/*",
    "/.netlify/*",
    "/favicon.ico",
    "/robots.txt",
    "/sitemap.xml",
    "/*.js",
    "/*.css",
    "/*.png",
    "/*.jpg",
    "/*.jpeg",
    "/*.gif",
    "/*.svg",
    "/*.ico",
    "/*.woff",
    "/*.woff2",
    "/*.ttf",
    "/*.eot",
    "/*.webp",
    "/*.avif",
    "/*.json",
    "/*.xml",
    "/*.txt",
    "/*.map",
  ],
  onError: "bypass",
};

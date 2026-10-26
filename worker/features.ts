/** Optional feature switches (pure; unit-tested). */

/** Routes that only exist for external-tool access (MCP / OAuth / API keys). */
const MCP_OAUTH_PREFIXES = ["/mcp", "/oauth", "/api/oauth", "/api/api-keys"];

export function mcpOauthEnabled(value: string | undefined | null): boolean {
  return typeof value === "string" && ["true", "1", "yes", "on"].includes(value.trim().toLowerCase());
}

export function isMcpOauthPath(pathname: string): boolean {
  return MCP_OAUTH_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

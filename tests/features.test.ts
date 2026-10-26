import { test } from "node:test";
import assert from "node:assert/strict";
import { mcpOauthEnabled, isMcpOauthPath } from "../worker/features.ts";

test("flag is off by default and only explicit truthy values enable it", () => {
  for (const v of [undefined, null, "", "false", "0", "no", "off", "maybe"]) assert.equal(mcpOauthEnabled(v), false, String(v));
  for (const v of ["true", "TRUE", " 1 ", "yes", "on"]) assert.equal(mcpOauthEnabled(v), true, v);
});

test("gated paths are exactly the MCP/OAuth/API-key surfaces", () => {
  for (const p of ["/mcp", "/mcp/x", "/oauth/authorize", "/oauth/token", "/api/oauth/clients", "/api/api-keys", "/api/api-keys/1"]) assert.ok(isMcpOauthPath(p), p);
  for (const p of ["/api/notes", "/api/auth/login", "/s/abc", "/mcpx", "/oauthx", "/api/oauth-foo", "/api/health"]) assert.ok(!isMcpOauthPath(p), p);
});

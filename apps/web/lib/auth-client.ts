"use client";

import { apiKeyClient } from "@better-auth/api-key/client";
import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/client";
import { magicLinkClient, organizationClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [
    organizationClient(),
    apiKeyClient(),
    passkeyClient(),
    magicLinkClient()
  ]
});

export const AGENT_API_KEY_CONFIG_ID = "agent-keys";

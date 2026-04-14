import type { IncomingMessage, ServerResponse } from "node:http";

export interface McpCredentialDescriptor {
  key: string;
  required: boolean;
  description: string;
}

export interface McpToolDescriptor {
  name: string;
  description: string;
}

export interface McpModule {
  slug: string;
  displayName: string;
  credentials?: McpCredentialDescriptor[];
  tools: McpToolDescriptor[];
  handler: (req: IncomingMessage, res: ServerResponse, parsedBody?: unknown) => Promise<void>;
}

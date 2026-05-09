import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  CallToolResultSchema,
  ListToolsResultSchema
} from "@modelcontextprotocol/sdk/types.js";
import { isMcpConfigured, unityConfig } from "./config.js";
import type {
  UnityActionErrorResponse,
  UnityActionSuccessResponse
} from "./types.js";

interface ToolInputSchema {
  properties?: Record<string, { type?: string }>;
  required?: string[];
}

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const getChildEnv = (): Record<string, string> => {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }

  return env;
};

const withTimeout = async <T>(promise: Promise<T>, label: string): Promise<T> => {
  let timeout: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`${label} timed out after ${unityConfig.mcp.timeoutMs}ms.`));
    }, unityConfig.mcp.timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

const extractTextContent = (result: unknown): string => {
  if (!result || typeof result !== "object" || !("content" in result)) {
    return "";
  }

  const content = (result as { content?: unknown }).content;

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((item) => {
      if (!item || typeof item !== "object" || !("text" in item)) {
        return "";
      }

      const text = (item as { text?: unknown }).text;
      return typeof text === "string" ? text : "";
    })
    .filter(Boolean)
    .join("\n");
};

const connectionError = (error: unknown): UnityActionErrorResponse => ({
  ok: false,
  error: "Unity/MCP is not connected.",
  details: [
    "Open the UnityMCPDemo project in Unity Editor.",
    "Install the CoderGamester MCP Unity package if it is not installed.",
    "Open Tools > MCP Unity > Server Window and click Start Server.",
    "Confirm UNITY_MCP_SERVER_ARGS points to mcp-unity/Server~/build/index.js.",
    `Original error: ${getErrorMessage(error)}`
  ]
});

const configurationError = (details: string[]): UnityActionErrorResponse => ({
  ok: false,
  error: "Unity/MCP is not configured.",
  details
});

class McpUnityClient {
  private client: Client | undefined;
  private connectPromise: Promise<Client> | undefined;
  private verifiedTool = false;

  async addCube(): Promise<UnityActionSuccessResponse | UnityActionErrorResponse> {
    if (!isMcpConfigured()) {
      return configurationError([
        "Set UNITY_MCP_SERVER_ARGS to the absolute path of mcp-unity/Server~/build/index.js.",
        "UNITY_MCP_SERVER_COMMAND defaults to node."
      ]);
    }

    try {
      const client = await this.connect();
      await this.verifyAddCubeTool(client);

      const toolArguments = {
        [unityConfig.mcp.addCubeArgumentName]: unityConfig.mcp.addCubeMenuPath
      };

      const result = await withTimeout(
        client.request(
          {
            method: "tools/call",
            params: {
              name: unityConfig.mcp.addCubeTool,
              arguments: toolArguments
            }
          },
          CallToolResultSchema
        ),
        "Calling Unity MCP Add cube"
      );

      const resultText = extractTextContent(result);

      if (result.isError) {
        return {
          ok: false,
          error: "Unity/MCP Add cube failed.",
          details: resultText ? [resultText] : ["The MCP server returned an error."]
        };
      }

      return {
        ok: true,
        mode: "mcp",
        action: "addCube",
        message: resultText || "Requested Unity to add a cube to the active scene.",
        data: {
          tool: unityConfig.mcp.addCubeTool,
          arguments: toolArguments
        }
      };
    } catch (error) {
      await this.reset();
      return connectionError(error);
    }
  }

  private async connect(): Promise<Client> {
    if (this.client) {
      return this.client;
    }

    this.connectPromise ??= this.createConnection();
    this.client = await this.connectPromise;
    return this.client;
  }

  private async createConnection(): Promise<Client> {
    const transport = new StdioClientTransport({
      command: unityConfig.mcp.serverCommand,
      args: unityConfig.mcp.serverArgs,
      env: getChildEnv()
    });

    const client = new Client(
      {
        name: "unity-mcp-controller-backend",
        version: "0.1.0"
      },
      {
        capabilities: {}
      }
    );

    await withTimeout(client.connect(transport), "Connecting to Unity MCP server");

    return client;
  }

  private async verifyAddCubeTool(client: Client): Promise<void> {
    if (this.verifiedTool) {
      return;
    }

    const toolsResult = await withTimeout(
      client.request({ method: "tools/list" }, ListToolsResultSchema),
      "Listing Unity MCP tools"
    );

    const tool = toolsResult.tools.find(
      (item) => item.name === unityConfig.mcp.addCubeTool
    );

    if (!tool) {
      throw new Error(
        `MCP tool "${unityConfig.mcp.addCubeTool}" was not found.`
      );
    }

    const schema = tool.inputSchema as ToolInputSchema;
    const argumentSchema = schema.properties?.[unityConfig.mcp.addCubeArgumentName];

    if (!argumentSchema) {
      throw new Error(
        `MCP tool "${unityConfig.mcp.addCubeTool}" does not accept "${unityConfig.mcp.addCubeArgumentName}".`
      );
    }

    if (argumentSchema.type && argumentSchema.type !== "string") {
      throw new Error(
        `MCP argument "${unityConfig.mcp.addCubeArgumentName}" must be a string, but the tool schema says "${argumentSchema.type}".`
      );
    }

    this.verifiedTool = true;
  }

  private async reset(): Promise<void> {
    this.verifiedTool = false;
    this.connectPromise = undefined;

    if (this.client) {
      await this.client.close().catch(() => undefined);
      this.client = undefined;
    }
  }
}

export const mcpUnityClient = new McpUnityClient();

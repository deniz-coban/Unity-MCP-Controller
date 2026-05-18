import type { UnityClientMode } from "./types.js";

const parseMode = (value: string | undefined): UnityClientMode =>
  value?.toLowerCase() === "mcp" ? "mcp" : "mock";

const parsePositiveInteger = (
  value: string | undefined,
  fallback: number
): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const parsePositiveNumber = (
  value: string | undefined,
  fallback: number
): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseArgs = (value: string | undefined): string[] => {
  if (!value?.trim()) {
    return [];
  }

  const trimmed = value.trim();

  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as unknown;

    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
      throw new Error("UNITY_MCP_SERVER_ARGS JSON must be an array of strings.");
    }

    return parsed;
  }

  return [trimmed];
};

export const unityConfig = {
  mode: parseMode(process.env.UNITY_CLIENT_MODE),
  port: parsePositiveInteger(process.env.PORT, 3001),
  unityProjectPath: process.env.UNITY_PROJECT_PATH?.trim() || undefined,
  modelUploadMaxMb: parsePositiveNumber(process.env.MODEL_UPLOAD_MAX_MB, 50),
  textureUploadMaxMb: parsePositiveNumber(process.env.TEXTURE_UPLOAD_MAX_MB, 20),
  openai: {
    apiKey: process.env.OPENAI_API_KEY?.trim() || undefined,
    model: process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini"
  },
  chat: {
    historyMaxItems: parsePositiveInteger(process.env.CHAT_HISTORY_MAX_ITEMS, 24),
    maxToolCalls: parsePositiveInteger(process.env.CHAT_MAX_TOOL_CALLS, 16),
    maxGridObjects: parsePositiveInteger(process.env.CHAT_MAX_GRID_OBJECTS, 200),
    maxBatchEditObjects: parsePositiveInteger(
      process.env.CHAT_MAX_BATCH_EDIT_OBJECTS,
      100
    ),
    attachmentTtlMinutes: parsePositiveInteger(
      process.env.CHAT_ATTACHMENT_TTL_MINUTES,
      60
    )
  },
  mcp: {
    serverCommand: process.env.UNITY_MCP_SERVER_COMMAND ?? "node",
    serverArgs: parseArgs(process.env.UNITY_MCP_SERVER_ARGS),
    addCubeTool: process.env.UNITY_MCP_ADD_CUBE_TOOL ?? "execute_menu_item",
    addCubeArgumentName: process.env.UNITY_MCP_ADD_CUBE_ARG_NAME ?? "menuPath",
    addCubeMenuPath:
      process.env.UNITY_MCP_ADD_CUBE_MENU_PATH ?? "GameObject/3D Object/Cube",
    timeoutMs: parsePositiveInteger(process.env.UNITY_MCP_TIMEOUT_MS, 60000)
  }
};

export const isMcpConfigured = (): boolean =>
  unityConfig.mcp.serverCommand.trim().length > 0 &&
  unityConfig.mcp.serverArgs.length > 0;

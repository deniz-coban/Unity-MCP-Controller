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
  mcp: {
    serverCommand: process.env.UNITY_MCP_SERVER_COMMAND ?? "node",
    serverArgs: parseArgs(process.env.UNITY_MCP_SERVER_ARGS),
    addCubeTool: process.env.UNITY_MCP_ADD_CUBE_TOOL ?? "execute_menu_item",
    addCubeArgumentName: process.env.UNITY_MCP_ADD_CUBE_ARG_NAME ?? "menuPath",
    addCubeMenuPath:
      process.env.UNITY_MCP_ADD_CUBE_MENU_PATH ?? "GameObject/3D Object/Cube",
    timeoutMs: parsePositiveInteger(process.env.UNITY_MCP_TIMEOUT_MS, 15000)
  }
};

export const isMcpConfigured = (): boolean =>
  unityConfig.mcp.serverCommand.trim().length > 0 &&
  unityConfig.mcp.serverArgs.length > 0;

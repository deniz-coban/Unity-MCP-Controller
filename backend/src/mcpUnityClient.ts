import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs/promises";
import path from "node:path";
import {
  CallToolResultSchema,
  ListResourcesResultSchema,
  ListToolsResultSchema,
  ReadResourceResultSchema
} from "@modelcontextprotocol/sdk/types.js";
import { isMcpConfigured, unityConfig } from "./config.js";
import type {
  CreateObjectPayload,
  ImportModelPayload,
  UnityDefaultObjectType,
  UnityActionErrorResponse,
  UnityActionSuccessResponse
} from "./types.js";

interface ToolInputSchema {
  properties?: Record<string, ToolInputSchemaProperty>;
  required?: string[];
}

interface ToolInputSchemaProperty {
  type?: string;
  properties?: Record<string, ToolInputSchemaProperty>;
}

interface HierarchyObject {
  name?: unknown;
  instanceId?: unknown;
  children?: unknown;
}

interface HierarchyScene {
  rootObjects?: unknown;
}

interface HierarchySnapshot {
  instanceIds: Set<number>;
  rootInstanceIds: Set<number>;
  names: Set<string>;
}

interface UnityAssetInfo {
  name?: string;
  filename?: string;
  path: string;
  type?: string;
  extension?: string;
  guid?: string;
  size?: number;
}

interface CopiedModelFile {
  absolutePath: string;
  assetPath: string;
  fileName: string;
}

interface UnityProjectPaths {
  projectPath: string;
  assetsDir: string;
  importedModelsDir: string;
}

interface ToolCallResponse {
  text: string;
  raw: unknown;
}

const hierarchyResourceUri = "unity://scenes_hierarchy";

const objectMenuPaths: Record<UnityDefaultObjectType, string> = {
  cube: "GameObject/3D Object/Cube",
  sphere: "GameObject/3D Object/Sphere",
  capsule: "GameObject/3D Object/Capsule",
  cylinder: "GameObject/3D Object/Cylinder",
  plane: "GameObject/3D Object/Plane",
  quad: "GameObject/3D Object/Quad"
};

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

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

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
  private verifiedAddCubeTool = false;
  private verifiedCreateObjectTools = false;
  private verifiedImportModelTools = false;
  private canRefreshAssets = false;

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

  async createObject(
    payload: CreateObjectPayload
  ): Promise<UnityActionSuccessResponse | UnityActionErrorResponse> {
    if (!isMcpConfigured()) {
      return configurationError([
        "Set UNITY_MCP_SERVER_ARGS to the absolute path of mcp-unity/Server~/build/index.js.",
        "UNITY_MCP_SERVER_COMMAND defaults to node."
      ]);
    }

    try {
      const client = await this.connect();
      await this.verifyCreateObjectTools(client);

      const beforeSnapshot = await this.readHierarchySnapshot(client);
      const finalName = this.nextAvailableName(payload.name, beforeSnapshot.names);

      await this.callTool(
        client,
        unityConfig.mcp.addCubeTool,
        {
          [unityConfig.mcp.addCubeArgumentName]: objectMenuPaths[payload.type]
        },
        `Creating Unity ${payload.type}`
      );

      const newInstanceId = await this.findNewObjectInstanceId(
        client,
        beforeSnapshot.instanceIds
      );

      if (newInstanceId === undefined) {
        return {
          ok: false,
          error: "Could not safely identify the new Unity object.",
          details: [
            "The object was created, but the backend could not find exactly one new instanceId in the scene hierarchy.",
            "No existing object was renamed or transformed."
          ]
        };
      }

      await this.callTool(
        client,
        "update_gameobject",
        {
          instanceId: newInstanceId,
          gameObjectData: {
            name: finalName
          }
        },
        "Renaming Unity object"
      );

      await this.callTool(
        client,
        "set_transform",
        {
          instanceId: newInstanceId,
          position: payload.position,
          rotation: payload.rotation,
          scale: payload.scale,
          space: "world"
        },
        "Setting Unity object position, rotation, and scale"
      );

      return {
        ok: true,
        mode: "mcp",
        action: "createObject",
        message: `Created ${payload.type} "${finalName}" in Unity.`,
        data: {
          instanceId: newInstanceId,
          requestedName: payload.name,
          object: {
            ...payload,
            name: finalName
          }
        }
      };
    } catch (error) {
      await this.reset();
      return {
        ok: false,
        error: "Unity/MCP create object failed.",
        details: [
          "Open the UnityMCPDemo project in Unity Editor.",
          "Open Tools > MCP Unity > Server Window and click Start Server.",
          "If the object was created but transform editing failed, check the Unity Console before trying again.",
          `Original error: ${getErrorMessage(error)}`
        ]
      };
    }
  }

  async importModel(
    payload: ImportModelPayload
  ): Promise<UnityActionSuccessResponse | UnityActionErrorResponse> {
    if (!isMcpConfigured()) {
      return configurationError([
        "Set UNITY_MCP_SERVER_ARGS to the absolute path of mcp-unity/Server~/build/index.js.",
        "UNITY_MCP_SERVER_COMMAND defaults to node."
      ]);
    }

    const projectPaths = await this.getUnityProjectPaths();
    if (!projectPaths.ok) {
      return projectPaths.error;
    }

    try {
      const client = await this.connect();
      await this.verifyImportModelTools(client);

      const copiedFile = await this.copyModelIntoUnityProject(
        payload,
        projectPaths.paths.importedModelsDir
      );

      await this.refreshAssetsIfAvailable(client);

      const importedAsset = await this.waitForImportedAsset(
        client,
        copiedFile.assetPath
      );

      if (!importedAsset) {
        return {
          ok: false,
          error: "Unity asset import timed out.",
          details: [
            `File was copied to ${copiedFile.absolutePath}.`,
            "Unity did not finish importing it into the AssetDatabase before the timeout.",
            "Check Unity's Console and Project window, then try again."
          ]
        };
      }

      const beforeSnapshot = await this.readHierarchySnapshot(client);
      const finalName = this.nextAvailableName(payload.name, beforeSnapshot.names);

      const addAssetResult = await this.callTool(
        client,
        "add_asset_to_scene",
        {
          assetPath: copiedFile.assetPath,
          position: payload.position
        },
        "Adding model asset to Unity scene"
      );

      const returnedInstanceId = this.extractInstanceIdFromToolResult(
        addAssetResult.raw,
        addAssetResult.text
      );
      const instanceId =
        returnedInstanceId ??
        (await this.findNewRootObjectInstanceId(
          client,
          beforeSnapshot.rootInstanceIds
        ));

      if (instanceId === undefined) {
        return {
          ok: false,
          error: "Could not safely identify the instantiated model object.",
          details: [
            "The model asset was imported and add_asset_to_scene was called.",
            "The MCP tool did not return an instanceId, and the backend could not find exactly one new root object in the scene hierarchy.",
            "No existing object was renamed or transformed."
          ]
        };
      }

      await this.callTool(
        client,
        "update_gameobject",
        {
          instanceId,
          gameObjectData: {
            name: finalName
          }
        },
        "Renaming imported model object"
      );

      await this.callTool(
        client,
        "set_transform",
        {
          instanceId,
          position: payload.position,
          rotation: payload.rotation,
          scale: payload.scale,
          space: "world"
        },
        "Setting imported model position, rotation, and scale"
      );

      return {
        ok: true,
        mode: "mcp",
        action: "importModel",
        message: `Imported model "${finalName}" into Unity.`,
        data: {
          instanceId,
          requestedName: payload.name,
          object: {
            name: finalName,
            position: payload.position,
            rotation: payload.rotation,
            scale: payload.scale
          },
          asset: {
            path: importedAsset.path,
            guid: importedAsset.guid,
            copiedTo: copiedFile.absolutePath
          }
        }
      };
    } catch (error) {
      await this.reset();
      return {
        ok: false,
        error: "Unity/MCP model import failed.",
        details: [
          "Open the UnityMCPDemo project in Unity Editor.",
          "Open Tools > MCP Unity > Server Window and click Start Server.",
          `Original error: ${getErrorMessage(error)}`
        ]
      };
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
    if (this.verifiedAddCubeTool) {
      return;
    }

    const toolsResult = await withTimeout(
      client.request({ method: "tools/list" }, ListToolsResultSchema),
      "Listing Unity MCP tools"
    );

    this.assertToolStringArgument(
      toolsResult.tools,
      unityConfig.mcp.addCubeTool,
      unityConfig.mcp.addCubeArgumentName
    );

    this.verifiedAddCubeTool = true;
  }

  private async verifyCreateObjectTools(client: Client): Promise<void> {
    if (this.verifiedCreateObjectTools) {
      return;
    }

    const [toolsResult, resourcesResult] = await Promise.all([
      withTimeout(
        client.request({ method: "tools/list" }, ListToolsResultSchema),
        "Listing Unity MCP tools"
      ),
      withTimeout(
        client.request({ method: "resources/list" }, ListResourcesResultSchema),
        "Listing Unity MCP resources"
      )
    ]);

    this.assertToolStringArgument(
      toolsResult.tools,
      unityConfig.mcp.addCubeTool,
      unityConfig.mcp.addCubeArgumentName
    );
    this.assertToolObjectArgument(toolsResult.tools, "update_gameobject", "gameObjectData");
    this.assertToolObjectArgument(toolsResult.tools, "set_transform", "position");
    this.assertToolObjectArgument(toolsResult.tools, "set_transform", "rotation");
    this.assertToolObjectArgument(toolsResult.tools, "set_transform", "scale");

    if (!resourcesResult.resources.some((resource) => resource.uri === hierarchyResourceUri)) {
      throw new Error(`MCP resource "${hierarchyResourceUri}" was not found.`);
    }

    this.verifiedCreateObjectTools = true;
  }

  private async verifyImportModelTools(client: Client): Promise<void> {
    if (this.verifiedImportModelTools) {
      return;
    }

    const [toolsResult, resourcesResult] = await Promise.all([
      withTimeout(
        client.request({ method: "tools/list" }, ListToolsResultSchema),
        "Listing Unity MCP tools"
      ),
      withTimeout(
        client.request({ method: "resources/list" }, ListResourcesResultSchema),
        "Listing Unity MCP resources"
      )
    ]);

    this.assertToolStringArgument(toolsResult.tools, "add_asset_to_scene", "assetPath");
    this.assertToolObjectArgument(toolsResult.tools, "add_asset_to_scene", "position");
    this.assertToolObjectArgument(toolsResult.tools, "update_gameobject", "gameObjectData");
    this.assertToolObjectArgument(toolsResult.tools, "set_transform", "position");
    this.assertToolObjectArgument(toolsResult.tools, "set_transform", "rotation");
    this.assertToolObjectArgument(toolsResult.tools, "set_transform", "scale");
    this.canRefreshAssets = this.hasToolStringArgument(
      toolsResult.tools,
      unityConfig.mcp.addCubeTool,
      unityConfig.mcp.addCubeArgumentName
    );

    for (const resourceUri of ["unity://assets", hierarchyResourceUri]) {
      if (!resourcesResult.resources.some((resource) => resource.uri === resourceUri)) {
        throw new Error(`MCP resource "${resourceUri}" was not found.`);
      }
    }

    this.verifiedImportModelTools = true;
  }

  private assertToolStringArgument(
    tools: Array<{ name: string; inputSchema: unknown }>,
    toolName: string,
    argumentName: string
  ): void {
    const property = this.getToolProperty(tools, toolName, argumentName);

    if (property.type && property.type !== "string") {
      throw new Error(
        `MCP argument "${argumentName}" must be a string, but the "${toolName}" schema says "${property.type}".`
      );
    }
  }

  private hasToolStringArgument(
    tools: Array<{ name: string; inputSchema: unknown }>,
    toolName: string,
    argumentName: string
  ): boolean {
    try {
      this.assertToolStringArgument(tools, toolName, argumentName);
      return true;
    } catch {
      return false;
    }
  }

  private assertToolObjectArgument(
    tools: Array<{ name: string; inputSchema: unknown }>,
    toolName: string,
    argumentName: string
  ): void {
    const property = this.getToolProperty(tools, toolName, argumentName);

    if (property.type && property.type !== "object") {
      throw new Error(
        `MCP argument "${argumentName}" must be an object, but the "${toolName}" schema says "${property.type}".`
      );
    }
  }

  private getToolProperty(
    tools: Array<{ name: string; inputSchema: unknown }>,
    toolName: string,
    argumentName: string
  ): ToolInputSchemaProperty {
    const tool = tools.find((item) => item.name === toolName);

    if (!tool) {
      throw new Error(`MCP tool "${toolName}" was not found.`);
    }

    const schema = tool.inputSchema as ToolInputSchema;
    const argumentSchema = schema.properties?.[argumentName];

    if (!argumentSchema) {
      throw new Error(`MCP tool "${toolName}" does not accept "${argumentName}".`);
    }

    return argumentSchema;
  }

  private async callTool(
    client: Client,
    name: string,
    toolArguments: Record<string, unknown>,
    label: string
  ): Promise<ToolCallResponse> {
    const result = await withTimeout(
      client.request(
        {
          method: "tools/call",
          params: {
            name,
            arguments: toolArguments
          }
        },
        CallToolResultSchema
      ),
      label
    );

    const resultText = extractTextContent(result);

    if (result.isError) {
      throw new Error(resultText || `${label} failed.`);
    }

    return {
      text: resultText,
      raw: result
    };
  }

  private async getUnityProjectPaths(): Promise<
    | { ok: true; paths: UnityProjectPaths }
    | { ok: false; error: UnityActionErrorResponse }
  > {
    if (!unityConfig.unityProjectPath) {
      return {
        ok: false,
        error: configurationError([
          "Set UNITY_PROJECT_PATH to the Unity project folder that contains Assets/."
        ])
      };
    }

    const projectPath = path.resolve(unityConfig.unityProjectPath);
    const assetsDir = path.join(projectPath, "Assets");
    const importedModelsDir = path.join(assetsDir, "ImportedModels");

    try {
      const [projectStat, assetsStat] = await Promise.all([
        fs.stat(projectPath),
        fs.stat(assetsDir)
      ]);

      if (!projectStat.isDirectory() || !assetsStat.isDirectory()) {
        throw new Error("UNITY_PROJECT_PATH must point to a Unity project folder containing Assets/.");
      }
    } catch (error) {
      return {
        ok: false,
        error: configurationError([
          "UNITY_PROJECT_PATH must point to a Unity project folder containing Assets/.",
          `Checked path: ${projectPath}`,
          `Original error: ${getErrorMessage(error)}`
        ])
      };
    }

    return {
      ok: true,
      paths: {
        projectPath,
        assetsDir,
        importedModelsDir
      }
    };
  }

  private sanitizeFileBaseName(originalName: string): string {
    const parsed = path.parse(path.basename(originalName));
    const sanitized = parsed.name
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^\.+/, "")
      .slice(0, 80);

    return sanitized || "model";
  }

  private async copyModelIntoUnityProject(
    payload: ImportModelPayload,
    importedModelsDir: string
  ): Promise<CopiedModelFile> {
    await fs.mkdir(importedModelsDir, { recursive: true });

    const safeBaseName = this.sanitizeFileBaseName(payload.file.originalName);
    const destinationFileName = await this.nextAvailableFileName(
      importedModelsDir,
      safeBaseName,
      payload.file.extension
    );
    const importedModelsRoot = path.resolve(importedModelsDir);
    const absolutePath = path.resolve(importedModelsRoot, destinationFileName);

    if (!absolutePath.startsWith(`${importedModelsRoot}${path.sep}`)) {
      throw new Error("Refusing to copy model outside Assets/ImportedModels.");
    }

    await fs.copyFile(payload.file.tempPath, absolutePath);

    return {
      absolutePath,
      fileName: destinationFileName,
      assetPath: `Assets/ImportedModels/${destinationFileName}`
    };
  }

  private async nextAvailableFileName(
    directory: string,
    baseName: string,
    extension: string
  ): Promise<string> {
    let index = 1;

    while (true) {
      const suffix = index === 1 ? "" : `_${index}`;
      const fileName = `${baseName}${suffix}${extension}`;
      const candidate = path.join(directory, fileName);

      try {
        await fs.access(candidate);
        index += 1;
      } catch {
        return fileName;
      }
    }
  }

  private async refreshAssetsIfAvailable(client: Client): Promise<void> {
    if (!this.canRefreshAssets) {
      return;
    }

    await this.callTool(
      client,
      unityConfig.mcp.addCubeTool,
      {
        [unityConfig.mcp.addCubeArgumentName]: "Assets/Refresh"
      },
      "Refreshing Unity assets"
    ).catch(() => undefined);
  }

  private async waitForImportedAsset(
    client: Client,
    assetPath: string
  ): Promise<UnityAssetInfo | undefined> {
    const deadline = Date.now() + unityConfig.mcp.timeoutMs;

    while (Date.now() <= deadline) {
      const asset = (await this.readAssets(client)).find(
        (item) => item.path === assetPath
      );

      if (asset) {
        return asset;
      }

      await delay(500);
    }

    return undefined;
  }

  private async readAssets(client: Client): Promise<UnityAssetInfo[]> {
    const result = await withTimeout(
      client.request(
        {
          method: "resources/read",
          params: {
            uri: "unity://assets"
          }
        },
        ReadResourceResultSchema
      ),
      "Reading Unity assets"
    );

    const text = result.contents
      .map((content) => ("text" in content && typeof content.text === "string" ? content.text : ""))
      .find(Boolean);

    if (!text) {
      throw new Error("Unity assets response did not include JSON text.");
    }

    const parsed = JSON.parse(text) as { assets?: unknown };

    if (!Array.isArray(parsed.assets)) {
      return [];
    }

    return parsed.assets.filter(
      (asset): asset is UnityAssetInfo =>
        typeof asset === "object" &&
        asset !== null &&
        typeof (asset as UnityAssetInfo).path === "string"
    );
  }

  private nextAvailableName(baseName: string, existingNames: Set<string>): string {
    if (!existingNames.has(baseName)) {
      return baseName;
    }

    let index = 2;
    while (existingNames.has(`${baseName}_${index}`)) {
      index += 1;
    }

    return `${baseName}_${index}`;
  }

  private async readHierarchySnapshot(client: Client): Promise<HierarchySnapshot> {
    const result = await withTimeout(
      client.request(
        {
          method: "resources/read",
          params: {
            uri: hierarchyResourceUri
          }
        },
        ReadResourceResultSchema
      ),
      "Reading Unity scene hierarchy"
    );

    const text = result.contents
      .map((content) => ("text" in content && typeof content.text === "string" ? content.text : ""))
      .find(Boolean);

    if (!text) {
      throw new Error("Unity scene hierarchy response did not include JSON text.");
    }

    const hierarchy = JSON.parse(text) as unknown;
    return this.extractHierarchySnapshot(hierarchy);
  }

  private extractHierarchySnapshot(hierarchy: unknown): HierarchySnapshot {
    const instanceIds = new Set<number>();
    const rootInstanceIds = new Set<number>();
    const names = new Set<string>();

    const visitObject = (object: HierarchyObject): void => {
      if (typeof object.instanceId === "number") {
        instanceIds.add(object.instanceId);
      }

      if (typeof object.name === "string") {
        names.add(object.name);
      }

      if (Array.isArray(object.children)) {
        for (const child of object.children) {
          if (child && typeof child === "object") {
            visitObject(child as HierarchyObject);
          }
        }
      }
    };

    if (!Array.isArray(hierarchy)) {
      throw new Error("Unity scene hierarchy JSON was not an array.");
    }

    for (const scene of hierarchy) {
      if (!scene || typeof scene !== "object") {
        continue;
      }

      const rootObjects = (scene as HierarchyScene).rootObjects;
      if (!Array.isArray(rootObjects)) {
        continue;
      }

      for (const rootObject of rootObjects) {
        if (rootObject && typeof rootObject === "object") {
          const root = rootObject as HierarchyObject;
          if (typeof root.instanceId === "number") {
            rootInstanceIds.add(root.instanceId);
          }
          visitObject(rootObject as HierarchyObject);
        }
      }
    }

    return {
      instanceIds,
      rootInstanceIds,
      names
    };
  }

  private async findNewObjectInstanceId(
    client: Client,
    beforeIds: Set<number>
  ): Promise<number | undefined> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (attempt > 0) {
        await delay(150);
      }

      const afterSnapshot = await this.readHierarchySnapshot(client);
      const newIds = [...afterSnapshot.instanceIds].filter(
        (id) => !beforeIds.has(id)
      );

      if (newIds.length === 1) {
        return newIds[0];
      }

      if (newIds.length > 1) {
        return undefined;
      }
    }

    return undefined;
  }

  private async findNewRootObjectInstanceId(
    client: Client,
    beforeRootIds: Set<number>
  ): Promise<number | undefined> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (attempt > 0) {
        await delay(150);
      }

      const afterSnapshot = await this.readHierarchySnapshot(client);
      const newIds = [...afterSnapshot.rootInstanceIds].filter(
        (id) => !beforeRootIds.has(id)
      );

      if (newIds.length === 1) {
        return newIds[0];
      }

      if (newIds.length > 1) {
        return undefined;
      }
    }

    return undefined;
  }

  private extractInstanceIdFromToolResult(
    raw: unknown,
    text: string
  ): number | undefined {
    const fromRaw = this.findInstanceId(raw);
    if (fromRaw !== undefined) {
      return fromRaw;
    }

    const jsonMatch = text.match(/"instanceId"\s*:\s*(-?\d+)/i);
    if (jsonMatch?.[1]) {
      return Number(jsonMatch[1]);
    }

    const messageMatch = text.match(/instance\s+ID\s+(-?\d+)/i);
    if (messageMatch?.[1]) {
      return Number(messageMatch[1]);
    }

    return undefined;
  }

  private findInstanceId(value: unknown, depth = 0): number | undefined {
    if (depth > 4 || !value || typeof value !== "object") {
      return undefined;
    }

    if ("instanceId" in value && typeof value.instanceId === "number") {
      return value.instanceId;
    }

    for (const child of Object.values(value)) {
      if (Array.isArray(child)) {
        for (const item of child) {
          const found = this.findInstanceId(item, depth + 1);
          if (found !== undefined) {
            return found;
          }
        }
      } else if (child && typeof child === "object") {
        const found = this.findInstanceId(child, depth + 1);
        if (found !== undefined) {
          return found;
        }
      }
    }

    return undefined;
  }

  private async reset(): Promise<void> {
    this.verifiedAddCubeTool = false;
    this.verifiedCreateObjectTools = false;
    this.verifiedImportModelTools = false;
    this.canRefreshAssets = false;
    this.connectPromise = undefined;

    if (this.client) {
      await this.client.close().catch(() => undefined);
      this.client = undefined;
    }
  }
}

export const mcpUnityClient = new McpUnityClient();

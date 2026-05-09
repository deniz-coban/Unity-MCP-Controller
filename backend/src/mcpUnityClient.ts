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
  CreateLightPayload,
  CreateObjectPayload,
  EditTransformPayload,
  ImportModelPayload,
  UploadedTextureFile,
  UnityDefaultObjectType,
  UnityLightType,
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

interface FlattenedHierarchyObject {
  name: string;
  instanceId: number;
  path: string;
  scenePath?: string;
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

interface CopiedProjectFile {
  absolutePath: string;
  assetPath: string;
  fileName: string;
}

interface UnityProjectPaths {
  projectPath: string;
  assetsDir: string;
  importedModelsDir: string;
  importedTexturesDir: string;
  generatedMaterialsDir: string;
}

interface ToolCallResponse {
  text: string;
  raw: unknown;
}

interface MaterialPropertyInfo {
  name: string;
  type: string;
}

interface PreparedTextureMaterial {
  textureAsset: UnityAssetInfo;
  texturePath: string;
  materialName: string;
  materialPath: string;
  textureProperty: string;
}

interface MaterialAssignmentResult {
  assignedCount: number;
  totalRenderers: number;
  failures: string[];
}

const hierarchyResourceUri = "unity://scenes_hierarchy";
const menuItemsResourceUri = "unity://menu-items";

const objectMenuPaths: Record<UnityDefaultObjectType, string> = {
  cube: "GameObject/3D Object/Cube",
  sphere: "GameObject/3D Object/Sphere",
  capsule: "GameObject/3D Object/Capsule",
  cylinder: "GameObject/3D Object/Cylinder",
  plane: "GameObject/3D Object/Plane",
  quad: "GameObject/3D Object/Quad"
};

const lightMenuPaths: Record<UnityLightType, string> = {
  directional: "GameObject/Light/Directional Light",
  point: "GameObject/Light/Point Light",
  spot: "GameObject/Light/Spot Light"
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
  private verifiedMaterialTools = false;
  private verifiedEditTransformTools = false;
  private verifiedSaveSceneTool = false;
  private verifiedCreateLightTools = false;
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
      let preparedTextureMaterial: PreparedTextureMaterial | undefined;

      if (payload.texture) {
        await this.verifyMaterialTools(client);

        const projectPaths = await this.getUnityProjectPaths();
        if (!projectPaths.ok) {
          return projectPaths.error;
        }

        const materialResult = await this.prepareTextureMaterial(
          client,
          payload.texture,
          finalName,
          projectPaths.paths
        );

        if (!materialResult.ok) {
          return materialResult.error;
        }

        preparedTextureMaterial = materialResult.material;
      }

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

      if (preparedTextureMaterial) {
        const assignmentResult = await this.assignMaterialToRenderer(
          client,
          newInstanceId,
          preparedTextureMaterial.materialPath
        );

        if (!assignmentResult.ok) {
          return assignmentResult.error;
        }
      }

      return {
        ok: true,
        mode: "mcp",
        action: "createObject",
        message: preparedTextureMaterial
          ? `Created ${payload.type} "${finalName}" in Unity with texture ${preparedTextureMaterial.textureAsset.filename ?? preparedTextureMaterial.textureAsset.name ?? "texture"}.`
          : `Created ${payload.type} "${finalName}" in Unity.`,
        data: {
          instanceId: newInstanceId,
          requestedName: payload.name,
          object: {
            ...payload,
            name: finalName
          },
          ...(preparedTextureMaterial
            ? {
                material: {
                  name: preparedTextureMaterial.materialName,
                  path: preparedTextureMaterial.materialPath,
                  texturePath: preparedTextureMaterial.texturePath,
                  textureProperty: preparedTextureMaterial.textureProperty,
                  assignedRenderers: 1
                }
              }
            : {})
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

  async createLight(
    payload: CreateLightPayload
  ): Promise<UnityActionSuccessResponse | UnityActionErrorResponse> {
    if (!isMcpConfigured()) {
      return configurationError([
        "Set UNITY_MCP_SERVER_ARGS to the absolute path of mcp-unity/Server~/build/index.js.",
        "UNITY_MCP_SERVER_COMMAND defaults to node."
      ]);
    }

    try {
      const client = await this.connect();
      await this.verifyCreateLightTools(client);

      const beforeSnapshot = await this.readHierarchySnapshot(client);
      const finalName = this.nextAvailableName(payload.name, beforeSnapshot.names);

      await this.callTool(
        client,
        "execute_menu_item",
        {
          menuPath: lightMenuPaths[payload.type]
        },
        `Creating Unity ${payload.type} light`
      );

      const newInstanceId = await this.findNewObjectInstanceId(
        client,
        beforeSnapshot.instanceIds
      );

      if (newInstanceId === undefined) {
        return {
          ok: false,
          error: "Could not safely identify the new Unity light.",
          details: [
            "The light menu item was executed, but the backend could not find exactly one new instanceId in the scene hierarchy.",
            "No existing object was renamed, transformed, or edited."
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
        "Renaming Unity light"
      );

      await this.callTool(
        client,
        "set_transform",
        {
          instanceId: newInstanceId,
          position: payload.position,
          rotation: payload.rotation,
          space: "world"
        },
        "Setting Unity light position and rotation"
      );

      try {
        await this.callTool(
          client,
          "update_component",
          {
            instanceId: newInstanceId,
            componentName: "Light",
            componentData: {
              intensity: payload.intensity,
              color: payload.color
            }
          },
          "Setting Unity light intensity and color"
        );
      } catch (error) {
        return {
          ok: false,
          error: "Unity/MCP light property update failed.",
          details: [
            `The ${payload.type} light was created as "${finalName}", renamed, and transformed.`,
            "The backend could not apply intensity and color through update_component.",
            `Original error: ${getErrorMessage(error)}`
          ]
        };
      }

      return {
        ok: true,
        mode: "mcp",
        action: "createLight",
        message: `Created ${payload.type} light "${finalName}" in Unity.`,
        data: {
          instanceId: newInstanceId,
          requestedName: payload.name,
          light: {
            ...payload,
            name: finalName
          },
          menuPath: lightMenuPaths[payload.type]
        }
      };
    } catch (error) {
      await this.reset();
      return {
        ok: false,
        error: "Unity/MCP create light failed.",
        details: [
          "Open the UnityMCPDemo project in Unity Editor.",
          "Open Tools > MCP Unity > Server Window and click Start Server.",
          "The backend verifies the MCP schemas and Unity light menu paths before creating a light.",
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
      if (payload.texture) {
        await this.verifyMaterialTools(client);
      }

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
      let preparedTextureMaterial: PreparedTextureMaterial | undefined;

      if (payload.texture) {
        const materialResult = await this.prepareTextureMaterial(
          client,
          payload.texture,
          finalName,
          projectPaths.paths
        );

        if (!materialResult.ok) {
          return materialResult.error;
        }

        preparedTextureMaterial = materialResult.material;
      }

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

      let materialAssignment: MaterialAssignmentResult | undefined;
      if (preparedTextureMaterial) {
        const assignmentResult = await this.assignMaterialToModelRenderers(
          client,
          instanceId,
          preparedTextureMaterial.materialPath
        );

        if (!assignmentResult.ok) {
          return assignmentResult.error;
        }

        materialAssignment = assignmentResult.assignment;
      }

      const materialAssignmentMessage = materialAssignment
        ? ` Texture material assigned to ${materialAssignment.assignedCount} of ${materialAssignment.totalRenderers} renderers${
            materialAssignment.failures.length > 0 ? " with some failures" : ""
          }.`
        : "";

      return {
        ok: true,
        mode: "mcp",
        action: "importModel",
        message: preparedTextureMaterial
          ? `Imported model "${finalName}" into Unity with texture ${preparedTextureMaterial.textureAsset.filename ?? preparedTextureMaterial.textureAsset.name ?? "texture"}.${materialAssignmentMessage}`
          : `Imported model "${finalName}" into Unity.`,
        data: {
          instanceId,
          requestedName: payload.name,
          object: {
            name: finalName,
            position: payload.position,
            rotation: payload.rotation,
            scale: payload.scale
          },
          ...(preparedTextureMaterial
            ? {
                material: {
                  name: preparedTextureMaterial.materialName,
                  path: preparedTextureMaterial.materialPath,
                  texturePath: preparedTextureMaterial.texturePath,
                  textureProperty: preparedTextureMaterial.textureProperty,
                  assignedRenderers: materialAssignment?.assignedCount ?? 0,
                  totalRenderers: materialAssignment?.totalRenderers ?? 0,
                  failures: materialAssignment?.failures ?? []
                }
              }
            : {}),
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

  async editTransform(
    payload: EditTransformPayload
  ): Promise<UnityActionSuccessResponse | UnityActionErrorResponse> {
    if (!isMcpConfigured()) {
      return configurationError([
        "Set UNITY_MCP_SERVER_ARGS to the absolute path of mcp-unity/Server~/build/index.js.",
        "UNITY_MCP_SERVER_COMMAND defaults to node."
      ]);
    }

    try {
      const client = await this.connect();
      await this.verifyEditTransformTools(client);

      const objects = await this.readHierarchyObjects(client);
      const resolved = this.resolveHierarchyTarget(payload.target, objects);

      if (!resolved.ok) {
        return resolved.error;
      }

      await this.callTool(
        client,
        "set_transform",
        {
          instanceId: resolved.object.instanceId,
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
        action: "editTransform",
        message: `Updated transform for "${resolved.object.path}" in Unity.`,
        data: {
          target: payload.target,
          matchedObject: resolved.object,
          transform: {
            position: payload.position,
            rotation: payload.rotation,
            scale: payload.scale
          }
        }
      };
    } catch (error) {
      await this.reset();
      return {
        ok: false,
        error: "Unity/MCP edit transform failed.",
        details: [
          "Open the UnityMCPDemo project in Unity Editor.",
          "Open Tools > MCP Unity > Server Window and click Start Server.",
          "The backend reads the Unity hierarchy first and only transforms a uniquely matched object.",
          `Original error: ${getErrorMessage(error)}`
        ]
      };
    }
  }

  async saveScene(): Promise<UnityActionSuccessResponse | UnityActionErrorResponse> {
    if (!isMcpConfigured()) {
      return configurationError([
        "Set UNITY_MCP_SERVER_ARGS to the absolute path of mcp-unity/Server~/build/index.js.",
        "UNITY_MCP_SERVER_COMMAND defaults to node."
      ]);
    }

    try {
      const client = await this.connect();
      await this.verifySaveSceneTool(client);

      const result = await this.callTool(
        client,
        "save_scene",
        {},
        "Saving Unity scene"
      );

      return {
        ok: true,
        mode: "mcp",
        action: "saveScene",
        message: result.text || "Unity scene saved successfully.",
        data: {
          tool: "save_scene"
        }
      };
    } catch (error) {
      await this.reset();
      return {
        ok: false,
        error: "Unity/MCP save scene failed.",
        details: [
          "The current scene may need to already have a scene path before it can be saved.",
          "Save As is not implemented in this app yet.",
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
    this.canRefreshAssets = this.hasToolStringArgument(
      toolsResult.tools,
      unityConfig.mcp.addCubeTool,
      unityConfig.mcp.addCubeArgumentName
    );

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

  private async verifyMaterialTools(client: Client): Promise<void> {
    if (this.verifiedMaterialTools) {
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

    this.assertToolStringArgument(toolsResult.tools, "create_material", "name");
    this.assertToolStringArgument(toolsResult.tools, "create_material", "savePath");
    this.assertToolStringArgument(toolsResult.tools, "get_material_info", "materialPath");
    this.assertToolStringArgument(toolsResult.tools, "modify_material", "materialPath");
    this.assertToolObjectArgument(toolsResult.tools, "modify_material", "properties");
    this.assertToolStringArgument(toolsResult.tools, "assign_material", "materialPath");
    this.assertToolStringArgument(toolsResult.tools, "get_gameobject", "idOrName");

    if (!resourcesResult.resources.some((resource) => resource.uri === "unity://assets")) {
      throw new Error('MCP resource "unity://assets" was not found.');
    }

    this.verifiedMaterialTools = true;
  }

  private async verifyCreateLightTools(client: Client): Promise<void> {
    if (this.verifiedCreateLightTools) {
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

    this.assertToolStringArgument(toolsResult.tools, "execute_menu_item", "menuPath");
    this.assertToolObjectArgument(toolsResult.tools, "update_gameobject", "gameObjectData");
    this.assertToolObjectArgument(toolsResult.tools, "set_transform", "position");
    this.assertToolObjectArgument(toolsResult.tools, "set_transform", "rotation");
    this.assertToolStringArgument(toolsResult.tools, "update_component", "componentName");
    this.assertToolObjectArgument(toolsResult.tools, "update_component", "componentData");

    for (const resourceUri of [hierarchyResourceUri, menuItemsResourceUri]) {
      if (!resourcesResult.resources.some((resource) => resource.uri === resourceUri)) {
        throw new Error(`MCP resource "${resourceUri}" was not found.`);
      }
    }

    const menuItems = await this.readMenuItems(client);
    const missingMenuPaths = Object.values(lightMenuPaths).filter(
      (menuPath) => !menuItems.includes(menuPath)
    );

    if (missingMenuPaths.length > 0) {
      throw new Error(
        `Unity light menu paths were not found in ${menuItemsResourceUri}: ${missingMenuPaths.join(", ")}.`
      );
    }

    this.verifiedCreateLightTools = true;
  }

  private async verifyEditTransformTools(client: Client): Promise<void> {
    if (this.verifiedEditTransformTools) {
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

    this.assertToolObjectArgument(toolsResult.tools, "set_transform", "position");
    this.assertToolObjectArgument(toolsResult.tools, "set_transform", "rotation");
    this.assertToolObjectArgument(toolsResult.tools, "set_transform", "scale");

    if (!resourcesResult.resources.some((resource) => resource.uri === hierarchyResourceUri)) {
      throw new Error(`MCP resource "${hierarchyResourceUri}" was not found.`);
    }

    this.verifiedEditTransformTools = true;
  }

  private async verifySaveSceneTool(client: Client): Promise<void> {
    if (this.verifiedSaveSceneTool) {
      return;
    }

    const toolsResult = await withTimeout(
      client.request({ method: "tools/list" }, ListToolsResultSchema),
      "Listing Unity MCP tools"
    );

    this.assertToolExists(toolsResult.tools, "save_scene");
    this.verifiedSaveSceneTool = true;
  }

  private assertToolExists(
    tools: Array<{ name: string; inputSchema: unknown }>,
    toolName: string
  ): void {
    if (!tools.some((tool) => tool.name === toolName)) {
      throw new Error(`MCP tool "${toolName}" was not found.`);
    }
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
    const importedTexturesDir = path.join(assetsDir, "ImportedTextures");
    const generatedMaterialsDir = path.join(assetsDir, "GeneratedMaterials");

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
        importedModelsDir,
        importedTexturesDir,
        generatedMaterialsDir
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
  ): Promise<CopiedProjectFile> {
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

  private async copyTextureIntoUnityProject(
    texture: UploadedTextureFile,
    importedTexturesDir: string
  ): Promise<CopiedProjectFile> {
    await fs.mkdir(importedTexturesDir, { recursive: true });

    const safeBaseName = this.sanitizeFileBaseName(texture.originalName);
    const destinationFileName = await this.nextAvailableFileName(
      importedTexturesDir,
      safeBaseName,
      texture.extension
    );
    const importedTexturesRoot = path.resolve(importedTexturesDir);
    const absolutePath = path.resolve(importedTexturesRoot, destinationFileName);

    if (!absolutePath.startsWith(`${importedTexturesRoot}${path.sep}`)) {
      throw new Error("Refusing to copy texture outside Assets/ImportedTextures.");
    }

    await fs.copyFile(texture.tempPath, absolutePath);

    return {
      absolutePath,
      fileName: destinationFileName,
      assetPath: `Assets/ImportedTextures/${destinationFileName}`
    };
  }

  private async prepareTextureMaterial(
    client: Client,
    texture: UploadedTextureFile,
    finalObjectName: string,
    projectPaths: UnityProjectPaths
  ): Promise<
    | { ok: true; material: PreparedTextureMaterial }
    | { ok: false; error: UnityActionErrorResponse }
  > {
    try {
      await Promise.all([
        fs.mkdir(projectPaths.importedTexturesDir, { recursive: true }),
        fs.mkdir(projectPaths.generatedMaterialsDir, { recursive: true })
      ]);

      const copiedTexture = await this.copyTextureIntoUnityProject(
        texture,
        projectPaths.importedTexturesDir
      );

      await this.refreshAssetsIfAvailable(client);

      const textureAsset = await this.waitForImportedAsset(
        client,
        copiedTexture.assetPath
      );

      if (!textureAsset) {
        return {
          ok: false,
          error: {
            ok: false,
            error: "Unity texture import timed out.",
            details: [
              `Texture file was copied to ${copiedTexture.absolutePath}.`,
              "Unity did not finish importing it into the AssetDatabase before the timeout.",
              "Check Unity's Console and Project window, then try again."
            ]
          }
        };
      }

      const materialAsset = await this.nextGeneratedMaterialAsset(
        projectPaths.generatedMaterialsDir,
        finalObjectName
      );

      await this.callTool(
        client,
        "create_material",
        {
          name: materialAsset.name,
          savePath: materialAsset.path
        },
        "Creating Unity texture material"
      );

      const info = await this.callTool(
        client,
        "get_material_info",
        {
          materialPath: materialAsset.path
        },
        "Reading generated material info"
      );
      const textureProperty = this.chooseTextureProperty(info.raw, info.text);

      if (!textureProperty) {
        return {
          ok: false,
          error: {
            ok: false,
            error: "No usable texture property found on the generated material.",
            details: [
              `Material path: ${materialAsset.path}`,
              "Expected one of _BaseMap, _MainTex, _BaseColorMap, or another TexEnv property."
            ]
          }
        };
      }

      await this.callTool(
        client,
        "modify_material",
        {
          materialPath: materialAsset.path,
          properties: {
            [textureProperty]: textureAsset.path
          }
        },
        "Assigning texture to generated material"
      );

      return {
        ok: true,
        material: {
          textureAsset,
          texturePath: textureAsset.path,
          materialName: materialAsset.name,
          materialPath: materialAsset.path,
          textureProperty
        }
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          ok: false,
          error: "Unity/MCP texture material setup failed.",
          details: [
            "The texture could not be imported or connected to a generated material.",
            `Original error: ${getErrorMessage(error)}`
          ]
        }
      };
    }
  }

  private async nextGeneratedMaterialAsset(
    generatedMaterialsDir: string,
    objectName: string
  ): Promise<{ name: string; path: string }> {
    await fs.mkdir(generatedMaterialsDir, { recursive: true });

    const safeBaseName = `${this.sanitizeFileBaseName(objectName)}_Material`;
    const fileName = await this.nextAvailableFileName(
      generatedMaterialsDir,
      safeBaseName,
      ".mat"
    );

    return {
      name: path.parse(fileName).name,
      path: `Assets/GeneratedMaterials/${fileName}`
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

  private async readMenuItems(client: Client): Promise<string[]> {
    const result = await withTimeout(
      client.request(
        {
          method: "resources/read",
          params: {
            uri: menuItemsResourceUri
          }
        },
        ReadResourceResultSchema
      ),
      "Reading Unity menu items"
    );

    const text = result.contents
      .map((content) => ("text" in content && typeof content.text === "string" ? content.text : ""))
      .find(Boolean);

    if (!text) {
      throw new Error("Unity menu items response did not include JSON text.");
    }

    const parsed = JSON.parse(text) as unknown;
    const items = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { menuItems?: unknown }).menuItems)
        ? (parsed as { menuItems: unknown[] }).menuItems
        : [];

    return items.filter((item): item is string => typeof item === "string");
  }

  private chooseTextureProperty(raw: unknown, text: string): string | undefined {
    const properties = this.extractMaterialProperties(raw, text);
    const textureProperties = properties.filter((property) =>
      property.type.toLowerCase().includes("tex")
    );
    const priority = ["_BaseMap", "_MainTex", "_BaseColorMap"];

    for (const propertyName of priority) {
      if (textureProperties.some((property) => property.name === propertyName)) {
        return propertyName;
      }
    }

    return textureProperties[0]?.name;
  }

  private extractMaterialProperties(
    raw: unknown,
    text: string
  ): MaterialPropertyInfo[] {
    const fromRaw = this.findMaterialProperties(raw);
    if (fromRaw.length > 0) {
      return fromRaw;
    }

    const properties: MaterialPropertyInfo[] = [];
    const propertyPattern = /^\s*([A-Za-z0-9_]+)\s+\(([^)]+)\):/gm;
    let match = propertyPattern.exec(text);

    while (match) {
      properties.push({
        name: match[1],
        type: match[2]
      });
      match = propertyPattern.exec(text);
    }

    return properties;
  }

  private findMaterialProperties(value: unknown, depth = 0): MaterialPropertyInfo[] {
    if (depth > 5 || !value || typeof value !== "object") {
      return [];
    }

    if (Array.isArray(value)) {
      const properties = value
        .map((item): MaterialPropertyInfo | undefined => {
          if (!item || typeof item !== "object") {
            return undefined;
          }

          const maybeProperty = item as { name?: unknown; type?: unknown };
          return typeof maybeProperty.name === "string" &&
            typeof maybeProperty.type === "string"
            ? {
                name: maybeProperty.name,
                type: maybeProperty.type
              }
            : undefined;
        })
        .filter((item): item is MaterialPropertyInfo => Boolean(item));

      if (properties.length > 0) {
        return properties;
      }
    }

    const record = value as Record<string, unknown>;

    if (Array.isArray(record.properties)) {
      const properties = this.findMaterialProperties(record.properties, depth + 1);
      if (properties.length > 0) {
        return properties;
      }
    }

    for (const child of Object.values(record)) {
      const properties = this.findMaterialProperties(child, depth + 1);
      if (properties.length > 0) {
        return properties;
      }
    }

    return [];
  }

  private async assignMaterialToRenderer(
    client: Client,
    instanceId: number,
    materialPath: string
  ): Promise<{ ok: true } | { ok: false; error: UnityActionErrorResponse }> {
    try {
      await this.callTool(
        client,
        "assign_material",
        {
          instanceId,
          materialPath,
          slot: 0
        },
        "Assigning material to Unity object"
      );

      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: {
          ok: false,
          error: "Unity/MCP material assignment failed.",
          details: [
            "The object was created, but the generated material could not be assigned to renderer slot 0.",
            `Original error: ${getErrorMessage(error)}`
          ]
        }
      };
    }
  }

  private async assignMaterialToModelRenderers(
    client: Client,
    rootInstanceId: number,
    materialPath: string
  ): Promise<
    | { ok: true; assignment: MaterialAssignmentResult }
    | { ok: false; error: UnityActionErrorResponse }
  > {
    let rendererIds: number[];

    try {
      rendererIds = await this.findRendererInstanceIds(client, rootInstanceId);
    } catch (error) {
      return {
        ok: false,
        error: {
          ok: false,
          error: "Could not inspect imported model renderers.",
          details: [
            "The model was imported and transformed, but the backend could not inspect the hierarchy before assigning the material.",
            `Original error: ${getErrorMessage(error)}`
          ]
        }
      };
    }

    if (rendererIds.length === 0) {
      return {
        ok: false,
        error: {
          ok: false,
          error: "No Renderer components found on the imported model.",
          details: [
            "The model was imported and transformed, but the backend could not find a renderer on the root object or its children.",
            "No material was assigned."
          ]
        }
      };
    }

    let assignedCount = 0;
    const failures: string[] = [];

    for (const rendererId of rendererIds) {
      try {
        await this.callTool(
          client,
          "assign_material",
          {
            instanceId: rendererId,
            materialPath,
            slot: 0
          },
          `Assigning material to renderer ${rendererId}`
        );
        assignedCount += 1;
      } catch (error) {
        failures.push(`Renderer ${rendererId}: ${getErrorMessage(error)}`);
      }
    }

    if (assignedCount === 0) {
      return {
        ok: false,
        error: {
          ok: false,
          error: "Unity/MCP material assignment failed for every renderer.",
          details: [
            "The model was imported and transformed, but no renderer accepted the generated material.",
            ...failures
          ]
        }
      };
    }

    return {
      ok: true,
      assignment: {
        assignedCount,
        totalRenderers: rendererIds.length,
        failures
      }
    };
  }

  private async findRendererInstanceIds(
    client: Client,
    rootInstanceId: number
  ): Promise<number[]> {
    const result = await this.callTool(
      client,
      "get_gameobject",
      {
        idOrName: String(rootInstanceId)
      },
      "Reading imported model hierarchy"
    );
    const parsed = JSON.parse(result.text) as { gameObject?: unknown };
    const rendererIds: number[] = [];

    const visit = (node: unknown): void => {
      if (!node || typeof node !== "object") {
        return;
      }

      const objectNode = node as {
        instanceId?: unknown;
        components?: unknown;
        children?: unknown;
      };

      if (
        typeof objectNode.instanceId === "number" &&
        this.hasRendererComponent(objectNode.components)
      ) {
        rendererIds.push(objectNode.instanceId);
      }

      if (Array.isArray(objectNode.children)) {
        for (const child of objectNode.children) {
          visit(child);
        }
      }
    };

    visit(parsed.gameObject);
    return rendererIds;
  }

  private hasRendererComponent(components: unknown): boolean {
    if (!Array.isArray(components)) {
      return false;
    }

    return components.some((component) => {
      if (!component || typeof component !== "object") {
        return false;
      }

      const type = (component as { type?: unknown }).type;
      return typeof type === "string" && type.endsWith("Renderer");
    });
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

  private async readHierarchyJson(client: Client): Promise<unknown> {
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

    return JSON.parse(text) as unknown;
  }

  private async readHierarchyObjects(client: Client): Promise<FlattenedHierarchyObject[]> {
    return this.extractHierarchyObjects(await this.readHierarchyJson(client));
  }

  private async readHierarchySnapshot(client: Client): Promise<HierarchySnapshot> {
    return this.extractHierarchySnapshot(await this.readHierarchyJson(client));
  }

  private getHierarchyScenes(hierarchy: unknown): unknown[] {
    if (Array.isArray(hierarchy)) {
      return hierarchy;
    }

    if (
      hierarchy &&
      typeof hierarchy === "object" &&
      Array.isArray((hierarchy as { hierarchy?: unknown }).hierarchy)
    ) {
      return (hierarchy as { hierarchy: unknown[] }).hierarchy;
    }

    throw new Error("Unity scene hierarchy JSON was not an array.");
  }

  private extractHierarchyObjects(hierarchy: unknown): FlattenedHierarchyObject[] {
    const objects: FlattenedHierarchyObject[] = [];

    const visitObject = (
      object: HierarchyObject,
      parentPath: string,
      sceneName?: string
    ): void => {
      const name = typeof object.name === "string" ? object.name : undefined;
      const instanceId =
        typeof object.instanceId === "number" ? object.instanceId : undefined;
      const currentPath = name
        ? parentPath
          ? `${parentPath}/${name}`
          : name
        : parentPath;

      if (name && instanceId !== undefined) {
        objects.push({
          name,
          instanceId,
          path: currentPath,
          ...(sceneName ? { scenePath: `${sceneName}/${currentPath}` } : {})
        });
      }

      if (Array.isArray(object.children)) {
        for (const child of object.children) {
          if (child && typeof child === "object") {
            visitObject(child as HierarchyObject, currentPath, sceneName);
          }
        }
      }
    };

    for (const scene of this.getHierarchyScenes(hierarchy)) {
      if (!scene || typeof scene !== "object") {
        continue;
      }

      const sceneRecord = scene as HierarchyScene & { name?: unknown };
      const rootObjects = sceneRecord.rootObjects;
      const sceneName =
        typeof sceneRecord.name === "string" && sceneRecord.name.length > 0
          ? sceneRecord.name
          : undefined;

      if (!Array.isArray(rootObjects)) {
        continue;
      }

      for (const rootObject of rootObjects) {
        if (rootObject && typeof rootObject === "object") {
          visitObject(rootObject as HierarchyObject, "", sceneName);
        }
      }
    }

    return objects;
  }

  private resolveHierarchyTarget(
    target: string,
    objects: FlattenedHierarchyObject[]
  ):
    | { ok: true; object: FlattenedHierarchyObject }
    | { ok: false; error: UnityActionErrorResponse } {
    const trimmedTarget = target.trim();
    const normalizedPathTarget = trimmedTarget
      .split("/")
      .filter((part) => part.length > 0)
      .join("/");
    const isNumericTarget = /^-?\d+$/.test(trimmedTarget);
    const candidates = isNumericTarget
      ? objects.filter((object) => object.instanceId === Number(trimmedTarget))
      : trimmedTarget.includes("/")
        ? objects.filter(
            (object) =>
              object.path === normalizedPathTarget ||
              object.scenePath === normalizedPathTarget
          )
        : objects.filter((object) => object.name === trimmedTarget);

    if (candidates.length === 0) {
      return {
        ok: false,
        error: {
          ok: false,
          error: "Unity object target was not found.",
          details: [
            `No object matched "${target}".`,
            "Use a unique object name, a hierarchy path such as Parent/Child, or an instance ID from the Unity hierarchy."
          ]
        }
      };
    }

    if (candidates.length > 1) {
      return {
        ok: false,
        error: {
          ok: false,
          error: "Unity object target is ambiguous.",
          details: [
            `Multiple objects matched "${target}".`,
            "Use a full hierarchy path or an instance ID.",
            ...candidates.map(
              (object) =>
                `${object.scenePath ?? object.path} (instanceId ${object.instanceId})`
            )
          ]
        }
      };
    }

    return {
      ok: true,
      object: candidates[0]
    };
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

    for (const scene of this.getHierarchyScenes(hierarchy)) {
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
    this.verifiedMaterialTools = false;
    this.verifiedEditTransformTools = false;
    this.verifiedSaveSceneTool = false;
    this.verifiedCreateLightTools = false;
    this.canRefreshAssets = false;
    this.connectPromise = undefined;

    if (this.client) {
      await this.client.close().catch(() => undefined);
      this.client = undefined;
    }
  }
}

export const mcpUnityClient = new McpUnityClient();

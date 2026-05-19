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
  ApplyTextureToObjectPayload,
  BatchApplyTextureToObjectsPayload,
  BatchSetMaterialColorPayload,
  ColorRGBA,
  CreateLightPayload,
  CreateObjectGridPayload,
  CreateObjectPayload,
  DeleteObjectPayload,
  DeleteObjectsPayload,
  DuplicateObjectPayload,
  EditObjectPayload,
  EditTransformPayload,
  ImportModelPayload,
  PartialTransformPayload,
  RenameObjectPayload,
  SceneObjectCategory,
  SceneObjectDetails,
  SceneObjectLightDetails,
  SceneObjectSummary,
  SetMaterialColorPayload,
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
  components?: unknown;
  children?: unknown;
}

interface HierarchyScene {
  name?: unknown;
  path?: unknown;
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
  sceneName?: string;
  sceneFilePath?: string;
  scenePath?: string;
  componentTypes: string[];
  hasLight: boolean;
  hasRenderer: boolean;
  hasCamera: boolean;
  category: SceneObjectCategory;
  displayName: string;
}

interface ComponentInfo {
  type?: unknown;
  properties?: unknown;
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

interface BatchOperation {
  tool: string;
  params: Record<string, unknown>;
  id: string;
}

interface GridObjectItem {
  name: string;
  position: CreateObjectGridPayload["startPosition"];
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

const withTimeout = async <T>(
  promise: Promise<T>,
  label: string,
  timeoutMs = unityConfig.mcp.timeoutMs
): Promise<T> => {
  let timeout: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

const hierarchyReadTimeoutMs = (): number =>
  Math.max(unityConfig.mcp.timeoutMs, 30000);

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
  private verifiedCreateObjectGridTools = false;
  private verifiedSceneObjectReadTools = false;
  private verifiedEditObjectTools = false;
  private verifiedDeleteObjectTool = false;
  private verifiedDuplicateObjectTool = false;
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

  async listSceneObjects(): Promise<UnityActionSuccessResponse | UnityActionErrorResponse> {
    if (!isMcpConfigured()) {
      return configurationError([
        "Set UNITY_MCP_SERVER_ARGS to the absolute path of mcp-unity/Server~/build/index.js.",
        "UNITY_MCP_SERVER_COMMAND defaults to node."
      ]);
    }

    try {
      const client = await this.connect();
      await this.verifySceneObjectReadTools(client);
      const objects = await this.readSceneObjectSummaries(client);

      return {
        ok: true,
        mode: "mcp",
        action: "listSceneObjects",
        message: `Loaded ${objects.length} scene objects from Unity.`,
        data: {
          objects
        }
      };
    } catch (error) {
      await this.reset();
      return connectionError(error);
    }
  }

  async getSceneObject(
    instanceId: number
  ): Promise<UnityActionSuccessResponse | UnityActionErrorResponse> {
    if (!isMcpConfigured()) {
      return configurationError([
        "Set UNITY_MCP_SERVER_ARGS to the absolute path of mcp-unity/Server~/build/index.js.",
        "UNITY_MCP_SERVER_COMMAND defaults to node."
      ]);
    }

    try {
      const client = await this.connect();
      await this.verifySceneObjectReadTools(client);
      const summary = await this.findSceneObjectSummary(client, instanceId);

      if (!summary) {
        return {
          ok: false,
          error: "Object no longer exists. Refresh scene objects."
        };
      }

      const object = await this.readSceneObjectDetails(client, summary);

      return {
        ok: true,
        mode: "mcp",
        action: "getSceneObject",
        message: `Loaded "${object.name}" from Unity.`,
        data: {
          object
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

  async createObjectGrid(
    payload: CreateObjectGridPayload
  ): Promise<UnityActionSuccessResponse | UnityActionErrorResponse> {
    if (!isMcpConfigured()) {
      return configurationError([
        "Set UNITY_MCP_SERVER_ARGS to the absolute path of mcp-unity/Server~/build/index.js.",
        "UNITY_MCP_SERVER_COMMAND defaults to node."
      ]);
    }

    const total = payload.rows * payload.columns;

    try {
      const client = await this.connect();
      await this.verifyCreateObjectGridTools(client);

      const beforeObjects = await this.readHierarchyObjects(
        client,
        this.gridBatchTimeoutMs(total)
      );
      const beforeIds = new Set(beforeObjects.map((object) => object.instanceId));
      const reservedNames = new Set(beforeObjects.map((object) => object.name));
      const gridItems = this.buildGridItems(payload, reservedNames);
      const createOperations = gridItems.map((_item, index) => ({
        tool: unityConfig.mcp.addCubeTool,
        params: {
          [unityConfig.mcp.addCubeArgumentName]: objectMenuPaths[payload.type]
        },
        id: `create-${index + 1}`
      }));

      await this.callBatchOperations(client, createOperations, "Creating Unity grid primitives");

      const newObjects = await this.waitForNewHierarchyObjects(
        client,
        beforeIds,
        total
      );

      if (newObjects.length !== total) {
        return {
          ok: false,
          error: "Unity/MCP grid creation could not safely identify every new object.",
          details: [
            `Expected ${total} new objects, but found ${newObjects.length}.`,
            "No existing object was renamed or transformed.",
            "If Unity is still processing the objects, refresh the scene object list before retrying."
          ]
        };
      }

      const updateOperations = gridItems.flatMap((item, index) => {
        const instanceId = newObjects[index].instanceId;

        return [
          {
            tool: "update_gameobject",
            params: {
              instanceId,
              gameObjectData: {
                name: item.name
              }
            },
            id: `rename-${index + 1}`
          },
          {
            tool: "set_transform",
            params: {
              instanceId,
              position: item.position,
              rotation: payload.rotation,
              scale: payload.scale,
              space: "world"
            },
            id: `transform-${index + 1}`
          }
        ];
      });

      await this.callBatchOperations(
        client,
        updateOperations,
        "Renaming and transforming Unity grid objects"
      );

      return {
        ok: true,
        mode: "mcp",
        action: "createObjectGrid",
        message: `Created ${total} ${payload.type} objects in a ${payload.rows}x${payload.columns} grid.`,
        data: {
          count: total,
          rows: payload.rows,
          columns: payload.columns,
          firstNames: gridItems.slice(0, 8).map((item) => item.name),
          lastNames: gridItems.slice(-8).map((item) => item.name),
          firstInstanceIds: newObjects.slice(0, 8).map((object) => object.instanceId),
          lastInstanceIds: newObjects.slice(-8).map((object) => object.instanceId)
        }
      };
    } catch (error) {
      await this.reset();
      return {
        ok: false,
        error: "Unity/MCP create object grid failed.",
        details: [
          "The optimized grid path uses Unity MCP batch_execute internally to reduce timeout risk.",
          "Open Tools > MCP Unity > Server Window and confirm it is still running.",
          "If Unity is busy after a large batch, wait a few seconds and retry with a smaller grid.",
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
        const componentData: Record<string, unknown> = {
          intensity: payload.intensity,
          color: payload.color
        };

        if (payload.range !== undefined) {
          componentData.range = payload.range;
        }
        if (payload.spotAngle !== undefined) {
          componentData.spotAngle = payload.spotAngle;
        }

        await this.callTool(
          client,
          "update_component",
          {
            instanceId: newInstanceId,
            componentName: "Light",
            componentData
          },
          "Setting Unity light fields"
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

  async editObject(
    payload: EditObjectPayload
  ): Promise<UnityActionSuccessResponse | UnityActionErrorResponse> {
    if (!isMcpConfigured()) {
      return configurationError([
        "Set UNITY_MCP_SERVER_ARGS to the absolute path of mcp-unity/Server~/build/index.js.",
        "UNITY_MCP_SERVER_COMMAND defaults to node."
      ]);
    }

    try {
      const client = await this.connect();
      await this.verifyEditObjectTools(client);

      const summaries = await this.readSceneObjectSummaries(client);
      const summary = summaries.find((object) => object.instanceId === payload.instanceId);

      if (!summary) {
        return {
          ok: false,
          error: "Object no longer exists. Refresh scene objects."
        };
      }

      const beforeDetails = await this.readSceneObjectDetails(client, summary);
      const requestedName = payload.name?.trim();
      const finalName = requestedName
        ? this.nextAvailableNameExcluding(requestedName, summaries, payload.instanceId)
        : beforeDetails.name;

      if (payload.light) {
        if (!beforeDetails.hasLight) {
          return {
            ok: false,
            error: "Selected object is not a light.",
            details: [
              "Light-specific fields can only be applied to objects with a Light component."
            ]
          };
        }

        if (
          payload.light.spotAngle !== undefined &&
          beforeDetails.light?.lightType !== "spot"
        ) {
          return {
            ok: false,
            error: "Spot angle can only be edited on Spot Light objects."
          };
        }
      }

      if (finalName !== beforeDetails.name) {
        await this.callTool(
          client,
          "update_gameobject",
          {
            instanceId: payload.instanceId,
            gameObjectData: {
              name: finalName
            }
          },
          "Renaming Unity object"
        );
      }

      await this.callTool(
        client,
        "set_transform",
        {
          instanceId: payload.instanceId,
          position: payload.position,
          rotation: payload.rotation,
          scale: payload.scale,
          space: "world"
        },
        "Setting Unity object position, rotation, and scale"
      );

      if (payload.light) {
        const componentData: Record<string, unknown> = {};

        if (payload.light.intensity !== undefined) {
          componentData.intensity = payload.light.intensity;
        }
        if (payload.light.color) {
          componentData.color = payload.light.color;
        }
        if (payload.light.range !== undefined) {
          componentData.range = payload.light.range;
        }
        if (payload.light.spotAngle !== undefined) {
          componentData.spotAngle = payload.light.spotAngle;
        }

        if (Object.keys(componentData).length > 0) {
          await this.callTool(
            client,
            "update_component",
            {
              instanceId: payload.instanceId,
              componentName: "Light",
              componentData
            },
            "Setting Unity light fields"
          );
        }
      }

      const refreshedSummary = await this.findSceneObjectSummary(
        client,
        payload.instanceId
      );

      if (!refreshedSummary) {
        return {
          ok: false,
          error: "Object no longer exists. Refresh scene objects."
        };
      }

      const object = await this.readSceneObjectDetails(client, refreshedSummary);
      const renamedMessage =
        requestedName && finalName !== requestedName
          ? ` Requested name "${requestedName}" was already in use, so Unity object was renamed to "${finalName}".`
          : "";

      return {
        ok: true,
        mode: "mcp",
        action: "editObject",
        message: `Updated "${object.name}" in Unity.${renamedMessage}`,
        data: {
          object,
          requestedName,
          finalName
        }
      };
    } catch (error) {
      await this.reset();
      return {
        ok: false,
        error: "Unity/MCP edit object failed.",
        details: [
          "Open the UnityMCPDemo project in Unity Editor.",
          "Open Tools > MCP Unity > Server Window and click Start Server.",
          "The new edit route targets objects by instanceId only.",
          `Original error: ${getErrorMessage(error)}`
        ]
      };
    }
  }

  async editPartialTransform(
    payload: PartialTransformPayload
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

      const summary = await this.findSceneObjectSummary(client, payload.instanceId);
      if (!summary) {
        return {
          ok: false,
          error: "Object no longer exists. Refresh scene objects."
        };
      }

      const beforeDetails = await this.readSceneObjectDetails(client, summary);
      const transformArgs: Record<string, unknown> = {
        instanceId: payload.instanceId,
        position: payload.position ?? beforeDetails.position,
        rotation: payload.rotation ?? beforeDetails.rotation,
        scale: payload.scale ?? beforeDetails.scale,
        space: "world"
      };

      if (
        !payload.position &&
        !payload.rotation &&
        !payload.scale
      ) {
        return {
          ok: false,
          error: "At least one transform field is required."
        };
      }

      await this.callTool(
        client,
        "set_transform",
        transformArgs,
        "Setting Unity partial transform"
      );

      const refreshedSummary = await this.findSceneObjectSummary(
        client,
        payload.instanceId
      );

      if (!refreshedSummary) {
        return {
          ok: false,
          error: "Object no longer exists. Refresh scene objects."
        };
      }

      const object = await this.readSceneObjectDetails(client, refreshedSummary);

      return {
        ok: true,
        mode: "mcp",
        action: "editPartialTransform",
        message: `Updated transform for "${object.name}" in Unity.`,
        data: {
          object,
          changed: {
            ...(payload.position ? { position: payload.position } : {}),
            ...(payload.rotation ? { rotation: payload.rotation } : {}),
            ...(payload.scale ? { scale: payload.scale } : {})
          }
        }
      };
    } catch (error) {
      await this.reset();
      return {
        ok: false,
        error: "Unity/MCP partial transform edit failed.",
        details: [
          "Open the UnityMCPDemo project in Unity Editor.",
          "Open Tools > MCP Unity > Server Window and click Start Server.",
          "The chat transform tools only send the specific transform field being changed.",
          `Original error: ${getErrorMessage(error)}`
        ]
      };
    }
  }

  async renameObject(
    payload: RenameObjectPayload
  ): Promise<UnityActionSuccessResponse | UnityActionErrorResponse> {
    if (!isMcpConfigured()) {
      return configurationError([
        "Set UNITY_MCP_SERVER_ARGS to the absolute path of mcp-unity/Server~/build/index.js.",
        "UNITY_MCP_SERVER_COMMAND defaults to node."
      ]);
    }

    try {
      const client = await this.connect();
      await this.verifyEditObjectTools(client);

      const summaries = await this.readSceneObjectSummaries(client);
      const summary = summaries.find((object) => object.instanceId === payload.instanceId);

      if (!summary) {
        return {
          ok: false,
          error: "Object no longer exists. Refresh scene objects."
        };
      }

      const beforeDetails = await this.readSceneObjectDetails(client, summary);
      const requestedName = payload.name.trim();
      const finalName = this.nextAvailableNameExcluding(
        requestedName,
        summaries,
        payload.instanceId
      );

      if (finalName !== beforeDetails.name) {
        await this.callTool(
          client,
          "update_gameobject",
          {
            instanceId: payload.instanceId,
            gameObjectData: {
              name: finalName
            }
          },
          "Renaming Unity object"
        );
      }

      const refreshedSummary = await this.findSceneObjectSummary(
        client,
        payload.instanceId
      );

      if (!refreshedSummary) {
        return {
          ok: false,
          error: "Object no longer exists. Refresh scene objects."
        };
      }

      const object = await this.readSceneObjectDetails(client, refreshedSummary);
      const renamedMessage =
        finalName !== requestedName
          ? ` Requested name "${requestedName}" was already in use, so Unity object was renamed to "${finalName}".`
          : "";

      return {
        ok: true,
        mode: "mcp",
        action: "renameObject",
        message: `Renamed object to "${object.name}" in Unity.${renamedMessage}`,
        data: {
          object,
          requestedName,
          finalName
        }
      };
    } catch (error) {
      await this.reset();
      return {
        ok: false,
        error: "Unity/MCP rename object failed.",
        details: [
          "Open the UnityMCPDemo project in Unity Editor.",
          "Open Tools > MCP Unity > Server Window and click Start Server.",
          "The chat rename tool only updates the object name and preserves transform fields.",
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

  async deleteObject(
    payload: DeleteObjectPayload
  ): Promise<UnityActionSuccessResponse | UnityActionErrorResponse> {
    if (!isMcpConfigured()) {
      return configurationError([
        "Set UNITY_MCP_SERVER_ARGS to the absolute path of mcp-unity/Server~/build/index.js.",
        "UNITY_MCP_SERVER_COMMAND defaults to node."
      ]);
    }

    if (payload.confirm !== true) {
      return {
        ok: false,
        error: "Refusing to delete without confirm: true. The chat layer must request a preview first."
      };
    }

    try {
      const client = await this.connect();
      await this.verifyDeleteObjectTool(client);

      const result = await this.callTool(
        client,
        "delete_gameobject",
        {
          instanceId: payload.instanceId,
          includeChildren: true
        },
        "Deleting Unity GameObject"
      );

      return {
        ok: true,
        mode: "mcp",
        action: "deleteObject",
        message: result.text || `Deleted instanceId ${payload.instanceId}.`,
        data: {
          tool: "delete_gameobject",
          instanceId: payload.instanceId
        }
      };
    } catch (error) {
      await this.reset();
      return {
        ok: false,
        error: "Unity/MCP delete failed.",
        details: [
          "The object may already have been removed or the MCP server may have disconnected.",
          `Original error: ${getErrorMessage(error)}`
        ]
      };
    }
  }

  async deleteObjects(
    payload: DeleteObjectsPayload
  ): Promise<UnityActionSuccessResponse | UnityActionErrorResponse> {
    if (!isMcpConfigured()) {
      return configurationError([
        "Set UNITY_MCP_SERVER_ARGS to the absolute path of mcp-unity/Server~/build/index.js.",
        "UNITY_MCP_SERVER_COMMAND defaults to node."
      ]);
    }

    if (payload.confirm !== true) {
      return {
        ok: false,
        error: "Refusing to batch-delete without confirm: true. The chat layer must request a preview first."
      };
    }

    try {
      const client = await this.connect();
      await this.verifyDeleteObjectTool(client);

      const perCallFailures: { instanceId: number; error: string }[] = [];

      // `delete_gameobject` with includeChildren:true removes descendants
      // alongside their parent. A subsequent attempt on one of those already-
      // gone descendants throws "object not found", which is NOT a real
      // failure — the deletion happened, just not via this particular call.
      // We loop through every requested id anyway (so partially-broken trees
      // still get cleaned up), then verify against the live hierarchy below.
      for (const instanceId of payload.instanceIds) {
        try {
          await this.callTool(
            client,
            "delete_gameobject",
            { instanceId, includeChildren: true },
            `Deleting Unity GameObject ${instanceId}`
          );
        } catch (error) {
          perCallFailures.push({
            instanceId,
            error: getErrorMessage(error)
          });
        }
      }

      // Verify by reading the live hierarchy. If this snapshot succeeds, an
      // id is only considered "failed" if it is STILL present in the scene.
      // If the snapshot itself fails, fall back to trusting per-call signals.
      let verifiedRemainingIds: Set<number> | undefined;
      try {
        const snapshot = await this.readHierarchySnapshot(client);
        verifiedRemainingIds = snapshot.instanceIds;
      } catch {
        verifiedRemainingIds = undefined;
      }

      let deleted: number[];
      let failed: { instanceId: number; error: string }[];
      let verificationNote: string | undefined;

      if (verifiedRemainingIds) {
        deleted = payload.instanceIds.filter(
          (id) => !verifiedRemainingIds!.has(id)
        );
        const stillPresent = payload.instanceIds.filter((id) =>
          verifiedRemainingIds!.has(id)
        );
        failed = stillPresent.map((id) => {
          const perCall = perCallFailures.find(
            (entry) => entry.instanceId === id
          );
          return {
            instanceId: id,
            error:
              perCall?.error ??
              "Object still present in scene after delete attempt."
          };
        });
        if (perCallFailures.length > failed.length) {
          verificationNote = `Ignored ${perCallFailures.length - failed.length} apparent per-call errors confirmed deleted via parent (descendants removed with includeChildren).`;
        }
      } else {
        const failedSet = new Set(
          perCallFailures.map((entry) => entry.instanceId)
        );
        deleted = payload.instanceIds.filter((id) => !failedSet.has(id));
        failed = perCallFailures;
      }

      if (deleted.length === 0 && failed.length > 0) {
        return {
          ok: false,
          error: "Batch delete failed for every requested object.",
          details: failed.slice(0, 20).map(
            (entry) => `id ${entry.instanceId}: ${entry.error}`
          )
        };
      }

      const message =
        failed.length === 0
          ? `Deleted ${deleted.length} object${deleted.length === 1 ? "" : "s"}.`
          : `Deleted ${deleted.length} of ${payload.instanceIds.length} object${
              payload.instanceIds.length === 1 ? "" : "s"
            }. ${failed.length} failed.`;

      return {
        ok: true,
        mode: "mcp",
        action: "deleteObjects",
        message,
        data: {
          tool: "delete_gameobject",
          requested: payload.instanceIds.length,
          deleted,
          failed: failed.slice(0, 20),
          ...(verificationNote ? { verificationNote } : {}),
          verified: verifiedRemainingIds !== undefined
        }
      };
    } catch (error) {
      await this.reset();
      return {
        ok: false,
        error: "Unity/MCP batch delete failed.",
        details: [
          "The MCP server may have disconnected.",
          `Original error: ${getErrorMessage(error)}`
        ]
      };
    }
  }

  async duplicateObject(
    payload: DuplicateObjectPayload
  ): Promise<UnityActionSuccessResponse | UnityActionErrorResponse> {
    if (!isMcpConfigured()) {
      return configurationError([
        "Set UNITY_MCP_SERVER_ARGS to the absolute path of mcp-unity/Server~/build/index.js.",
        "UNITY_MCP_SERVER_COMMAND defaults to node."
      ]);
    }

    try {
      const client = await this.connect();
      await this.verifyDuplicateObjectTool(client);

      const offset = payload.positionOffset ?? {};
      const offsetMagnitude =
        (offset.x ?? 0) + (offset.y ?? 0) + (offset.z ?? 0);
      const needsTransform = offsetMagnitude !== 0;

      let beforeIds: Set<number> | undefined;
      if (needsTransform) {
        beforeIds = (await this.readHierarchySnapshot(client)).instanceIds;
      }

      const duplicateArgs: Record<string, unknown> = {
        instanceId: payload.instanceId,
        count: 1
      };
      if (payload.newName) {
        duplicateArgs.newName = payload.newName;
      }

      const result = await this.callTool(
        client,
        "duplicate_gameobject",
        duplicateArgs,
        "Duplicating Unity GameObject"
      );

      let newInstanceId: number | undefined;
      let appliedOffset = false;

      if (needsTransform && beforeIds) {
        const detectedId =
          this.extractInstanceIdFromToolResult(result.raw, result.text) ??
          (await this.findNewObjectInstanceId(client, beforeIds));

        if (detectedId !== undefined) {
          newInstanceId = detectedId;

          // Read the source position separately so the offset is from the original.
          const sourceSummary = await this.findSceneObjectSummary(
            client,
            payload.instanceId
          );
          let sourcePosition = { x: 0, y: 0, z: 0 };
          if (sourceSummary) {
            const sourceDetails = await this.readSceneObjectDetails(
              client,
              sourceSummary
            );
            sourcePosition = sourceDetails.position;
          }

          const newPosition = {
            x: sourcePosition.x + (offset.x ?? 0),
            y: sourcePosition.y + (offset.y ?? 0),
            z: sourcePosition.z + (offset.z ?? 0)
          };

          try {
            const duplicateSummary = await this.findSceneObjectSummary(
              client,
              detectedId
            );
            const duplicateDetails = duplicateSummary
              ? await this.readSceneObjectDetails(client, duplicateSummary)
              : undefined;

            await this.callTool(
              client,
              "set_transform",
              {
                instanceId: detectedId,
                position: newPosition,
                rotation: duplicateDetails?.rotation ?? { x: 0, y: 0, z: 0 },
                scale: duplicateDetails?.scale ?? { x: 1, y: 1, z: 1 },
                space: "world"
              },
              "Offsetting duplicated object"
            );
            appliedOffset = true;
          } catch {
            // If offsetting fails, the duplicate still exists at the source position.
            appliedOffset = false;
          }
        }
      } else {
        newInstanceId =
          this.extractInstanceIdFromToolResult(result.raw, result.text) ??
          undefined;
      }

      return {
        ok: true,
        mode: "mcp",
        action: "duplicateObject",
        message: result.text || "Duplicated Unity GameObject.",
        data: {
          tool: "duplicate_gameobject",
          sourceInstanceId: payload.instanceId,
          newInstanceId,
          requestedName: payload.newName,
          positionOffsetRequested: needsTransform ? offset : undefined,
          positionOffsetApplied: appliedOffset
        }
      };
    } catch (error) {
      await this.reset();
      return {
        ok: false,
        error: "Unity/MCP duplicate failed.",
        details: [
          "The MCP server may have disconnected or the source object may no longer exist.",
          `Original error: ${getErrorMessage(error)}`
        ]
      };
    }
  }

  async applyTextureToObject(
    payload: ApplyTextureToObjectPayload
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
      await this.verifySceneObjectReadTools(client);
      await this.verifyMaterialTools(client);

      const summary = await this.findSceneObjectSummary(client, payload.instanceId);
      if (!summary) {
        return {
          ok: false,
          error: "Object no longer exists. Refresh scene objects."
        };
      }
      const details = await this.readSceneObjectDetails(client, summary);

      if (!details.hasRenderer) {
        return {
          ok: false,
          error: "Cannot apply a texture to an object without a Renderer.",
          details: [
            `Object "${details.name}" (id ${details.instanceId}) has no Renderer component.`,
            "Apply textures to primitives or model meshes only."
          ]
        };
      }

      const materialResult = await this.prepareTextureMaterial(
        client,
        payload.texture,
        details.name,
        projectPaths.paths
      );
      if (!materialResult.ok) {
        return materialResult.error;
      }

      const assignment = await this.assignMaterialToRenderer(
        client,
        details.instanceId,
        materialResult.material.materialPath
      );
      if (!assignment.ok) {
        return assignment.error;
      }

      return {
        ok: true,
        mode: "mcp",
        action: "applyTextureToObject",
        message: `Applied texture ${payload.texture.originalName} to "${details.name}".`,
        data: {
          instanceId: details.instanceId,
          object: { name: details.name },
          material: {
            name: materialResult.material.materialName,
            path: materialResult.material.materialPath,
            texturePath: materialResult.material.texturePath,
            textureProperty: materialResult.material.textureProperty
          }
        }
      };
    } catch (error) {
      await this.reset();
      return {
        ok: false,
        error: "Unity/MCP apply-texture failed.",
        details: [
          "The MCP server may have disconnected or the texture could not be imported.",
          `Original error: ${getErrorMessage(error)}`
        ]
      };
    }
  }

  async batchApplyTextureToObjects(
    payload: BatchApplyTextureToObjectsPayload
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
      await this.verifySceneObjectReadTools(client);
      await this.verifyMaterialTools(client);

      // ONE material asset, MANY assignments — orders of magnitude faster than
      // calling apply_texture_to_object per id.
      const materialBaseName =
        payload.texture.originalName.replace(/\.[^/.]+$/, "") || "Texture";
      const materialResult = await this.prepareTextureMaterial(
        client,
        payload.texture,
        materialBaseName,
        projectPaths.paths
      );
      if (!materialResult.ok) {
        return materialResult.error;
      }
      const materialPath = materialResult.material.materialPath;

      const applied: number[] = [];
      const failed: { instanceId: number; error: string }[] = [];

      for (const instanceId of payload.instanceIds) {
        try {
          const summary = await this.findSceneObjectSummary(client, instanceId);
          if (!summary) {
            failed.push({ instanceId, error: "Object no longer exists." });
            continue;
          }
          const details = await this.readSceneObjectDetails(client, summary);
          if (!details.hasRenderer) {
            failed.push({
              instanceId,
              error: "Object has no Renderer component."
            });
            continue;
          }
          const assignment = await this.assignMaterialToRenderer(
            client,
            instanceId,
            materialPath
          );
          if (!assignment.ok) {
            failed.push({
              instanceId,
              error: assignment.error.details?.[0] ?? assignment.error.error
            });
            continue;
          }
          applied.push(instanceId);
        } catch (error) {
          failed.push({ instanceId, error: getErrorMessage(error) });
        }
      }

      if (applied.length === 0 && failed.length > 0) {
        return {
          ok: false,
          error: "Batch texture failed for every requested object.",
          details: failed
            .slice(0, 20)
            .map((entry) => `id ${entry.instanceId}: ${entry.error}`)
        };
      }

      const message =
        failed.length === 0
          ? `Applied texture ${payload.texture.originalName} to ${applied.length} object${applied.length === 1 ? "" : "s"}.`
          : `Applied texture to ${applied.length} of ${payload.instanceIds.length} object${
              payload.instanceIds.length === 1 ? "" : "s"
            }. ${failed.length} failed.`;

      return {
        ok: true,
        mode: "mcp",
        action: "batchApplyTextureToObjects",
        message,
        data: {
          tool: "assign_material",
          material: {
            name: materialResult.material.materialName,
            path: materialPath,
            texturePath: materialResult.material.texturePath
          },
          requested: payload.instanceIds.length,
          applied,
          failed: failed.slice(0, 20)
        }
      };
    } catch (error) {
      await this.reset();
      return {
        ok: false,
        error: "Unity/MCP batch apply-texture failed.",
        details: [
          "The MCP server may have disconnected or the texture could not be imported.",
          `Original error: ${getErrorMessage(error)}`
        ]
      };
    }
  }

  async batchSetMaterialColor(
    payload: BatchSetMaterialColorPayload
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
      await this.verifySceneObjectReadTools(client);
      await this.verifyMaterialTools(client);

      // ONE color material asset, MANY assignments.
      await fs.mkdir(projectPaths.paths.generatedMaterialsDir, {
        recursive: true
      });
      const sanitizedHex = payload.colorHex.replace("#", "");
      const materialAsset = await this.nextGeneratedMaterialAsset(
        projectPaths.paths.generatedMaterialsDir,
        `Color_${sanitizedHex}`
      );

      await this.callTool(
        client,
        "create_material",
        {
          name: materialAsset.name,
          savePath: materialAsset.path,
          color: payload.color
        },
        "Creating Unity color material"
      );

      const applied: number[] = [];
      const failed: { instanceId: number; error: string }[] = [];

      for (const instanceId of payload.instanceIds) {
        try {
          const summary = await this.findSceneObjectSummary(client, instanceId);
          if (!summary) {
            failed.push({ instanceId, error: "Object no longer exists." });
            continue;
          }
          const details = await this.readSceneObjectDetails(client, summary);
          if (!details.hasRenderer) {
            failed.push({
              instanceId,
              error: "Object has no Renderer component."
            });
            continue;
          }
          const assignment = await this.assignMaterialToRenderer(
            client,
            instanceId,
            materialAsset.path
          );
          if (!assignment.ok) {
            failed.push({
              instanceId,
              error: assignment.error.details?.[0] ?? assignment.error.error
            });
            continue;
          }
          applied.push(instanceId);
        } catch (error) {
          failed.push({ instanceId, error: getErrorMessage(error) });
        }
      }

      if (applied.length === 0 && failed.length > 0) {
        return {
          ok: false,
          error: "Batch color failed for every requested object.",
          details: failed
            .slice(0, 20)
            .map((entry) => `id ${entry.instanceId}: ${entry.error}`)
        };
      }

      const message =
        failed.length === 0
          ? `Set color ${payload.colorHex} on ${applied.length} object${applied.length === 1 ? "" : "s"}.`
          : `Set color on ${applied.length} of ${payload.instanceIds.length} object${
              payload.instanceIds.length === 1 ? "" : "s"
            }. ${failed.length} failed.`;

      return {
        ok: true,
        mode: "mcp",
        action: "batchSetMaterialColor",
        message,
        data: {
          tool: "assign_material",
          material: {
            name: materialAsset.name,
            path: materialAsset.path,
            color: payload.color,
            colorHex: payload.colorHex
          },
          requested: payload.instanceIds.length,
          applied,
          failed: failed.slice(0, 20)
        }
      };
    } catch (error) {
      await this.reset();
      return {
        ok: false,
        error: "Unity/MCP batch set-color failed.",
        details: [
          "The MCP server may have disconnected or material creation failed.",
          `Original error: ${getErrorMessage(error)}`
        ]
      };
    }
  }

  async setMaterialColor(
    payload: SetMaterialColorPayload
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
      await this.verifySceneObjectReadTools(client);
      await this.verifyMaterialTools(client);

      const summary = await this.findSceneObjectSummary(client, payload.instanceId);
      if (!summary) {
        return {
          ok: false,
          error: "Object no longer exists. Refresh scene objects."
        };
      }
      const details = await this.readSceneObjectDetails(client, summary);

      if (!details.hasRenderer) {
        return {
          ok: false,
          error: "Cannot set material color on an object without a Renderer.",
          details: [
            `Object "${details.name}" (id ${details.instanceId}) has no Renderer component.`,
            "For light color, use edit_light instead."
          ]
        };
      }

      await fs.mkdir(projectPaths.paths.generatedMaterialsDir, { recursive: true });
      const materialAsset = await this.nextGeneratedMaterialAsset(
        projectPaths.paths.generatedMaterialsDir,
        details.name
      );

      await this.callTool(
        client,
        "create_material",
        {
          name: materialAsset.name,
          savePath: materialAsset.path,
          color: payload.color
        },
        "Creating Unity color material"
      );

      const assignment = await this.assignMaterialToRenderer(
        client,
        details.instanceId,
        materialAsset.path
      );
      if (!assignment.ok) {
        return assignment.error;
      }

      return {
        ok: true,
        mode: "mcp",
        action: "setMaterialColor",
        message: `Set color ${payload.colorHex} on "${details.name}".`,
        data: {
          instanceId: details.instanceId,
          object: { name: details.name },
          material: {
            name: materialAsset.name,
            path: materialAsset.path,
            color: payload.color,
            colorHex: payload.colorHex
          }
        }
      };
    } catch (error) {
      await this.reset();
      return {
        ok: false,
        error: "Unity/MCP set-color failed.",
        details: [
          "The MCP server may have disconnected or material creation failed.",
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

  private async verifyCreateObjectGridTools(client: Client): Promise<void> {
    if (this.verifiedCreateObjectGridTools) {
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

    this.assertToolExists(toolsResult.tools, "batch_execute");
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

    this.verifiedCreateObjectGridTools = true;
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

  private async verifySceneObjectReadTools(client: Client): Promise<void> {
    if (this.verifiedSceneObjectReadTools) {
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

    this.assertToolStringArgument(toolsResult.tools, "get_gameobject", "idOrName");

    if (!resourcesResult.resources.some((resource) => resource.uri === hierarchyResourceUri)) {
      throw new Error(`MCP resource "${hierarchyResourceUri}" was not found.`);
    }

    this.verifiedSceneObjectReadTools = true;
  }

  private async verifyEditObjectTools(client: Client): Promise<void> {
    if (this.verifiedEditObjectTools) {
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

    this.assertToolStringArgument(toolsResult.tools, "get_gameobject", "idOrName");
    this.assertToolObjectArgument(toolsResult.tools, "update_gameobject", "gameObjectData");
    this.assertToolObjectArgument(toolsResult.tools, "set_transform", "position");
    this.assertToolObjectArgument(toolsResult.tools, "set_transform", "rotation");
    this.assertToolObjectArgument(toolsResult.tools, "set_transform", "scale");
    this.assertToolStringArgument(toolsResult.tools, "update_component", "componentName");
    this.assertToolObjectArgument(toolsResult.tools, "update_component", "componentData");

    if (!resourcesResult.resources.some((resource) => resource.uri === hierarchyResourceUri)) {
      throw new Error(`MCP resource "${hierarchyResourceUri}" was not found.`);
    }

    this.verifiedEditObjectTools = true;
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

  private async verifyDeleteObjectTool(client: Client): Promise<void> {
    if (this.verifiedDeleteObjectTool) {
      return;
    }

    const toolsResult = await withTimeout(
      client.request({ method: "tools/list" }, ListToolsResultSchema),
      "Listing Unity MCP tools"
    );

    this.assertToolExists(toolsResult.tools, "delete_gameobject");
    this.verifiedDeleteObjectTool = true;
  }

  private async verifyDuplicateObjectTool(client: Client): Promise<void> {
    if (this.verifiedDuplicateObjectTool) {
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

    this.assertToolExists(toolsResult.tools, "duplicate_gameobject");
    this.assertToolExists(toolsResult.tools, "get_gameobject");
    this.assertToolObjectArgument(toolsResult.tools, "set_transform", "position");

    if (!resourcesResult.resources.some((resource) => resource.uri === hierarchyResourceUri)) {
      throw new Error(`MCP resource "${hierarchyResourceUri}" was not found.`);
    }

    this.verifiedDuplicateObjectTool = true;
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
    label: string,
    timeoutMs = unityConfig.mcp.timeoutMs
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
      label,
      timeoutMs
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

  private gridBatchTimeoutMs(operationCount: number): number {
    return Math.min(
      Math.max(unityConfig.mcp.timeoutMs, 20000 + operationCount * 750),
      180000
    );
  }

  private chunkOperations(
    operations: BatchOperation[],
    maxOperations = 100
  ): BatchOperation[][] {
    const chunks: BatchOperation[][] = [];

    for (let index = 0; index < operations.length; index += maxOperations) {
      chunks.push(operations.slice(index, index + maxOperations));
    }

    return chunks;
  }

  private async callBatchOperations(
    client: Client,
    operations: BatchOperation[],
    label: string
  ): Promise<void> {
    const chunks = this.chunkOperations(operations);

    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      await this.callTool(
        client,
        "batch_execute",
        {
          operations: chunk,
          stopOnError: true,
          atomic: false
        },
        chunks.length > 1 ? `${label} (${index + 1}/${chunks.length})` : label,
        this.gridBatchTimeoutMs(chunk.length)
      );
    }
  }

  private buildGridItems(
    payload: CreateObjectGridPayload,
    reservedNames: Set<string>
  ): GridObjectItem[] {
    const total = payload.rows * payload.columns;
    const items: GridObjectItem[] = [];

    for (let row = 0; row < payload.rows; row += 1) {
      for (let column = 0; column < payload.columns; column += 1) {
        const index = row * payload.columns + column + 1;
        const requestedName =
          total === 1 ? payload.baseName : `${payload.baseName}_${index}`;
        const name = this.nextAvailableName(requestedName, reservedNames);

        reservedNames.add(name);
        items.push({
          name,
          position: {
            x: payload.startPosition.x + column * payload.spacing,
            y: payload.startPosition.y,
            z: payload.startPosition.z + row * payload.spacing
          }
        });
      }
    }

    return items;
  }

  private async waitForNewHierarchyObjects(
    client: Client,
    beforeIds: Set<number>,
    expectedCount: number
  ): Promise<FlattenedHierarchyObject[]> {
    const deadline = Date.now() + this.gridBatchTimeoutMs(expectedCount);
    let latestNewObjects: FlattenedHierarchyObject[] = [];

    while (Date.now() <= deadline) {
      const objects = await this.readHierarchyObjects(
        client,
        this.gridBatchTimeoutMs(expectedCount)
      );
      latestNewObjects = objects.filter((object) => !beforeIds.has(object.instanceId));

      if (latestNewObjects.length >= expectedCount) {
        return latestNewObjects;
      }

      await delay(250);
    }

    return latestNewObjects;
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

  private nextAvailableNameExcluding(
    baseName: string,
    objects: SceneObjectSummary[],
    instanceId: number
  ): string {
    const nameExists = (name: string): boolean =>
      objects.some((object) => object.instanceId !== instanceId && object.name === name);

    if (!nameExists(baseName)) {
      return baseName;
    }

    let index = 2;
    while (nameExists(`${baseName}_${index}`)) {
      index += 1;
    }

    return `${baseName}_${index}`;
  }

  private async readHierarchyJson(
    client: Client,
    timeoutMs = hierarchyReadTimeoutMs()
  ): Promise<unknown> {
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
      "Reading Unity scene hierarchy",
      timeoutMs
    );

    const text = result.contents
      .map((content) => ("text" in content && typeof content.text === "string" ? content.text : ""))
      .find(Boolean);

    if (!text) {
      throw new Error("Unity scene hierarchy response did not include JSON text.");
    }

    return JSON.parse(text) as unknown;
  }

  private async readHierarchyObjects(
    client: Client,
    timeoutMs = hierarchyReadTimeoutMs()
  ): Promise<FlattenedHierarchyObject[]> {
    return this.extractHierarchyObjects(await this.readHierarchyJson(client, timeoutMs));
  }

  private async readSceneObjectSummaries(client: Client): Promise<SceneObjectSummary[]> {
    return this.extractHierarchyObjects(await this.readHierarchyJson(client));
  }

  private async findSceneObjectSummary(
    client: Client,
    instanceId: number
  ): Promise<SceneObjectSummary | undefined> {
    return (await this.readSceneObjectSummaries(client)).find(
      (object) => object.instanceId === instanceId
    );
  }

  private async readSceneObjectDetails(
    client: Client,
    summary: SceneObjectSummary
  ): Promise<SceneObjectDetails> {
    const result = await this.callTool(
      client,
      "get_gameobject",
      {
        idOrName: String(summary.instanceId)
      },
      "Reading Unity object details"
    );
    const parsed = JSON.parse(result.text) as { gameObject?: unknown };
    const gameObject =
      parsed.gameObject && typeof parsed.gameObject === "object"
        ? (parsed.gameObject as Record<string, unknown>)
        : undefined;

    if (!gameObject) {
      throw new Error("Unity object detail response did not include gameObject data.");
    }

    const name = typeof gameObject.name === "string" ? gameObject.name : summary.name;
    const components = Array.isArray(gameObject.components)
      ? (gameObject.components as ComponentInfo[])
      : [];
    const componentTypes = this.componentTypesFromComponents(components);
    const transformProperties = this.findComponentProperties(components, "Transform");
    const lightProperties = this.findComponentProperties(components, "Light");
    const hasLight = componentTypes.includes("Light");
    const hasRenderer = this.hasRendererComponent(components);
    const hasCamera = componentTypes.includes("Camera");
    const category = this.categoryFromComponentTypes(componentTypes);
    const updatedSummary: SceneObjectSummary = {
      ...summary,
      name,
      componentTypes,
      hasLight,
      hasRenderer,
      hasCamera,
      category,
      displayName: this.sceneObjectDisplayName({
        ...summary,
        name
      })
    };

    return {
      ...updatedSummary,
      position:
        this.readVector3Property(transformProperties, ["position", "localPosition"]) ?? {
          x: 0,
          y: 0,
          z: 0
        },
      rotation:
        this.readVector3Property(transformProperties, [
          "eulerAngles",
          "localEulerAngles"
        ]) ?? {
          x: 0,
          y: 0,
          z: 0
        },
      scale:
        this.readVector3Property(transformProperties, ["localScale"]) ?? {
          x: 1,
          y: 1,
          z: 1
        },
      ...(hasLight
        ? {
            light: this.extractLightDetails(lightProperties)
          }
        : {})
    };
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
      sceneName?: string,
      sceneFilePath?: string
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
        const componentTypes = this.componentTypesFromComponents(object.components);
        const baseObject = {
          name,
          instanceId,
          path: currentPath,
          ...(sceneName ? { sceneName } : {}),
          ...(sceneFilePath ? { sceneFilePath } : {}),
          ...(sceneName ? { scenePath: `${sceneName}/${currentPath}` } : {})
        };

        objects.push({
          ...baseObject,
          componentTypes,
          hasLight: componentTypes.includes("Light"),
          hasRenderer: this.hasRendererComponent(object.components),
          hasCamera: componentTypes.includes("Camera"),
          category: this.categoryFromComponentTypes(componentTypes),
          displayName: this.sceneObjectDisplayName(baseObject)
        });
      }

      if (Array.isArray(object.children)) {
        for (const child of object.children) {
          if (child && typeof child === "object") {
            visitObject(child as HierarchyObject, currentPath, sceneName, sceneFilePath);
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
      const sceneFilePath =
        typeof sceneRecord.path === "string" && sceneRecord.path.length > 0
          ? sceneRecord.path
          : undefined;

      if (!Array.isArray(rootObjects)) {
        continue;
      }

      for (const rootObject of rootObjects) {
        if (rootObject && typeof rootObject === "object") {
          visitObject(rootObject as HierarchyObject, "", sceneName, sceneFilePath);
        }
      }
    }

    return objects;
  }

  private sceneObjectDisplayName(
    object: Pick<SceneObjectSummary, "name" | "path" | "scenePath" | "instanceId">
  ): string {
    return `${object.name} — ${object.scenePath ?? object.path} — id ${object.instanceId}`;
  }

  private componentTypesFromComponents(components: unknown): string[] {
    if (!Array.isArray(components)) {
      return [];
    }

    return components
      .map((component) => {
        if (!component || typeof component !== "object") {
          return undefined;
        }

        const type = (component as { type?: unknown }).type;
        return typeof type === "string" ? type : undefined;
      })
      .filter((type): type is string => Boolean(type));
  }

  private categoryFromComponentTypes(componentTypes: string[]): SceneObjectCategory {
    if (componentTypes.includes("Light")) {
      return "light";
    }

    if (componentTypes.includes("Camera")) {
      return "camera";
    }

    if (componentTypes.some((type) => type.endsWith("Renderer"))) {
      return "renderer";
    }

    return "generic";
  }

  private findComponentProperties(
    components: ComponentInfo[],
    componentType: string
  ): Record<string, unknown> | undefined {
    const component = components.find((item) => item.type === componentType);

    return component?.properties &&
      typeof component.properties === "object" &&
      !Array.isArray(component.properties)
      ? (component.properties as Record<string, unknown>)
      : undefined;
  }

  private readVector3Property(
    properties: Record<string, unknown> | undefined,
    names: string[]
  ): SceneObjectDetails["position"] | undefined {
    if (!properties) {
      return undefined;
    }

    for (const name of names) {
      const value = properties[name];
      if (
        value &&
        typeof value === "object" &&
        typeof (value as { x?: unknown }).x === "number" &&
        typeof (value as { y?: unknown }).y === "number" &&
        typeof (value as { z?: unknown }).z === "number"
      ) {
        return {
          x: (value as { x: number }).x,
          y: (value as { y: number }).y,
          z: (value as { z: number }).z
        };
      }
    }

    return undefined;
  }

  private extractLightDetails(
    properties: Record<string, unknown> | undefined
  ): SceneObjectLightDetails {
    const color = this.readColorProperty(properties?.color) ?? {
      r: 1,
      g: 1,
      b: 1,
      a: 1
    };
    const rawLightType = typeof properties?.type === "string" ? properties.type : undefined;
    const lightType = this.normalizeLightType(rawLightType);
    const range = typeof properties?.range === "number" ? properties.range : undefined;
    const spotAngle =
      typeof properties?.spotAngle === "number" ? properties.spotAngle : undefined;

    return {
      ...(lightType ? { lightType } : {}),
      color,
      colorHex: this.colorToHex(color),
      intensity:
        typeof properties?.intensity === "number" ? properties.intensity : 1,
      ...(range !== undefined ? { range } : {}),
      ...(spotAngle !== undefined ? { spotAngle } : {})
    };
  }

  private readColorProperty(value: unknown): ColorRGBA | undefined {
    if (
      value &&
      typeof value === "object" &&
      typeof (value as { r?: unknown }).r === "number" &&
      typeof (value as { g?: unknown }).g === "number" &&
      typeof (value as { b?: unknown }).b === "number"
    ) {
      return {
        r: (value as { r: number }).r,
        g: (value as { g: number }).g,
        b: (value as { b: number }).b,
        a:
          typeof (value as { a?: unknown }).a === "number"
            ? (value as { a: number }).a
            : 1
      };
    }

    return undefined;
  }

  private colorToHex(color: ColorRGBA): string {
    const toHex = (value: number): string =>
      Math.max(0, Math.min(255, Math.round(value * 255)))
        .toString(16)
        .padStart(2, "0");

    const alpha = color.a < 1 ? toHex(color.a) : "";
    return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}${alpha}`;
  }

  private normalizeLightType(value: string | undefined): UnityLightType | undefined {
    if (!value) {
      return undefined;
    }

    const normalized = value.toLowerCase();
    if (normalized.includes("directional")) {
      return "directional";
    }
    if (normalized.includes("point")) {
      return "point";
    }
    if (normalized.includes("spot")) {
      return "spot";
    }

    return undefined;
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
    this.verifiedCreateObjectGridTools = false;
    this.verifiedSceneObjectReadTools = false;
    this.verifiedEditObjectTools = false;
    this.verifiedDeleteObjectTool = false;
    this.verifiedDuplicateObjectTool = false;
    this.canRefreshAssets = false;
    this.connectPromise = undefined;

    if (this.client) {
      await this.client.close().catch(() => undefined);
      this.client = undefined;
    }
  }
}

export const mcpUnityClient = new McpUnityClient();

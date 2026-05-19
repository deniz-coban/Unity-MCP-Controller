import { unityConfig } from "../config.js";
import { chatToolExecutors } from "./toolExecutors.js";
import { chatToolSchemas } from "./toolSchemas.js";
import {
  addChatMessage,
  addToolSummary,
  listChatAttachments,
  listPendingConfirmations
} from "./sessionStore.js";
import type {
  ChatResponsePayload,
  ChatSession,
  OpenAIResponse,
  OpenAIResponseOutputItem,
  ToolCallLogEntry
} from "./types.js";

interface SendChatInput {
  session: ChatSession;
  message: string;
  persistUser?: boolean;
}

const openAiResponsesUrl = "https://api.openai.com/v1/responses";

const truncate = (value: string, maxLength = 1600): string =>
  value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;

const safeJson = (value: unknown): string => {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const summarizeArguments = (args: unknown): unknown => {
  if (!args || typeof args !== "object") {
    return args;
  }

  const text = JSON.stringify(args);
  if (text.length <= 900) {
    return args;
  }

  return {
    summary: truncate(text, 900)
  };
};

const extractOutputText = (response: OpenAIResponse): string => {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }

  const chunks: string[] = [];

  for (const item of response.output ?? []) {
    if (item.type !== "message") {
      continue;
    }

    for (const content of item.content ?? []) {
      if (
        (content.type === "output_text" || content.type === "text") &&
        typeof content.text === "string"
      ) {
        chunks.push(content.text);
      }
    }
  }

  return chunks.join("\n").trim();
};

const extractFunctionCalls = (
  response: OpenAIResponse
): Required<Pick<OpenAIResponseOutputItem, "call_id" | "name" | "arguments">>[] =>
  (response.output ?? []).filter(
    (
      item
    ): item is Required<Pick<OpenAIResponseOutputItem, "call_id" | "name" | "arguments">> =>
      item.type === "function_call" &&
      typeof item.call_id === "string" &&
      typeof item.name === "string" &&
      typeof item.arguments === "string"
  );

const openAiRequest = async (body: Record<string, unknown>): Promise<OpenAIResponse> => {
  if (!unityConfig.openai.apiKey) {
    throw new Error("OPENAI_API_KEY is not configured on the backend.");
  }

  const response = await fetch(openAiResponsesUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${unityConfig.openai.apiKey}`
    },
    body: JSON.stringify(body)
  });

  const parsed = (await response.json()) as OpenAIResponse;

  if (!response.ok) {
    throw new Error(
      parsed.error?.message ?? `OpenAI Responses API request failed (${response.status}).`
    );
  }

  return parsed;
};

const buildInstructions = (session: ChatSession): string => {
  const attachments = listChatAttachments(session);
  const attachmentLines = attachments.length
    ? attachments
        .map(
          (attachment) =>
            `- ${attachment.id}: ${attachment.kind}, ${attachment.originalName}, ${attachment.extension}, ${attachment.sizeBytes} bytes`
        )
        .join("\n")
    : "No uploaded attachments are currently available.";

  return `You are an LLM-powered Unity scene builder for a local Unity MCP Controller.
You decide which safe high-level app tools to call to fulfill the user's Unity scene request.

Rules:
- Use only the provided high-level tools. Do not ask for raw MCP tools.
- Do not create/load/unload scenes, run menu items, install packages, run tests, or execute arbitrary Unity commands.
- When editing an object named by the user, call list_scene_objects first and choose the exact instanceId.
- Use move_object only for position changes, rotate_object only for rotation changes, and scale_object only for scale changes.
- Use rename_object only for object name changes.
- For multi-object transform changes, use the matching batch_move_objects, batch_rotate_objects, or batch_scale_objects tool.
- Never include position in a rotation/scale request, never include rotation in a move/scale request, and never include scale in a move/rotate request.
- Use edit_light only for Light component fields such as intensity, color, range, and spotAngle. Never send light fields through transform tools.
- Do not rely only on chat memory for scene state. Use list_scene_objects whenever current scene state matters.
- For uploads, use only the attachment ids below. Never invent attachment ids and never request raw binary data.
- If a tool fails, clearly tell the user what failed and why.
- Keep final answers concise and mention important object names or counts.

Delete safety:
- NEVER call delete_object or delete_objects unless the user's most recent message explicitly asked for deletion. Deletion words include: "delete", "remove", "clear", "wipe", "destroy", "get rid of", "reset the scene". If the user did not use one of these, do not delete anything, regardless of how natural it might seem.
- Constructive operations — creating new objects, building grids, applying textures, setting colors, duplicating, etc. — NEVER require deleting existing objects as a prerequisite. Unity objects can overlap freely. Making a 10x10 grid does NOT require removing any cube that happens to be in the same location. Just create the new objects; they will coexist with whatever was already there.
- If a user request seems to "conflict" with an existing object (overlap, same name, similar shape), proceed with the constructive part anyway. Do not invent a deletion step. If the user later asks to remove the redundant object, that is a separate request.
- delete_object and delete_objects never actually delete on their own. They only request a confirmation prompt that the user resolves by clicking Confirm or Cancel in the UI.
- For "delete X" call delete_object with the right instanceId. For "delete all", "delete every Y", or any multi-target deletion, call list_scene_objects ONCE and then delete_objects ONCE with the full instanceIds array. NEVER call delete_object many times. NEVER split a single multi-target deletion across multiple delete_objects calls — pass every id in one call, even if there are hundreds. delete_objects accepts up to 500 ids per call.
- list_scene_objects returns a compact list ({instanceId, name, category, hasLight, hasRenderer}) plus a "count" of every object in the scene and an optional "truncated" flag. If "truncated" is true, the scene exceeds the listing cap (1000); ask the user before doing anything destructive. Otherwise treat the returned objects as complete and pass every instanceId to delete_objects.
- After issuing the confirmation, briefly tell the user what was prepared and stop the current tool-calling loop. Do not call delete_object/delete_objects again unless the user explicitly asks for a different set of targets. The system will automatically re-engage you once the user has clicked Confirm or Cancel, and you can continue with any remaining steps from the original request at that point.

Materials:
- apply_texture_to_object and set_material_color each REPLACE the object's current generated material. In v1 they do not compose; applying one after the other loses the previous effect. If the user asks for both, choose the final desired effect or ask them.
- When the user wants the SAME texture or the SAME color on MANY objects (any number greater than one — a grid, every cube, multiple selected ids), you MUST use batch_apply_texture_to_objects or batch_set_material_color. NEVER loop apply_texture_to_object or set_material_color in a multi-call sequence. One batch call covers every target.
- A typical "make a grid of textured cubes" flow is: (1) call create_object_grid once, (2) call list_scene_objects once to read back the new instanceIds, (3) call batch_apply_texture_to_objects once with every id from the grid. Three tool calls, not 100.
- duplicate_object copies type, name (deduped), and transform. For lights it also copies light properties. It does NOT copy textures, materials, or colors in real Unity mode. For imported models, duplicate_object is unsupported in v1.

Online model search:
- Use find_online_model whenever the user asks to add a real-world object that is not a primitive and was not uploaded as an attachment (e.g. "add a bicycle", "put a coffee mug on the table", "add a tree"). It searches free 3D model catalogs (Poly Pizza, Sketchfab) and prepares a UI confirmation card with candidates. The user picks one and the model is downloaded and imported automatically. The tool itself does NOT add anything to the scene.
- Use simple, common-noun queries: "bicycle", not "1985 Schwinn road bike". Specific product names rarely match.
- If the user specified position/rotation/scale, pass those to find_online_model so they are honored after import.
- After issuing the search, briefly tell the user what was found and stop. The user picks an option in the UI; the system re-engages you with the result once a model is imported.

Honesty rules:
- Never claim to have done something you did not actually call a tool for. If you only applied a texture to the first cube, say exactly that. Do not say "applied to all" unless every target succeeded.
- Do not invent or "fix up" steps the user did not ask for. If a grid was created at scale 9x, do not later set scale to 9x "to be sure" — that is wasted work and risks hallucinated instanceIds.
- After any batch tool, the result's "applied" and "failed" arrays are the source of truth. Summarize them exactly in your final reply; do not round up.

Available uploaded attachments for this session:
${attachmentLines}`;
};

const buildConversationInput = (session: ChatSession, message: string) => {
  const messages = session.messages.map((item) => ({
    role: item.role,
    content: item.content
  }));

  if (session.toolSummaries.length > 0) {
    messages.push({
      role: "assistant",
      content: `Recent Unity tool results:\n${session.toolSummaries.join("\n")}`
    });
  }

  messages.push({
    role: "user",
    content: message
  });

  return messages;
};

export const sendChatMessage = async ({
  session,
  message,
  persistUser = true
}: SendChatInput): Promise<ChatResponsePayload> => {
  const trimmedMessage = message.trim();

  if (!trimmedMessage) {
    throw new Error("Message is required.");
  }

  if (!unityConfig.openai.apiKey) {
    throw new Error("OPENAI_API_KEY is not configured on the backend.");
  }

  const toolCalls: ToolCallLogEntry[] = [];
  let response = await openAiRequest({
    model: unityConfig.openai.model,
    instructions: buildInstructions(session),
    input: buildConversationInput(session, trimmedMessage),
    tools: chatToolSchemas,
    parallel_tool_calls: false,
    max_output_tokens: 4096
  });
  let totalToolCalls = 0;

  while (true) {
    const functionCalls = extractFunctionCalls(response);

    if (functionCalls.length === 0) {
      break;
    }

    if (totalToolCalls + functionCalls.length > unityConfig.chat.maxToolCalls) {
      const messageText = `Stopped because the model requested more than ${unityConfig.chat.maxToolCalls} tool calls.`;
      if (persistUser) {
        addChatMessage(session, "user", trimmedMessage);
      }
      addChatMessage(session, "assistant", messageText);
      return {
        ok: true,
        sessionId: session.id,
        message: messageText,
        messages: session.messages,
        toolCalls,
        attachments: listChatAttachments(session),
        pendingConfirmations: listPendingConfirmations(session)
      };
    }

    totalToolCalls += functionCalls.length;

    const functionOutputs = [];

    for (const functionCall of functionCalls) {
      let parsedArgs: Record<string, unknown> = {};
      const logEntry: ToolCallLogEntry = {
        id: functionCall.call_id,
        toolName: functionCall.name,
        arguments: {},
        status: "loading"
      };
      toolCalls.push(logEntry);

      try {
        parsedArgs = functionCall.arguments
          ? (JSON.parse(functionCall.arguments) as Record<string, unknown>)
          : {};
        logEntry.arguments = summarizeArguments(parsedArgs);

        const executor = chatToolExecutors[functionCall.name];
        if (!executor) {
          throw new Error(`Unknown tool "${functionCall.name}".`);
        }

        const result = await executor(parsedArgs, { session });
        logEntry.status = result.ok ? "success" : "error";
        logEntry.result = result.ok ? result.message : undefined;
        logEntry.error = result.ok ? undefined : result.message;

        functionOutputs.push({
          type: "function_call_output",
          call_id: functionCall.call_id,
          output: truncate(
            safeJson({
              ok: result.ok,
              message: result.message,
              data: result.data
            }),
            60000
          )
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logEntry.status = "error";
        logEntry.error = errorMessage;

        functionOutputs.push({
          type: "function_call_output",
          call_id: functionCall.call_id,
          output: safeJson({
            ok: false,
            message: errorMessage
          })
        });
      }
    }

    response = await openAiRequest({
      model: unityConfig.openai.model,
      instructions: buildInstructions(session),
      previous_response_id: response.id,
      input: functionOutputs,
      tools: chatToolSchemas,
      parallel_tool_calls: false,
      max_output_tokens: 4096
    });
  }

  const extractedText = extractOutputText(response);
  const hasAssistantOutput = extractedText.length > 0;
  const statusNoteText =
    "Model returned no message. The request was processed, but there is nothing to show.";
  const assistantMessage = hasAssistantOutput ? extractedText : statusNoteText;

  if (persistUser) {
    addChatMessage(session, "user", trimmedMessage);
  }
  if (hasAssistantOutput) {
    addChatMessage(session, "assistant", extractedText);
  }

  if (toolCalls.length > 0) {
    addToolSummary(
      session,
      toolCalls
        .map((toolCall) => {
          const result = toolCall.status === "success" ? toolCall.result : toolCall.error;
          return `${toolCall.toolName}: ${toolCall.status}${result ? ` - ${result}` : ""}`;
        })
        .join("\n")
    );
  }

  return {
    ok: true,
    sessionId: session.id,
    message: assistantMessage,
    messages: session.messages,
    toolCalls,
    attachments: listChatAttachments(session),
    pendingConfirmations: listPendingConfirmations(session),
    ...(hasAssistantOutput
      ? {}
      : { statusNote: { kind: "no_assistant_output", text: statusNoteText } as const })
  };
};

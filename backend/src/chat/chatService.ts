import { unityConfig } from "../config.js";
import { chatToolExecutors } from "./toolExecutors.js";
import { chatToolSchemas } from "./toolSchemas.js";
import {
  addChatMessage,
  addToolSummary,
  listChatAttachments
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
- Do not delete objects, create/load/unload scenes, run menu items, install packages, run tests, or execute arbitrary Unity commands.
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
  message
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
    max_output_tokens: 1200
  });
  let totalToolCalls = 0;

  while (true) {
    const functionCalls = extractFunctionCalls(response);

    if (functionCalls.length === 0) {
      break;
    }

    if (totalToolCalls + functionCalls.length > unityConfig.chat.maxToolCalls) {
      const messageText = `Stopped because the model requested more than ${unityConfig.chat.maxToolCalls} tool calls.`;
      addChatMessage(session, "user", trimmedMessage);
      addChatMessage(session, "assistant", messageText);
      return {
        ok: true,
        sessionId: session.id,
        message: messageText,
        messages: session.messages,
        toolCalls,
        attachments: listChatAttachments(session)
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
            5000
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
      max_output_tokens: 1200
    });
  }

  const assistantMessage =
    extractOutputText(response) ||
    "I finished processing the request, but the model did not return a final message.";

  addChatMessage(session, "user", trimmedMessage);
  addChatMessage(session, "assistant", assistantMessage);

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
    attachments: listChatAttachments(session)
  };
};

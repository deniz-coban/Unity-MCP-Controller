import "dotenv/config";
import express from "express";
import { isMcpConfigured, unityConfig } from "./config.js";
import { chatRoutes } from "./routes/chatRoutes.js";
import { unityRoutes } from "./routes/unityRoutes.js";

const app = express();
const port = unityConfig.port;

app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "unity-mcp-controller-backend",
    mode: unityConfig.mode,
    openai: {
      configured: Boolean(unityConfig.openai.apiKey),
      model: unityConfig.openai.model
    },
    onlineModels: {
      polyPizzaConfigured: Boolean(unityConfig.onlineModels.polyPizzaApiKey),
      sketchfabConfigured: Boolean(unityConfig.onlineModels.sketchfabApiToken)
    },
    mcp: {
      configured: isMcpConfigured(),
      serverCommand: unityConfig.mcp.serverCommand,
      serverArgsConfigured: unityConfig.mcp.serverArgs.length > 0,
      addCubeTool: unityConfig.mcp.addCubeTool,
      addCubeArgumentName: unityConfig.mcp.addCubeArgumentName,
      addCubeMenuPath: unityConfig.mcp.addCubeMenuPath,
      unityProjectPathConfigured: Boolean(unityConfig.unityProjectPath),
      modelUploadMaxMb: unityConfig.modelUploadMaxMb,
      textureUploadMaxMb: unityConfig.textureUploadMaxMb
    }
  });
});

app.use("/api/unity", unityRoutes);
app.use("/api/chat", chatRoutes);

app.use((_req, res) => {
  res.status(404).json({
    ok: false,
    error: "Route not found."
  });
});

const server = app.listen(port, "127.0.0.1", () => {
  console.log(`Backend listening locally on http://127.0.0.1:${port}`);
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `Backend port ${port} is already in use. Stop the existing server on port ${port}, or set PORT to a different value in backend/.env.`
    );
    process.exit(1);
  }

  throw error;
});

import express from "express";
import { isMcpConfigured, unityConfig } from "./config.js";
import { unityRoutes } from "./routes/unityRoutes.js";

const app = express();
const port = unityConfig.port;

app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "unity-mcp-controller-backend",
    mode: unityConfig.mode,
    mcp: {
      configured: isMcpConfigured(),
      serverCommand: unityConfig.mcp.serverCommand,
      serverArgsConfigured: unityConfig.mcp.serverArgs.length > 0,
      addCubeTool: unityConfig.mcp.addCubeTool,
      addCubeArgumentName: unityConfig.mcp.addCubeArgumentName,
      addCubeMenuPath: unityConfig.mcp.addCubeMenuPath
    }
  });
});

app.use("/api/unity", unityRoutes);

app.use((_req, res) => {
  res.status(404).json({
    ok: false,
    error: "Route not found."
  });
});

app.listen(port, "127.0.0.1", () => {
  console.log(`Backend listening locally on http://127.0.0.1:${port}`);
});

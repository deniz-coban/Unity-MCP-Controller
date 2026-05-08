import express from "express";
import { unityRoutes } from "./routes/unityRoutes.js";

const app = express();
const parsedPort = Number(process.env.PORT);
const port = Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : 3001;

app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "unity-mcp-controller-backend",
    mode: "mock"
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

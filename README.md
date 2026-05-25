# Unity MCP Controller

A local React + Express app for building and editing Unity scenes through 
high-level tools. The frontend gives you an AI scene-building chat interface,
attachment upload, confirmation cards for destructive actions and online model
picks, and a tool-call/activity log. The backend can run in an in-memory mock
mode or connect to Unity through a Model Context Protocol (MCP) bridge.

The project is intentionally local-only: no database, no auth, no Docker, and no
deployment setup.

## What It Does

- Talks to Unity through a Unity client abstraction in `backend/src/unityClient.ts`.
- Runs in `mock` mode by default, using `backend/src/mockUnityClient.ts` to keep
  scene state in memory while the backend process is running.
- Runs in `mcp` mode with the CoderGamester Unity MCP bridge, using
  `backend/src/mcpUnityClient.ts`.
- Provides an AI scene builder backed by the OpenAI Responses API. The model can
  call only the app's high-level tools, not arbitrary Unity MCP tools.
- Supports creating primitives, grids, lights, model imports, scene inspection,
  transform edits, renaming, duplication, deletion confirmations, textures, and
  material colors.
- Supports uploaded model/texture attachments for chat workflows.
- Can search online model catalogs through Poly Pizza and/or Sketchfab, then
  asks the user to pick a candidate before downloading and importing it.

## Tech Stack

- Node.js + TypeScript
- Express backend
- React + Vite frontend
- `@modelcontextprotocol/sdk` for MCP communication
- OpenAI Responses API for chat tool calling
- Multer for local upload handling

## Project Layout

```text
backend/
  src/
    server.ts                 Express app and health endpoint
    config.ts                 Environment parsing
    unityClient.ts            Mock/MCP client switch
    mockUnityClient.ts        In-memory scene implementation
    mcpUnityClient.ts         Real Unity MCP implementation
    routes/
      unityRoutes.ts          Direct Unity REST routes
      chatRoutes.ts           Chat, attachments, confirmations
    chat/
      chatService.ts          OpenAI Responses loop
      toolSchemas.ts          Tools exposed to the model
      toolExecutors.ts        Tool implementations
      sessionStore.ts         In-memory chat state and attachment TTLs
    online/                   Poly Pizza, Sketchfab, download helpers
frontend/
  src/
    App.tsx                   Main chat workspace
    api.ts                    Frontend API client
    components/               Chat, activity log, top bar, library UI
```

## Prerequisites

- Node.js 20 or newer.
- npm.
- For MCP mode: Unity Editor plus the CoderGamester MCP Unity package.
- For AI chat: an OpenAI API key.
- For online model search: a Poly Pizza API key and/or a Sketchfab API token.

## Quick Start: Mock Mode

Mock mode is the default and does not require Unity, MCP, or OpenAI unless you
want to use the chat panel.

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

The backend listens on `http://127.0.0.1:3001` by default.

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open the Vite URL, usually:

```text
http://127.0.0.1:5173
```

Check backend health:

```bash
curl http://127.0.0.1:3001/api/health
```

In mock mode, scene state is in memory and is lost when the backend restarts.
Direct mock scene actions require a scene to be created first:

```bash
curl -X POST http://127.0.0.1:3001/api/unity/create-scene
```

## Enable AI Chat

Set these in `backend/.env`, then restart the backend:

```bash
OPENAI_API_KEY=your_api_key
OPENAI_MODEL=gpt-4.1-mini
```

The chat service keeps short-lived session state in memory. Uploaded attachments
are stored in a temp directory and cleaned up after the configured TTL.

The chat model is constrained by `backend/src/chat/toolSchemas.ts` and
`backend/src/chat/chatService.ts`. It is instructed to stay on Unity
scene-building tasks and to use only the provided high-level tools.

## Enable Real Unity MCP Mode

This app targets the public CoderGamester bridge:

```text
https://github.com/CoderGamester/mcp-unity
```

### 1. Install the Unity Package

In your Unity project:

```text
Window > Package Manager > + > Add package from git URL...
```

Use:

```text
https://github.com/CoderGamester/mcp-unity.git
```

### 2. Start the Unity MCP Server Window

In Unity:

```text
Tools > MCP Unity > Server Window
```

Click `Start Server`. The default Unity-side WebSocket port is `8090`.

### 3. Clone and Build the MCP Node Server

```bash
mkdir -p ~/Developer
cd ~/Developer
git clone https://github.com/CoderGamester/mcp-unity.git
cd mcp-unity/Server~
npm install
npm run build
```

### 4. Configure This Backend

Edit `backend/.env`:

```bash
UNITY_CLIENT_MODE=mcp
UNITY_MCP_SERVER_COMMAND=node
UNITY_MCP_SERVER_ARGS=/Users/you/Developer/mcp-unity/Server~/build/index.js
UNITY_PORT=8090
UNITY_PROJECT_PATH=/Users/you/path/to/YourUnityProject
```

Then run:

```bash
cd backend
npm run dev
```

`UNITY_PROJECT_PATH` must point at a Unity project folder that contains
`Assets/`. It is required for model imports, texture imports, and generated
materials. The backend writes imported assets under:

```text
Assets/ImportedModels/
Assets/ImportedTextures/
Assets/GeneratedMaterials/
```

## Online Model Search

The chat tool `find_online_model` can search free model catalogs and show a UI
selection card. The model is downloaded and imported only after the user picks
one of the candidates.

Set one or both credentials in `backend/.env`:

```bash
POLY_PIZZA_API_KEY=your_poly_pizza_key
SKETCHFAB_API_TOKEN=your_sketchfab_token
```

Poly Pizza candidates may resolve to direct model files. Sketchfab candidates
use downloadable GLB/GLTF payloads when available. Manual frontend model uploads
currently accept FBX and OBJ files; texture uploads accept PNG, JPG, and JPEG.

## Useful Scripts

Backend:

```bash
cd backend
npm run dev      # start Express with tsx watch
npm run build    # type-check and compile to dist/
npm start        # run dist/server.js after build
```

Frontend:

```bash
cd frontend
npm run dev      # start Vite on 127.0.0.1:5173
npm run build    # TypeScript check + Vite production build
npm run preview  # preview production build
```

The Vite dev server proxies `/api` to `http://127.0.0.1:3001`.

## Environment Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | Backend port. |
| `UNITY_CLIENT_MODE` | `mock` | `mock` or `mcp`. |
| `UNITY_MCP_SERVER_COMMAND` | `node` | Command used to start the MCP stdio server. |
| `UNITY_MCP_SERVER_ARGS` | empty | Path or JSON string array of args for the MCP server command. |
| `UNITY_MCP_ADD_CUBE_TOOL` | `execute_menu_item` | MCP tool used for menu-item primitive creation. |
| `UNITY_MCP_ADD_CUBE_ARG_NAME` | `menuPath` | Argument name for the add-cube/menu tool. |
| `UNITY_MCP_ADD_CUBE_MENU_PATH` | `GameObject/3D Object/Cube` | Menu path for the legacy Add cube route. |
| `UNITY_MCP_TIMEOUT_MS` | `60000` | MCP call timeout. |
| `UNITY_PORT` | `8090` | Passed through to the MCP server process for the Unity bridge. |
| `UNITY_PROJECT_PATH` | empty | Unity project folder for asset import/material workflows. |
| `MODEL_UPLOAD_MAX_MB` | `50` | Model upload limit. |
| `TEXTURE_UPLOAD_MAX_MB` | `20` | Texture upload limit. |
| `OPENAI_API_KEY` | empty | Enables the AI chat panel. |
| `OPENAI_MODEL` | `gpt-4.1-mini` | Model used by the chat service. |
| `CHAT_HISTORY_MAX_ITEMS` | `24` | Stored chat messages per session. |
| `CHAT_MAX_TOOL_CALLS` | `32` | Maximum OpenAI tool calls per chat request. |
| `CHAT_MAX_GRID_OBJECTS` | `200` | Maximum objects created by one grid tool call. |
| `CHAT_MAX_BATCH_EDIT_OBJECTS` | `100` | Maximum objects edited by one batch transform call. |
| `CHAT_ATTACHMENT_TTL_MINUTES` | `60` | Uploaded chat attachment lifetime. |
| `POLY_PIZZA_API_KEY` | empty | Enables Poly Pizza model search. |
| `SKETCHFAB_API_TOKEN` | empty | Enables Sketchfab model search. |

## REST API

Health:

```text
GET /api/health
```

Chat:

```text
POST /api/chat
POST /api/chat/attachments
POST /api/chat/confirmations/:key
```

Unity routes:

```text
POST /api/unity/create-scene
POST /api/unity/add-cube
POST /api/unity/add-sphere
POST /api/unity/add-light
GET  /api/unity/scene-objects
GET  /api/unity/scene-objects/:instanceId
POST /api/unity/create-object
POST /api/unity/create-light
POST /api/unity/import-model
POST /api/unity/move-object
POST /api/unity/scale-object
POST /api/unity/edit-transform
POST /api/unity/edit-object
POST /api/unity/save-scene
```

Some newer operations are exposed through chat tools rather than direct REST
routes, including grids, deletion, duplication, partial transforms, material
colors, texture application, and online model search.

## Important Notes

- MCP mode assumes there is already an open scene in Unity. Creating a new scene
  from this app is mock-only.
- In MCP mode, the older direct routes `add-sphere`, `add-light`, `move-object`,
  and `scale-object` are mock-only legacy routes. Use `create-object`,
  `create-light`, `edit-object`, or chat tools for real Unity workflows.
- `save-scene` calls the MCP `save_scene` tool. Save As is not implemented.
- Destructive chat tools do not delete immediately. They create a confirmation
  card, and deletion runs only after the user confirms.
- Chat sessions, pending confirmations, mock scene state, and attachment records
  are all in memory.
- This app is designed for trusted local use on `127.0.0.1`.

## Build Checks

Run both builds before sharing a change:

```bash
cd backend
npm run build

cd ../frontend
npm run build
```

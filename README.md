# Unity MCP Controller

A simple local web app for controlling Unity through MCP-style tools.

## Goal

Build a simple interface that lets a user send Unity actions from a web page.

The app should eventually connect to a Unity MCP server / Unity Editor bridge, but it should start with a working mock mode first.

## Tech stack

- Node.js
- TypeScript
- Express backend
- React + Vite frontend
- Local-only app
- No database
- No login
- No deployment

## Required features

Frontend:
- Simple dashboard
- Buttons/forms for:
  - Create scene
  - Add cube
  - Add sphere
  - Add light
  - Move object
  - Scale object
  - Save scene
- Log/output panel showing success or errors

Backend:
- Express API routes for each Unity action
- A Unity client abstraction in `backend/src/unityClient.ts`
- Mock mode that returns fake success responses before Unity is connected
- Later, replace mock mode with real Unity MCP calls

Unity integration:
- Investigate existing public/community Unity MCP servers later
- Prefer using an existing Unity MCP bridge/plugin instead of building Unity integration from scratch
- Keep the Unity integration isolated so it can be swapped later

Important:
- Keep the project simple
- Do not over-engineer
- Do not add authentication, database, Docker, or deployment unless asked
- Make sure the app can run locally with clear commands

## Mock milestone

This repository currently implements a local mock version only. It does not
connect to Unity, MCP, or any real Unity Editor bridge yet.

The mock backend tracks simple in-memory scene state while it is running:
whether a scene has been created and the mock objects currently in that scene.
Creating a scene resets that state.

### Backend

```bash
cd backend
npm install
npm run dev
```

The backend listens on `127.0.0.1:3001` by default. To use another port:

```bash
PORT=4001 npm run dev
```

Health check:

```bash
curl http://127.0.0.1:3001/api/health
```

### Frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open the Vite URL shown in the terminal, usually:

```text
http://127.0.0.1:5173
```

### Build checks

```bash
cd backend
npm run build

cd ../frontend
npm run build
```

### Integration boundary

All Unity-facing behavior is isolated in:

```text
backend/src/unityClient.ts
```

That file returns mock success responses today. Later, it can be replaced with
real Unity MCP calls without changing the frontend or route names.

## Real Unity/MCP milestone: Add cube

Mock mode remains the default. Real Unity/MCP mode currently implements only one
real action: clicking **Add cube** calls Unity through MCP and adds a cube to the
currently open Unity scene.

The current integration targets the public CoderGamester MCP Unity bridge:

```text
https://github.com/CoderGamester/mcp-unity
```

The verified MCP tool contract for this milestone is:

```text
tool: execute_menu_item
argument: menuPath
value: GameObject/3D Object/Cube
```

### 1. Install the Unity package

In the open `UnityMCPDemo` Unity project:

```text
Window > Package Manager > + > Add package from git URL...
```

Use this Git URL:

```text
https://github.com/CoderGamester/mcp-unity.git
```

Unity will add it to the project through `UnityMCPDemo/Packages/manifest.json`.

### 2. Start the Unity MCP server window

In Unity:

```text
Tools > MCP Unity > Server Window
```

Click:

```text
Start Server
```

The default WebSocket port is:

```text
8090
```

### 3. Clone and build the MCP Node server

In Terminal:

```bash
mkdir -p ~/Developer
cd ~/Developer
git clone https://github.com/CoderGamester/mcp-unity.git
cd mcp-unity/Server~
npm install
npm run build
```

### 4. Run this app backend in MCP mode

In this repository:

```bash
cd backend
UNITY_CLIENT_MODE=mcp \
UNITY_MCP_SERVER_COMMAND=node \
UNITY_MCP_SERVER_ARGS="$HOME/Developer/mcp-unity/Server~/build/index.js" \
UNITY_MCP_ADD_CUBE_TOOL=execute_menu_item \
UNITY_MCP_ADD_CUBE_ARG_NAME=menuPath \
UNITY_MCP_ADD_CUBE_MENU_PATH="GameObject/3D Object/Cube" \
UNITY_PORT=8090 \
npm run dev
```

If your Unity MCP Server Window uses a different WebSocket port, set
`UNITY_PORT` to that value before running the backend.

### 5. Run the frontend

In a second terminal:

```bash
cd frontend
npm run dev
```

Open:

```text
http://127.0.0.1:5173
```

Click **Add cube**. A cube should appear in the currently open
`UnityMCPDemo` scene.

### Model import

MCP mode can import simple Unity-compatible model files into the open scene.
The first supported formats are:

```text
.fbx
.obj
```

Do not use `.glb`, `.gltf`, `.blend`, `.zip`, texture folders, material folders,
or animated model workflows yet. OBJ material and texture sidecars are not fully
supported in this first version, so test with small FBX files first.

Simple texture upload is supported for newly created primitives and newly
imported models. The first supported texture formats are:

```text
.png
.jpg
.jpeg
```

Texture support is intentionally narrow for now:

- one optional texture image per created object/model
- one generated Unity material per created object/model
- material assignment uses slot `0` only
- no OBJ `.mtl` parsing yet
- no texture folders, material packs, or zip files yet

Set the Unity project path when running the backend in MCP mode:

```bash
UNITY_PROJECT_PATH=/Users/deniz/Desktop/UnityMCPDemo
```

The backend copies uploaded model files into:

```text
<UNITY_PROJECT_PATH>/Assets/ImportedModels
```

Uploaded texture files are copied into:

```text
<UNITY_PROJECT_PATH>/Assets/ImportedTextures
```

Generated Unity materials are saved into:

```text
<UNITY_PROJECT_PATH>/Assets/GeneratedMaterials
```

These folders are created automatically if they do not exist. Model uploads are
limited by `MODEL_UPLOAD_MAX_MB`, which defaults to `50`. Texture uploads are
limited by `TEXTURE_UPLOAD_MAX_MB`, which defaults to `20`.

Example MCP backend command with model import enabled:

```bash
cd backend
UNITY_CLIENT_MODE=mcp \
UNITY_MCP_SERVER_COMMAND=node \
UNITY_MCP_SERVER_ARGS="$HOME/Developer/mcp-unity/Server~/build/index.js" \
UNITY_PROJECT_PATH=/Users/deniz/Desktop/UnityMCPDemo \
MODEL_UPLOAD_MAX_MB=50 \
TEXTURE_UPLOAD_MAX_MB=20 \
UNITY_PORT=8090 \
npm run dev
```

### MCP mode limitations

Default object creation and simple FBX/OBJ model import are real in MCP mode.
The older individual buttons for actions that have not been implemented in MCP
mode still return clear unsupported-action errors or are disabled in the UI.
Mock mode continues to support the mock workflow.

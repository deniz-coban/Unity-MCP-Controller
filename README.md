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

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
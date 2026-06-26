const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");
const ScorchShared = require("./shared-game");

const PORT = Number(process.env.PORT || 3000);
const GAME_TOKEN = process.env.GAME_TOKEN || process.env.SCORCH_TOKEN || "scorch";
const PUBLIC_DIR = __dirname;
const PLAYER_TIMEOUT_MS = 2 * 60 * 1000;

let gameState = ScorchShared.createGameState(Date.now());
const sessions = new Map();

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function sendJson(response, status, data) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(data));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 8192) {
        reject(new Error("Request body too large"));
        request.destroy();
      }
    });

    request.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });

    request.on("error", reject);
  });
}

function cleanName(name, fallback) {
  const value = String(name || "").trim().replace(/\s+/g, " ").slice(0, 20);
  return value || fallback;
}

function cleanupSessions() {
  const now = Date.now();
  for (const [session, player] of sessions.entries()) {
    if (now - player.lastSeen > PLAYER_TIMEOUT_MS) {
      sessions.delete(session);
    }
  }
}

function connectedPlayers() {
  return [0, 1].map((playerId) => {
    const player = [...sessions.values()].find((entry) => entry.playerId === playerId);
    return {
      playerId,
      name: player?.name || gameState.tanks[playerId].name,
      connected: Boolean(player),
    };
  });
}

function touchSession(session) {
  const player = sessions.get(session);
  if (!player) return null;
  player.lastSeen = Date.now();
  return player;
}

function assignPlayer(name) {
  cleanupSessions();

  if (sessions.size >= 2) {
    return null;
  }

  const usedSlots = new Set([...sessions.values()].map((player) => player.playerId));
  const playerId = usedSlots.has(0) ? 1 : 0;
  const playerName = cleanName(name, `Spieler ${playerId + 1}`);
  const session = crypto.randomBytes(24).toString("hex");
  sessions.set(session, {
    playerId,
    name: playerName,
    lastSeen: Date.now(),
  });
  gameState.tanks[playerId].name = playerName;
  return { session, playerId, name: playerName };
}

function resetGame() {
  const players = connectedPlayers();
  gameState = ScorchShared.createGameState(Date.now());
  players.forEach((player) => {
    gameState.tanks[player.playerId].name = player.name;
  });
}

function publicPayload(player) {
  cleanupSessions();
  const players = connectedPlayers();
  const state = ScorchShared.publicState(gameState);

  if (players.filter((entry) => entry.connected).length < 2 && !state.gameOver) {
    state.status = "Warte auf Spieler 2";
  }

  return {
    you: {
      playerId: player.playerId,
      name: player.name,
    },
    players,
    state,
    serverTime: Date.now(),
  };
}

async function handleApi(request, response, url) {
  if (request.method === "POST" && url.pathname === "/api/join") {
    const body = await readJson(request);

    if (String(body.token || "") !== GAME_TOKEN) {
      sendJson(response, 401, { error: "Invalid game code" });
      return;
    }

    const player = assignPlayer(body.name);
    if (!player) {
      sendJson(response, 409, { error: "Game is full" });
      return;
    }

    sendJson(response, 200, {
      session: player.session,
      ...publicPayload(player),
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/state") {
    const player = touchSession(url.searchParams.get("session"));
    if (!player) {
      sendJson(response, 401, { error: "Session expired" });
      return;
    }

    sendJson(response, 200, publicPayload(player));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/action") {
    const body = await readJson(request);
    const player = touchSession(body.session);

    if (!player) {
      sendJson(response, 401, { error: "Session expired" });
      return;
    }

    if (body.action?.type === "reset") {
      resetGame();
      sendJson(response, 200, publicPayload(player));
      return;
    }

    if (sessions.size < 2) {
      sendJson(response, 409, { error: "Waiting for player 2" });
      return;
    }

    const result = ScorchShared.applyAction(gameState, player.playerId, body.action);
    if (!result.ok) {
      sendJson(response, 409, { error: result.reason });
      return;
    }

    sendJson(response, 200, publicPayload(player));
    return;
  }

  sendJson(response, 404, { error: "Not found" });
}

function serveStatic(request, response, url) {
  const requestedPath = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestedPath));
  const relativePath = path.relative(PUBLIC_DIR, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath) || requestedPath.startsWith(".git")) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    const contentType = contentTypes[path.extname(filePath)] || "application/octet-stream";
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": contentType,
    });
    response.end(data);
  });
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (url.pathname.startsWith("/api/")) {
    handleApi(request, response, url).catch((error) => {
      sendJson(response, 400, { error: error.message });
    });
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405);
    response.end("Method not allowed");
    return;
  }

  serveStatic(request, response, url);
});

let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = ScorchShared.clamp((now - lastTick) / 16.67, 0.1, 2.4);
  lastTick = now;
  ScorchShared.tick(gameState, dt);
}, 1000 / 60);

server.listen(PORT, () => {
  console.log(`Scorch server running at http://localhost:${PORT}`);
  console.log(`Game code: ${GAME_TOKEN}`);
});

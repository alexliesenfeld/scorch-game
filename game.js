const shared = window.ScorchShared;
const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");

const ui = {
  angle: document.querySelector("#angleReadout"),
  power: document.querySelector("#powerReadout"),
  wind: document.querySelector("#windReadout"),
  banner: document.querySelector("#turnBanner"),
  p1Hp: document.querySelector("#playerOneHp"),
  p2Hp: document.querySelector("#playerTwoHp"),
  p1Panel: document.querySelector("#playerOnePanel"),
  p2Panel: document.querySelector("#playerTwoPanel"),
  p1Name: document.querySelector("#playerOneName"),
  p2Name: document.querySelector("#playerTwoName"),
  role: document.querySelector("#roleReadout"),
  connection: document.querySelector("#connectionReadout"),
  joinForm: document.querySelector("#joinForm"),
  joinOverlay: document.querySelector("#joinOverlay"),
  joinError: document.querySelector("#joinError"),
  tokenInput: document.querySelector("#gameToken"),
  nameInput: document.querySelector("#playerName"),
};

const client = {
  session: window.sessionStorage.getItem("scorchSession") || "",
  playerId: null,
  playerName: "",
  players: [],
  state: shared.createGameState(12345),
  connected: false,
  joining: false,
  lastActionAt: 0,
  lastPollAt: 0,
};

let lastTime = performance.now();

const clamp = shared.clamp;
const WORLD = shared.WORLD;

function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(320, window.innerWidth);
  const height = Math.max(420, window.innerHeight);

  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function worldScale() {
  return {
    x: canvas.clientWidth / WORLD.width,
    y: canvas.clientHeight / WORLD.height,
  };
}

function toScreen(point) {
  const scale = worldScale();
  return {
    x: point.x * scale.x,
    y: point.y * scale.y,
  };
}

function drawWorldPath(points, closeToBottom = false) {
  const first = toScreen({ x: points[0].x, y: points[0].y });
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);

  for (let i = 1; i < points.length; i += 1) {
    const p = toScreen(points[i]);
    ctx.lineTo(p.x, p.y);
  }

  if (closeToBottom) {
    const scale = worldScale();
    ctx.lineTo(canvas.clientWidth, WORLD.height * scale.y);
    ctx.lineTo(0, WORLD.height * scale.y);
    ctx.closePath();
  }
}

function currentTank() {
  return client.state.tanks[client.state.activeTank];
}

function updateHud() {
  const state = client.state;
  const tank = currentTank();
  const p1 = client.players.find((player) => player.playerId === 0);
  const p2 = client.players.find((player) => player.playerId === 1);
  const isMyTurn = client.connected && client.playerId === state.activeTank && !state.projectile && !state.gameOver;

  ui.angle.textContent = `${Math.round(tank.angle)} Grad`;
  ui.power.textContent = `${Math.round(tank.power)}`;
  ui.wind.textContent = `${state.wind > 0 ? ">" : state.wind < 0 ? "<" : "-"} ${Math.round(Math.abs(state.wind) * 1000)}`;
  ui.p1Hp.textContent = Math.max(0, Math.round(state.tanks[0].hp));
  ui.p2Hp.textContent = Math.max(0, Math.round(state.tanks[1].hp));
  ui.p1Name.textContent = p1?.name || state.tanks[0].name;
  ui.p2Name.textContent = p2?.name || state.tanks[1].name;
  ui.p1Panel.classList.toggle("active", state.activeTank === 0 && !state.gameOver);
  ui.p2Panel.classList.toggle("active", state.activeTank === 1 && !state.gameOver);
  ui.p1Panel.classList.toggle("mine", client.playerId === 0);
  ui.p2Panel.classList.toggle("mine", client.playerId === 1);
  ui.banner.textContent = isMyTurn ? `${state.status} - du bist dran` : state.status;
  ui.role.textContent = client.connected ? `Du bist Spieler ${client.playerId + 1}` : "Nicht verbunden";
  ui.connection.textContent = client.connected ? "Online" : "Offline";
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }

  return data;
}

function acceptServerPayload(payload) {
  client.connected = true;
  client.playerId = payload.you.playerId;
  client.playerName = payload.you.name;
  client.players = payload.players;
  client.state = payload.state;
  ui.joinOverlay.hidden = true;
  ui.joinError.textContent = "";
  updateHud();
}

async function joinGame(event) {
  event.preventDefault();
  if (client.joining) return;

  client.joining = true;
  ui.joinError.textContent = "";

  try {
    const payload = await requestJson("/api/join", {
      method: "POST",
      body: JSON.stringify({
        token: ui.tokenInput.value,
        name: ui.nameInput.value,
      }),
    });
    client.session = payload.session;
    window.sessionStorage.setItem("scorchSession", client.session);
    acceptServerPayload(payload);
  } catch (error) {
    ui.joinError.textContent = error.message;
  } finally {
    client.joining = false;
  }
}

async function pollState() {
  if (!client.session) return;

  try {
    const payload = await requestJson(`/api/state?session=${encodeURIComponent(client.session)}`);
    acceptServerPayload(payload);
  } catch (error) {
    client.connected = false;
    window.sessionStorage.removeItem("scorchSession");
    client.session = "";
    ui.joinOverlay.hidden = false;
    ui.joinError.textContent = error.message;
    updateHud();
  }
}

function canSendAction(action) {
  if (!client.connected) return false;
  if (action.type === "reset") return true;
  if (client.playerId !== client.state.activeTank) return false;
  if (client.state.projectile || client.state.gameOver || client.state.pendingTurnDelay > 0) return false;
  return true;
}

async function sendAction(action) {
  if (!canSendAction(action)) return;

  const now = performance.now();
  if (action.type !== "fire" && action.type !== "reset" && now - client.lastActionAt < 35) {
    return;
  }
  client.lastActionAt = now;

  try {
    const payload = await requestJson("/api/action", {
      method: "POST",
      body: JSON.stringify({
        session: client.session,
        action,
      }),
    });
    acceptServerPayload(payload);
  } catch (error) {
    ui.banner.textContent = error.message;
  }
}

function drawSky() {
  const state = client.state;
  const sky = ctx.createLinearGradient(0, 0, 0, canvas.clientHeight);
  sky.addColorStop(0, "#7fbbe3");
  sky.addColorStop(0.48, "#d6eadf");
  sky.addColorStop(1, "#f8d99b");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);

  const sun = toScreen({ x: 1070, y: 105 });
  const sunRadius = canvas.clientWidth * 0.034;
  ctx.beginPath();
  ctx.arc(sun.x, sun.y, sunRadius, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 231, 145, 0.82)";
  ctx.fill();

  state.clouds.forEach((cloud) => {
    const p = toScreen(cloud);
    const scale = worldScale();
    const size = cloud.size * Math.min(scale.x, scale.y);
    ctx.fillStyle = `rgba(255, 255, 255, ${cloud.alpha})`;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, size * 1.55, size * 0.52, 0, 0, Math.PI * 2);
    ctx.ellipse(p.x - size * 0.7, p.y + size * 0.05, size * 0.8, size * 0.44, 0, 0, Math.PI * 2);
    ctx.ellipse(p.x + size * 0.78, p.y + size * 0.02, size * 0.9, size * 0.46, 0, 0, Math.PI * 2);
    ctx.fill();
  });
}

function terrainPoints(offset = 0) {
  return client.state.terrain.map((height, i) => ({
    x: i * WORLD.terrainStep,
    y: height + offset,
  }));
}

function drawTerrain() {
  drawWorldPath(terrainPoints(), true);
  const fill = ctx.createLinearGradient(0, canvas.clientHeight * 0.52, 0, canvas.clientHeight);
  fill.addColorStop(0, "#4f8f4a");
  fill.addColorStop(0.42, "#5b7f38");
  fill.addColorStop(1, "#392a1d");
  ctx.fillStyle = fill;
  ctx.fill();

  drawWorldPath(terrainPoints(6), false);
  ctx.strokeStyle = "rgba(245, 237, 198, 0.32)";
  ctx.lineWidth = Math.max(1.5, canvas.clientHeight / 360);
  ctx.stroke();

  drawWorldPath(terrainPoints(22), false);
  ctx.strokeStyle = "rgba(44, 31, 20, 0.22)";
  ctx.lineWidth = Math.max(3, canvas.clientHeight / 180);
  ctx.stroke();
}

function roundedRect(x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function drawTank(tank) {
  if (tank.hp <= 0) return;

  const state = client.state;
  const p = toScreen(tank);
  const scale = worldScale();
  const unit = Math.min(scale.x, scale.y);
  const slope = Math.atan2(shared.terrainSlopeAt(state, tank.x), 24);
  const radians = (tank.angle * Math.PI) / 180;

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(slope * 0.34);

  ctx.fillStyle = "rgba(0, 0, 0, 0.24)";
  ctx.beginPath();
  ctx.ellipse(0, 16 * unit, 28 * unit, 7 * unit, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = tank.dark;
  roundedRect(-25 * unit, -3 * unit, 50 * unit, 20 * unit, 8 * unit);
  ctx.fill();

  ctx.fillStyle = tank.color;
  roundedRect(-17 * unit, -17 * unit, 34 * unit, 20 * unit, 9 * unit);
  ctx.fill();

  ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
  ctx.beginPath();
  ctx.arc(-6 * unit, -8 * unit, 4 * unit, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#222821";
  for (let i = -2; i <= 2; i += 1) {
    ctx.beginPath();
    ctx.arc(i * 10 * unit, 11 * unit, 4.2 * unit, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();

  const muzzle = shared.muzzlePosition(tank);
  const barrelStart = toScreen({ x: tank.x, y: tank.y - 12 });
  const barrelEnd = toScreen(muzzle);
  ctx.strokeStyle = "#27342f";
  ctx.lineWidth = Math.max(5, unit * 7);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(barrelStart.x, barrelStart.y);
  ctx.lineTo(barrelEnd.x, barrelEnd.y);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
  ctx.lineWidth = Math.max(1, unit * 1.6);
  ctx.beginPath();
  ctx.moveTo(barrelStart.x, barrelStart.y - unit * 2);
  ctx.lineTo(barrelEnd.x, barrelEnd.y - unit * 2);
  ctx.stroke();

  if (tank.id === state.activeTank && client.playerId === tank.id && !state.projectile && !state.gameOver) {
    const aimEnd = toScreen({
      x: tank.x + Math.cos(radians) * (WORLD.barrelLength + 42),
      y: tank.y - 12 - Math.sin(radians) * (WORLD.barrelLength + 42),
    });
    ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
    ctx.lineWidth = Math.max(1, unit * 1.4);
    ctx.setLineDash([5 * unit, 6 * unit]);
    ctx.beginPath();
    ctx.moveTo(barrelEnd.x, barrelEnd.y);
    ctx.lineTo(aimEnd.x, aimEnd.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawProjectile() {
  const shot = client.state.projectile;
  if (!shot) return;

  if (shot.trail.length > 1) {
    ctx.lineWidth = Math.max(2, canvas.clientHeight / 280);
    ctx.lineCap = "round";

    for (let i = 1; i < shot.trail.length; i += 1) {
      const a = toScreen(shot.trail[i - 1]);
      const b = toScreen(shot.trail[i]);
      ctx.strokeStyle = `rgba(255, 246, 205, ${i / shot.trail.length / 1.5})`;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  const p = toScreen(shot);
  ctx.fillStyle = "#181d1a";
  ctx.beginPath();
  ctx.arc(p.x, p.y, Math.max(4, canvas.clientHeight / 130), 0, Math.PI * 2);
  ctx.fill();
}

function drawEffects() {
  const unit = Math.min(worldScale().x, worldScale().y);

  client.state.explosions.forEach((explosion) => {
    const p = toScreen(explosion);
    const radius = explosion.radius * (1.22 - explosion.life) * unit;
    const ring = explosion.radius * (1.55 - explosion.life * 0.45) * unit;

    ctx.fillStyle = `rgba(255, 198, 73, ${explosion.life * 0.78})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = `rgba(244, 92, 67, ${explosion.life * 0.85})`;
    ctx.lineWidth = Math.max(2, 6 * unit);
    ctx.beginPath();
    ctx.arc(p.x, p.y, ring, 0, Math.PI * 2);
    ctx.stroke();
  });

  client.state.debris.forEach((piece) => {
    const p = toScreen(piece);
    ctx.globalAlpha = clamp(piece.life, 0, 1);
    ctx.fillStyle = piece.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(1, piece.size * unit), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  });
}

function drawWind() {
  const scale = worldScale();
  const start = toScreen({ x: 596, y: 165 });
  const length = client.state.wind * 2200 * scale.x;
  const arrow = Math.sign(client.state.wind);

  ctx.save();
  ctx.strokeStyle = "rgba(31, 48, 45, 0.4)";
  ctx.fillStyle = "rgba(31, 48, 45, 0.48)";
  ctx.lineWidth = Math.max(2, canvas.clientHeight / 280);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(start.x + length, start.y);
  ctx.stroke();

  if (arrow !== 0) {
    ctx.beginPath();
    ctx.moveTo(start.x + length, start.y);
    ctx.lineTo(start.x + length - arrow * 12 * scale.x, start.y - 7 * scale.y);
    ctx.lineTo(start.x + length - arrow * 12 * scale.x, start.y + 7 * scale.y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawFrame() {
  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  drawSky();
  drawWind();
  drawTerrain();
  client.state.tanks.forEach(drawTank);
  drawProjectile();
  drawEffects();
}

function step(now) {
  const dt = clamp((now - lastTime) / 16.67, 0.1, 2.4);
  lastTime = now;

  if (!client.connected) {
    shared.tick(client.state, dt);
  }

  drawFrame();
  requestAnimationFrame(step);
}

window.addEventListener("keydown", (event) => {
  const key = event.key;

  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(key)) {
    event.preventDefault();
  }

  if (key === "ArrowLeft") sendAction({ type: "rotate", direction: "left" });
  if (key === "ArrowRight") sendAction({ type: "rotate", direction: "right" });
  if (key === "ArrowUp") sendAction({ type: "power", direction: "up" });
  if (key === "ArrowDown") sendAction({ type: "power", direction: "down" });
  if (key === " ") sendAction({ type: "fire" });
  if (key.toLowerCase() === "r") sendAction({ type: "reset" });
});

window.addEventListener("resize", () => {
  resizeCanvas();
  drawFrame();
});

ui.joinForm.addEventListener("submit", joinGame);

resizeCanvas();
updateHud();
requestAnimationFrame(step);
setInterval(pollState, 120);
pollState();

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
};

const WORLD = {
  width: 1280,
  height: 720,
  gravity: 0.18,
  tankRadius: 17,
  barrelLength: 34,
  terrainStep: 4,
};

let terrain = [];
let tanks = [];
let activeTank = 0;
let projectile = null;
let explosions = [];
let debris = [];
let clouds = [];
let wind = 0;
let gameOver = false;
let messageTimer = 0;
let lastTime = performance.now();

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * t;
const randomBetween = (min, max) => min + Math.random() * (max - min);

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

function terrainHeightAt(x) {
  if (x <= 0) return terrain[0];
  if (x >= WORLD.width) return terrain[terrain.length - 1];

  const raw = x / WORLD.terrainStep;
  const i = Math.floor(raw);
  const t = raw - i;
  return lerp(terrain[i], terrain[i + 1], t);
}

function terrainSlopeAt(x) {
  return terrainHeightAt(x + 12) - terrainHeightAt(x - 12);
}

function rebuildTankPositions() {
  tanks.forEach((tank) => {
    tank.y = terrainHeightAt(tank.x) - WORLD.tankRadius + 2;
  });
}

function makeTerrain() {
  const count = Math.ceil(WORLD.width / WORLD.terrainStep) + 1;
  const values = [];
  const ridgeA = randomBetween(0.6, 1.2);
  const ridgeB = randomBetween(1.7, 2.4);
  const ridgeC = randomBetween(2.9, 3.6);

  for (let i = 0; i < count; i += 1) {
    const x = (i * WORLD.terrainStep) / WORLD.width;
    const height =
      510 +
      Math.sin(x * Math.PI * ridgeA + 0.4) * 44 +
      Math.sin(x * Math.PI * ridgeB + 2.2) * 34 +
      Math.sin(x * Math.PI * ridgeC + 4.8) * 20;
    values.push(clamp(height, 410, 610));
  }

  for (let pass = 0; pass < 3; pass += 1) {
    for (let i = 1; i < values.length - 1; i += 1) {
      values[i] = values[i] * 0.48 + (values[i - 1] + values[i + 1]) * 0.26;
    }
  }

  return values;
}

function makeTanks() {
  return [
    {
      id: 0,
      name: "Spieler 1",
      x: 145,
      y: 0,
      hp: 100,
      angle: 45,
      power: 55,
      facing: 1,
      color: "#e9c46a",
      dark: "#8b6330",
    },
    {
      id: 1,
      name: "Spieler 2",
      x: WORLD.width - 145,
      y: 0,
      hp: 100,
      angle: 135,
      power: 55,
      facing: -1,
      color: "#e76f51",
      dark: "#7f3f33",
    },
  ];
}

function makeClouds() {
  return Array.from({ length: 7 }, (_, i) => ({
    x: randomBetween(-80, WORLD.width + 80),
    y: randomBetween(56, 210),
    size: randomBetween(22, 52),
    speed: randomBetween(2, 8) + i * 0.2,
    alpha: randomBetween(0.18, 0.36),
  }));
}

function newWind() {
  wind = Number(randomBetween(-0.075, 0.075).toFixed(3));
}

function resetGame() {
  terrain = makeTerrain();
  tanks = makeTanks();
  rebuildTankPositions();
  activeTank = 0;
  projectile = null;
  explosions = [];
  debris = [];
  clouds = makeClouds();
  gameOver = false;
  messageTimer = 0;
  newWind();
  updateHud("Spieler 1 ist dran");
}

function activePlayer() {
  return tanks[activeTank];
}

function inactivePlayer() {
  return tanks[activeTank === 0 ? 1 : 0];
}

function updateHud(message) {
  const tank = activePlayer();
  ui.angle.textContent = `${Math.round(tank.angle)} Grad`;
  ui.power.textContent = `${Math.round(tank.power)}`;
  ui.wind.textContent = `${wind > 0 ? ">" : wind < 0 ? "<" : "-"} ${Math.round(Math.abs(wind) * 1000)}`;
  ui.p1Hp.textContent = Math.max(0, Math.round(tanks[0].hp));
  ui.p2Hp.textContent = Math.max(0, Math.round(tanks[1].hp));
  ui.p1Panel.classList.toggle("active", activeTank === 0 && !gameOver);
  ui.p2Panel.classList.toggle("active", activeTank === 1 && !gameOver);

  if (message) {
    ui.banner.textContent = message;
  } else if (!gameOver) {
    ui.banner.textContent = `${tank.name} ist dran`;
  }
}

function rotateAim(amount) {
  if (projectile || gameOver) return;
  const tank = activePlayer();
  const min = tank.id === 0 ? 2 : 92;
  const max = tank.id === 0 ? 88 : 178;
  tank.angle = clamp(tank.angle + amount, min, max);
  updateHud();
}

function changePower(amount) {
  if (projectile || gameOver) return;
  const tank = activePlayer();
  tank.power = clamp(tank.power + amount, 18, 100);
  updateHud();
}

function muzzlePosition(tank) {
  const radians = (tank.angle * Math.PI) / 180;
  return {
    x: tank.x + Math.cos(radians) * WORLD.barrelLength,
    y: tank.y - 12 - Math.sin(radians) * WORLD.barrelLength,
  };
}

function fire() {
  if (projectile || gameOver) return;
  const tank = activePlayer();
  const muzzle = muzzlePosition(tank);
  const radians = (tank.angle * Math.PI) / 180;
  const speed = tank.power * 0.18;

  projectile = {
    x: muzzle.x,
    y: muzzle.y,
    vx: Math.cos(radians) * speed,
    vy: -Math.sin(radians) * speed,
    trail: [],
    owner: tank.id,
  };

  updateHud(`${tank.name} feuert`);
}

function nextTurn(message) {
  activeTank = activeTank === 0 ? 1 : 0;
  newWind();
  updateHud(message || `${activePlayer().name} ist dran`);
}

function carveTerrain(cx, cy, radius) {
  for (let i = 0; i < terrain.length; i += 1) {
    const x = i * WORLD.terrainStep;
    const dx = x - cx;
    if (Math.abs(dx) > radius) continue;

    const craterDepth = Math.sqrt(radius * radius - dx * dx);
    const targetY = cy + craterDepth;
    if (terrain[i] < targetY) {
      terrain[i] = clamp(targetY, 0, WORLD.height + 40);
    }
  }

  for (let pass = 0; pass < 2; pass += 1) {
    for (let i = 1; i < terrain.length - 1; i += 1) {
      terrain[i] = terrain[i] * 0.68 + (terrain[i - 1] + terrain[i + 1]) * 0.16;
    }
  }

  rebuildTankPositions();
}

function spawnExplosion(x, y, radius) {
  explosions.push({
    x,
    y,
    radius,
    life: 1,
  });

  for (let i = 0; i < 34; i += 1) {
    const angle = randomBetween(0, Math.PI * 2);
    const speed = randomBetween(1.2, 5.5);
    debris.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - randomBetween(0.4, 2.8),
      life: randomBetween(0.45, 0.95),
      color: Math.random() > 0.45 ? "#f6bd60" : "#f28482",
      size: randomBetween(2, 5),
    });
  }
}

function damageTanks(x, y, radius) {
  let hitMessage = "";

  tanks.forEach((tank) => {
    if (tank.hp <= 0) return;
    const dx = tank.x - x;
    const dy = tank.y - y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance > radius + WORLD.tankRadius) return;

    const damage = clamp(Math.round((1 - distance / (radius + WORLD.tankRadius)) * 58), 8, 58);
    tank.hp = clamp(tank.hp - damage, 0, 100);
    hitMessage = `${tank.name} verliert ${damage} HP`;
  });

  const loser = tanks.find((tank) => tank.hp <= 0);
  if (loser) {
    const winner = tanks.find((tank) => tank.hp > 0);
    gameOver = true;
    updateHud(winner ? `${winner.name} gewinnt! R für Neustart` : "Unentschieden! R für Neustart");
    return true;
  }

  return hitMessage;
}

function explodeProjectile(x, y) {
  const radius = 52;
  projectile = null;
  spawnExplosion(x, y, radius);
  carveTerrain(x, y, radius);
  const hitMessage = damageTanks(x, y, radius);

  if (!gameOver) {
    const message = hitMessage || "Knapp daneben";
    setTimeout(() => {
      if (!gameOver && !projectile) {
        nextTurn(message);
      }
    }, 650);
  }
}

function updateProjectile(dt) {
  if (!projectile) return;

  projectile.vx += wind * dt;
  projectile.vy += WORLD.gravity * dt;
  projectile.x += projectile.vx * dt;
  projectile.y += projectile.vy * dt;
  projectile.trail.push({ x: projectile.x, y: projectile.y });

  if (projectile.trail.length > 34) {
    projectile.trail.shift();
  }

  if (projectile.x < -80 || projectile.x > WORLD.width + 80 || projectile.y > WORLD.height + 80) {
    projectile = null;
    setTimeout(() => {
      if (!gameOver && !projectile) {
        nextTurn("Schuss im Aus");
      }
    }, 320);
    return;
  }

  if (projectile.y >= terrainHeightAt(projectile.x)) {
    explodeProjectile(projectile.x, terrainHeightAt(projectile.x));
    return;
  }

  for (const tank of tanks) {
    if (tank.id === projectile.owner || tank.hp <= 0) continue;
    const dx = tank.x - projectile.x;
    const dy = tank.y - projectile.y;
    if (Math.sqrt(dx * dx + dy * dy) < WORLD.tankRadius + 7) {
      explodeProjectile(projectile.x, projectile.y);
      return;
    }
  }
}

function updateEffects(dt) {
  clouds.forEach((cloud) => {
    cloud.x += (cloud.speed + wind * 40) * dt * 0.08;
    if (cloud.x > WORLD.width + 120) cloud.x = -120;
    if (cloud.x < -140) cloud.x = WORLD.width + 120;
  });

  explosions = explosions.filter((explosion) => {
    explosion.life -= 0.035 * dt;
    return explosion.life > 0;
  });

  debris = debris.filter((piece) => {
    piece.vy += WORLD.gravity * dt * 0.45;
    piece.x += piece.vx * dt;
    piece.y += piece.vy * dt;
    piece.life -= 0.025 * dt;
    return piece.life > 0;
  });

  if (messageTimer > 0) {
    messageTimer -= dt;
  }
}

function drawSky() {
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

  clouds.forEach((cloud) => {
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
  return terrain.map((height, i) => ({
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

function drawTank(tank) {
  if (tank.hp <= 0) return;

  const p = toScreen(tank);
  const scale = worldScale();
  const unit = Math.min(scale.x, scale.y);
  const slope = Math.atan2(terrainSlopeAt(tank.x), 24);
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

  const muzzle = muzzlePosition(tank);
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

  if (tank.id === activeTank && !projectile && !gameOver) {
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

function roundedRect(x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function drawProjectile() {
  if (!projectile) return;

  if (projectile.trail.length > 1) {
    ctx.lineWidth = Math.max(2, canvas.clientHeight / 280);
    ctx.lineCap = "round";

    for (let i = 1; i < projectile.trail.length; i += 1) {
      const a = toScreen(projectile.trail[i - 1]);
      const b = toScreen(projectile.trail[i]);
      ctx.strokeStyle = `rgba(255, 246, 205, ${i / projectile.trail.length / 1.5})`;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  const p = toScreen(projectile);
  ctx.fillStyle = "#181d1a";
  ctx.beginPath();
  ctx.arc(p.x, p.y, Math.max(4, canvas.clientHeight / 130), 0, Math.PI * 2);
  ctx.fill();
}

function drawEffects() {
  const unit = Math.min(worldScale().x, worldScale().y);

  explosions.forEach((explosion) => {
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

  debris.forEach((piece) => {
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
  const length = wind * 2200 * scale.x;
  const arrow = Math.sign(wind);

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
  tanks.forEach(drawTank);
  drawProjectile();
  drawEffects();
}

function step(now) {
  const dt = clamp((now - lastTime) / 16.67, 0.1, 2.4);
  lastTime = now;
  updateProjectile(dt);
  updateEffects(dt);
  drawFrame();
  requestAnimationFrame(step);
}

window.addEventListener("keydown", (event) => {
  const key = event.key;

  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(key)) {
    event.preventDefault();
  }

  if (key === "ArrowLeft") rotateAim(activePlayer().id === 0 ? -2 : 2);
  if (key === "ArrowRight") rotateAim(activePlayer().id === 0 ? 2 : -2);
  if (key === "ArrowUp") changePower(2);
  if (key === "ArrowDown") changePower(-2);
  if (key === " ") fire();
  if (key.toLowerCase() === "r") resetGame();
});

window.addEventListener("resize", () => {
  resizeCanvas();
  drawFrame();
});

resizeCanvas();
resetGame();
requestAnimationFrame(step);

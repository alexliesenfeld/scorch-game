(function attachSharedGame(root, factory) {
  const api = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.ScorchShared = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function buildSharedGame() {
  const WORLD = {
    width: 1280,
    height: 720,
    gravity: 0.18,
    tankRadius: 17,
    barrelLength: 34,
    terrainStep: 4,
  };

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const lerp = (a, b, t) => a + (b - a) * t;

  function makeSeed(seed) {
    const value = Number(seed) || Date.now();
    return (Math.floor(value) >>> 0) || 1;
  }

  function random(state) {
    state.rngSeed = (Math.imul(1664525, state.rngSeed) + 1013904223) >>> 0;
    return state.rngSeed / 4294967296;
  }

  function randomBetween(state, min, max) {
    return min + random(state) * (max - min);
  }

  function terrainHeightAt(state, x) {
    if (x <= 0) return state.terrain[0];
    if (x >= WORLD.width) return state.terrain[state.terrain.length - 1];

    const raw = x / WORLD.terrainStep;
    const i = Math.floor(raw);
    const t = raw - i;
    return lerp(state.terrain[i], state.terrain[i + 1], t);
  }

  function terrainSlopeAt(state, x) {
    return terrainHeightAt(state, x + 12) - terrainHeightAt(state, x - 12);
  }

  function rebuildTankPositions(state) {
    state.tanks.forEach((tank) => {
      tank.y = terrainHeightAt(state, tank.x) - WORLD.tankRadius + 2;
    });
  }

  function makeTerrain(state) {
    const count = Math.ceil(WORLD.width / WORLD.terrainStep) + 1;
    const values = [];
    const ridgeA = randomBetween(state, 0.6, 1.2);
    const ridgeB = randomBetween(state, 1.7, 2.4);
    const ridgeC = randomBetween(state, 2.9, 3.6);

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
        color: "#e76f51",
        dark: "#7f3f33",
      },
    ];
  }

  function makeClouds(state) {
    return Array.from({ length: 7 }, (_, i) => ({
      x: randomBetween(state, -80, WORLD.width + 80),
      y: randomBetween(state, 56, 210),
      size: randomBetween(state, 22, 52),
      speed: randomBetween(state, 2, 8) + i * 0.2,
      alpha: randomBetween(state, 0.18, 0.36),
    }));
  }

  function newWind(state) {
    state.wind = Number(randomBetween(state, -0.075, 0.075).toFixed(3));
  }

  function activePlayer(state) {
    return state.tanks[state.activeTank];
  }

  function muzzlePosition(tank) {
    const radians = (tank.angle * Math.PI) / 180;
    return {
      x: tank.x + Math.cos(radians) * WORLD.barrelLength,
      y: tank.y - 12 - Math.sin(radians) * WORLD.barrelLength,
    };
  }

  function createGameState(seed) {
    const state = {
      version: 1,
      rngSeed: makeSeed(seed),
      revision: 0,
      terrain: [],
      tanks: makeTanks(),
      activeTank: 0,
      projectile: null,
      explosions: [],
      debris: [],
      clouds: [],
      wind: 0,
      gameOver: false,
      status: "Spieler 1 ist dran",
      pendingTurnDelay: 0,
      pendingTurnMessage: "",
    };

    state.terrain = makeTerrain(state);
    rebuildTankPositions(state);
    state.clouds = makeClouds(state);
    newWind(state);
    return state;
  }

  function rotateAim(state, direction) {
    const tank = activePlayer(state);
    const input = direction === "left" ? -1 : direction === "right" ? 1 : 0;
    const amount = input * -2;
    const min = tank.id === 0 ? 2 : 92;
    const max = tank.id === 0 ? 88 : 178;
    tank.angle = clamp(tank.angle + amount, min, max);
  }

  function changePower(state, direction) {
    const tank = activePlayer(state);
    const amount = direction === "up" ? 2 : direction === "down" ? -2 : 0;
    tank.power = clamp(tank.power + amount, 18, 100);
  }

  function fire(state) {
    const tank = activePlayer(state);
    const muzzle = muzzlePosition(tank);
    const radians = (tank.angle * Math.PI) / 180;
    const speed = tank.power * 0.18;

    state.projectile = {
      x: muzzle.x,
      y: muzzle.y,
      vx: Math.cos(radians) * speed,
      vy: -Math.sin(radians) * speed,
      trail: [],
      owner: tank.id,
    };
    state.status = `${tank.name} feuert`;
  }

  function applyAction(state, playerId, action) {
    if (!action || typeof action.type !== "string") {
      return { ok: false, reason: "Invalid action" };
    }

    if (state.gameOver && action.type !== "reset") {
      return { ok: false, reason: "Game is over" };
    }

    if (playerId !== state.activeTank) {
      return { ok: false, reason: "Not your turn" };
    }

    if (state.projectile || state.pendingTurnDelay > 0) {
      return { ok: false, reason: "Shot in progress" };
    }

    if (action.type === "rotate") {
      rotateAim(state, action.direction);
    } else if (action.type === "power") {
      changePower(state, action.direction);
    } else if (action.type === "fire") {
      fire(state);
    } else {
      return { ok: false, reason: "Unknown action" };
    }

    state.revision += 1;
    return { ok: true };
  }

  function nextTurn(state, message) {
    state.activeTank = state.activeTank === 0 ? 1 : 0;
    state.pendingTurnDelay = 0;
    state.pendingTurnMessage = "";
    newWind(state);
    state.status = `${activePlayer(state).name} ist dran - ${message}`;
    state.revision += 1;
  }

  function queueNextTurn(state, message, delay) {
    state.projectile = null;
    state.pendingTurnDelay = delay;
    state.pendingTurnMessage = message;
    state.status = message;
    state.revision += 1;
  }

  function carveTerrain(state, cx, cy, radius) {
    for (let i = 0; i < state.terrain.length; i += 1) {
      const x = i * WORLD.terrainStep;
      const dx = x - cx;
      if (Math.abs(dx) > radius) continue;

      const craterDepth = Math.sqrt(radius * radius - dx * dx);
      const targetY = cy + craterDepth;
      if (state.terrain[i] < targetY) {
        state.terrain[i] = clamp(targetY, 0, WORLD.height + 40);
      }
    }

    for (let pass = 0; pass < 2; pass += 1) {
      for (let i = 1; i < state.terrain.length - 1; i += 1) {
        state.terrain[i] = state.terrain[i] * 0.68 + (state.terrain[i - 1] + state.terrain[i + 1]) * 0.16;
      }
    }

    rebuildTankPositions(state);
  }

  function spawnExplosion(state, x, y, radius) {
    state.explosions.push({
      x,
      y,
      radius,
      life: 1,
    });

    for (let i = 0; i < 34; i += 1) {
      const angle = randomBetween(state, 0, Math.PI * 2);
      const speed = randomBetween(state, 1.2, 5.5);
      state.debris.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - randomBetween(state, 0.4, 2.8),
        life: randomBetween(state, 0.45, 0.95),
        color: random(state) > 0.45 ? "#f6bd60" : "#f28482",
        size: randomBetween(state, 2, 5),
      });
    }
  }

  function damageTanks(state, x, y, radius) {
    let hitMessage = "";

    state.tanks.forEach((tank) => {
      if (tank.hp <= 0) return;
      const dx = tank.x - x;
      const dy = tank.y - y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > radius + WORLD.tankRadius) return;

      const damage = clamp(Math.round((1 - distance / (radius + WORLD.tankRadius)) * 58), 8, 58);
      tank.hp = clamp(tank.hp - damage, 0, 100);
      hitMessage = `${tank.name} verliert ${damage} HP`;
    });

    const loser = state.tanks.find((tank) => tank.hp <= 0);
    if (loser) {
      const winner = state.tanks.find((tank) => tank.hp > 0);
      state.gameOver = true;
      state.projectile = null;
      state.pendingTurnDelay = 0;
      state.status = winner ? `${winner.name} gewinnt! R fur Neustart` : "Unentschieden! R fur Neustart";
      state.revision += 1;
      return true;
    }

    return hitMessage;
  }

  function explodeProjectile(state, x, y) {
    const radius = 52;
    state.projectile = null;
    spawnExplosion(state, x, y, radius);
    carveTerrain(state, x, y, radius);
    const hitMessage = damageTanks(state, x, y, radius);

    if (!state.gameOver) {
      queueNextTurn(state, hitMessage || "Knapp daneben", 39);
    }
  }

  function updateProjectile(state, dt) {
    if (!state.projectile) return;

    const shot = state.projectile;
    shot.vx += state.wind * dt;
    shot.vy += WORLD.gravity * dt;
    shot.x += shot.vx * dt;
    shot.y += shot.vy * dt;
    shot.trail.push({ x: shot.x, y: shot.y });

    if (shot.trail.length > 34) {
      shot.trail.shift();
    }

    if (shot.x < -80 || shot.x > WORLD.width + 80 || shot.y > WORLD.height + 80) {
      queueNextTurn(state, "Schuss im Aus", 19);
      return;
    }

    if (shot.y >= terrainHeightAt(state, shot.x)) {
      explodeProjectile(state, shot.x, terrainHeightAt(state, shot.x));
      return;
    }

    for (const tank of state.tanks) {
      if (tank.id === shot.owner || tank.hp <= 0) continue;
      const dx = tank.x - shot.x;
      const dy = tank.y - shot.y;
      if (Math.sqrt(dx * dx + dy * dy) < WORLD.tankRadius + 7) {
        explodeProjectile(state, shot.x, shot.y);
        return;
      }
    }
  }

  function updateEffects(state, dt) {
    state.clouds.forEach((cloud) => {
      cloud.x += (cloud.speed + state.wind * 40) * dt * 0.08;
      if (cloud.x > WORLD.width + 120) cloud.x = -120;
      if (cloud.x < -140) cloud.x = WORLD.width + 120;
    });

    state.explosions = state.explosions.filter((explosion) => {
      explosion.life -= 0.035 * dt;
      return explosion.life > 0;
    });

    state.debris = state.debris.filter((piece) => {
      piece.vy += WORLD.gravity * dt * 0.45;
      piece.x += piece.vx * dt;
      piece.y += piece.vy * dt;
      piece.life -= 0.025 * dt;
      return piece.life > 0;
    });
  }

  function tick(state, dt) {
    updateProjectile(state, dt);
    updateEffects(state, dt);

    if (!state.projectile && !state.gameOver && state.pendingTurnDelay > 0) {
      state.pendingTurnDelay -= dt;
      if (state.pendingTurnDelay <= 0) {
        nextTurn(state, state.pendingTurnMessage || "Weiter");
      }
    }
  }

  function publicState(state) {
    return {
      version: state.version,
      revision: state.revision,
      terrain: state.terrain,
      tanks: state.tanks,
      activeTank: state.activeTank,
      projectile: state.projectile,
      explosions: state.explosions,
      debris: state.debris,
      clouds: state.clouds,
      wind: state.wind,
      gameOver: state.gameOver,
      status: state.status,
      pendingTurnDelay: state.pendingTurnDelay,
    };
  }

  return {
    WORLD,
    activePlayer,
    applyAction,
    clamp,
    createGameState,
    muzzlePosition,
    publicState,
    terrainHeightAt,
    terrainSlopeAt,
    tick,
  };
});

(() => {
  "use strict";

  const canvas = document.querySelector("#game");
  const ctx = canvas.getContext("2d", { alpha: false });
  const panel = document.querySelector("#panel");
  const startButton = document.querySelector("#start");
  const healthEl = document.querySelector("#health");
  const healthFillEl = document.querySelector("#health-fill");
  const contractEl = document.querySelector("#contract");
  const rankEl = document.querySelector("#rank");
  const rankLineEl = document.querySelector("#rank-line");
  const passiveLineEl = document.querySelector("#passive-line");
  const faceEl = document.querySelector("#face");

  const VIEW_W = 320;
  const VIEW_H = 180;
  const SCALE = 3;
  const FOV = Math.PI / 3.15;
  const RAY_STEP = 2;
  const MAX_DEPTH = 18;
  const TILE = 1;
  const TWO_PI = Math.PI * 2;
  const THROW_SPEED = 9;
  const THROW_RANGE = 12;

  canvas.width = VIEW_W * SCALE;
  canvas.height = VIEW_H * SCALE;
  ctx.imageSmoothingEnabled = false;

  const buffer = document.createElement("canvas");
  buffer.width = VIEW_W;
  buffer.height = VIEW_H;
  const btx = buffer.getContext("2d", { alpha: false });
  btx.imageSmoothingEnabled = false;

  const mapRows = [
    "1111111111111111111",
    "1000000010000000001",
    "1022220010111110101",
    "1000000010100010101",
    "1011111110101010101",
    "1010000000101010001",
    "1010111111101011101",
    "1010100000001000101",
    "1000101111111110101",
    "1110101000000010101",
    "1000101011111010101",
    "1011101010001010001",
    "1000000010101011111",
    "1011111110101000001",
    "1010000000101111101",
    "1010111110100000101",
    "1000000010001110101",
    "1000000000000010001",
    "1111111111111111111",
  ];

  const world = mapRows.map((row) => row.split("").map(Number));
  const mapH = world.length;
  const mapW = world[0].length;
  const zBuffer = new Float32Array(VIEW_W);

  const player = {
    x: 2.45,
    y: 1.75,
    angle: 0.08,
    health: 100,
    rank: "S",
    attackTimer: 0,
    throwTimer: 0,
    hurtTimer: 0,
    healTimer: 0,
    facePulse: 0,
    bob: 0,
    dashTimer: 0,
    kills: 0,
  };

  const thrownWeapon = {
    active: false,
    x: 0,
    y: 0,
    dx: 0,
    dy: 0,
    travelled: 0,
  };

  const enemies = [
    makeEnemy(7.6, 1.8, "Crimson Needle"),
    makeEnemy(13.5, 1.7, "Silent Fan"),
    makeEnemy(16.4, 5.6, "Wire Ghost"),
    makeEnemy(3.5, 7.5, "Mask Duelist"),
    makeEnemy(7.5, 8.3, "Midnight Rook"),
    makeEnemy(13.4, 10.4, "Poison Clerk"),
  ];

  const pickups = [
    { x: 6.5, y: 5.5, type: "medkit", active: true },
    { x: 15.4, y: 8.5, type: "medkit", active: true },
    { x: 5.5, y: 13.5, type: "medkit", active: true },
    { x: 11.5, y: 17.5, type: "medkit", active: true },
  ];

  const keys = new Set();
  const messages = [];
  const pointer = {
    dragging: false,
    id: null,
    lastX: 0,
  };
  let running = false;
  let won = false;
  let lastTime = performance.now();
  let audio;

  function makeEnemy(x, y, name) {
    return {
      x,
      y,
      name,
      hp: 3,
      maxHp: 3,
      alive: true,
      hurt: 0,
      cooldown: 0,
      phase: Math.random() * TWO_PI,
      alert: false,
    };
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function normalizeAngle(angle) {
    while (angle < -Math.PI) angle += TWO_PI;
    while (angle > Math.PI) angle -= TWO_PI;
    return angle;
  }

  function tileAt(x, y) {
    if (x < 0 || y < 0 || x >= mapW || y >= mapH) return 1;
    return world[Math.floor(y)][Math.floor(x)];
  }

  function isWall(x, y) {
    return tileAt(x, y) > 0;
  }

  function canStand(x, y) {
    const r = 0.2;
    return !isWall(x - r, y - r) && !isWall(x + r, y - r) && !isWall(x - r, y + r) && !isWall(x + r, y + r);
  }

  function moveBody(body, dx, dy) {
    if (canStand(body.x + dx, body.y)) body.x += dx;
    if (canStand(body.x, body.y + dy)) body.y += dy;
  }

  function getThornMultiplier() {
    const missingHealth = 100 - player.health;
    return 1 + clamp(missingHealth / 75, 0, 1) * 2;
  }

  function getStrikeDamage() {
    return getThornMultiplier();
  }

  function formatMultiplier(value) {
    return value.toFixed(1);
  }

  function lineOfSight(ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const dist = Math.hypot(dx, dy);
    const steps = Math.ceil(dist / 0.08);

    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (isWall(ax + dx * t, ay + dy * t)) return false;
    }
    return true;
  }

  function initAudio() {
    if (audio) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    audio = new AudioContext();
  }

  function beep(freq, duration, type = "square", gain = 0.045) {
    if (!audio) return;
    const osc = audio.createOscillator();
    const amp = audio.createGain();
    const now = audio.currentTime;

    osc.frequency.setValueAtTime(freq, now);
    osc.type = type;
    amp.gain.setValueAtTime(gain, now);
    amp.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(amp);
    amp.connect(audio.destination);
    osc.start(now);
    osc.stop(now + duration);
  }

  function showMessage(text, ttl = 2.2) {
    messages.unshift({ text, ttl });
    messages.splice(3);
  }

  function requestPointerLockSafe() {
    if (document.pointerLockElement === canvas) return;
    const pointerLock = canvas.requestPointerLock?.();
    if (pointerLock && typeof pointerLock.catch === "function") {
      pointerLock.catch(() => {});
    }
  }

  function startGame(capturePointer = false) {
    initAudio();
    if (audio?.state === "suspended") audio.resume();
    running = true;
    panel.hidden = true;
    canvas.focus();
    if (capturePointer) requestPointerLockSafe();
    showMessage("Contract accepted");
    beep(220, 0.07, "square", 0.035);
    beep(440, 0.09, "triangle", 0.03);
  }

  function restartGame() {
    player.x = 2.45;
    player.y = 1.75;
    player.angle = 0.08;
    player.health = 100;
    player.rank = "S";
    player.attackTimer = 0;
    player.throwTimer = 0;
    player.hurtTimer = 0;
    player.healTimer = 0;
    player.facePulse = 0;
    player.kills = 0;
    player.dashTimer = 0;
    enemies.forEach((enemy) => {
      enemy.hp = enemy.maxHp;
      enemy.alive = true;
      enemy.hurt = 0;
      enemy.cooldown = 0;
      enemy.alert = false;
    });
    pickups.forEach((pickup) => {
      pickup.active = true;
    });
    messages.length = 0;
    won = false;
    running = true;
    panel.hidden = true;
    showMessage("Contract renewed");
  }

  function attack() {
    if (!running || won) {
      if (player.health <= 0 || won) restartGame();
      return;
    }
    if (player.attackTimer > 0 || player.throwTimer > 0) return;

    const forwardX = Math.cos(player.angle);
    const forwardY = Math.sin(player.angle);
    const throwX = player.x + forwardX * 0.6;
    const throwY = player.y + forwardY * 0.6;

    player.attackTimer = 0.34;
    player.throwTimer = 0.9;
    player.facePulse = 0.18;
    beep(150, 0.035, "sawtooth", 0.035);
    beep(520, 0.04, "square", 0.025);

    thrownWeapon.active = true;
    thrownWeapon.x = throwX;
    thrownWeapon.y = throwY;
    thrownWeapon.dx = forwardX * THROW_SPEED;
    thrownWeapon.dy = forwardY * THROW_SPEED;
    thrownWeapon.travelled = 0;

    let best = null;
    let bestDist = Infinity;

    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      const dx = enemy.x - player.x;
      const dy = enemy.y - player.y;
      const dist = Math.hypot(dx, dy);
      const angle = normalizeAngle(Math.atan2(dy, dx) - player.angle);

      if (dist < 1.72 && Math.abs(angle) < 0.42 && lineOfSight(player.x, player.y, enemy.x, enemy.y) && dist < bestDist) {
        best = enemy;
        bestDist = dist;
      }
    }

    if (!best) return;

    const damage = getStrikeDamage();
    best.hp -= damage;
    best.hurt = 0.22;
    best.alert = true;
    showMessage(best.hp <= 0 ? `${best.name} finished` : `${best.name} staggered x${formatMultiplier(getThornMultiplier())}`, 1.45);
    beep(best.hp <= 0 ? 92 : 260, best.hp <= 0 ? 0.14 : 0.07, "sawtooth", 0.05);

    if (best.hp <= 0) {
      best.alive = false;
      player.kills += 1;
      if (player.kills === enemies.length) {
        won = true;
        running = false;
        showMessage("Target has been pruned", 8);
        panel.querySelector("h1").textContent = "Mission Complete";
        panel.querySelector("p").textContent = "Target has been pruned";
        startButton.textContent = "Run Again";
        panel.hidden = false;
      }
    }
  }

  function damagePlayer(amount) {
    if (player.hurtTimer > 0 || player.health <= 0) return;
    player.health = Math.max(0, player.health - amount);
    player.hurtTimer = 0.55;
    player.rank = player.health > 72 ? "S" : player.health > 42 ? "A" : player.health > 18 ? "B" : "C";
    showMessage(`Thorn x${formatMultiplier(getThornMultiplier())}`, 1.2);
    beep(70, 0.12, "sawtooth", 0.055);

    if (player.health <= 0) {
      running = false;
      panel.querySelector("h1").textContent = "Contract Failed";
      panel.querySelector("p").textContent = "Stand up, Thorn Princess";
      startButton.textContent = "Retry";
      panel.hidden = false;
      document.exitPointerLock?.();
    }
  }

  function update(dt) {
    if (player.attackTimer > 0) player.attackTimer -= dt;
    if (player.throwTimer > 0) player.throwTimer -= dt;
    if (player.hurtTimer > 0) player.hurtTimer -= dt;
    if (player.healTimer > 0) player.healTimer -= dt;
    if (player.facePulse > 0) player.facePulse -= dt;
    if (player.dashTimer > 0) player.dashTimer -= dt;

    if (thrownWeapon.active) {
      const moveX = thrownWeapon.dx * dt;
      const moveY = thrownWeapon.dy * dt;
      thrownWeapon.x += moveX;
      thrownWeapon.y += moveY;
      thrownWeapon.travelled += Math.hypot(moveX, moveY);

      if (thrownWeapon.travelled >= THROW_RANGE || isWall(thrownWeapon.x, thrownWeapon.y)) {
        thrownWeapon.active = false;
      } else {
        for (const enemy of enemies) {
          if (!enemy.alive) continue;
          const dist = Math.hypot(enemy.x - thrownWeapon.x, enemy.y - thrownWeapon.y);
          if (dist < 0.35) {
            const damage = getStrikeDamage() * 1.25;
            enemy.hp -= damage;
            enemy.hurt = 0.22;
            enemy.alert = true;
            showMessage(enemy.hp <= 0 ? `${enemy.name} impaled` : `${enemy.name} struck`, 1.45);
            beep(enemy.hp <= 0 ? 92 : 260, enemy.hp <= 0 ? 0.14 : 0.07, "sawtooth", 0.05);
            thrownWeapon.active = false;
            if (enemy.hp <= 0) {
              enemy.alive = false;
              player.kills += 1;
              if (player.kills === enemies.length) {
                won = true;
                running = false;
                showMessage("Target has been pruned", 8);
                panel.querySelector("h1").textContent = "Mission Complete";
                panel.querySelector("p").textContent = "Target has been pruned";
                startButton.textContent = "Run Again";
                panel.hidden = false;
              }
            }
            break;
          }
        }
      }
    }

    for (const message of messages) message.ttl -= dt;
    while (messages.length && messages[messages.length - 1].ttl <= 0) messages.pop();

    if (!running) return;

    const turnSpeed = 2.25;
    const moveSpeed = (keys.has("ShiftLeft") || keys.has("ShiftRight") ? 3.6 : 2.15) * dt;
    let moveX = 0;
    let moveY = 0;

    if (keys.has("ArrowLeft") || keys.has("KeyQ")) player.angle -= turnSpeed * dt;
    if (keys.has("ArrowRight") || keys.has("KeyE")) player.angle += turnSpeed * dt;

    const forward = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
    const strafe = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
    const sin = Math.sin(player.angle);
    const cos = Math.cos(player.angle);

    if (forward || strafe) {
      const len = Math.hypot(forward, strafe) || 1;
      moveX = ((cos * forward - sin * strafe) / len) * moveSpeed;
      moveY = ((sin * forward + cos * strafe) / len) * moveSpeed;
      player.bob += dt * (keys.has("ShiftLeft") || keys.has("ShiftRight") ? 12 : 8);
    } else {
      player.bob += dt * 2;
    }

    moveBody(player, moveX, moveY);
    player.angle = normalizeAngle(player.angle);

    updatePickups();
    updateEnemies(dt);
  }

  function updatePickups() {
    for (const pickup of pickups) {
      if (!pickup.active) continue;
      if (Math.hypot(pickup.x - player.x, pickup.y - player.y) > 0.55) continue;

      pickup.active = false;
        if (pickup.type === "medkit") {
        player.health = Math.min(100, player.health + 32);
        player.healTimer = 0.9;
        showMessage("Medkit secured", 1.6);
        beep(760, 0.1, "triangle", 0.045);
      } else {
        enemies.forEach((enemy) => {
          if (enemy.alive && Math.hypot(enemy.x - player.x, enemy.y - player.y) < 4) enemy.alert = true;
        });
        showMessage("Rose signal found", 1.6);
        beep(350, 0.08, "sine", 0.035);
      }
    }
  }

  function updateEnemies(dt) {
    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      if (enemy.hurt > 0) enemy.hurt -= dt;
      if (enemy.cooldown > 0) enemy.cooldown -= dt;

      const dx = player.x - enemy.x;
      const dy = player.y - enemy.y;
      const dist = Math.hypot(dx, dy);
      const seesPlayer = dist < 7.6 && lineOfSight(enemy.x, enemy.y, player.x, player.y);

      if (seesPlayer) enemy.alert = true;
      if (!enemy.alert) {
        enemy.phase += dt;
        const driftX = Math.cos(enemy.phase * 0.7) * 0.3 * dt;
        const driftY = Math.sin(enemy.phase * 0.9) * 0.3 * dt;
        moveBody(enemy, driftX, driftY);
        continue;
      }

      if (dist > 1.02) {
        const speed = (enemy.hurt > 0 ? 0.35 : 0.78) * dt;
        moveBody(enemy, (dx / dist) * speed, (dy / dist) * speed);
      } else if (enemy.cooldown <= 0) {
        enemy.cooldown = 1.2 + Math.random() * 0.55;
        damagePlayer(8);
      }
    }
  }

  function castRay(angle) {
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    let shade = 0;

    for (let depth = 0.02; depth < MAX_DEPTH; depth += 0.025) {
      const x = player.x + cos * depth;
      const y = player.y + sin * depth;
      const tile = tileAt(x, y);

      if (tile > 0) {
        const hitX = x - Math.floor(x);
        const hitY = y - Math.floor(y);
        const edge = Math.min(hitX, hitY, 1 - hitX, 1 - hitY);
        shade = edge < 0.045 ? 0.72 : 1;
        return { depth, tile, shade, x, y };
      }
    }

    return { depth: MAX_DEPTH, tile: 0, shade, x: player.x + cos * MAX_DEPTH, y: player.y + sin * MAX_DEPTH };
  }

  function render() {
    renderWorld();
    renderSprites();
    renderWeapon();
    renderOverlay();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(buffer, 0, 0, canvas.width, canvas.height);
  }

  function renderWorld() {
    const ceiling = btx.createLinearGradient(0, 0, 0, VIEW_H / 2);
    ceiling.addColorStop(0, "#120812");
    ceiling.addColorStop(0.55, "#29121d");
    ceiling.addColorStop(1, "#4b1b25");
    btx.fillStyle = ceiling;
    btx.fillRect(0, 0, VIEW_W, VIEW_H / 2);

    const floor = btx.createLinearGradient(0, VIEW_H / 2, 0, VIEW_H);
    floor.addColorStop(0, "#24191a");
    floor.addColorStop(0.34, "#161313");
    floor.addColorStop(1, "#070607");
    btx.fillStyle = floor;
    btx.fillRect(0, VIEW_H / 2, VIEW_W, VIEW_H / 2);

    drawFloorTiles();

    for (let x = 0; x < VIEW_W; x += RAY_STEP) {
      const cameraX = x / VIEW_W - 0.5;
      const rayAngle = player.angle + cameraX * FOV;
      const hit = castRay(rayAngle);
      const corrected = hit.depth * Math.cos(rayAngle - player.angle);
      const wallH = Math.min(VIEW_H * 2, Math.floor(VIEW_H / corrected));
      const wallTop = Math.floor(VIEW_H / 2 - wallH / 2);
      const wallBottom = wallTop + wallH;
      const fog = clamp(1 - corrected / MAX_DEPTH, 0, 1);
      const color = wallColor(hit.tile, fog * hit.shade, hit.x, hit.y);

      zBuffer[x] = corrected;
      if (x + 1 < VIEW_W) zBuffer[x + 1] = corrected;

      btx.fillStyle = color;
      btx.fillRect(x, wallTop, RAY_STEP, wallH);

      if (hit.tile === 2) {
        btx.fillStyle = `rgba(246, 201, 69, ${0.12 + fog * 0.18})`;
        btx.fillRect(x, wallTop + 4, RAY_STEP, Math.max(1, wallH * 0.05));
      }

      btx.fillStyle = `rgba(0, 0, 0, ${0.3 + (1 - fog) * 0.35})`;
      btx.fillRect(x, wallBottom, RAY_STEP, VIEW_H - wallBottom);
    }
  }

  function drawFloorTiles() {
    for (let y = VIEW_H / 2; y < VIEW_H; y += 5) {
      const shade = (y - VIEW_H / 2) / (VIEW_H / 2);
      btx.fillStyle = `rgba(246, 201, 69, ${0.02 + shade * 0.025})`;
      btx.fillRect(0, y, VIEW_W, 1);
    }

    for (let i = -8; i <= 8; i++) {
      const x = VIEW_W / 2 + i * 28 - ((player.angle * 60) % 28);
      btx.fillStyle = "rgba(255, 231, 169, 0.035)";
      btx.beginPath();
      btx.moveTo(x, VIEW_H / 2);
      btx.lineTo(x - 70, VIEW_H);
      btx.lineTo(x - 67, VIEW_H);
      btx.lineTo(x + 2, VIEW_H / 2);
      btx.fill();
    }
  }

  function wallColor(tile, light, hitX, hitY) {
    const checker = (Math.floor(hitX * 5) + Math.floor(hitY * 5)) % 2;
    const l = clamp(light, 0.08, 1);

    if (tile === 2) {
      const r = Math.floor((92 + checker * 22) * l);
      const g = Math.floor((21 + checker * 12) * l);
      const b = Math.floor((36 + checker * 9) * l);
      return `rgb(${r}, ${g}, ${b})`;
    }

    const r = Math.floor((77 + checker * 25) * l);
    const g = Math.floor((63 + checker * 16) * l);
    const b = Math.floor((55 + checker * 20) * l);
    return `rgb(${r}, ${g}, ${b})`;
  }

  function renderSprites() {
    const sprites = [
      ...pickups.filter((pickup) => pickup.active).map((pickup) => ({ ...pickup, sprite: "pickup" })),
      ...enemies.filter((enemy) => enemy.alive).map((enemy) => ({ ...enemy, sprite: "enemy" })),
    ];

    if (thrownWeapon.active) {
      sprites.push({
        x: thrownWeapon.x,
        y: thrownWeapon.y,
        sprite: "thrown",
        dx: thrownWeapon.dx,
        dy: thrownWeapon.dy,
      });
    }

    sprites.sort((a, b) => distanceTo(b) - distanceTo(a));

    for (const sprite of sprites) {
      const dx = sprite.x - player.x;
      const dy = sprite.y - player.y;
      const dist = Math.hypot(dx, dy);
      const angle = normalizeAngle(Math.atan2(dy, dx) - player.angle);

      if (Math.abs(angle) > FOV * 0.72 || dist < 0.15) continue;

      const screenX = VIEW_W / 2 + Math.tan(angle) * (VIEW_W / FOV);
      const size = clamp((VIEW_H / dist) * (sprite.sprite === "enemy" ? 0.82 : sprite.sprite === "thrown" ? 0.24 : 0.36), 2, 118);
      const x = Math.floor(screenX - size / 2);
      const y = Math.floor(VIEW_H / 2 - size * (sprite.sprite === "enemy" ? 0.55 : sprite.sprite === "thrown" ? 0.2 : 0.08));

      const column = clamp(Math.floor(screenX), 0, VIEW_W - 1);
      if (dist > zBuffer[column] + 0.25) continue;

      if (sprite.sprite === "enemy") {
        drawEnemy(sprite, x, y, size, dist);
      } else if (sprite.sprite === "thrown") {
        drawThrownWeapon(sprite, x, y, size, dist);
      } else {
        drawPickup(sprite, x, y, size);
      }
    }
  }

  function distanceTo(sprite) {
    return Math.hypot(sprite.x - player.x, sprite.y - player.y);
  }

  function drawEnemy(enemy, x, y, size, dist) {
    const hurt = enemy.hurt > 0;
    const alpha = clamp(1.2 - dist / 11, 0.25, 1);
    btx.save();
    btx.globalAlpha = alpha;

    const w = size * 0.56;
    const h = size;
    const cx = x + size / 2;
    const head = size * 0.18;
    const bodyTop = y + size * 0.26;

    btx.fillStyle = "rgba(0, 0, 0, 0.35)";
    btx.fillRect(cx - w * 0.58, y + h * 0.91, w * 1.16, Math.max(2, h * 0.08));

    btx.fillStyle = hurt ? "#ffd8d8" : "#1a1218";
    btx.fillRect(cx - w * 0.3, y + head * 0.25, w * 0.6, head * 0.8);
    btx.fillStyle = hurt ? "#fff2d4" : "#d8b29e";
    btx.fillRect(cx - w * 0.22, y + head * 0.44, w * 0.44, head * 0.42);

    btx.fillStyle = hurt ? "#f4d64e" : "#7d1f30";
    btx.fillRect(cx - w * 0.42, bodyTop, w * 0.84, h * 0.45);
    btx.fillStyle = "#080608";
    btx.fillRect(cx - w * 0.25, bodyTop + h * 0.08, w * 0.5, h * 0.35);

    btx.fillStyle = "#d9dee7";
    btx.fillRect(cx - w * 0.58, bodyTop + h * 0.08, w * 0.16, h * 0.32);
    btx.fillRect(cx + w * 0.42, bodyTop + h * 0.08, w * 0.16, h * 0.32);

    btx.fillStyle = "#c7cbd3";
    btx.fillRect(cx - w * 0.7, bodyTop + h * 0.32, w * 0.35, Math.max(1, h * 0.035));
    btx.fillRect(cx + w * 0.35, bodyTop + h * 0.32, w * 0.35, Math.max(1, h * 0.035));

    const hpW = w * (enemy.hp / enemy.maxHp);
    btx.fillStyle = "#16090a";
    btx.fillRect(cx - w * 0.46, y - 5, w * 0.92, 3);
    btx.fillStyle = hurt ? "#fff1a8" : "#c52d3a";
    btx.fillRect(cx - w * 0.46, y - 5, hpW * 0.92, 3);

    btx.restore();
  }

  function drawPickup(pickup, x, y, size) {
    btx.save();
    btx.globalAlpha = 0.9;
    if (pickup.type === "medkit") {
      btx.fillStyle = "#ece4d4";
      btx.fillRect(x, y + size * 0.2, size, size * 0.6);
      btx.fillStyle = "#c52d3a";
      const bar = size * 0.18;
      btx.fillRect(x + size * 0.41, y + size * 0.26, bar, size * 0.48);
      btx.fillRect(x + size * 0.26, y + size * 0.42, size * 0.48, bar);
    } else {
      btx.fillStyle = "#c52d3a";
      btx.fillRect(x + size * 0.28, y + size * 0.1, size * 0.44, size * 0.44);
      btx.fillStyle = "#3c8d58";
      btx.fillRect(x + size * 0.47, y + size * 0.45, size * 0.1, size * 0.46);
      btx.fillStyle = "#f6c945";
      btx.fillRect(x + size * 0.2, y + size * 0.22, size * 0.6, size * 0.08);
    }
    btx.restore();
  }

  function renderWeapon() {
    const bob = Math.sin(player.bob) * 3;
    const attack = Math.max(0, player.attackTimer);
    const thrust = attack > 0 ? Math.sin((1 - attack / 0.34) * Math.PI) : 0;
    const leftX = VIEW_W * 0.34 - thrust * 26;
    const rightX = VIEW_W * 0.66 + thrust * 26;
    const baseY = VIEW_H + 10 + bob - thrust * 34;
    const tipY = VIEW_H * 0.56 - thrust * 22;

    drawStiletto(leftX, baseY, VIEW_W * 0.47 - thrust * 10, tipY, -1, thrust);
    drawStiletto(rightX, baseY, VIEW_W * 0.53 + thrust * 10, tipY, 1, thrust);
  }

  function drawStiletto(baseX, baseY, tipX, tipY, side, thrust) {
    const dx = tipX - baseX;
    const dy = tipY - baseY;
    const len = Math.hypot(dx, dy);
    const nx = -dy / len;
    const ny = dx / len;

    btx.save();
    btx.lineCap = "square";

    btx.strokeStyle = "#6a390b";
    btx.lineWidth = 6;
    btx.beginPath();
    btx.moveTo(baseX, baseY);
    btx.lineTo(tipX, tipY);
    btx.stroke();

    btx.strokeStyle = "#f6c945";
    btx.lineWidth = 3;
    btx.beginPath();
    btx.moveTo(baseX, baseY);
    btx.lineTo(tipX, tipY);
    btx.stroke();

    btx.strokeStyle = "#ffef9b";
    btx.lineWidth = 1;
    btx.beginPath();
    btx.moveTo(baseX + nx * 1.8, baseY + ny * 1.8);
    btx.lineTo(tipX + nx * 0.8, tipY + ny * 0.8);
    btx.stroke();

    const handleX = baseX - dx * 0.28;
    const handleY = baseY - dy * 0.28;
    btx.strokeStyle = "#7c4b0e";
    btx.lineWidth = 12;
    btx.beginPath();
    btx.moveTo(baseX, baseY);
    btx.lineTo(handleX, handleY);
    btx.stroke();

    btx.strokeStyle = "#e2a827";
    btx.lineWidth = 8;
    btx.beginPath();
    btx.moveTo(baseX, baseY);
    btx.lineTo(handleX, handleY);
    btx.stroke();

    btx.strokeStyle = "#ffe184";
    btx.lineWidth = 1;
    for (let i = 0; i < 7; i++) {
      const t = i / 7;
      const x = baseX + (handleX - baseX) * t;
      const y = baseY + (handleY - baseY) * t;
      btx.beginPath();
      btx.moveTo(x - nx * 5, y - ny * 5);
      btx.lineTo(x + nx * 5, y + ny * 5);
      btx.stroke();
    }

    const ringX = handleX - dx * 0.08;
    const ringY = handleY - dy * 0.08;
    btx.strokeStyle = "#7c4b0e";
    btx.lineWidth = 7;
    btx.beginPath();
    btx.ellipse(ringX, ringY, 12 + thrust * 2, 10 + thrust * 2, Math.atan2(dy, dx), 0, TWO_PI);
    btx.stroke();

    btx.strokeStyle = "#f6c945";
    btx.lineWidth = 4;
    btx.beginPath();
    btx.ellipse(ringX, ringY, 10 + thrust * 2, 8 + thrust * 2, Math.atan2(dy, dx), 0, TWO_PI);
    btx.stroke();

    btx.fillStyle = side < 0 ? "rgba(197, 45, 58, 0.16)" : "rgba(246, 201, 69, 0.12)";
    btx.beginPath();
    btx.moveTo(tipX, tipY);
    btx.lineTo(tipX - side * 34 * thrust, tipY + 18 * thrust);
    btx.lineTo(tipX - side * 9 * thrust, tipY + 42 * thrust);
    btx.fill();

    btx.restore();
  }

  function drawThrownWeapon(sprite, x, y, size, dist) {
    const angle = normalizeAngle(Math.atan2(sprite.y - player.y, sprite.x - player.x) - player.angle);
    btx.save();
    btx.translate(x + size / 2, y + size / 2);
    btx.rotate(angle);

    btx.fillStyle = "#f6c945";
    btx.strokeStyle = "#ffffff";
    btx.lineWidth = 1.5;
    btx.beginPath();
    btx.moveTo(-size * 0.4, -size * 0.16);
    btx.lineTo(size * 0.3, 0);
    btx.lineTo(-size * 0.4, size * 0.16);
    btx.closePath();
    btx.fill();
    btx.stroke();

    btx.fillStyle = "rgba(246, 201, 69, 0.8)";
    btx.beginPath();
    btx.arc(-size * 0.25, 0, Math.max(1, size * 0.08), 0, TWO_PI);
    btx.fill();

    btx.restore();
  }

  function renderOverlay() {
    btx.fillStyle = "rgba(0, 0, 0, 0.18)";
    btx.fillRect(0, 0, VIEW_W, 10);

    drawCrosshair();
    drawMinimap();
    drawMessages();

    if (player.healTimer > 0) {
      const alpha = 0.12 + player.healTimer * 0.18;
      btx.fillStyle = `rgba(118, 208, 140, ${alpha})`;
      btx.fillRect(0, 0, VIEW_W, VIEW_H);
    }

    if (player.hurtTimer > 0) {
      btx.fillStyle = `rgba(197, 45, 58, ${0.2 + player.hurtTimer * 0.25})`;
      btx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
  }

  function drawCrosshair() {
    const cx = VIEW_W / 2;
    const cy = VIEW_H / 2;
    btx.fillStyle = "#f6c945";
    btx.fillRect(cx - 1, cy - 7, 2, 5);
    btx.fillRect(cx - 1, cy + 3, 2, 5);
    btx.fillRect(cx - 7, cy - 1, 5, 2);
    btx.fillRect(cx + 3, cy - 1, 5, 2);
    btx.fillStyle = "#5b1c22";
    btx.fillRect(cx - 1, cy - 1, 2, 2);
  }

  function drawMinimap() {
    const scale = 3;
    const ox = 8;
    const oy = 13;

    btx.fillStyle = "rgba(7, 5, 7, 0.76)";
    btx.fillRect(ox - 3, oy - 3, mapW * scale + 6, mapH * scale + 6);

    for (let y = 0; y < mapH; y++) {
      for (let x = 0; x < mapW; x++) {
        if (!world[y][x]) continue;
        btx.fillStyle = world[y][x] === 2 ? "#762333" : "#504646";
        btx.fillRect(ox + x * scale, oy + y * scale, scale, scale);
      }
    }

    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      btx.fillStyle = enemy.alert ? "#c52d3a" : "#79636b";
      btx.fillRect(ox + enemy.x * scale - 1, oy + enemy.y * scale - 1, 2, 2);
    }

    for (const pickup of pickups) {
      if (!pickup.active) continue;
      btx.fillStyle = pickup.type === "medkit" ? "#3c8d58" : "#f6c945";
      btx.fillRect(ox + pickup.x * scale - 1, oy + pickup.y * scale - 1, 3, 3);
    }

    btx.fillStyle = "#f6c945";
    btx.fillRect(ox + player.x * scale - 1, oy + player.y * scale - 1, 3, 3);
  }

  function drawMessages() {
    btx.textAlign = "center";
    btx.font = "8px monospace";
    messages.forEach((message, index) => {
      const alpha = clamp(message.ttl, 0, 1);
      btx.fillStyle = `rgba(8, 5, 7, ${0.48 * alpha})`;
      btx.fillRect(VIEW_W / 2 - 60, 18 + index * 10, 120, 9);
      btx.fillStyle = `rgba(246, 201, 69, ${alpha})`;
      btx.fillText(message.text.toUpperCase(), VIEW_W / 2, 25 + index * 10);
    });
  }

  function syncHud() {
    const multiplier = getThornMultiplier();
    healthEl.textContent = String(player.health);
    healthFillEl.style.width = `${player.health}%`;
    healthFillEl.style.background =
      player.health > 55
        ? "repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.18) 0 2px, transparent 2px 8px), linear-gradient(90deg, #3c8d58, #f6c945)"
        : player.health > 25
          ? "repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.18) 0 2px, transparent 2px 8px), linear-gradient(90deg, #d58b2a, #f6c945)"
          : "repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.18) 0 2px, transparent 2px 8px), linear-gradient(90deg, #7d1f30, #c52d3a)";
    contractEl.textContent = `${player.kills}/${enemies.length}`;
    rankEl.textContent = player.rank;
    rankLineEl.textContent = `Rank ${player.rank}`;
    passiveLineEl.textContent = `Thorn x${formatMultiplier(multiplier)}`;
    faceEl.dataset.mood =
      player.health <= 0 ? "dead" : player.healTimer > 0 ? "heal" : player.hurtTimer > 0 ? "hurt" : player.health < 28 ? "low" : player.health < 58 ? "wary" : "ok";
    faceEl.classList.toggle("is-striking", player.facePulse > 0 && player.health > 0);
    faceEl.classList.toggle("is-healing", player.healTimer > 0 && player.health > 0);
  }

  function loop(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    update(dt);
    render();
    syncHud();
    requestAnimationFrame(loop);
  }

  startButton.addEventListener("click", () => {
    if (player.health <= 0 || won) restartGame();
    else startGame();
  });

  window.addEventListener("keydown", (event) => {
    keys.add(event.code);
    if (event.code === "Space") {
      event.preventDefault();
      attack();
    }
    if (event.code === "Enter" && !running) {
      event.preventDefault();
      if (player.health <= 0 || won) restartGame();
      else startGame();
    }
  });

  window.addEventListener("keyup", (event) => {
    keys.delete(event.code);
  });

  canvas.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    canvas.focus();

    if (!running) {
      startGame(true);
      return;
    }

    pointer.dragging = true;
    pointer.id = event.pointerId;
    pointer.lastX = event.clientX;
    canvas.setPointerCapture?.(event.pointerId);
    requestPointerLockSafe();
    attack();
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!running) return;

    if (document.pointerLockElement === canvas) {
      player.angle = normalizeAngle(player.angle + event.movementX * 0.0028);
      return;
    }

    if (!pointer.dragging || pointer.id !== event.pointerId) return;
    const dx = event.clientX - pointer.lastX;
    pointer.lastX = event.clientX;
    player.angle = normalizeAngle(player.angle + dx * 0.008);
  });

  canvas.addEventListener("pointerup", (event) => {
    if (pointer.id === event.pointerId) {
      pointer.dragging = false;
      pointer.id = null;
      canvas.releasePointerCapture?.(event.pointerId);
    }
  });

  canvas.addEventListener("pointercancel", (event) => {
    if (pointer.id === event.pointerId) {
      pointer.dragging = false;
      pointer.id = null;
    }
  });

  window.addEventListener("blur", () => {
    keys.clear();
  });

  render();
  syncHud();
  requestAnimationFrame(loop);
})();

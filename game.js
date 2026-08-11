"use strict";

/* =========================================================================
   STICK DUEL — Strichmännchen-Fechtduell im Nidhogg-Stil
   Zwei Spieler, ein Treffer entscheidet, Tauziehen über mehrere Bildschirme.
   ========================================================================= */

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// ---- Weltmaße --------------------------------------------------------------
const VIEW_W = 960;
const VIEW_H = 540;
const NUM_SCREENS = 5;
const WORLD_W = VIEW_W * NUM_SCREENS;
const GROUND_Y = 470;                 // Fußlinie (Boden)

// ---- Physik ----------------------------------------------------------------
const GRAVITY = 0.7;
const MOVE_SPEED = 3.4;
const CROUCH_SPEED = 1.4;
const JUMP_V = -13.2;

// ---- Fecht-Konstanten ------------------------------------------------------
const HIGH = 0, MID = 1, LOW = 2;
const STANCE_OFFSET = { [HIGH]: 50, [MID]: 34, [LOW]: 16 }; // Klingenhöhe über Füßen
const HOLD_LEN = 40;       // Länge der gehaltenen Klinge (Block)
const STAB_REACH = 66;     // Reichweite der Klingenspitze beim Stich
const HALF_W = 11;         // halbe Körperbreite (stehend)
const HALF_W_CROUCH = 13;
const STAB_ACTIVE = 9;     // Frames aktiver Stich
const STAB_COOLDOWN = 20;  // Frames Erholung
const CLASH_STUN = 16;     // Frames Betäubung nach Klingenkreuzen
const RESPAWN_DELAY = 55;  // Frames bis Wiedereinstieg
const INVULN = 34;         // Frames Unverwundbarkeit nach Respawn
const RESPAWN_AHEAD = VIEW_W * 0.72;

// ---- Eingabe ---------------------------------------------------------------
const keys = new Set();
window.addEventListener("keydown", (e) => {
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Slash"].includes(e.code)) e.preventDefault();
  keys.add(e.code);
  if (state === "won" && (e.code === "Enter" || e.code === "NumpadEnter")) toMenu();
});
window.addEventListener("keyup", (e) => keys.delete(e.code));

const P1_KEYS = {
  left: ["KeyA"], right: ["KeyD"], up: ["KeyW"], down: ["KeyS"],
  jump: ["Space"], attack: ["KeyF"], throw: ["KeyG"],
};
const P2_KEYS = {
  left: ["ArrowLeft"], right: ["ArrowRight"], up: ["ArrowUp"], down: ["ArrowDown"],
  jump: ["ShiftRight", "Numpad0"], attack: ["Period", "Numpad2"], throw: ["Slash", "Numpad1"],
};
const held = (arr) => arr.some((k) => keys.has(k));

// ---- kleine Audio-Effekte (WebAudio, keine Dateien) ------------------------
let audioCtx = null;
function beep(freq, dur, type = "square", vol = 0.06) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.value = vol;
    o.connect(g); g.connect(audioCtx.destination);
    const t = audioCtx.currentTime;
    o.start(t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.stop(t + dur);
  } catch (_) { /* Audio optional */ }
}
const sndClash = () => { beep(880, 0.09, "square", 0.05); beep(1200, 0.06, "square", 0.03); };
const sndKill = () => { beep(160, 0.18, "sawtooth", 0.08); };
const sndThrow = () => beep(500, 0.08, "triangle", 0.05);
const sndJump = () => beep(360, 0.07, "sine", 0.04);

// ---- Spieler ---------------------------------------------------------------
function makeFighter(isP1, isCPU) {
  return {
    isP1, isCPU: !!isCPU,
    keymap: isP1 ? P1_KEYS : P2_KEYS,
    color: isP1 ? "#63b3ff" : "#ff7a7a",
    goalDir: isP1 ? 1 : -1,          // Richtung zum eigenen Ziel
    x: 0, y: GROUND_Y, vx: 0, vy: 0,
    facing: isP1 ? 1 : -1,
    onGround: true,
    stance: MID,
    crouch: false,
    hasSword: true,
    alive: true,
    respawnTimer: 0,
    invuln: 0,
    attackTimer: 0,
    attackCooldown: 0,
    stun: 0,
    walk: 0,                          // Laufanimations-Phase
    // gemerkter „Attacke gedrückt"-Zustand für Flankensteuerung
    prevAttack: false,
    prevThrow: false,
    prevJump: false,
    // KI-Zustand
    ai: { reactTimer: 0, wantJump: false },
  };
}

let P1, P2, swords, advantage, state, winner, cpuMode;

function resetMatch(cpu) {
  cpuMode = cpu;
  P1 = makeFighter(true, false);
  P2 = makeFighter(false, cpu);
  const cx = VIEW_W * 2 + VIEW_W / 2;      // Mitte des Mittelbildschirms
  P1.x = cx - 80; P1.facing = 1;
  P2.x = cx + 80; P2.facing = -1;
  swords = [];
  advantage = null;   // Momentum: null | P1 | P2
  winner = null;
  state = "playing";
}

// ---- Geometrie-Helfer ------------------------------------------------------
function swordY(p) { return p.y - STANCE_OFFSET[p.stance]; }
function hurtTop(p) { return p.crouch ? p.y - 36 : p.y - 58; }
function hurtBottom(p) { return p.y - 2; }
function hurtHalf(p) { return p.crouch ? HALF_W_CROUCH : HALF_W; }

function pointInHurt(px, py, p) {
  return px >= p.x - hurtHalf(p) && px <= p.x + hurtHalf(p) &&
         py >= hurtTop(p) && py <= hurtBottom(p);
}

// Blockt Verteidiger d einen Stich von Angreifer a auf Höhe ay?
function guardsAgainst(d, a, ay) {
  if (!d.hasSword) return false;
  if (d.facing !== -a.facing) return false;          // muss zugewandt sein
  if (Math.abs(swordY(d) - ay) > 9) return false;    // gleiche Höhe
  // x-Überlappung der Klingen
  const aMin = Math.min(a.x, a.x + a.facing * STAB_REACH);
  const aMax = Math.max(a.x, a.x + a.facing * STAB_REACH);
  const dMin = Math.min(d.x, d.x + d.facing * HOLD_LEN);
  const dMax = Math.max(d.x, d.x + d.facing * HOLD_LEN);
  return aMax >= dMin && dMax >= aMin;
}

// ---- Kill / Respawn --------------------------------------------------------
function killFighter(dead, killer) {
  if (!dead.alive || dead.invuln > 0) return;
  dead.alive = false;
  dead.respawnTimer = RESPAWN_DELAY;
  dead.vx = 0; dead.vy = 0;
  sndKill();
  spawnBlood(dead.x, dead.y - 30);
  if (killer) advantage = killer;      // Momentum an den Killer
}

function respawn(dead) {
  const holder = advantage || (dead.isP1 ? P2 : P1);
  // Toter erscheint vor dem Momentum-Halter in dessen Zielrichtung
  let x = holder.x + holder.goalDir * RESPAWN_AHEAD;
  x = Math.max(60, Math.min(WORLD_W - 60, x));
  dead.x = x;
  dead.y = GROUND_Y;
  dead.vx = 0; dead.vy = 0;
  dead.onGround = true;
  dead.alive = true;
  dead.hasSword = true;
  dead.stance = MID;
  dead.crouch = false;
  dead.attackTimer = 0; dead.attackCooldown = 0; dead.stun = 0;
  dead.invuln = INVULN;
  dead.facing = -holder.goalDir;   // zum Halter gewandt
}

// ---- Blut-Partikel (rein kosmetisch) --------------------------------------
let particles = [];
function spawnBlood(x, y) {
  for (let i = 0; i < 16; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 1 + Math.random() * 5;
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 2, life: 30 + Math.random() * 20 });
  }
}
function updateParticles() {
  for (const p of particles) { p.x += p.vx; p.y += p.vy; p.vy += 0.4; p.life--; }
  particles = particles.filter((p) => p.life > 0 && p.y < GROUND_Y + 20);
}

// ---- Eingaben eines Kämpfers auslesen -------------------------------------
function readInput(p) {
  if (p.isCPU) return aiInput(p);
  const k = p.keymap;
  return {
    left: held(k.left), right: held(k.right),
    up: held(k.up), down: held(k.down),
    jump: held(k.jump), attack: held(k.attack), throw: held(k.throw),
  };
}

// ---- Kämpfer-Update --------------------------------------------------------
function updateFighter(p, foe) {
  if (!p.alive) {
    if (--p.respawnTimer <= 0) respawn(p);
    return;
  }
  if (p.invuln > 0) p.invuln--;
  if (p.stun > 0) { p.stun--; }

  const inp = readInput(p);

  // Haltung / Ducken
  p.crouch = inp.down && p.onGround;
  if (inp.up) p.stance = HIGH;
  else if (inp.down) p.stance = LOW;
  else p.stance = MID;

  // Bewegung
  const canAct = p.stun <= 0;
  if (canAct) {
    let speed = p.crouch ? CROUCH_SPEED : MOVE_SPEED;
    if (p.attackTimer > 0) speed *= 0.5;
    if (inp.left && !inp.right) { p.vx = -speed; p.facing = -1; }
    else if (inp.right && !inp.left) { p.vx = speed; p.facing = 1; }
    else p.vx = 0;

    // Springen
    if (inp.jump && !p.prevJump && p.onGround && !p.crouch) {
      p.vy = JUMP_V; p.onGround = false; sndJump();
    }
  } else {
    // im Stun: kein aktives Bremsen, Trägheit ausklingen lassen
    p.vx *= 0.9;
  }

  // Angriff (Flanke)
  if (canAct && inp.attack && !p.prevAttack && p.attackCooldown <= 0 && p.hasSword) {
    p.attackTimer = STAB_ACTIVE;
    p.attackCooldown = STAB_ACTIVE + STAB_COOLDOWN;
    p.vx += p.facing * 2.2;   // kleiner Ausfallschritt
  }
  // Werfen (Flanke)
  if (canAct && inp.throw && !p.prevThrow && p.hasSword && p.attackTimer <= 0) {
    throwSword(p);
  }

  p.prevAttack = inp.attack;
  p.prevThrow = inp.throw;
  p.prevJump = inp.jump;

  if (p.attackTimer > 0) p.attackTimer--;
  if (p.attackCooldown > 0) p.attackCooldown--;

  // Schwerkraft
  p.vy += GRAVITY;
  p.x += p.vx;
  p.y += p.vy;

  if (p.y >= GROUND_Y) { p.y = GROUND_Y; p.vy = 0; p.onGround = true; }
  else p.onGround = false;

  // Weltgrenzen
  p.x = Math.max(24, Math.min(WORLD_W - 24, p.x));

  // Laufanimation
  if (Math.abs(p.vx) > 0.4 && p.onGround) p.walk += 0.35;
  else p.walk *= 0.8;

  // Waffe vom Boden aufheben
  if (!p.hasSword) {
    for (const s of swords) {
      if (!s.flying && Math.abs(s.x - p.x) < 22 && p.onGround) {
        p.hasSword = true;
        s.dead = true;
        beep(700, 0.06, "triangle", 0.05);
        break;
      }
    }
  }
}

// ---- Stich-Trefferprüfung --------------------------------------------------
function resolveStabs(a, d) {
  if (a.attackTimer <= 0 || !a.alive || !a.hasSword) return;
  if (!d.alive || d.invuln > 0) return;
  const tipX = a.x + a.facing * STAB_REACH;
  const tipY = swordY(a);
  // Muss in Blickrichtung liegen
  if (Math.sign(d.x - a.x) !== a.facing && Math.abs(d.x - a.x) > 6) return;
  if (!pointInHurt(tipX, tipY, d)) return;

  if (guardsAgainst(d, a, tipY)) {
    // Klingen kreuzen sich → Rückstoß + Betäubung
    if (a.stun <= 0 && d.stun <= 0) {
      a.stun = CLASH_STUN; d.stun = CLASH_STUN;
      a.vx = -a.facing * 5; d.vx = -d.facing * 5;
      a.attackTimer = 0; d.attackTimer = 0;
      sndClash();
      for (let i = 0; i < 6; i++)
        particles.push({ x: (a.x + d.x) / 2, y: tipY, vx: (Math.random() - 0.5) * 6, vy: -Math.random() * 4, life: 18, spark: true });
    }
  } else {
    killFighter(d, a);
  }
}

// ---- Degen werfen ----------------------------------------------------------
function throwSword(p) {
  p.hasSword = false;
  swords.push({
    x: p.x + p.facing * 18,
    y: swordY(p),
    vx: p.facing * 13,
    vy: -0.5,
    rot: 0,
    facing: p.facing,
    flying: true,
    ignore: p,        // Werfer kann sich nicht sofort selbst treffen
    ignoreTimer: 6,
    dead: false,
  });
  sndThrow();
}

function updateSwords() {
  for (const s of swords) {
    if (s.flying) {
      s.x += s.vx;
      s.y += s.vy;
      s.vy += 0.12;              // leichte Schwerkraft
      s.rot += 0.5 * Math.sign(s.vx || 1);
      if (s.ignoreTimer > 0) s.ignoreTimer--;

      // Trefferprüfung gegen beide Kämpfer
      for (const f of [P1, P2]) {
        if (f === s.ignore && s.ignoreTimer > 0) continue;
        if (!f.alive || f.invuln > 0) continue;
        if (pointInHurt(s.x, s.y, f)) {
          // Block: bewaffnet, zugewandt, gleiche Höhe → abgewehrt
          const blocks = f.hasSword && f.facing === -Math.sign(s.vx) && Math.abs(swordY(f) - s.y) < 12;
          if (blocks) {
            s.flying = false; s.vx = 0; s.vy = 0; s.y = GROUND_Y - 4;
            sndClash();
          } else {
            killFighter(f, s.ignore && s.ignore.alive ? s.ignore : null);
            s.flying = false; s.vx = 0; s.vy = 0; s.y = GROUND_Y - 4;
          }
          break;
        }
      }
      // Landen
      if (s.flying && (s.y >= GROUND_Y - 4 || s.x <= 20 || s.x >= WORLD_W - 20)) {
        s.flying = false; s.vx = 0; s.vy = 0;
        s.y = GROUND_Y - 4;
        s.x = Math.max(20, Math.min(WORLD_W - 20, s.x));
      }
    }
  }
  swords = swords.filter((s) => !s.dead);
}

// ---- Sieg prüfen -----------------------------------------------------------
function checkWin() {
  if (!advantage) return;
  if (advantage === P1 && P1.alive && P1.x >= WORLD_W - 30) win(P1);
  else if (advantage === P2 && P2.alive && P2.x <= 30) win(P2);
}
function win(p) {
  winner = p;
  state = "won";
  document.getElementById("win-title").innerHTML =
    (p.isP1 ? "Spieler&nbsp;1" : (cpuMode ? "CPU" : "Spieler&nbsp;2")) + " gewinnt!";
  document.getElementById("winscreen").classList.remove("hidden");
}

// ---- Kamera ----------------------------------------------------------------
let camX = 0;
function updateCamera() {
  const mid = (P1.x + P2.x) / 2;
  let target = mid - VIEW_W / 2;
  target = Math.max(0, Math.min(WORLD_W - VIEW_W, target));
  camX += (target - camX) * 0.12;
}

/* =========================================================================
   SEHR EINFACHE KI für Spieler 2
   ========================================================================= */
function aiInput(p) {
  const foe = P1;
  const out = { left: false, right: false, up: false, down: false, jump: false, attack: false, throw: false };
  if (!foe.alive) { return out; }
  const dx = foe.x - p.x;
  const dist = Math.abs(dx);
  const dir = Math.sign(dx) || -1;

  // Waffe suchen, wenn unbewaffnet
  if (!p.hasSword) {
    let nearest = null, nd = 1e9;
    for (const s of swords) if (!s.flying) { const d = Math.abs(s.x - p.x); if (d < nd) { nd = d; nearest = s; } }
    if (nearest) { if (nearest.x < p.x - 6) out.left = true; else if (nearest.x > p.x + 6) out.right = true; }
    else { if (dir < 0) out.left = true; else out.right = true; } // sonst wegrennen Richtung Ziel
    return out;
  }

  // Fliegenden Degen ausweichen
  for (const s of swords) {
    if (s.flying && Math.sign(s.vx) === -dir * -1) {} // (Richtung egal, prüfe Nähe)
    if (s.flying && Math.abs(s.x - p.x) < 160 && Math.sign(s.vx || 0) === Math.sign(p.x - s.x)) {
      if (s.y > p.y - 30) out.jump = true; else out.down = true;
    }
  }

  // Höhe an Gegner anpassen (Block), wenn nah
  if (dist < 150) {
    if (foe.attackTimer > 0 || foe.stance !== MID) {
      if (foe.stance === HIGH) out.up = true;
      else if (foe.stance === LOW) out.down = true;
    }
    // Gegner sticht tief → springen, sticht hoch → ducken
    if (foe.attackTimer > 0) {
      if (foe.stance === LOW) { out.jump = true; }
      if (foe.stance === HIGH) { out.down = true; }
    }
  }

  // Annähern bis Stichdistanz
  const idealRange = STAB_REACH + 8;
  if (dist > idealRange + 6) { if (dir > 0) out.right = true; else out.left = true; }
  else if (dist < idealRange - 26) { if (dir > 0) out.left = true; else out.right = true; } // zu nah → zurück

  // Zustechen, wenn in Reichweite und bereit
  if (dist <= idealRange + 10 && p.attackCooldown <= 0 && p.stun <= 0) {
    // etwas Reaktionszeit einbauen
    if (p.ai.reactTimer <= 0) { out.attack = true; p.ai.reactTimer = 8 + Math.floor(Math.random() * 10); }
  }
  if (p.ai.reactTimer > 0) p.ai.reactTimer--;

  // Gelegentlich werfen aus mittlerer Distanz
  if (dist > 140 && dist < 320 && Math.random() < 0.008) out.throw = true;

  // Blickrichtung sicherstellen
  p.facing = dir;
  return out;
}

/* =========================================================================
   ZEICHNEN
   ========================================================================= */
function draw() {
  ctx.clearRect(0, 0, VIEW_W, VIEW_H);
  drawBackground();

  // Bodenlinie
  ctx.strokeStyle = "#3a3a55";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, GROUND_Y + 2 - 0);
  ctx.lineTo(VIEW_W, GROUND_Y + 2 - 0);
  ctx.stroke();

  // Ziel-Zonen
  drawGoal(0 - camX, "#ff7a7a");                 // links: P2
  drawGoal(WORLD_W - 30 - camX, "#63b3ff");      // rechts: P1

  // Degen am Boden / im Flug
  for (const s of swords) drawSword(s);

  // Kämpfer
  drawFighter(P2);
  drawFighter(P1);

  // Partikel
  for (const p of particles) {
    ctx.fillStyle = p.spark ? "#ffe08a" : "#c0303a";
    ctx.fillRect(p.x - camX - 1.5, p.y - 1.5, 3, 3);
  }

  drawHUD();
}

function drawBackground() {
  // Vertikaler Verlauf
  const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  g.addColorStop(0, "#161628");
  g.addColorStop(1, "#0d0d18");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // Parallax-Berge
  ctx.fillStyle = "#1d1d33";
  const p1 = camX * 0.3;
  for (let i = -1; i < NUM_SCREENS + 1; i++) {
    const bx = i * 480 - (p1 % 480);
    ctx.beginPath();
    ctx.moveTo(bx, GROUND_Y);
    ctx.lineTo(bx + 240, GROUND_Y - 180);
    ctx.lineTo(bx + 480, GROUND_Y);
    ctx.closePath();
    ctx.fill();
  }
  // Fackeln/Säulen als Screen-Marker (Parallax näher)
  const p2 = camX;
  ctx.strokeStyle = "#242440";
  ctx.lineWidth = 14;
  for (let i = 1; i < NUM_SCREENS; i++) {
    const bx = i * VIEW_W - p2;
    if (bx < -20 || bx > VIEW_W + 20) continue;
    ctx.beginPath();
    ctx.moveTo(bx, GROUND_Y);
    ctx.lineTo(bx, GROUND_Y - 120);
    ctx.stroke();
    // Fackelglut
    const flick = 6 + Math.sin(Date.now() / 90 + i) * 3;
    ctx.fillStyle = "rgba(255,160,60,0.85)";
    ctx.beginPath();
    ctx.arc(bx, GROUND_Y - 122, flick, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,90,30,0.25)";
    ctx.beginPath();
    ctx.arc(bx, GROUND_Y - 122, flick * 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawGoal(sx, color) {
  if (sx < -60 || sx > VIEW_W + 60) return;
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = color;
  ctx.fillRect(sx, 0, 30, GROUND_Y);
  ctx.restore();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.6;
  ctx.setLineDash([8, 8]);
  ctx.beginPath();
  ctx.moveTo(sx + 30, 0); ctx.lineTo(sx + 30, GROUND_Y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

function drawSword(s) {
  const sx = s.x - camX;
  ctx.save();
  ctx.translate(sx, s.y);
  if (s.flying) ctx.rotate(s.rot);
  else ctx.rotate(0.15 * s.facing);   // am Boden leicht geneigt
  ctx.strokeStyle = "#dfe3ee";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-6 * (s.facing || 1), 0);
  ctx.lineTo(30 * (s.facing || 1), 0);
  ctx.stroke();
  // Parierstange
  ctx.strokeStyle = "#9a6a2a";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-6 * (s.facing || 1), -5);
  ctx.lineTo(-6 * (s.facing || 1), 5);
  ctx.stroke();
  ctx.restore();
}

function drawFighter(p) {
  if (!p.alive) return;
  const sx = p.x - camX;
  const fy = p.y;
  const f = p.facing;

  ctx.save();
  if (p.invuln > 0 && Math.floor(p.invuln / 4) % 2 === 0) ctx.globalAlpha = 0.4;

  // Körpermaße je nach Ducken
  const hip = p.crouch ? fy - 16 : fy - 24;
  const shoulder = p.crouch ? fy - 32 : fy - 50;
  const headY = p.crouch ? fy - 40 : fy - 58;

  ctx.strokeStyle = p.color;
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Beine
  const swing = Math.sin(p.walk) * (p.onGround ? 8 : 3);
  ctx.beginPath();
  ctx.moveTo(sx, hip);
  ctx.lineTo(sx - 8 + swing, fy);
  ctx.moveTo(sx, hip);
  ctx.lineTo(sx + 8 - swing, fy);
  ctx.stroke();

  // Rumpf
  ctx.beginPath();
  ctx.moveTo(sx, hip);
  ctx.lineTo(sx, shoulder);
  ctx.stroke();

  // Kopf
  ctx.beginPath();
  ctx.fillStyle = p.color;
  ctx.arc(sx, headY, 7, 0, Math.PI * 2);
  ctx.fill();

  // hinterer Arm (kurz, zur Balance)
  ctx.strokeStyle = p.color;
  ctx.beginPath();
  ctx.moveTo(sx, shoulder + 3);
  ctx.lineTo(sx - f * 9, shoulder + 14);
  ctx.stroke();

  // vorderer Arm + Degen
  const bladeY = swordY(p);
  const gripReach = p.attackTimer > 0 ? 22 : 12;
  const gx = sx + f * gripReach;                 // Griff-Position
  ctx.beginPath();
  ctx.moveTo(sx, shoulder + 3);
  ctx.lineTo(gx, bladeY);
  ctx.stroke();

  if (p.hasSword) {
    const bladeLen = p.attackTimer > 0 ? STAB_REACH - gripReach : HOLD_LEN;
    ctx.strokeStyle = "#eef1f8";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(gx, bladeY);
    ctx.lineTo(gx + f * bladeLen, bladeY);
    ctx.stroke();
    // Parierstange
    ctx.strokeStyle = "#9a6a2a";
    ctx.beginPath();
    ctx.moveTo(gx, bladeY - 4);
    ctx.lineTo(gx, bladeY + 4);
    ctx.stroke();
    ctx.lineWidth = 4;
  }

  ctx.restore();
}

function drawHUD() {
  // Fortschrittsleiste oben (Tauziehen)
  const barX = 60, barW = VIEW_W - 120, barY = 26, barH = 10;
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fillRect(barX, barY, barW, barH);

  const p1prog = P1.x / WORLD_W;
  const p2prog = 1 - P2.x / WORLD_W;
  // P1 füllt von links
  ctx.fillStyle = "rgba(99,179,255,0.55)";
  ctx.fillRect(barX, barY, barW * p1prog, barH);
  // P2 füllt von rechts
  ctx.fillStyle = "rgba(255,122,122,0.55)";
  ctx.fillRect(barX + barW * (1 - p2prog), barY, barW * p2prog, barH);

  // Marker
  ctx.fillStyle = "#63b3ff";
  ctx.fillRect(barX + barW * p1prog - 2, barY - 3, 4, barH + 6);
  ctx.fillStyle = "#ff7a7a";
  ctx.fillRect(barX + barW * (1 - p2prog) - 2, barY - 3, 4, barH + 6);

  // Momentum-Anzeige
  ctx.font = "bold 16px system-ui, sans-serif";
  ctx.textAlign = "center";
  let txt = "— Erstes Blut entscheidet über das Momentum —";
  let col = "#9aa4c8";
  if (advantage === P1) { txt = "▶  Spieler 1 hat das Momentum  ▶"; col = "#63b3ff"; }
  else if (advantage === P2) { txt = "◀  " + (cpuMode ? "CPU" : "Spieler 2") + " hat das Momentum  ◀"; col = "#ff7a7a"; }
  ctx.fillStyle = col;
  ctx.fillText(txt, VIEW_W / 2, 58);
  ctx.textAlign = "left";
}

/* =========================================================================
   HAUPTSCHLEIFE
   ========================================================================= */
function loop() {
  if (state === "playing") {
    updateFighter(P1, P2);
    updateFighter(P2, P1);
    resolveStabs(P1, P2);
    resolveStabs(P2, P1);
    updateSwords();
    updateParticles();
    checkWin();
    updateCamera();
    draw();
  }
  requestAnimationFrame(loop);
}

/* =========================================================================
   MENÜ / ABLAUF
   ========================================================================= */
function startGame(cpu) {
  document.getElementById("menu").classList.add("hidden");
  document.getElementById("winscreen").classList.add("hidden");
  if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {} }
  resetMatch(cpu);
}
function toMenu() {
  document.getElementById("winscreen").classList.add("hidden");
  document.getElementById("menu").classList.remove("hidden");
  state = "menu";
}

document.getElementById("btn-2p").addEventListener("click", () => startGame(false));
document.getElementById("btn-cpu").addEventListener("click", () => startGame(true));
document.getElementById("btn-again").addEventListener("click", () => startGame(cpuMode));

state = "menu";
loop();

/*! Nocturne Hold'em — zero-dependency online room server (MIT) */
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { PokerGame } = require("./js/engine.js");
const { PokerAI, createBotLineup } = require("./js/ai.js");
const { StatsStore } = require("./stats-store.js");

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || "0.0.0.0";
const MAX_BODY = 64 * 1024;
const MAX_HUMANS = 6;
const TURN_MS = 45000;
const TURN_DISCONNECTED_MS = 15000;
const NEXT_HAND_MS = 9000;
const STREET_MS = 800;
const BOT_MIN_MS = 700;
const BOT_MAX_MS = 1400;
const ROOM_TTL_MS = 2 * 60 * 60 * 1000;
const DONE_TTL_MS = 30 * 60 * 1000;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");

const rooms = new Map();
const statsStore = new StatsStore({
  dataDir: DATA_DIR,
  databaseUrl: process.env.DATABASE_URL || "",
});
const HUMAN_COLORS = ["#d8b56a", "#78b9a4", "#a99bf0", "#e58e8a", "#7cb7dc", "#d8a06a"];
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

/* ------------------------------------------------------------------ utils */

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("请求内容过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        resolve(parsed && typeof parsed === "object" ? parsed : {});
      } catch (error) {
        reject(new Error("请求格式不正确"));
      }
    });
    req.on("error", reject);
  });
}

function token() {
  return crypto.randomBytes(24).toString("hex");
}

function roomCode() {
  for (let i = 0; i < 100; i++) {
    const code = String(crypto.randomInt(1000, 10000));
    if (!rooms.has(code)) return code;
  }
  throw new Error("暂时没有空闲房间号，请稍后再试");
}

function cleanName(value) {
  return String(value || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 12);
}

function avatarFor(name) {
  return Array.from(name)[0] || "♠";
}

function findRoom(code) {
  return rooms.get(String(code || "").trim());
}

function findHuman(room, tok) {
  if (!room || !tok) return null;
  return room.humans.find((human) => human.token === tok && !human.left) || null;
}

function findHumanById(room, id) {
  return room.humans.find((human) => human.id === id && !human.left) || null;
}

function activeHumans(room) {
  return room.humans.filter((human) => !human.left);
}

function canStart(room) {
  const humans = activeHumans(room).length;
  if (humans < 1) return false;
  if (room.botFill) return humans <= MAX_HUMANS;
  return humans >= 2;
}

function humanOnline(room, human) {
  if (!human || human.left) return false;
  return [...room.clients].some((client) => client.humanId === human.id);
}

function anyHumanOnline(room) {
  return activeHumans(room).some((human) => humanOnline(room, human));
}

function allHumansEliminated(room) {
  const humans = activeHumans(room);
  if (!humans.length) return true;
  return humans.every((human) => {
    const player = room.game && room.game.players.find((candidate) => candidate.id === human.id);
    return !player || player.chips <= 0;
  });
}

function touch(room) {
  room.seq += 1;
  room.updatedAt = Date.now();
}

function clearRoomTimer(room) {
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
}

function publicHuman(human) {
  return {
    id: human.id,
    name: human.name,
    avatar: human.avatar,
    isHost: Boolean(human.isHost),
    connected: Boolean(human.connected),
    joinedAt: human.joinedAt,
  };
}

/* ------------------------------------------------------------------ views */

function buildLobby(room) {
  return {
    humans: activeHumans(room).map(publicHuman),
    canStart: canStart(room),
    botFill: room.botFill,
    difficulty: room.difficulty,
    startingChips: room.startingChips,
    maxHumans: MAX_HUMANS,
  };
}

function displayIndex(actualIndex, viewerIndex, total) {
  if (actualIndex < 0 || viewerIndex < 0 || !total) return -1;
  return (actualIndex - viewerIndex + total) % total;
}

function buildGameView(room, viewerId) {
  const game = room.game;
  if (!game) return null;
  const total = game.players.length;
  const viewerIndex = Math.max(0, game.players.findIndex((player) => player.id === viewerId));
  const order = [];
  for (let offset = 0; offset < total; offset++) {
    order.push((viewerIndex + offset) % total);
  }
  const displayOf = (actualIndex) => displayIndex(actualIndex, viewerIndex, total);
  const revealAll = game.handResult && game.handResult.type === "showdown";

  const players = order.map((actualIndex, seat) => {
    const player = game.players[actualIndex];
    const self = player.id === viewerId;
    const revealed = Boolean(player.revealed && revealAll);
    const canSee = self || revealed;
    const human = player.isHuman ? room.humans.find((candidate) => candidate.id === player.id) : null;
    const online = !human || humanOnline(room, human);
    return {
      id: player.id,
      name: player.name,
      avatar: player.avatar,
      color: player.color,
      tag: player.tag || "",
      isHuman: Boolean(player.isHuman),
      isYou: self,
      connected: online,
      seat,
      position: game.getPositionLabel(player),
      chips: player.chips,
      hole: canSee ? player.hole.slice() : null,
      cardCount: player.hole.length,
      dealtIn: Boolean(player.dealtIn),
      folded: Boolean(player.folded),
      allIn: Boolean(player.allIn),
      out: Boolean(player.out),
      eliminated: Boolean(player.eliminated),
      streetBet: player.streetBet,
      totalBet: player.totalBet,
      hasActed: Boolean(player.hasActed),
      lastAction: player.lastAction,
      revealed,
      bestHand: player.bestHand
        ? { name: player.bestHand.name, category: player.bestHand.category, cards: player.bestHand.cards }
        : null,
      winAmount: player.winAmount || 0,
      isWinner: Boolean(player.isWinner),
    };
  });

  const viewer = game.players.find((player) => player.id === viewerId) || null;
  let legal = null;
  if (viewer && game.currentPlayerId === viewer.id && !game.streetComplete && !game.handResult) {
    try {
      legal = game.getLegalActions(viewer.id);
    } catch (error) {
      legal = null;
    }
  }

  let handResult = null;
  if (game.handResult) {
    handResult = {
      type: game.handResult.type,
      totalPot: game.handResult.totalPot,
      winners: game.handResult.winners,
      pots: game.handResult.pots,
      community: game.handResult.community,
      reason: game.handResult.reason,
      showdownHands: game.handResult.showdownHands,
      humanEliminated: Boolean(viewer && viewer.chips <= 0),
      gameOver: Boolean(game.gameOver || room.status === "done"),
    };
  }

  const champion = game.champion
    ? {
        id: game.champion.id,
        name: game.champion.name,
        avatar: game.champion.avatar,
        chips: game.champion.chips,
      }
    : null;

  return {
    room: room.code,
    status: room.status,
    seq: room.seq,
    hostId: room.hostId,
    you: viewer
      ? {
          id: viewer.id,
          name: viewer.name,
          seat: 0,
          chips: viewer.chips,
          isHost: room.hostId === viewer.id,
        }
      : null,
    statusLabel: room.status,
    playerId: viewerId,
    turnDeadline: room.turnDeadline || 0,
    serverTime: Date.now(),
    startingChips: room.startingChips,
    difficulty: room.difficulty,
    botFill: room.botFill,
    lobby: null,
    game: {
      room: room.code,
      status: room.status === "done" ? "done" : "playing",
      handNumber: game.handNumber,
      phase: game.phase,
      community: game.community.slice(),
      pot: game.getTotalPot(),
      currentBet: game.currentBet,
      smallBlind: game.smallBlind,
      bigBlind: game.bigBlind,
      blindLevel: game.blindLevel,
      handsUntilNextLevel: game.getHandsUntilBlindIncrease(),
      blindEvery: game.config.blindEvery,
      startingChips: room.startingChips,
      dealerIndex: displayOf(game.dealerIndex),
      smallBlindIndex: displayOf(game.smallBlindIndex),
      bigBlindIndex: displayOf(game.bigBlindIndex),
      currentPlayerId: game.currentPlayerId,
      streetComplete: Boolean(game.streetComplete),
      handResult,
      gameOver: Boolean(game.gameOver || room.status === "done"),
      champion,
      log: game.log.slice(-220),
      players,
    },
    legal,
  };
}

function buildView(room, humanId) {
  const human = room.humans.find((candidate) => candidate.id === humanId && !candidate.left);
  if (!human) return null;
  if (!room.game || room.status === "lobby") {
    return {
      room: room.code,
      status: "lobby",
      seq: room.seq,
      hostId: room.hostId,
      you: { id: human.id, name: human.name, isHost: room.hostId === human.id },
      startingChips: room.startingChips,
      difficulty: room.difficulty,
      botFill: room.botFill,
      lobby: buildLobby(room),
      game: null,
      legal: null,
      turnDeadline: 0,
      serverTime: Date.now(),
    };
  }
  const view = buildGameView(room, humanId);
  if (view) {
    view.hostId = room.hostId;
    view.you.isHost = room.hostId === human.id;
  }
  return view;
}

function broadcast(room) {
  if (!room.clients.size) return;
  for (const client of [...room.clients]) {
    if (!client || client.res.writableEnded) {
      room.clients.delete(client);
      continue;
    }
    try {
      const view = buildView(room, client.humanId);
      if (!view) continue;
      client.res.write("event: state\ndata: " + JSON.stringify(view) + "\n\n");
    } catch (error) {
      room.clients.delete(client);
      try {
        client.res.end();
      } catch (closeError) {
        /* ignore */
      }
    }
  }
}

/* --------------------------------------------------------------- stats */

function trackRoomHand(room) {
  const game = room.game;
  if (!room.humanStats || !game || !game.handResult) return;
  if (room.lastStatsHand === game.handNumber) return;
  room.lastStatsHand = game.handNumber;
  const winnerIds = new Set((game.handResult.winners || []).map((winner) => winner.id));
  for (const human of room.humans) {
    const player = game.players.find((candidate) => candidate.id === human.id);
    if (!player) continue;
    let stats = room.humanStats.get(human.id);
    if (!stats) {
      stats = { hands: 0, won: 0 };
      room.humanStats.set(human.id, stats);
    }
    if (player.dealtIn) stats.hands += 1;
    if (winnerIds.has(player.id)) stats.won += 1;
  }
}

function finalizeRoomStats(room) {
  if (room.statsFinalized || !room.game || !room.startedAt) return;
  room.statsFinalized = true;
  const game = room.game;
  const players = game.players;
  const ranked = players
    .slice()
    .sort((a, b) => {
      if (b.chips !== a.chips) return b.chips - a.chips;
      return a.seat - b.seat;
    });
  const humans = [];
  for (const human of room.humans) {
    const player = players.find((candidate) => candidate.id === human.id);
    if (!player) continue;
    const stats = room.humanStats.get(human.id) || { hands: 0, won: 0 };
    humans.push({
      name: human.name,
      buyIn: room.startingChips,
      finalChips: player.chips,
      net: player.chips - room.startingChips,
      place: ranked.indexOf(player) + 1,
      hands: stats.hands,
      won: Boolean(game.champion && game.champion.id === human.id),
      left: Boolean(human.left),
    });
  }
  if (!humans.length) return;
  statsStore.recordSession({
    id: room.code + ":" + room.startedAt,
    room: room.code,
    startedAt: room.startedAt,
    endedAt: Date.now(),
    startingChips: room.startingChips,
    difficulty: room.difficulty,
    botFill: room.botFill,
    humans,
  });
}

/* --------------------------------------------------------------- game loop */

function prepareTurn(room) {
  const game = room.game;
  if (room.status !== "playing" || !game || game.handResult || game.streetComplete) {
    room.turnDeadline = 0;
    room.turnPlayerId = null;
    return;
  }
  const current = game.currentPlayer;
  if (!current) {
    room.turnDeadline = 0;
    room.turnPlayerId = null;
    return;
  }
  if (!current.isHuman) {
    room.turnDeadline = 0;
    room.turnPlayerId = null;
    return;
  }
  const human = findHumanById(room, current.id);
  const now = Date.now();
  if (room.turnPlayerId !== current.id || !room.turnDeadline || room.turnDeadline <= now) {
    room.turnPlayerId = current.id;
    room.turnDeadline = now + (human && human.connected ? TURN_MS : TURN_DISCONNECTED_MS);
  }
}

function roomChanged(room) {
  const game = room.game;
  if (game && game.handResult) trackRoomHand(room);
  if (game && room.status === "playing") {
    if (game.gameOver || (game.handResult && allHumansEliminated(room))) {
      room.status = "done";
      room.turnDeadline = 0;
      room.turnPlayerId = null;
    }
  }
  if (room.status === "done") finalizeRoomStats(room);
  prepareTurn(room);
  touch(room);
  broadcast(room);
  armRoom(room);
}

function finishRoom(room) {
  room.status = "done";
  room.turnDeadline = 0;
  room.turnPlayerId = null;
  clearRoomTimer(room);
  if (room.game && room.game.handResult) trackRoomHand(room);
  finalizeRoomStats(room);
  touch(room);
  broadcast(room);
}

function armRoom(room) {
  clearRoomTimer(room);
  const game = room.game;
  if (room.status !== "playing" || !game) return;
  if (!anyHumanOnline(room)) {
    room.paused = true;
    room.turnDeadline = 0;
    room.turnPlayerId = null;
    return;
  }
  room.paused = false;

  if (game.gameOver) {
    finishRoom(room);
    return;
  }

  if (game.handResult) {
    room.turnDeadline = 0;
    room.turnPlayerId = null;
    room.timer = setTimeout(() => {
      if (room.status !== "playing") return;
      if (!anyHumanOnline(room)) {
        room.paused = true;
        return;
      }
      const started = game.startHand();
      if (!started) {
        finishRoom(room);
        return;
      }
      roomChanged(room);
    }, NEXT_HAND_MS);
    return;
  }

  if (game.streetComplete) {
    room.turnDeadline = 0;
    room.turnPlayerId = null;
    room.timer = setTimeout(() => {
      if (room.status !== "playing" || !anyHumanOnline(room)) return;
      try {
        game.advanceStreet();
      } catch (error) {
        console.error("advanceStreet failed", error);
        finishRoom(room);
        return;
      }
      roomChanged(room);
    }, STREET_MS);
    return;
  }

  const current = game.currentPlayer;
  if (!current) {
    room.timer = setTimeout(() => roomChanged(room), 450);
    return;
  }

  if (current.isHuman) {
    if (!room.turnDeadline) {
      // Defensive: always give a turn a deadline.
      prepareTurn(room);
      broadcast(room);
    }
    const remaining = Math.max(0, room.turnDeadline - Date.now());
    room.timer = setTimeout(() => timeoutTurn(room, current.id), remaining + 25);
    return;
  }

  const delay = BOT_MIN_MS + Math.floor(Math.random() * (BOT_MAX_MS - BOT_MIN_MS));
  room.timer = setTimeout(() => {
    if (room.status !== "playing" || !anyHumanOnline(room)) return;
    if (game.currentPlayerId !== current.id || game.handResult) return;
    const ai = room.ais.get(current.id);
    let action = null;
    try {
      if (!ai) throw new Error("Missing bot AI");
      action = ai.decide(game, current);
      game.act(current.id, action.type, action.amount);
    } catch (error) {
      console.error("bot action failed", error);
      const legal = safeLegal(game, current.id);
      try {
        if (legal && legal.canCheck) game.act(current.id, "check");
        else if (legal && legal.canCall) game.act(current.id, "call");
        else game.act(current.id, "fold");
      } catch (fallbackError) {
        console.error("bot fallback failed", fallbackError);
      }
    }
    roomChanged(room);
  }, delay);
}

function safeLegal(game, playerId) {
  try {
    return game.getLegalActions(playerId);
  } catch (error) {
    return null;
  }
}

function timeoutTurn(room, playerId) {
  const game = room.game;
  if (room.status !== "playing" || !game || game.currentPlayerId !== playerId || game.handResult) {
    return;
  }
  const player = game.getPlayer(playerId);
  if (!player || !player.isHuman) return;
  const legal = safeLegal(game, playerId);
  if (!legal || !legal.canPlay) {
    roomChanged(room);
    return;
  }
  try {
    if (legal.canCheck) {
      game._log("action", player.name + " 超时，自动过牌", { playerId: player.id, action: "check" });
      game.act(player.id, "check");
    } else {
      game._log("action", player.name + " 超时，自动弃牌", { playerId: player.id, action: "fold" });
      game.act(player.id, "fold");
    }
  } catch (error) {
    console.error("timeout action failed", error);
    const fallback = safeLegal(game, playerId);
    try {
      if (fallback && fallback.canCheck) game.act(player.id, "check");
      else if (fallback && fallback.canFold) game.act(player.id, "fold");
    } catch (fallbackError) {
      console.error("timeout fallback failed", fallbackError);
    }
  }
  roomChanged(room);
}

/* --------------------------------------------------------------- rooms */

function createHuman(room, name, isHost) {
  room.humanSeq += 1;
  const id = "h" + room.humanSeq;
  return {
    id,
    name,
    avatar: avatarFor(name),
    color: HUMAN_COLORS[(room.humanSeq - 1) % HUMAN_COLORS.length],
    token: token(),
    isHost: Boolean(isHost),
    connected: false,
    left: false,
    joinedAt: Date.now(),
  };
}

function createRoom(options) {
  const code = roomCode();
  const name = cleanName(options.name) || "玩家";
  const botFill = options.botFill !== false;
  const difficulty = ["casual", "standard", "pro"].includes(options.difficulty)
    ? options.difficulty
    : "standard";
  const startingChips = [2000, 5000, 10000].includes(Number(options.startingChips))
    ? Number(options.startingChips)
    : 5000;
  const room = {
    code,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: "lobby",
    humans: [],
    hostId: null,
    humanSeq: 0,
    botFill,
    difficulty,
    startingChips,
    game: null,
    ais: new Map(),
    seq: 1,
    timer: null,
    turnDeadline: 0,
    turnPlayerId: null,
    paused: false,
    clients: new Set(),
  };
  const human = createHuman(room, name, true);
  room.humans.push(human);
  room.hostId = human.id;
  rooms.set(code, room);
  return { room, human };
}

function joinRoom(room, name) {
  if (room.status !== "lobby") {
    const error = new Error("牌局已经开始了，暂时不能加入。");
    error.status = 409;
    throw error;
  }
  if (activeHumans(room).length >= MAX_HUMANS) {
    const error = new Error("房间已经坐满了。");
    error.status = 409;
    throw error;
  }
  const clean = cleanName(name);
  if (!clean) {
    const error = new Error("先填一个昵称。");
    error.status = 400;
    throw error;
  }
  const human = createHuman(room, clean, false);
  room.humans.push(human);
  roomChanged(room);
  return human;
}

function makeGame(room) {
  const humans = activeHumans(room);
  if (!canStart(room)) {
    const error = new Error(room.botFill ? "还没有玩家入座。" : "至少需要两位真人玩家，或开启电脑补位。");
    error.status = 400;
    throw error;
  }
  const players = humans.map((human) => ({
    id: human.id,
    name: human.name,
    avatar: human.avatar,
    color: human.color,
    tag: "玩家",
    isHuman: true,
    chips: room.startingChips,
  }));
  const botCount = room.botFill ? Math.max(0, 6 - humans.length) : 0;
  const lineup = createBotLineup(botCount, room.difficulty);
  lineup.forEach((profile, index) => {
    players.push({
      id: "b" + (index + 1),
      name: profile.name,
      avatar: profile.avatar,
      color: profile.color,
      tag: profile.tag,
      style: profile.style,
      isHuman: false,
      chips: room.startingChips,
    });
  });

  if (players.length < 2) {
    const error = new Error("至少需要 2 位玩家才能开局。");
    error.status = 400;
    throw error;
  }

  const game = new PokerGame({
    players,
    startingChips: room.startingChips,
    blindEvery: 8,
  });
  room.game = game;
  room.ais = new Map();
  for (const player of game.players) {
    if (!player.isHuman) room.ais.set(player.id, new PokerAI(room.difficulty));
  }
  room.status = "playing";
  room.startedAt = Date.now();
  room.turnDeadline = 0;
  room.turnPlayerId = null;
  room.paused = false;
  room.statsFinalized = false;
  room.lastStatsHand = 0;
  room.humanStats = new Map();
  for (const human of humans) room.humanStats.set(human.id, { hands: 0, won: 0 });
  const started = game.startHand();
  if (!started) {
    const error = new Error("无法开始牌局。");
    error.status = 400;
    throw error;
  }
  roomChanged(room);
}

function startRoom(room) {
  if (room.status !== "lobby") {
    const error = new Error("牌局已经开始。");
    error.status = 409;
    throw error;
  }
  makeGame(room);
}

function removeHuman(room, human) {
  human.left = true;
  human.connected = false;
  for (const client of [...room.clients]) {
    if (client.humanId === human.id) {
      room.clients.delete(client);
      try {
        client.res.end();
      } catch (error) {
        /* ignore */
      }
    }
  }
  if (room.status === "lobby") {
    room.humans = room.humans.filter((candidate) => candidate !== human);
    if (room.hostId === human.id) {
      const nextHost = activeHumans(room)[0];
      room.hostId = nextHost ? nextHost.id : null;
      for (const candidate of room.humans) candidate.isHost = candidate.id === room.hostId;
    }
    if (!activeHumans(room).length) {
      clearRoomTimer(room);
      rooms.delete(room.code);
      return;
    }
    roomChanged(room);
    return;
  }

  if (!anyHumanOnline(room)) {
    clearRoomTimer(room);
    room.paused = true;
    room.turnDeadline = 0;
    room.turnPlayerId = null;
  } else if (room.game && room.status === "playing" && room.game.currentPlayerId === human.id) {
    // Don't make the rest of the table wait a full turn for a seat that has
    // explicitly left. Fold it quickly instead.
    room.turnPlayerId = human.id;
    room.turnDeadline = Date.now() + 1200;
  }
  if (room.hostId === human.id) {
    const nextHost = activeHumans(room).find((candidate) => candidate.connected) || activeHumans(room)[0];
    if (nextHost) {
      room.hostId = nextHost.id;
      for (const candidate of room.humans) candidate.isHost = candidate.id === room.hostId;
    }
  }
  if (!activeHumans(room).length) {
    finishRoom(room);
    return;
  }
  broadcast(room);
  armRoom(room);
}

/* --------------------------------------------------------------- SSE */

function handleEvents(req, res, url) {
  const room = findRoom(url.searchParams.get("room"));
  const human = room ? findHuman(room, url.searchParams.get("token")) : null;
  if (!room || !human) {
    sendJson(res, 401, { error: "房间不存在或登录已失效。" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "X-Content-Type-Options": "nosniff",
  });
  res.write("retry: 2000\n\n");
  res.write(": connected\n\n");

  const client = { res, humanId: human.id };
  room.clients.add(client);
  human.connected = true;
  room.updatedAt = Date.now();
  broadcast(room);
  if (room.status === "playing") {
    if (room.paused) {
      room.paused = false;
      roomChanged(room);
    } else {
      armRoom(room);
    }
  }

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    room.clients.delete(client);
    const stillConnected = [...room.clients].some((candidate) => candidate.humanId === human.id);
    if (!stillConnected) human.connected = false;
    if (room.status === "playing") {
      if (!anyHumanOnline(room)) {
        clearRoomTimer(room);
        room.paused = true;
        room.turnDeadline = 0;
        room.turnPlayerId = null;
      } else {
        const current = room.game && room.game.currentPlayer;
        if (current && current.id === human.id) {
          room.turnDeadline = Math.min(room.turnDeadline || Infinity, Date.now() + TURN_DISCONNECTED_MS);
        }
      }
    }
    room.updatedAt = Date.now();
    broadcast(room);
    if (room.status === "playing" && anyHumanOnline(room)) armRoom(room);
  };
  req.on("close", cleanup);
  res.on("close", cleanup);
  res.on("error", cleanup);
}

/* --------------------------------------------------------------- API */

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  if (req.method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      rooms: rooms.size,
      now: Date.now(),
      stats: {
        sessions: statsStore.status().sessions,
        storageError: statsStore.storageError,
        persistence: statsStore.status().persistence,
      },
    });
    return;
  }

  if (req.method === "GET" && pathname === "/api/leaderboard") {
    sendJson(res, 200, {
      ok: true,
      board: statsStore.leaderboard(30),
      storageError: statsStore.storageError,
    });
    return;
  }

  if (req.method === "GET" && pathname === "/api/history") {
    const name = String(url.searchParams.get("name") || "").trim();
    if (!name) {
      sendJson(res, 400, { error: "请先填写昵称。" });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      ...statsStore.history(name, 40),
      storageError: statsStore.storageError,
    });
    return;
  }

  if (req.method === "GET" && pathname === "/api/state") {
    const room = findRoom(url.searchParams.get("room"));
    const human = room ? findHuman(room, url.searchParams.get("token")) : null;
    if (!room || !human) {
      sendJson(res, 401, { error: "房间不存在或登录已失效。" });
      return;
    }
    sendJson(res, 200, { ok: true, view: buildView(room, human.id) });
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  let body;
  try {
    body = await readJson(req);
  } catch (error) {
    sendJson(res, 400, { error: error.message || "请求格式不正确" });
    return;
  }

  try {
    if (pathname === "/api/create") {
      const { room, human } = createRoom({
        name: body.name,
        botFill: body.botFill,
        difficulty: body.difficulty,
        startingChips: body.startingChips,
      });
      sendJson(res, 200, {
        ok: true,
        room: room.code,
        token: human.token,
        playerId: human.id,
        view: buildView(room, human.id),
      });
      return;
    }

    if (pathname === "/api/join") {
      const room = findRoom(body.room);
      if (!room) {
        sendJson(res, 404, { error: "找不到这个房间，检查一下房间号。" });
        return;
      }
      const human = joinRoom(room, body.name);
      sendJson(res, 200, {
        ok: true,
        room: room.code,
        token: human.token,
        playerId: human.id,
        view: buildView(room, human.id),
      });
      return;
    }

    if (pathname === "/api/check") {
      const room = findRoom(body.room);
      const human = room ? findHuman(room, body.token) : null;
      if (!room || !human) {
        sendJson(res, 401, { error: "房间不存在或登录已失效。" });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        status: room.status,
        room: room.code,
        playerId: human.id,
        view: buildView(room, human.id),
      });
      return;
    }

    if (pathname === "/api/state") {
      const room = findRoom(body.room);
      const human = room ? findHuman(room, body.token) : null;
      if (!room || !human) {
        sendJson(res, 401, { error: "房间不存在或登录已失效。" });
        return;
      }
      sendJson(res, 200, { ok: true, view: buildView(room, human.id) });
      return;
    }

    if (pathname === "/api/start") {
      const room = findRoom(body.room);
      const human = room ? findHuman(room, body.token) : null;
      if (!room || !human) {
        sendJson(res, 401, { error: "房间不存在或登录已失效。" });
        return;
      }
      startRoom(room);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (pathname === "/api/leave") {
      const room = findRoom(body.room);
      const human = room ? findHuman(room, body.token) : null;
      if (!room || !human) {
        sendJson(res, 200, { ok: true });
        return;
      }
      removeHuman(room, human);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (pathname === "/api/act") {
      const room = findRoom(body.room);
      const human = room ? findHuman(room, body.token) : null;
      if (!room || !human) {
        sendJson(res, 401, { error: "房间不存在或登录已失效。" });
        return;
      }
      if (room.status !== "playing" || !room.game) {
        sendJson(res, 409, { error: "牌局还没有开始。" });
        return;
      }
      const game = room.game;
      if (game.handResult) {
        sendJson(res, 409, { error: "这一手已经结束。" });
        return;
      }
      if (game.currentPlayerId !== human.id) {
        sendJson(res, 409, { error: "还没轮到你行动。" });
        return;
      }
      const type = String(body.type || "");
      const amount = Number(body.amount);
      try {
        game.act(human.id, type, amount);
      } catch (error) {
        sendJson(res, 400, { error: error.message || "这个操作不合法。" });
        return;
      }
      roomChanged(room);
      sendJson(res, 200, { ok: true, seq: room.seq });
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    if (!error.status || error.status >= 500) console.error("API error", pathname, error);
    sendJson(res, error.status || 500, { error: error.message || "服务器开小差了。" });
  }
}

/* --------------------------------------------------------------- static */

function serveStatic(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end("Method not allowed");
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch (error) {
    res.writeHead(400);
    res.end("Bad path");
    return;
  }
  if (pathname === "/") pathname = "/index.html";
  if (
    pathname.includes("\0") ||
    pathname.split("/").some((segment) => segment.startsWith(".")) ||
    pathname === "/server.js" ||
    pathname === "/package.json" ||
    pathname.startsWith("/data/")
  ) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  const absolute = path.resolve(ROOT, "." + pathname);
  if (!absolute.startsWith(ROOT + path.sep)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }
  fs.stat(absolute, (error, stat) => {
    if (error || !stat.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const extension = path.extname(absolute).toLowerCase();
    const contentType = MIME[extension] || "application/octet-stream";
    const headers = {
      "Content-Type": contentType,
      "Content-Length": stat.size,
      "Cache-Control": extension === ".html" ? "no-cache" : "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
    };
    res.writeHead(200, headers);
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    const stream = fs.createReadStream(absolute);
    stream.on("error", () => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
    stream.pipe(res);
  });
}

/* --------------------------------------------------------------- server */

function handleRequest(req, res) {
  let url;
  try {
    url = new URL(req.url, "http://localhost");
  } catch (error) {
    res.writeHead(400);
    res.end("Bad request");
    return;
  }

  if (url.pathname === "/api/events" && req.method === "GET") {
    handleEvents(req, res, url);
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url).catch((error) => {
      console.error("unhandled API error", error);
      if (!res.headersSent) sendJson(res, 500, { error: "服务器开小差了。" });
      else res.end();
    });
    return;
  }
  serveStatic(req, res, url);
}

const server = http.createServer(handleRequest);

const heartbeat = setInterval(() => {
  for (const room of rooms.values()) {
    for (const client of [...room.clients]) {
      if (client.res.writableEnded) {
        room.clients.delete(client);
        continue;
      }
      try {
        client.res.write(": heartbeat\n\n");
      } catch (error) {
        room.clients.delete(client);
      }
    }
  }
}, 15000);
heartbeat.unref();

const cleaner = setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const idle = now - room.updatedAt;
    if (room.status === "done" && idle > DONE_TTL_MS && room.clients.size === 0) {
      clearRoomTimer(room);
      rooms.delete(code);
    } else if (idle > ROOM_TTL_MS && room.clients.size === 0) {
      clearRoomTimer(room);
      rooms.delete(code);
    }
  }
}, 10 * 60 * 1000);
cleaner.unref();

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log("NOCTURNE HOLD'EM");
    console.log("Local:   http://127.0.0.1:" + PORT);
    console.log("Rooms:   in-memory (no database required)");
  });
}

module.exports = {
  server,
  createServer: () => http.createServer(handleRequest),
  rooms,
  createRoom,
  joinRoom,
  startRoom,
  buildView,
  findRoom,
  findHuman,
  statsStore,
};

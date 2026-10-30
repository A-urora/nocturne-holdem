/*! Nocturne Hold'em — JSON-backed session leaderboard and history (MIT) */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MAX_SESSIONS = 1000;
const MAX_NAME = 12;

function nameKey(name) {
  return String(name || "").trim().slice(0, MAX_NAME).toLocaleLowerCase();
}

function cleanName(name) {
  return String(name || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, MAX_NAME);
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

class StatsStore {
  constructor(options = {}) {
    this.dataDir = options.dataDir || path.join(__dirname, "data");
    this.file = path.join(this.dataDir, "stats.json");
    this.sessions = [];
    this.storageError = "";
    this._load();
  }

  _load() {
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      if (!fs.existsSync(this.file)) return;
      const raw = fs.readFileSync(this.file, "utf8");
      if (!raw.trim()) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.sessions)) {
        this.sessions = parsed.sessions
          .filter((session) => session && session.id && Array.isArray(session.humans))
          .slice(0, MAX_SESSIONS);
      }
    } catch (error) {
      this.storageError = "读取战绩失败：" + (error.message || "未知错误");
    }
  }

  _save() {
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      const tmp = this.file + ".tmp";
      fs.writeFileSync(
        tmp,
        JSON.stringify({ version: 1, sessions: this.sessions }, null, 2),
        "utf8"
      );
      fs.renameSync(tmp, this.file);
      this.storageError = "";
      return true;
    } catch (error) {
      this.storageError = "保存战绩失败：" + (error.message || "未知错误");
      return false;
    }
  }

  recordSession(session) {
    if (!session || !session.id || !Array.isArray(session.humans) || !session.humans.length) {
      return false;
    }
    if (this.sessions.some((existing) => existing.id === session.id)) return false;

    const humans = [];
    for (const human of session.humans) {
      const name = cleanName(human.name);
      if (!name) continue;
      const buyIn = Math.max(0, safeNumber(human.buyIn));
      const finalChips = Math.max(0, safeNumber(human.finalChips));
      humans.push({
        name,
        buyIn,
        finalChips,
        net: Math.round(safeNumber(human.net !== undefined ? human.net : finalChips - buyIn)),
        place: Math.max(1, Math.round(safeNumber(human.place) || 1)),
        hands: Math.max(0, Math.round(safeNumber(human.hands))),
        won: Boolean(human.won),
        left: Boolean(human.left),
      });
    }
    if (!humans.length) return false;

    this.sessions.unshift({
      id: String(session.id),
      room: String(session.room || ""),
      startedAt: safeNumber(session.startedAt) || Date.now(),
      endedAt: safeNumber(session.endedAt) || Date.now(),
      startingChips: Math.max(0, safeNumber(session.startingChips)),
      difficulty: String(session.difficulty || "standard"),
      botFill: session.botFill !== false,
      humans,
    });
    if (this.sessions.length > MAX_SESSIONS) {
      this.sessions.length = MAX_SESSIONS;
    }
    this._save();
    return true;
  }

  _aggregate() {
    const players = new Map();
    for (const session of this.sessions) {
      for (const human of session.humans) {
        const key = nameKey(human.name);
        if (!key) continue;
        let player = players.get(key);
        if (!player) {
          player = {
            name: human.name,
            sessions: 0,
            hands: 0,
            wins: 0,
            net: 0,
            bestPlace: Infinity,
            lastPlayedAt: 0,
          };
          players.set(key, player);
        }
        player.sessions += 1;
        player.hands += human.hands || 0;
        player.wins += human.won ? 1 : 0;
        player.net += human.net || 0;
        player.bestPlace = Math.min(player.bestPlace, human.place || Infinity);
        player.lastPlayedAt = Math.max(player.lastPlayedAt, session.endedAt || 0);
        if (!player.name && human.name) player.name = human.name;
      }
    }
    return players;
  }

  leaderboard(limit = 30) {
    const players = [...this._aggregate().values()].map((player) => ({
      ...player,
      bestPlace: Number.isFinite(player.bestPlace) ? player.bestPlace : null,
      winRate: player.sessions ? player.wins / player.sessions : 0,
    }));
    players.sort((a, b) => {
      if (b.net !== a.net) return b.net - a.net;
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (b.hands !== a.hands) return b.hands - a.hands;
      return a.name.localeCompare(b.name, "zh-CN");
    });
    return players.slice(0, limit);
  }

  history(name, limit = 40) {
    const key = nameKey(name);
    if (!key) {
      return {
        name: "",
        summary: { sessions: 0, hands: 0, wins: 0, net: 0, bestPlace: null },
        sessions: [],
      };
    }

    let displayName = cleanName(name);
    let sessions = 0;
    let hands = 0;
    let wins = 0;
    let net = 0;
    let bestPlace = Infinity;
    const rows = [];

    for (const session of this.sessions) {
      const human = session.humans.find((candidate) => nameKey(candidate.name) === key);
      if (!human) continue;
      if (!displayName) displayName = human.name;
      sessions += 1;
      hands += human.hands || 0;
      wins += human.won ? 1 : 0;
      net += human.net || 0;
      bestPlace = Math.min(bestPlace, human.place || Infinity);
      rows.push({
        id: session.id,
        room: session.room,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        place: human.place,
        buyIn: human.buyIn,
        finalChips: human.finalChips,
        net: human.net,
        hands: human.hands,
        won: human.won,
        left: human.left,
        startingChips: session.startingChips,
        difficulty: session.difficulty,
      });
    }

    rows.sort((a, b) => b.endedAt - a.endedAt);
    return {
      name: displayName || cleanName(name),
      summary: {
        sessions,
        hands,
        wins,
        net,
        bestPlace: Number.isFinite(bestPlace) ? bestPlace : null,
      },
      sessions: rows.slice(0, limit),
    };
  }

  status() {
    return {
      sessions: this.sessions.length,
      file: this.file,
      storageError: this.storageError,
      persistence: "json",
    };
  }
}

module.exports = { StatsStore, nameKey, cleanName };

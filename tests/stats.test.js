const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { StatsStore } = require("../stats-store.js");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "nocturne-stats-"));
}

test("records sessions and builds leaderboard and player history", () => {
  const dir = tempDir();
  try {
    const store = new StatsStore({ dataDir: dir });
    store.recordSession({
      id: "room1:1",
      room: "1234",
      startedAt: 1000,
      endedAt: 2000,
      startingChips: 5000,
      difficulty: "standard",
      botFill: true,
      humans: [
        { name: "Alice", buyIn: 5000, finalChips: 7000, place: 1, hands: 8, won: true },
        { name: "Bob", buyIn: 5000, finalChips: 3000, place: 2, hands: 8, won: false },
      ],
    });
    store.recordSession({
      id: "room2:1",
      room: "5678",
      startedAt: 3000,
      endedAt: 4000,
      startingChips: 5000,
      difficulty: "pro",
      botFill: false,
      humans: [
        { name: "alice", buyIn: 5000, finalChips: 2000, place: 3, hands: 6, won: false },
        { name: "Bob", buyIn: 5000, finalChips: 8000, place: 1, hands: 6, won: true },
      ],
    });
    // Duplicate session IDs are ignored.
    store.recordSession({ id: "room1:1", humans: [{ name: "Alice", buyIn: 5000, finalChips: 0 }] });

    const board = store.leaderboard(10);
    assert.equal(board.length, 2);
    assert.equal(board[0].name, "Bob");
    assert.equal(board[0].net, 1000);
    assert.equal(board[1].name, "alice");
    assert.equal(board[1].net, -1000);

    const history = store.history("ALICE");
    assert.equal(history.summary.sessions, 2);
    assert.equal(history.summary.hands, 14);
    assert.equal(history.summary.wins, 1);
    assert.equal(history.summary.net, -1000);
    assert.equal(history.summary.bestPlace, 1);
    assert.equal(history.sessions.length, 2);
    assert.equal(history.sessions[0].room, "5678");

    const reloaded = new StatsStore({ dataDir: dir });
    const reloadedHistory = reloaded.history("Alice");
    assert.equal(reloadedHistory.summary.sessions, 2);
    assert.equal(reloadedHistory.sessions[0].room, "5678");
    assert.equal(reloaded.leaderboard(10)[0].name, "Bob");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("survives a malformed stats file", () => {
  const dir = tempDir();
  try {
    fs.writeFileSync(path.join(dir, "stats.json"), "{not-json", "utf8");
    const store = new StatsStore({ dataDir: dir });
    assert.equal(store.leaderboard().length, 0);
    assert.match(store.storageError, /读取战绩失败/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

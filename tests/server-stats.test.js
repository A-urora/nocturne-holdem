const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "nocturne-api-stats-"));
process.env.DATA_DIR = dataDir;

const { createServer, rooms, statsStore } = require("../server.js");

async function withServer(fn) {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    return await fn(base);
  } finally {
    for (const room of rooms.values()) {
      if (room.timer) clearTimeout(room.timer);
      for (const client of room.clients) {
        try {
          client.res.end();
        } catch (error) {
          /* ignore */
        }
      }
    }
    rooms.clear();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("leaderboard and history endpoints expose persisted totals", async () => {
  statsStore.recordSession({
    id: "api-test:1",
    room: "9001",
    startedAt: 100,
    endedAt: 200,
    startingChips: 5000,
    difficulty: "standard",
    botFill: true,
    humans: [
      { name: "排行榜甲", buyIn: 5000, finalChips: 8000, place: 1, hands: 10, won: true },
      { name: "排行榜乙", buyIn: 5000, finalChips: 2000, place: 4, hands: 10, won: false },
    ],
  });

  await withServer(async (base) => {
    const board = await fetch(base + "/api/leaderboard").then((response) => response.json());
    assert.equal(board.ok, true);
    assert.equal(board.board[0].name, "排行榜甲");
    assert.equal(board.board[0].net, 3000);
    assert.equal(board.board[0].wins, 1);

    const history = await fetch(
      base + "/api/history?name=" + encodeURIComponent("排行榜乙")
    ).then((response) => response.json());
    assert.equal(history.ok, true);
    assert.equal(history.summary.sessions, 1);
    assert.equal(history.summary.net, -3000);
    assert.equal(history.sessions[0].room, "9001");
    assert.equal(history.sessions[0].place, 4);
  });
});

test.after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

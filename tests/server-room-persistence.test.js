const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "nocturne-room-api-"));
process.env.DATA_DIR = dataDir;

const {
  rooms,
  createRoom,
  startRoom,
  findHuman,
  buildView,
  initRoomPersistence,
  restoreRooms,
  persistRoomNow,
} = require("../server.js");

function clearRoomTimers() {
  for (const room of rooms.values()) {
    if (room.timer) clearTimeout(room.timer);
  }
}

test("a started room can be restored from the room snapshot", async () => {
  const store = await initRoomPersistence({ dataDir, databaseUrl: "" });
  const created = createRoom({
    name: "存档房主",
    botFill: true,
    difficulty: "standard",
    startingChips: 5000,
  });
  startRoom(created.room);
  const handNumber = created.room.game.handNumber;
  const playerCount = created.room.game.players.length;
  const token = created.human.token;
  const code = created.room.code;

  persistRoomNow(created.room);
  await store.flush();
  assert.equal(store.all().length, 1);

  clearRoomTimers();
  rooms.clear();
  await restoreRooms();

  const restored = rooms.get(code);
  assert.ok(restored, "room should be restored");
  assert.equal(restored.status, "playing");
  assert.equal(restored.paused, true);
  assert.equal(restored.game.handNumber, handNumber);
  assert.equal(restored.game.players.length, playerCount);
  assert.equal(restored.ais.size, playerCount - 1);
  assert.ok(findHuman(restored, token), "original token should still work");
  const view = buildView(restored, created.human.id);
  assert.equal(view.room, code);
  assert.equal(view.you.id, created.human.id);
  assert.equal(view.game.players[0].hole.length, 2);

  clearRoomTimers();
  rooms.clear();
  await store.close();
});

test.after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

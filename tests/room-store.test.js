const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { RoomStore } = require("../room-store.js");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "nocturne-rooms-"));
}

function snapshot(code, updatedAt = Date.now()) {
  return {
    version: 1,
    savedAt: updatedAt,
    room: {
      code,
      updatedAt,
      status: "playing",
      humans: [{ id: "h1", name: "A", token: "tok", left: false }],
      game: null,
    },
  };
}

test("room snapshots survive a file-backed reload and can be removed", async () => {
  const dir = tempDir();
  try {
    const store = new RoomStore({ dataDir: dir, databaseUrl: "" });
    assert.equal(store.save(snapshot("1234")), true);
    await store.flush();
    assert.equal(store.all().length, 1);
    assert.equal(store.get("1234").room.code, "1234");

    const reloaded = new RoomStore({ dataDir: dir, databaseUrl: "" });
    assert.equal(reloaded.all().length, 1);
    assert.equal(reloaded.get("1234").room.humans[0].name, "A");

    reloaded.remove("1234");
    await reloaded.flush();
    const empty = new RoomStore({ dataDir: dir, databaseUrl: "" });
    assert.equal(empty.all().length, 0);
    await empty.close();
    await store.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("room snapshots are versioned and malformed files do not crash", () => {
  const dir = tempDir();
  try {
    fs.writeFileSync(path.join(dir, "rooms.json"), "{not-json", "utf8");
    const store = new RoomStore({ dataDir: dir, databaseUrl: "" });
    assert.equal(store.all().length, 0);
    assert.match(store.storageError, /读取房间存档失败/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

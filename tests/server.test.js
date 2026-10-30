const test = require("node:test");
const assert = require("node:assert/strict");
const { createServer, rooms } = require("../server.js");

async function withServer(fn) {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const base = "http://127.0.0.1:" + port;
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

async function post(base, route, body) {
  const response = await fetch(base + route, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const data = await response.json();
  return { response, data };
}

test("create, join, start and per-player private views", async () => {
  await withServer(async (base) => {
    const created = await post(base, "/api/create", {
      name: "房主",
      botFill: true,
      difficulty: "standard",
      startingChips: 5000,
    });
    assert.equal(created.response.status, 200);
    assert.equal(created.data.view.status, "lobby");
    assert.equal(created.data.view.lobby.humans.length, 1);
    assert.equal(created.data.view.lobby.canStart, true);

    const joined = await post(base, "/api/join", {
      room: created.data.room,
      name: "朋友",
    });
    assert.equal(joined.response.status, 200);
    assert.equal(joined.data.view.lobby.humans.length, 2);

    const started = await post(base, "/api/start", {
      room: created.data.room,
      token: created.data.token,
    });
    assert.equal(started.response.status, 200);

    const hostState = await fetch(
      base + "/api/state?room=" + created.data.room + "&token=" + created.data.token
    ).then((response) => response.json());
    const guestState = await fetch(
      base + "/api/state?room=" + created.data.room + "&token=" + joined.data.token
    ).then((response) => response.json());

    assert.equal(hostState.view.status, "playing");
    assert.equal(hostState.view.game.players.length, 6);
    assert.equal(hostState.view.game.players[0].isYou, true);
    assert.equal(hostState.view.game.players[0].hole.length, 2);
    assert.equal(hostState.view.game.players[1].hole, null);
    assert.equal(guestState.view.game.players[0].isYou, true);
    assert.equal(guestState.view.game.players[0].name, "朋友");
    assert.equal(guestState.view.game.players[0].hole.length, 2);
    assert.equal(guestState.view.game.players[1].hole, null);

    // Different viewers see themselves at the bottom / index 0.
    assert.equal(hostState.view.game.players[0].id, created.data.playerId);
    assert.equal(guestState.view.game.players[0].id, joined.data.playerId);
    assert.equal(hostState.view.game.currentPlayerId, guestState.view.game.currentPlayerId);
    assert.equal(hostState.view.game.handNumber, 1);
  });
});

test("joining a started room and acting out of turn are rejected", async () => {
  await withServer(async (base) => {
    const created = await post(base, "/api/create", {
      name: "A",
      botFill: true,
      difficulty: "standard",
      startingChips: 5000,
    });
    await post(base, "/api/start", {
      room: created.data.room,
      token: created.data.token,
    });
    const joined = await post(base, "/api/join", {
      room: created.data.room,
      name: "迟到的人",
    });
    assert.equal(joined.response.status, 409);

    const guestToken = "not-a-token";
    const outOfTurn = await post(base, "/api/act", {
      room: created.data.room,
      token: guestToken,
      type: "fold",
    });
    assert.equal(outOfTurn.response.status, 401);
  });
});

test("disabling bot fill requires at least two humans to start", async () => {
  await withServer(async (base) => {
    const created = await post(base, "/api/create", {
      name: "独狼",
      botFill: false,
      difficulty: "standard",
      startingChips: 5000,
    });
    assert.equal(created.response.status, 200);
    assert.equal(created.data.view.lobby.canStart, false);
    const start = await post(base, "/api/start", {
      room: created.data.room,
      token: created.data.token,
    });
    assert.equal(start.response.status, 400);

    const joined = await post(base, "/api/join", {
      room: created.data.room,
      name: "第二位",
    });
    assert.equal(joined.response.status, 200);
    assert.equal(joined.data.view.lobby.canStart, true);
    const start2 = await post(base, "/api/start", {
      room: created.data.room,
      token: created.data.token,
    });
    assert.equal(start2.response.status, 200);
    const state = await fetch(
      base + "/api/state?room=" + created.data.room + "&token=" + created.data.token
    ).then((response) => response.json());
    assert.equal(state.view.game.players.length, 2);
    assert.equal(state.view.game.players.every((player) => player.isHuman), true);
  });
});

test("lobby leave transfers host and invalidates the token", async () => {
  await withServer(async (base) => {
    const created = await post(base, "/api/create", {
      name: "旧房主",
      botFill: true,
      difficulty: "standard",
      startingChips: 5000,
    });
    const joined = await post(base, "/api/join", {
      room: created.data.room,
      name: "新房主",
    });
    const left = await post(base, "/api/leave", {
      room: created.data.room,
      token: created.data.token,
    });
    assert.equal(left.response.status, 200);
    const state = await fetch(
      base + "/api/state?room=" + created.data.room + "&token=" + joined.data.token
    ).then((response) => response.json());
    assert.equal(state.view.lobby.humans.length, 1);
    assert.equal(state.view.lobby.humans[0].id, joined.data.playerId);
    assert.equal(state.view.lobby.humans[0].isHost, true);
    const old = await fetch(
      base + "/api/state?room=" + created.data.room + "&token=" + created.data.token
    );
    assert.equal(old.status, 401);
  });
});


test("short deck rooms expose the variant and 36-card private hands", async () => {
  await withServer(async (base) => {
    const created = await post(base, "/api/create", {
      name: "短牌房主",
      botFill: true,
      difficulty: "standard",
      startingChips: 5000,
      variant: "short",
    });
    assert.equal(created.response.status, 200);
    assert.equal(created.data.view.lobby.variant, "short");
    await post(base, "/api/start", {
      room: created.data.room,
      token: created.data.token,
    });
    const state = await fetch(
      base + "/api/state?room=" + created.data.room + "&token=" + created.data.token
    ).then((response) => response.json());
    assert.equal(state.view.game.variant, "short");
    assert.equal(state.view.game.players[0].hole.length, 2);
    for (const card of state.view.game.players[0].hole) {
      const rank = card.slice(0, -1);
      assert.equal(["2", "3", "4", "5"].includes(rank), false);
    }
  });
});

test("quick chat is whitelisted, rate-limited, and shared with the room", async () => {
  await withServer(async (base) => {
    const created = await post(base, "/api/create", {
      name: "粤语房主",
      botFill: true,
      difficulty: "standard",
      startingChips: 5000,
    });
    const joined = await post(base, "/api/join", {
      room: created.data.room,
      name: "粤语朋友",
    });

    const first = await post(base, "/api/chat", {
      room: created.data.room,
      token: created.data.token,
      phraseId: "praise_good",
    });
    assert.equal(first.response.status, 200);
    assert.equal(first.data.message.phraseId, "praise_good");
    assert.equal(first.data.message.text, "你啲牌打得真係好喎");
    assert.equal(first.data.message.id, 1);

    const second = await post(base, "/api/chat", {
      room: created.data.room,
      token: joined.data.token,
      phraseId: "invite_again",
    });
    assert.equal(second.response.status, 200);
    assert.equal(second.data.message.id, 2);

    const state = await fetch(
      base + "/api/state?room=" + created.data.room + "&token=" + created.data.token
    ).then((response) => response.json());
    assert.equal(state.view.chat.length, 2);
    assert.equal(state.view.chat[0].text, "你啲牌打得真係好喎");
    assert.equal(state.view.chat[1].text, "再嚟一局？");

    const tooFast = await post(base, "/api/chat", {
      room: created.data.room,
      token: created.data.token,
      phraseId: "praise_god",
    });
    assert.equal(tooFast.response.status, 429);

    const unknown = await post(base, "/api/chat", {
      room: created.data.room,
      token: created.data.token,
      phraseId: "free_text",
    });
    assert.equal(unknown.response.status, 400);
  });
});

test("Cantonese quick chat audio is served with range support", async () => {
  await withServer(async (base) => {
    const full = await fetch(base + "/audio/chat/praise_good.m4a");
    assert.equal(full.status, 200);
    assert.equal(full.headers.get("content-type"), "audio/mp4");
    assert.equal(full.headers.get("accept-ranges"), "bytes");
    const fullSize = Number(full.headers.get("content-length"));
    assert.ok(fullSize > 1000);
    await full.arrayBuffer();

    const partial = await fetch(base + "/audio/chat/praise_good.m4a", {
      headers: { Range: "bytes=0-99" },
    });
    assert.equal(partial.status, 206);
    assert.match(partial.headers.get("content-range"), /^bytes 0-99\/\d+$/);
    assert.equal((await partial.arrayBuffer()).byteLength, 100);

    const openEnded = await fetch(base + "/audio/chat/praise_good.m4a", {
      headers: { Range: "bytes=0-999999" },
    });
    assert.equal(openEnded.status, 206);
    assert.equal(openEnded.headers.get("content-range"), "bytes 0-" + (fullSize - 1) + "/" + fullSize);
    assert.equal((await openEnded.arrayBuffer()).byteLength, fullSize);
  });
});

test("the last human leaving a playing room deletes it", async () => {
  await withServer(async (base) => {
    const created = await post(base, "/api/create", {
      name: "最后一个",
      botFill: true,
      difficulty: "standard",
      startingChips: 5000,
    });
    await post(base, "/api/start", {
      room: created.data.room,
      token: created.data.token,
    });
    const left = await post(base, "/api/leave", {
      room: created.data.room,
      token: created.data.token,
    });
    assert.equal(left.response.status, 200);
    assert.equal(rooms.has(created.data.room), false);
    const state = await fetch(
      base + "/api/state?room=" + created.data.room + "&token=" + created.data.token
    );
    assert.equal(state.status, 401);
  });
});

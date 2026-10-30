const test = require("node:test");
const assert = require("node:assert/strict");
const { PokerGame } = require("../js/engine.js");
const { PokerAI, createBotLineup } = require("../js/ai.js");
const Cards = require("../js/cards.js");

function makeGame(playerCount = 2, chips = 1000, options = {}) {
  const players = Array.from({ length: playerCount }, (_, i) => ({
    id: "p" + i,
    name: "P" + i,
    chips: Array.isArray(chips) ? chips[i] : chips,
    isHuman: i === 0,
  }));
  return new PokerGame({
    players,
    startingChips: Array.isArray(chips) ? Math.max(...chips) : chips,
    dealerIndex: options.dealerIndex ?? 0,
    blindEvery: options.blindEvery ?? 8,
    variant: options.variant ?? "holdem",
  });
}

function totalChips(game) {
  return game.players.reduce((sum, player) => sum + player.chips, 0);
}

test("heads-up blinds, button and preflop order", () => {
  const game = makeGame(2, 1000, { dealerIndex: 0 });
  assert.equal(game.startHand(), true);
  assert.equal(game.phase, "preflop");
  assert.equal(game.smallBlind, 25);
  assert.equal(game.bigBlind, 50);
  assert.equal(game.players[0].streetBet, 25);
  assert.equal(game.players[1].streetBet, 50);
  assert.equal(game.currentPlayerId, "p0");
  assert.equal(game.handNumber, 1);

  const legal = game.getLegalActions("p0");
  assert.equal(legal.canCall, true);
  assert.equal(legal.toCall, 25);
  assert.equal(legal.canRaise, true);
  assert.equal(legal.minRaiseTo, 100);

  game.act("p0", "call");
  assert.equal(game.currentPlayerId, "p1");
  assert.equal(game.getLegalActions("p1").canCheck, true);
  game.act("p1", "check");
  assert.equal(game.streetComplete, true);
  assert.equal(game.currentPlayerId, null);

  game.advanceStreet();
  assert.equal(game.phase, "flop");
  assert.equal(game.community.length, 3);
  assert.equal(game.pot, 100);
  assert.equal(game.currentPlayerId, "p1");
  assert.equal(totalChips(game) + game.pot, 2000);
});

test("minimum raise is enforced and full raises reopen action", () => {
  const game = makeGame(2, 1000);
  game.startHand();
  assert.throws(() => game.act("p0", "raise", 75), /Minimum raise/);
  game.act("p0", "raise", 100);
  assert.equal(game.currentBet, 100);
  assert.equal(game.players[0].streetBet, 100);
  assert.equal(game.getLegalActions("p1").minRaiseTo, 150);
  assert.throws(() => game.act("p1", "raise", 125), /Minimum raise/);
  game.act("p1", "raise", 150);
  assert.equal(game.currentBet, 150);
  assert.equal(game.players[0].hasActed, false);
  assert.equal(game.getLegalActions("p0").canRaise, true);
  game.act("p0", "call");
  assert.equal(game.players[0].hasActed, true);
  assert.equal(game.currentPlayerId, null);
  assert.throws(() => game.act("p1", "check"), /Not this player's turn/);
  game.advanceStreet();
  assert.equal(game.pot, 300);
});

test("folding a hand awards the pot without a showdown", () => {
  const game = makeGame(2, 1000);
  game.startHand();
  game.act("p0", "fold");
  assert.equal(game.phase, "handover");
  assert.equal(game.handResult.type, "fold");
  assert.equal(game.handResult.totalPot, 75);
  assert.equal(game.players[1].chips, 1025);
  assert.equal(game.players[0].chips, 975);
  assert.equal(totalChips(game), 2000);
});

test("three-way all-in creates and resolves correct side pots", () => {
  const game = makeGame(3, [1000, 500, 200], { dealerIndex: 2 });
  game.startHand();

  assert.equal(game.smallBlindIndex, 0);
  assert.equal(game.bigBlindIndex, 1);
  assert.equal(game.currentPlayerId, "p2");

  game.act("p2", "raise", 200);
  assert.equal(game.players[2].allIn, true);
  game.act("p0", "raise", 1000);
  assert.equal(game.players[0].allIn, true);
  game.act("p1", "call");
  assert.equal(game.players[1].allIn, true);
  assert.equal(game.streetComplete, true);

  let guard = 0;
  while (game.phase !== "showdown" && guard++ < 10) game.advanceStreet();

  assert.equal(game.phase, "showdown");
  assert.equal(game.handResult.type, "showdown");
  assert.equal(game.handResult.totalPot, 1700);
  assert.deepEqual(
    game.handResult.pots.map((pot) => pot.amount),
    [600, 600, 500]
  );
  assert.equal(totalChips(game), 1700);
  assert.ok(game.players[0].winAmount >= 500);
});

test("a short all-in does not reopen raising for players who already acted", () => {
  const game = makeGame(3, [1000, 1000, 250], { dealerIndex: 2 });
  game.startHand();
  // Button (250 chips) calls, SB raises to 200, BB calls. The button can now
  // only shove to 250: a 50-chip raise that is below the 150-chip full raise.
  game.act("p2", "call");
  game.act("p0", "raise", 200);
  game.act("p1", "call");
  assert.equal(game.currentPlayerId, "p2");
  assert.equal(game.getLegalActions("p2").canRaise, true);
  game.act("p2", "raise", 250);
  assert.equal(game.currentBet, 250);
  assert.equal(game.players[2].allIn, true);
  // p0 already acted at 200 and may call the extra 50, but may not re-raise.
  assert.equal(game.currentPlayerId, "p0");
  const legal = game.getLegalActions("p0");
  assert.equal(legal.canCall, true);
  assert.equal(legal.toCall, 50);
  assert.equal(legal.canRaise, false);
  game.act("p0", "call");
  assert.equal(game.currentPlayerId, "p1");
  assert.equal(game.getLegalActions("p1").canRaise, false);
  game.act("p1", "call");
  assert.equal(game.streetComplete, true);
  assert.equal(game.getTotalPot(), 750);
});

test("eliminated players are skipped when the button moves", () => {
  const game = makeGame(3, [1000, 0, 1000], { dealerIndex: 0 });
  game.startHand();
  assert.equal(game.players[1].dealtIn, false);
  assert.equal(game.players[1].out, true);
  const active = game.players.filter((p) => p.dealtIn);
  assert.equal(active.length, 2);
});

test("showdown ties split the pot evenly", () => {
  const game = makeGame(2, 1000);
  game.startHand();
  game.act("p0", "call");
  game.act("p1", "check");
  game.community = ["As", "Ks", "Qs", "Js", "Ts"];
  game.players[0].hole = ["2c", "3d"];
  game.players[1].hole = ["4h", "5c"];
  game._resolveShowdown();
  assert.equal(game.phase, "showdown");
  assert.equal(game.handResult.winners.length, 2);
  assert.equal(game.players[0].winAmount, 50);
  assert.equal(game.players[1].winAmount, 50);
  assert.equal(totalChips(game), 2000);
});

test("chips cannot be raised beyond the stack", () => {
  const game = makeGame(2, 1000);
  game.startHand();
  assert.throws(() => game.act("p0", "raise", 5000), /exceeds your stack/);
});

test("AI plays entire hands without illegal actions and conserves chips", () => {
  const players = Array.from({ length: 4 }, (_, i) => ({
    id: "bot" + i,
    name: "Bot" + i,
    chips: 3000,
    isHuman: false,
  }));
  const game = new PokerGame({ players, startingChips: 3000, dealerIndex: 0 });
  const lineup = createBotLineup(4, "casual", () => 0.4);
  const ais = lineup.map((profile) => new PokerAI("casual", () => 0.43));
  for (let i = 0; i < 4; i++) game.players[i].style = lineup[i].style;

  const initial = totalChips(game);
  let handsPlayed = 0;
  while (handsPlayed < 20 && game.players.filter((p) => p.chips > 0).length > 1) {
    game.startHand();
    let steps = 0;
    while (!game.handResult && steps++ < 400) {
      if (game.streetComplete) {
        game.advanceStreet();
        continue;
      }
      if (!game.currentPlayer) break;
      const player = game.currentPlayer;
      const ai = ais[player.seat];
      const action = ai.decide(game, player, { iterations: 18 });
      game.act(player.id, action.type, action.amount);
    }
    assert.ok(game.handResult, "hand should conclude");
    assert.equal(totalChips(game), initial, "chips must be conserved");
    handsPlayed += 1;
    if (game.gameOver) break;
  }
  assert.ok(handsPlayed > 0);
});


test("blinds increase every eight hands", () => {
  const game = makeGame(2, 10000, { dealerIndex: 0 });
  for (let hand = 1; hand <= 9; hand++) {
    assert.equal(game.startHand(), true);
    assert.equal(game.handNumber, hand);
    if (hand <= 8) {
      assert.equal(game.smallBlind, 25);
      assert.equal(game.bigBlind, 50);
    } else {
      assert.equal(game.smallBlind, 50);
      assert.equal(game.bigBlind, 100);
    }
    game.act(game.currentPlayerId, "fold");
  }
});


test("short deck uses 36 cards and the short-deck straight", () => {
  const game = makeGame(2, 1000, { variant: "short", dealerIndex: 0 });
  assert.equal(game.variant, "short");
  game.startHand();
  const cards = game.deck.concat(game.players.flatMap((player) => player.hole));
  assert.equal(cards.length, 36);
  assert.equal(cards.some((card) => ["2", "3", "4", "5"].includes(Cards.rankOf(card))), false);
  assert.equal(game.players[0].hole.length, 2);
});

test("short deck AI plays legal hands and conserves chips", () => {
  const players = Array.from({ length: 4 }, (_, i) => ({
    id: "bot" + i,
    name: "Bot" + i,
    chips: 3000,
    isHuman: false,
  }));
  const game = new PokerGame({
    players,
    startingChips: 3000,
    dealerIndex: 0,
    variant: "short",
  });
  const lineup = createBotLineup(4, "casual", () => 0.4);
  const ais = lineup.map(() => new PokerAI("casual", () => 0.43));
  for (let i = 0; i < 4; i++) game.players[i].style = lineup[i].style;

  const initial = totalChips(game);
  let handsPlayed = 0;
  while (handsPlayed < 8 && game.players.filter((p) => p.chips > 0).length > 1) {
    game.startHand();
    let steps = 0;
    while (!game.handResult && steps++ < 400) {
      if (game.streetComplete) {
        game.advanceStreet();
        continue;
      }
      if (!game.currentPlayer) break;
      const player = game.currentPlayer;
      const action = ais[player.seat].decide(game, player, { iterations: 18 });
      game.act(player.id, action.type, action.amount);
    }
    assert.ok(game.handResult, "short-deck hand should conclude");
    assert.equal(totalChips(game), initial, "chips must be conserved");
    handsPlayed += 1;
    if (game.gameOver) break;
  }
  assert.ok(handsPlayed > 0);
});

test("game snapshot restores a hand exactly, including hidden cards", () => {
  const game = makeGame(4, 2000, { dealerIndex: 0 });
  game.startHand();
  while (!game.streetComplete && game.currentPlayer) {
    const legal = game.getLegalActions(game.currentPlayer.id);
    game.act(game.currentPlayer.id, legal.canCheck ? "check" : "call");
  }
  game.advanceStreet();
  const snapshot = game.toSnapshot();
  const restored = PokerGame.fromSnapshot(snapshot);

  assert.equal(restored.id, game.id);
  assert.equal(restored.phase, "flop");
  assert.equal(restored.pot, game.pot);
  assert.equal(restored.currentBet, game.currentBet);
  assert.equal(restored.currentPlayerId, game.currentPlayerId);
  assert.deepEqual(restored.community, game.community);
  assert.deepEqual(restored.deck, game.deck);
  assert.deepEqual(restored.players.map((p) => p.hole), game.players.map((p) => p.hole));
  assert.equal(restored.getTotalPot(), game.getTotalPot());
  assert.equal(restored.getLegalActions(restored.currentPlayerId).canPlay, true);
  assert.equal(restored.config.players, undefined);
});

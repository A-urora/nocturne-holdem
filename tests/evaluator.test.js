const test = require("node:test");
const assert = require("node:assert/strict");
const Cards = require("../js/cards.js");
const { evaluateHand, evaluateFive, compareHands, CATEGORY_NAMES } = require("../js/evaluator.js");

function category(cards) {
  return evaluateHand(cards).category;
}

test("detects every hand category", () => {
  const cases = [
    [["As", "Ks", "Qs", "Js", "Ts", "2d", "3c"], 8, "皇家同花顺"],
    [["9h", "8h", "7h", "6h", "5h", "As", "Kd"], 8, "9 高同花顺"],
    [["Ac", "2c", "3c", "4c", "5c", "Kd", "Qh"], 8, "5 高同花顺"],
    [["Ah", "Ad", "Ac", "As", "Kd", "2c", "3h"], 7, "A 四条"],
    [["Kh", "Kd", "Kc", "9s", "9d", "2c", "3h"], 6, "K 带 9 的葫芦"],
    [["Ah", "Jh", "8h", "5h", "2h", "Kd", "Qc"], 5, "A 高同花"],
    [["9s", "8d", "7c", "6h", "5s", "Ad", "Kc"], 4, "9 高顺子"],
    [["Ah", "Ad", "Ac", "5s", "7d", "2c", "9h"], 3, "A 三条"],
    [["Ah", "Ad", "Kc", "Ks", "7d", "2c", "9h"], 2, "A 和 K 两对"],
    [["Ah", "Ad", "Kc", "Qs", "7d", "2c", "9h"], 1, "A 一对"],
    [["Ah", "Kd", "Qc", "9s", "7d", "2c", "5h"], 0, "A 高牌"],
  ];
  for (const [hand, expectedCategory, expectedName] of cases) {
    const result = evaluateHand(hand);
    assert.equal(result.category, expectedCategory, hand.join(" "));
    assert.equal(result.categoryName, CATEGORY_NAMES[expectedCategory]);
    assert.equal(result.name, expectedName, hand.join(" "));
  }
});

test("wheel straight is five-high, not ace-high", () => {
  const wheel = evaluateFive(["As", "2d", "3c", "4h", "5s"]);
  const sixHigh = evaluateFive(["2s", "3d", "4c", "5h", "6s"]);
  assert.equal(wheel.score[1], 5);
  assert.equal(compareHands(sixHigh, wheel), 1);
});

test("kickers break ties correctly", () => {
  const pairAceKing = evaluateHand(["As", "Ad", "Kd", "Qc", "9s", "4h", "2c"]);
  const pairAceQueen = evaluateHand(["Ah", "Ac", "Qd", "Jc", "9d", "4s", "2h"]);
  assert.equal(compareHands(pairAceKing, pairAceQueen), 1);
});

test("best five cards are selected from seven", () => {
  const result = evaluateHand(["Ah", "Kh", "Qh", "Jh", "Th", "2c", "3d"]);
  assert.equal(result.name, "皇家同花顺");
  assert.equal(result.cards.length, 5);
  assert.deepEqual(result.cards.slice().sort(), ["Ah", "Jh", "Kh", "Qh", "Th"].sort());
});

test("board plays and exact ties compare equal", () => {
  const board = ["As", "Ks", "Qs", "Js", "Ts"];
  const p1 = evaluateHand(["2c", "3d"].concat(board));
  const p2 = evaluateHand(["9h", "9d"].concat(board));
  assert.equal(compareHands(p1, p2), 0);
  assert.equal(p1.name, "皇家同花顺");
});

test("invalid inputs are rejected", () => {
  assert.throws(() => evaluateFive(["As", "Ks", "Qs", "Js"]));
  assert.throws(() => evaluateHand(["As", "As", "Qs", "Js", "Ts", "2c", "3d"]));
  assert.throws(() => evaluateHand(["As", "Ks"]));
});

test("card helpers format labels correctly", () => {
  assert.equal(Cards.cardLabel("As"), "A♠");
  assert.equal(Cards.cardLabel("Th"), "10♥");
  assert.equal(Cards.formatChips(12345), "12,345");
  assert.equal(Cards.formatChips(12000, true), "12k");
});

test("short deck flushes beat full houses", () => {
  const flush = evaluateFive(["As", "Ks", "Qs", "Js", "9s"], "short");
  const fullHouse = evaluateFive(["Kh", "Kd", "Kc", "6s", "6h"], "short");
  assert.equal(flush.category, 6);
  assert.equal(fullHouse.category, 5);
  assert.equal(compareHands(flush, fullHouse), 1);
  assert.equal(flush.name, "A 高同花");
});

test("standard deck keeps full houses above flushes", () => {
  const flush = evaluateFive(["As", "Ks", "Qs", "Js", "9s"]);
  const fullHouse = evaluateFive(["Kh", "Kd", "Kc", "6s", "6h"]);
  assert.equal(compareHands(flush, fullHouse), -1);
});

test("short deck wheel is A-6-7-8-9", () => {
  const wheel = evaluateFive(["As", "6h", "7d", "8c", "9s"], "short");
  const tenHigh = evaluateFive(["Ts", "9d", "8c", "7h", "6s"], "short");
  assert.equal(wheel.category, 4);
  assert.equal(wheel.score[1], 9);
  assert.equal(wheel.name, "A 到 6 顺子");
  assert.equal(compareHands(tenHigh, wheel), 1);
  assert.equal(evaluateFive(["As", "6h", "7d", "8c", "9s"]).category, 0);
});

test("short deck createDeck removes 2 through 5", () => {
  const deck = Cards.createDeck("short");
  assert.equal(deck.length, 36);
  assert.equal(deck.some((card) => ["2", "3", "4", "5"].includes(Cards.rankOf(card))), false);
});

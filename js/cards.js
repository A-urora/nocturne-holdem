/*! Nocturne Hold'em — card utilities (MIT) */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.Cards = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
  const SUITS = ["s", "h", "d", "c"];
  const SUIT_SYMBOLS = { s: "♠", h: "♥", d: "♦", c: "♣" };
  const SUIT_NAMES = { s: "黑桃", h: "红桃", d: "方块", c: "梅花" };
  const RANK_NAMES = {
    2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8", 9: "9",
    10: "10", 11: "J", 12: "Q", 13: "K", 14: "A",
  };
  const RED_SUITS = new Set(["h", "d"]);

  function createDeck() {
    const deck = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) deck.push(rank + suit);
    }
    return deck;
  }

  function parseCard(card) {
    if (typeof card !== "string" || card.length < 2) {
      throw new Error("Invalid card: " + card);
    }
    const suit = card.slice(-1).toLowerCase();
    const rankText = card.slice(0, -1).toUpperCase();
    const rank = RANKS.indexOf(rankText) + 2;
    if (rank < 2 || !SUITS.includes(suit)) throw new Error("Invalid card: " + card);
    return { code: rankText + suit, rank, suit };
  }

  function rankOf(card) {
    return parseCard(card).rank;
  }

  function suitOf(card) {
    return parseCard(card).suit;
  }

  function isRed(card) {
    return RED_SUITS.has(suitOf(card));
  }

  function cardLabel(card) {
    const c = parseCard(card);
    return RANK_NAMES[c.rank] + SUIT_SYMBOLS[c.suit];
  }

  function rankLabel(rank) {
    return RANK_NAMES[rank] || String(rank);
  }

  function suitSymbol(suit) {
    return SUIT_SYMBOLS[suit] || "";
  }

  function secureRandomInt(max) {
    if (!Number.isInteger(max) || max <= 0) throw new Error("max must be a positive integer");
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      const limit = Math.floor(0x100000000 / max) * max;
      const buf = new Uint32Array(1);
      do {
        crypto.getRandomValues(buf);
      } while (buf[0] >= limit);
      return buf[0] % max;
    }
    return Math.floor(Math.random() * max);
  }

  function shuffle(deck, randomInt) {
    const rng = typeof randomInt === "function" ? randomInt : secureRandomInt;
    for (let i = deck.length - 1; i > 0; i--) {
      const j = rng(i + 1);
      const tmp = deck[i];
      deck[i] = deck[j];
      deck[j] = tmp;
    }
    return deck;
  }

  function sortDescending(cards) {
    return cards.slice().sort((a, b) => parseCard(b).rank - parseCard(a).rank);
  }

  function combinations(items, choose) {
    const result = [];
    const stack = [];
    function walk(start) {
      if (stack.length === choose) {
        result.push(stack.slice());
        return;
      }
      const remaining = choose - stack.length;
      for (let i = start; i <= items.length - remaining; i++) {
        stack.push(items[i]);
        walk(i + 1);
        stack.pop();
      }
    }
    walk(0);
    return result;
  }

  function formatChips(value, compact) {
    const n = Math.max(0, Math.round(Number(value) || 0));
    if (compact && n >= 1000000) return (n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1) + "m";
    if (compact && n >= 10000) return (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + "k";
    return n.toLocaleString("en-US");
  }

  function formatAmount(value) {
    return formatChips(value, false);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  return {
    RANKS,
    SUITS,
    SUIT_SYMBOLS,
    SUIT_NAMES,
    RANK_NAMES,
    createDeck,
    parseCard,
    rankOf,
    suitOf,
    isRed,
    cardLabel,
    rankLabel,
    suitSymbol,
    secureRandomInt,
    shuffle,
    sortDescending,
    combinations,
    formatChips,
    formatAmount,
    sleep,
  };
});

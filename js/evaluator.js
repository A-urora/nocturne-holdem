/*! Nocturne Hold'em — poker hand evaluator (MIT) */
(function (root, factory) {
  const Cards = typeof module === "object" && module.exports ? require("./cards.js") : root.Cards;
  const api = factory(Cards);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.HandEvaluator = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Cards) {
  "use strict";

  const CATEGORY_NAMES = [
    "高牌",
    "一对",
    "两对",
    "三条",
    "顺子",
    "同花",
    "葫芦",
    "四条",
    "同花顺",
  ];

  const CATEGORY_EN = [
    "High Card",
    "One Pair",
    "Two Pair",
    "Three of a Kind",
    "Straight",
    "Flush",
    "Full House",
    "Four of a Kind",
    "Straight Flush",
  ];

  // In 6+ short deck, a flush outranks a full house. Straight still outranks
  // trips in the common 7-card game, so only those two categories swap.
  const SHORT_CATEGORY_NAMES = [
    "高牌",
    "一对",
    "两对",
    "三条",
    "顺子",
    "葫芦",
    "同花",
    "四条",
    "同花顺",
  ];

  const SHORT_CATEGORY_EN = [
    "High Card",
    "One Pair",
    "Two Pair",
    "Three of a Kind",
    "Straight",
    "Full House",
    "Flush",
    "Four of a Kind",
    "Straight Flush",
  ];

  const cache5 = new Map();

  function cardSort(a, b) {
    return Cards.parseCard(b).rank - Cards.parseCard(a).rank;
  }

  function straightHigh(ranks, variant) {
    if (ranks.length !== 5) return 0;
    if (variant === "short") {
      // 6+ short deck wheel: A-6-7-8-9. A-2-3-4-5 does not exist.
      if (ranks[0] === 14 && ranks[1] === 9 && ranks[2] === 8 && ranks[3] === 7 && ranks[4] === 6) {
        return 9;
      }
    } else if (ranks[0] === 14 && ranks[1] === 5 && ranks[2] === 4 && ranks[3] === 3 && ranks[4] === 2) {
      return 5; // wheel: A-2-3-4-5
    }
    for (let i = 0; i < 4; i++) {
      if (ranks[i] - ranks[i + 1] !== 1) return 0;
    }
    return ranks[0];
  }

  /**
   * Rank exactly five cards. Returned score arrays compare lexicographically.
   * Category: 0 high card ... 8 straight flush.
   */
  function evaluateFive(cards, variant = "holdem") {
    if (!Array.isArray(cards) || cards.length !== 5) {
      throw new Error("evaluateFive requires exactly 5 cards");
    }
    const short = variant === "short";
    const key = (short ? "short|" : "holdem|") + cards.slice().sort().join("");
    const cached = cache5.get(key);
    if (cached) return cached;

    const parsed = cards.map(Cards.parseCard);
    parsed.sort((a, b) => b.rank - a.rank);
    const ranks = parsed.map((c) => c.rank);
    const suits = parsed.map((c) => c.suit);
    const flush = suits.every((s) => s === suits[0]);
    const unique = [...new Set(ranks)];
    const straight = straightHigh(unique, variant);

    const counts = new Map();
    for (const rank of ranks) counts.set(rank, (counts.get(rank) || 0) + 1);
    const groups = [...counts.entries()].sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return b[0] - a[0];
    });

    const orderedCards = [];
    for (const [rank] of groups) {
      for (const card of cards) {
        if (Cards.rankOf(card) === rank) orderedCards.push(card);
      }
    }

    let category;
    let tiebreak;
    if (flush && straight) {
      category = 8;
      tiebreak = [straight];
    } else if (groups[0][1] === 4) {
      category = 7;
      tiebreak = [groups[0][0], groups[1][0]];
    } else if (groups[0][1] === 3 && groups[1][1] === 2) {
      category = short ? 5 : 6;
      tiebreak = [groups[0][0], groups[1][0]];
    } else if (flush) {
      category = short ? 6 : 5;
      tiebreak = ranks.slice();
    } else if (straight) {
      category = 4;
      tiebreak = [straight];
    } else if (groups[0][1] === 3) {
      category = 3;
      tiebreak = [groups[0][0], ...groups.slice(1).map((g) => g[0]).sort((a, b) => b - a)];
    } else if (groups[0][1] === 2 && groups[1][1] === 2) {
      category = 2;
      const pairs = [groups[0][0], groups[1][0]].sort((a, b) => b - a);
      tiebreak = [pairs[0], pairs[1], groups[2][0]];
    } else if (groups[0][1] === 2) {
      category = 1;
      tiebreak = [groups[0][0], ...groups.slice(1).map((g) => g[0]).sort((a, b) => b - a)];
    } else {
      category = 0;
      tiebreak = ranks.slice();
    }

    const categoryNames = short ? SHORT_CATEGORY_NAMES : CATEGORY_NAMES;
    const categoryEn = short ? SHORT_CATEGORY_EN : CATEGORY_EN;
    const result = {
      category,
      score: [category, ...tiebreak],
      cards: orderedCards,
      categoryName: categoryNames[category],
      categoryEn: categoryEn[category],
      name: buildName(category, tiebreak, short),
      shortName: buildShortName(category, tiebreak, short),
      high: tiebreak[0] || 0,
      variant: short ? "short" : "holdem",
    };
    if (cache5.size < 50000) cache5.set(key, result);
    return result;
  }

  function buildName(category, tiebreak, short) {
    const r = (n) => Cards.rankLabel(n);
    switch (category) {
      case 8:
        return tiebreak[0] === 14 ? "皇家同花顺" : r(tiebreak[0]) + " 高同花顺";
      case 7:
        return r(tiebreak[0]) + " 四条";
      case 6:
        if (short) return r(tiebreak[0]) + " 高同花";
        return r(tiebreak[0]) + " 带 " + r(tiebreak[1]) + " 的葫芦";
      case 5:
        if (short) return r(tiebreak[0]) + " 带 " + r(tiebreak[1]) + " 的葫芦";
        return r(tiebreak[0]) + " 高同花";
      case 4:
        if (tiebreak[0] === 5) return "A 到 5 顺子";
        if (short && tiebreak[0] === 9) return "A 到 6 顺子";
        return r(tiebreak[0]) + " 高顺子";
      case 3:
        return r(tiebreak[0]) + " 三条";
      case 2:
        return r(tiebreak[0]) + " 和 " + r(tiebreak[1]) + " 两对";
      case 1:
        return r(tiebreak[0]) + " 一对";
      default:
        return r(tiebreak[0]) + " 高牌";
    }
  }

  function buildShortName(category, tiebreak, short) {
    const r = (n) => Cards.rankLabel(n);
    switch (category) {
      case 8:
        return tiebreak[0] === 14 ? "皇家同花顺" : "同花顺";
      case 7:
        return "四条 " + r(tiebreak[0]);
      case 6:
        return short ? "同花" : "葫芦 " + r(tiebreak[0]);
      case 5:
        return short ? "葫芦 " + r(tiebreak[0]) : "同花";
      case 4:
        return "顺子";
      case 3:
        return "三条 " + r(tiebreak[0]);
      case 2:
        return "两对 " + r(tiebreak[0]) + "/" + r(tiebreak[1]);
      case 1:
        return "一对 " + r(tiebreak[0]);
      default:
        return r(tiebreak[0]) + " 高牌";
    }
  }

  const comboCache = new Map();

  function combosOf(cards) {
    const n = cards.length;
    const key = n;
    if (comboCache.has(key)) {
      const indexes = comboCache.get(key);
      return indexes.map((combo) => combo.map((i) => cards[i]));
    }
    const max = n;
    const out = [];
    for (let a = 0; a < max - 4; a++) {
      for (let b = a + 1; b < max - 3; b++) {
        for (let c = b + 1; c < max - 2; c++) {
          for (let d = c + 1; d < max - 1; d++) {
            for (let e = d + 1; e < max; e++) out.push([a, b, c, d, e]);
          }
        }
      }
    }
    comboCache.set(key, out);
    return out.map((combo) => combo.map((i) => cards[i]));
  }

  /**
   * Evaluate the best five-card hand from 5, 6 or 7 cards.
   */
  function evaluateHand(cards, variant = "holdem") {
    if (!Array.isArray(cards) || cards.length < 5 || cards.length > 7) {
      throw new Error("evaluateHand requires 5 to 7 cards");
    }
    if (cards.length === 5) return evaluateFive(cards, variant);
    if (new Set(cards).size !== cards.length) throw new Error("Duplicate cards in hand");

    let best = null;
    for (const combo of combosOf(cards)) {
      const rank = evaluateFive(combo, variant);
      if (!best || compareScores(rank.score, best.score) > 0) best = rank;
    }
    return best;
  }

  function compareScores(a, b) {
    const length = Math.max(a.length, b.length);
    for (let i = 0; i < length; i++) {
      const av = a[i] || 0;
      const bv = b[i] || 0;
      if (av !== bv) return av - bv;
    }
    return 0;
  }

  function compareHands(a, b) {
    if (!a && !b) return 0;
    if (!a) return -1;
    if (!b) return 1;
    return compareScores(a.score, b.score);
  }

  function describeHoleCards(hole, board, variant = "holdem") {
    if (!hole || hole.length !== 2) return "";
    if (board && board.length >= 3) {
      try {
        return evaluateHand(hole.concat(board), variant).name;
      } catch (error) {
        return "";
      }
    }
    const a = Cards.parseCard(hole[0]);
    const b = Cards.parseCard(hole[1]);
    const high = Math.max(a.rank, b.rank);
    const low = Math.min(a.rank, b.rank);
    if (high === low) {
      return "口袋 " + Cards.rankLabel(high) + " 对";
    }
    const suited = a.suit === b.suit;
    const gap = high - low;
    let name = Cards.rankLabel(high) + Cards.rankLabel(low);
    if (suited) name += " 同花";
    if (gap === 1) name += " · 连牌";
    return name;
  }

  return {
    CATEGORY_NAMES,
    CATEGORY_EN,
    evaluateFive,
    evaluateHand,
    compareHands,
    compareScores,
    describeHoleCards,
  };
});

/*! Nocturne Hold'em — heuristic computer players (MIT) */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const Cards = isNode ? require("./cards.js") : root.Cards;
  const HandEvaluator = isNode ? require("./evaluator.js") : root.HandEvaluator;
  const api = factory(Cards, HandEvaluator);
  if (isNode) module.exports = api;
  root.PokerAI = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Cards, HandEvaluator) {
  "use strict";

  const BOT_PROFILES = [
    {
      name: "洛克",
      avatar: "🦊",
      color: "#e0a04d",
      tag: "紧凶",
      style: { aggression: 0.72, tightness: 0.68, bluff: 0.24, patience: 0.72 },
      lines: ["这桌有点意思。", "我只看牌说话。"],
    },
    {
      name: "Nova",
      avatar: "🌙",
      color: "#9d8cff",
      tag: "松凶",
      style: { aggression: 0.84, tightness: 0.32, bluff: 0.52, patience: 0.34 },
      lines: ["压力给到你。", "别眨眼。"],
    },
    {
      name: "阿七",
      avatar: "🐼",
      color: "#58c2a4",
      tag: "岩石",
      style: { aggression: 0.34, tightness: 0.84, bluff: 0.1, patience: 0.88 },
      lines: ["耐心，是一种武器。", "牌好才上。"],
    },
    {
      name: "Luna",
      avatar: "🦋",
      color: "#f58fb0",
      tag: "幻术",
      style: { aggression: 0.68, tightness: 0.4, bluff: 0.62, patience: 0.42 },
      lines: ["你猜我有没有牌？", "月亮站在我这边。"],
    },
    {
      name: "老陈",
      avatar: "🐯",
      color: "#df6b5f",
      tag: "稳健",
      style: { aggression: 0.5, tightness: 0.62, bluff: 0.2, patience: 0.7 },
      lines: ["稳一点，总没错。", "这手牌值得。"],
    },
    {
      name: "Mika",
      avatar: "⚡",
      color: "#5cb5e8",
      tag: "疯子",
      style: { aggression: 0.92, tightness: 0.22, bluff: 0.58, patience: 0.28 },
      lines: ["全下才是浪漫。", "速度，速度！"],
    },
  ];

  const DIFFICULTIES = {
    casual: {
      id: "casual",
      label: "休闲",
      description: "对手更爱跟注，偶尔犯点小错",
      iterations: 110,
      aggression: -0.06,
      tightness: 0.08,
      bluff: -0.08,
      mistake: 0.08,
      callMargin: 0.025,
    },
    standard: {
      id: "standard",
      label: "标准",
      description: "会看底池赔率与位置，攻守平衡",
      iterations: 240,
      aggression: 0,
      tightness: 0,
      bluff: 0,
      mistake: 0.02,
      callMargin: 0.01,
    },
    pro: {
      id: "pro",
      label: "职业",
      description: "更紧更凶，会施压，也会抓诈唬",
      iterations: 360,
      aggression: 0.08,
      tightness: -0.03,
      bluff: 0.1,
      mistake: 0,
      callMargin: -0.005,
    },
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function chenScore(hole) {
    const a = Cards.parseCard(hole[0]).rank;
    const b = Cards.parseCard(hole[1]).rank;
    const high = Math.max(a, b);
    const low = Math.min(a, b);
    let score;
    if (high === 14) score = 10;
    else if (high === 13) score = 8;
    else if (high === 12) score = 7;
    else if (high === 11) score = 6;
    else score = high / 2;
    if (high === low) score = Math.max(5, score * 2);
    if (Cards.suitOf(hole[0]) === Cards.suitOf(hole[1])) score += 2;
    const gap = high - low - 1;
    if (gap === 1) score -= 1;
    else if (gap === 2) score -= 2;
    else if (gap === 3) score -= 4;
    else if (gap >= 4) score -= 5;
    if (gap <= 1 && high < 12) score += 1;
    return score;
  }

  /**
   * Monte Carlo equity against unseen random hands. It never looks at the
   * opponents' actual hole cards, so the bots play honestly.
   */
  function estimateEquity(hole, board, opponentCount, iterations, random = Math.random) {
    if (opponentCount <= 0) return 1;
    if (!hole || hole.length !== 2) return 0;
    const known = new Set(hole.concat(board || []));
    const unseen = Cards.createDeck().filter((card) => !known.has(card));
    const missingBoard = 5 - (board ? board.length : 0);
    const needed = opponentCount * 2 + missingBoard;
    if (needed > unseen.length) return 0;

    const fixedBoard = board ? board.slice() : [];
    const heroPrecomputed =
      missingBoard === 0
        ? HandEvaluator.evaluateHand(hole.concat(fixedBoard))
        : null;
    let score = 0;
    const total = Math.max(24, iterations || 160);

    for (let iteration = 0; iteration < total; iteration++) {
      const pool = unseen.slice();
      // Partial Fisher-Yates: only draw the cards we need.
      for (let i = 0; i < needed; i++) {
        const j = i + Math.floor(random() * (pool.length - i));
        const tmp = pool[i];
        pool[i] = pool[j];
        pool[j] = tmp;
      }
      let cursor = 0;
      const opponentHands = [];
      for (let i = 0; i < opponentCount; i++) {
        opponentHands.push([pool[cursor++], pool[cursor++]]);
      }
      const runout = fixedBoard.concat(pool.slice(cursor, cursor + missingBoard));
      const hero = heroPrecomputed || HandEvaluator.evaluateHand(hole.concat(runout));

      let best = hero;
      let ties = 1;
      let beaten = false;
      for (const opponentHole of opponentHands) {
        const opponent = HandEvaluator.evaluateHand(opponentHole.concat(runout));
        const cmp = HandEvaluator.compareHands(opponent, best);
        if (cmp > 0) {
          best = opponent;
          ties = 1;
          beaten = true;
        } else if (cmp === 0) {
          ties += 1;
        }
      }
      if (!beaten) score += 1 / ties;
    }
    return score / total;
  }

  function countPlayersToAct(game, player) {
    let count = 0;
    const total = game.players.length;
    for (let offset = 1; offset < total; offset++) {
      const index = (player.seat + offset) % total;
      const other = game.players[index];
      if (other.id === player.id) break;
      if (other.dealtIn && !other.folded && !other.allIn) count += 1;
      if (index === game.dealerIndex) break;
    }
    return count;
  }

  function roundTarget(game, legal, desired) {
    const unit = Math.max(1, Math.round(game.bigBlind / 2));
    let target = Math.round(desired / unit) * unit;
    const minimum = legal.minRaiseTo;
    const maximum = legal.maxRaiseTo;
    if (target < minimum) target = minimum;
    if (target > maximum) target = maximum;
    if (target < game.currentBet + 1) target = Math.min(maximum, game.currentBet + 1);
    if (maximum - target <= unit) target = maximum;
    return Math.round(target);
  }

  function sanitizeAction(action, legal, game) {
    if (!action || !action.type) {
      if (legal.canCheck) return { type: "check" };
      if (legal.canCall) return { type: "call" };
      return { type: "fold" };
    }
    if (action.type === "check" && !legal.canCheck) {
      if (legal.canCall) return { type: "call" };
      return { type: "fold" };
    }
    if (action.type === "call" && !legal.canCall) {
      if (legal.canCheck) return { type: "check" };
      return { type: "fold" };
    }
    if (action.type === "fold" && legal.canCheck) return { type: "check" };
    if (action.type === "raise") {
      if (!legal.canRaise) {
        if (legal.canCall) return { type: "call" };
        if (legal.canCheck) return { type: "check" };
        return { type: "fold" };
      }
      let amount = Number(action.amount);
      if (!Number.isFinite(amount)) amount = legal.minRaiseTo;
      amount = Math.round(clamp(amount, legal.minRaiseTo, legal.maxRaiseTo));
      if (amount <= game.currentBet) amount = Math.min(legal.maxRaiseTo, legal.minRaiseTo);
      if (amount < legal.minRaiseLegal && amount !== legal.maxRaiseTo) {
        amount = Math.min(legal.maxRaiseTo, legal.minRaiseLegal);
      }
      return { type: "raise", amount };
    }
    return action;
  }

  class PokerAI {
    constructor(difficulty = "standard", random = Math.random) {
      this.difficultyId = DIFFICULTIES[difficulty] ? difficulty : "standard";
      this.difficulty = DIFFICULTIES[this.difficultyId];
      this.random = random;
    }

    decide(game, player, options = {}) {
      const legal = game.getLegalActions(player.id);
      if (!legal.canPlay) {
        return { type: legal.canCheck ? "check" : "fold" };
      }
      const style = player.style || {
        aggression: 0.5,
        tightness: 0.5,
        bluff: 0.3,
        patience: 0.5,
      };
      const diff = this.difficulty;
      const random = this.random;
      const opponents = game.inHandPlayers.filter((p) => p.id !== player.id);
      const opponentCount = Math.max(1, opponents.length);
      const iterations =
        options.iterations ||
        Math.max(30, Math.round(diff.iterations * (opponentCount > 3 ? 0.7 : 1)));
      let equity = estimateEquity(
        player.hole,
        game.community,
        opponentCount,
        iterations,
        random
      );

      // A tiny, bounded perception error makes casual bots less machine-like.
      if (diff.mistake > 0) {
        equity = clamp(equity + (random() - 0.5) * diff.mistake, 0, 1);
      }

      const pot = game.getTotalPot();
      const toCall = Math.max(0, legal.toCall);
      const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;
      const average = 1 / (opponentCount + 1);
      const edge = equity - average;
      const toAct = countPlayersToAct(game, player);
      const inPosition = toAct <= Math.floor(opponentCount / 2);
      const positionBonus = inPosition ? 0.018 : 0;
      const aggression = clamp(style.aggression + diff.aggression + (random() - 0.5) * 0.1, 0.15, 0.98);
      const tightness = clamp(style.tightness + diff.tightness, 0.08, 0.95);
      const bluff = clamp(style.bluff + diff.bluff, 0.02, 0.82);
      const stackBB = player.chips / game.bigBlind;
      const multiway = Math.max(0, opponentCount - 1);
      const street = game.phase;

      let action;

      if (street === "preflop") {
        const chen = chenScore(player.hole) / 20;
        const blended = equity * 0.78 + clamp(chen, 0, 1) * 0.22;
        const shortStacked = stackBB < 13;
        const facingRaise = game.currentBet > game.bigBlind;
        const raiseEdge = 0.065 + tightness * 0.035 - positionBonus;
        const callEdge = -0.012 + tightness * 0.02 - positionBonus * 0.4;

        if (legal.canCheck) {
          const wantsRaise =
            (blended > average + 0.07 + tightness * 0.03 || (blended > average && random() < aggression * 0.35)) &&
            legal.canRaise;
          if (wantsRaise) {
            const desired = facingRaise
              ? game.currentBet * 2.6
              : game.bigBlind * (2.6 + random() * 0.8);
            action = { type: "raise", amount: roundTarget(game, legal, desired) };
          } else {
            action = { type: "check" };
          }
        } else if (shortStacked) {
          const shoveWorthy = edge > 0.085 + tightness * 0.03;
          const callWorthy = equity > potOdds + 0.035 + tightness * 0.02;
          if (shoveWorthy && legal.canRaise && random() < 0.7 + aggression * 0.25) {
            action = { type: "raise", amount: legal.maxRaiseTo };
          } else if (callWorthy) {
            action = legal.isAllInCall && equity < potOdds + 0.08 ? { type: "fold" } : { type: "call" };
          } else {
            action = { type: "fold" };
          }
        } else if (edge > raiseEdge && legal.canRaise) {
          if (random() < 0.45 + aggression * 0.45) {
            const desired = facingRaise
              ? game.currentBet * (2.4 + aggression * 0.6)
              : game.bigBlind * (2.5 + random() * 1.1);
            action = { type: "raise", amount: roundTarget(game, legal, desired) };
          } else {
            action = { type: "call" };
          }
        } else if (equity > potOdds + callEdge + multiway * 0.006) {
          action = { type: "call" };
        } else if (
          !facingRaise &&
          random() < bluff * 0.045 &&
          legal.canRaise &&
          positionBonus > 0
        ) {
          action = {
            type: "raise",
            amount: roundTarget(game, legal, game.currentBet * 3 + game.bigBlind * 0.5),
          };
        } else {
          action = { type: "fold" };
        }

        // Premium hands should not be folded to a single raise at a shallow stack.
        if (
          action.type === "fold" &&
          edge > 0.18 &&
          legal.canCall &&
          player.chips <= game.bigBlind * 35
        ) {
          action = { type: "call" };
        }
      } else {
        let madeHand = null;
        if (game.community.length >= 3) {
          try {
            madeHand = HandEvaluator.evaluateHand(player.hole.concat(game.community));
          } catch (error) {
            madeHand = null;
          }
        }
        const category = madeHand ? madeHand.category : 0;
        const strongMade = category >= 3;
        const veryStrong = category >= 5;

        if (!legal.canCheck) {
          // Facing a bet.
          const allInPressure = legal.isAllInCall;
          const callMargin =
            0.015 +
            tightness * 0.025 +
            multiway * 0.006 +
            (allInPressure ? 0.035 : 0) +
            diff.callMargin;
          const raiseWorthy =
            equity > 0.7 + multiway * 0.012 ||
            (strongMade && equity > 0.58) ||
            (veryStrong && equity > 0.5);
          const bluffRaise =
            random() < bluff * 0.05 &&
            game.community.length >= 3 &&
            !allInPressure &&
            legal.canRaise;

          if (raiseWorthy && legal.canRaise && random() < 0.48 + aggression * 0.42) {
            const desired =
              game.currentBet + (pot + toCall) * (0.55 + aggression * 0.32);
            action = { type: "raise", amount: roundTarget(game, legal, desired) };
          } else if (
            equity > potOdds + callMargin ||
            (equity > potOdds - 0.012 && random() < 0.22 + aggression * 0.12)
          ) {
            action = { type: "call" };
          } else if (bluffRaise) {
            action = {
              type: "raise",
              amount: roundTarget(game, legal, game.currentBet + (pot + toCall) * 0.7),
            };
          } else {
            action = { type: "fold" };
          }
        } else {
          // Checked to us: value bet, protection bet, or occasional bluff.
          const valueBet =
            equity > 0.68 - multiway * 0.01 ||
            (strongMade && equity > 0.5) ||
            (category >= 2 && equity > 0.55 && random() < aggression);
          const thinValue = equity > 0.52 && random() < aggression * 0.55;
          const bluffSpot =
            game.community.length < 5 &&
            equity < average + 0.075 &&
            random() < bluff * 0.22 * (inPosition ? 1.3 : 0.7);

          if ((valueBet || thinValue) && legal.canRaise && random() < 0.35 + aggression * 0.55) {
            const factor = veryStrong ? 0.72 : strongMade ? 0.58 : 0.46;
            action = {
              type: "raise",
              amount: roundTarget(game, legal, Math.max(game.bigBlind, pot * factor)),
            };
          } else if (bluffSpot && legal.canRaise) {
            action = {
              type: "raise",
              amount: roundTarget(game, legal, Math.max(game.bigBlind, pot * (0.5 + random() * 0.18))),
            };
          } else {
            action = { type: "check" };
          }
        }

        // If a huge portion of the stack is going in, prefer a clean shove.
        if (
          action.type === "raise" &&
          action.amount >= legal.maxRaiseTo * 0.92 &&
          legal.canRaise
        ) {
          action.amount = legal.maxRaiseTo;
        }
      }

      return sanitizeAction(action, legal, game);
    }
  }

  function createBotLineup(count, difficulty = "standard", random = Math.random) {
    const pool = BOT_PROFILES.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      const tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
    }
    return pool.slice(0, Math.max(0, count)).map((profile) => ({
      ...profile,
      difficulty,
    }));
  }

  return {
    BOT_PROFILES,
    DIFFICULTIES,
    PokerAI,
    estimateEquity,
    chenScore,
    createBotLineup,
    sanitizeAction,
  };
});

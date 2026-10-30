/*! Nocturne Hold'em — no-limit Texas Hold'em rules engine (MIT) */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const Cards = isNode ? require("./cards.js") : root.Cards;
  const HandEvaluator = isNode ? require("./evaluator.js") : root.HandEvaluator;
  const api = factory(Cards, HandEvaluator);
  if (isNode) module.exports = api;
  root.PokerEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Cards, HandEvaluator) {
  "use strict";

  const STREETS = ["preflop", "flop", "turn", "river"];
  const PHASE_LABELS = {
    idle: "等待开始",
    preflop: "翻牌前",
    flop: "翻牌圈",
    turn: "转牌圈",
    river: "河牌圈",
    showdown: "摊牌",
    handover: "本手结束",
    gameover: "牌局结束",
  };

  const BLIND_LEVELS = [
    [25, 50],
    [50, 100],
    [75, 150],
    [100, 200],
    [150, 300],
    [200, 400],
    [300, 600],
    [400, 800],
    [600, 1200],
    [800, 1600],
    [1200, 2400],
    [1600, 3200],
  ];

  let gameId = 0;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  class PokerGame {
    constructor(options = {}) {
      this.id = ++gameId;
      this.config = {
        startingChips: 5000,
        blindEvery: 8,
        variant: "holdem",
        ...options,
      };
      this.variant = this.config.variant === "short" ? "short" : "holdem";
      this.players = (options.players || []).map((player, index) => ({
        id: player.id || "p" + (index + 1),
        name: player.name || "玩家 " + (index + 1),
        avatar: player.avatar || "♠",
        color: player.color || "#d8b56a",
        tag: player.tag || "",
        isHuman: Boolean(player.isHuman),
        style: player.style || null,
        seat: index,
        chips: Math.max(0, Math.round(player.chips ?? this.config.startingChips)),
        hole: [],
        streetBet: 0,
        totalBet: 0,
        hasActed: false,
        folded: false,
        allIn: false,
        out: false,
        eliminated: false,
        sittingOut: Boolean(player.sittingOut),
        dealtIn: false,
        revealed: false,
        bestHand: null,
        lastAction: null,
        winAmount: 0,
        isWinner: false,
      }));

      if (this.players.length < 2) throw new Error("A poker game needs at least 2 players");

      this.handNumber = 0;
      this.dealerIndex = Number.isInteger(options.dealerIndex) ? options.dealerIndex : null;
      this.smallBlindIndex = null;
      this.bigBlindIndex = null;
      this.phase = "idle";
      this.community = [];
      this.deck = [];
      this.pot = 0;
      this.currentBet = 0;
      this.lastFullRaise = 0;
      this.currentPlayerId = null;
      this.streetComplete = true;
      this.handResult = null;
      this.showdown = null;
      this.gameOver = false;
      this.champion = null;
      this.handNumber = 0;
      this.blindLevel = -1;
      this.smallBlind = 25;
      this.bigBlind = 50;
      this.log = [];
      this.logSeq = 0;
      this.actionSeq = 0;
      this.version = 0;
      this.started = false;
    }

    /* ---------------------------------------------------------------- state */

    get alivePlayers() {
      return this.players.filter((p) => p.chips > 0);
    }

    get inHandPlayers() {
      return this.players.filter((p) => p.dealtIn && !p.folded);
    }

    get currentPlayer() {
      return this.players.find((p) => p.id === this.currentPlayerId) || null;
    }

    getPlayer(id) {
      return this.players.find((p) => p.id === id) || null;
    }

    getTotalPot() {
      return this.pot + this.players.reduce((sum, p) => sum + p.streetBet, 0);
    }

    getHandsUntilBlindIncrease() {
      const playedAtLevel = (this.handNumber - 1) % this.config.blindEvery;
      return this.config.blindEvery - playedAtLevel;
    }

    getPhaseLabel() {
      return PHASE_LABELS[this.phase] || this.phase;
    }

    getBlindsForLevel(level) {
      if (level < BLIND_LEVELS.length) {
        return { smallBlind: BLIND_LEVELS[level][0], bigBlind: BLIND_LEVELS[level][1] };
      }
      const extra = level - BLIND_LEVELS.length + 1;
      return {
        smallBlind: BLIND_LEVELS[BLIND_LEVELS.length - 1][0] * Math.pow(2, extra),
        bigBlind: BLIND_LEVELS[BLIND_LEVELS.length - 1][1] * Math.pow(2, extra),
      };
    }

    getPositionLabel(player) {
      if (!player) return "";
      if (player.sittingOut) return "暂离";
      if (!player.dealtIn) return "";
      const inHand = this.players.filter((p) => p.dealtIn && !p.out);
      if (inHand.length === 2) {
        return player.seat === this.dealerIndex ? "按钮 / 小盲" : "大盲";
      }
      if (player.seat === this.dealerIndex) return "按钮位";
      if (player.seat === this.smallBlindIndex) return "小盲";
      if (player.seat === this.bigBlindIndex) return "大盲";
      return "";
    }

    /* ---------------------------------------------------------------- helpers */

    _log(kind, text, extra = {}) {
      this.log.push({
        id: ++this.logSeq,
        hand: this.handNumber,
        kind,
        text,
        ...extra,
      });
      if (this.log.length > 400) this.log.splice(0, this.log.length - 400);
    }

    _nextSeat(startIndex, predicate) {
      const count = this.players.length;
      for (let offset = 1; offset <= count; offset++) {
        const index = (startIndex + offset + count) % count;
        const player = this.players[index];
        if (predicate(player, index)) return index;
      }
      return -1;
    }

    _seatOf(player) {
      return this.players.indexOf(player);
    }

    _inHandAt(index) {
      const player = this.players[index];
      return player && player.dealtIn && !player.folded;
    }

    _needsAction(player) {
      return Boolean(
        player &&
        player.dealtIn &&
        !player.folded &&
        !player.allIn &&
        player.chips > 0 &&
        (!player.hasActed || player.streetBet < this.currentBet)
      );
    }

    _findNextNeedingAction(startIndex, includeStart = false) {
      const count = this.players.length;
      const firstOffset = includeStart ? 0 : 1;
      for (let offset = firstOffset; offset < count + firstOffset; offset++) {
        const index = (startIndex + offset + count) % count;
        if (this._needsAction(this.players[index])) return index;
      }
      return -1;
    }

    _othersCanAct(player) {
      return this.inHandPlayers.some(
        (p) => p.id !== player.id && !p.allIn && p.chips > 0
      );
    }

    _roundCanContinue() {
      const inHand = this.inHandPlayers;
      if (inHand.length <= 1) return false;
      const canAct = inHand.filter((p) => !p.allIn && p.chips > 0);
      if (canAct.length === 0) return false;
      if (canAct.length === 1 && canAct[0].streetBet >= this.currentBet) return false;
      return true;
    }

    _collectBets() {
      const collected = this.players.reduce((sum, p) => sum + p.streetBet, 0);
      this.pot += collected;
      for (const player of this.players) player.streetBet = 0;
      return collected;
    }

    _resetForStreet() {
      this.currentBet = 0;
      this.lastFullRaise = this.bigBlind;
      this.currentPlayerId = null;
      for (const player of this.players) {
        player.hasActed = false;
        if (this._inHandAt(player.seat) && !player.allIn) {
          player.lastAction = null;
        }
      }
    }

    _markCurrentPlayer(index) {
      if (index < 0) {
        this.currentPlayerId = null;
        this.streetComplete = true;
        return false;
      }
      this.currentPlayerId = this.players[index].id;
      this.streetComplete = false;
      return true;
    }

    _commit(player, amount) {
      const paid = Math.max(0, Math.min(player.chips, Math.round(amount)));
      player.chips -= paid;
      player.streetBet += paid;
      player.totalBet += paid;
      if (player.chips === 0) player.allIn = true;
      return paid;
    }

    /* ---------------------------------------------------------------- start hand */

    startHand() {
      const funded = this.players.filter((p) => p.chips > 0);
      const active = funded.filter((p) => !p.sittingOut);
      if (active.length < 2) {
        if (funded.length >= 2) {
          // There are still funded players, but too many are temporarily away.
          // Keep the table alive and let the room wait for someone to sit back in.
          this.phase = "idle";
          this.currentPlayerId = null;
          this.streetComplete = true;
          this.version++;
          return false;
        }
        this.gameOver = true;
        this.champion = active[0] || null;
        this.phase = "gameover";
        this.version++;
        return false;
      }

      this.handNumber += 1;
      this.started = true;
      this.gameOver = false;
      this.champion = null;
      this.version++;
      this.actionSeq = 0;

      // Move the button. The first hand uses the configured / random button.
      if (this.handNumber === 1) {
        if (this.dealerIndex === null || !active.includes(this.players[this.dealerIndex])) {
          this.dealerIndex = active[Cards.secureRandomInt(active.length)].seat;
        }
      } else {
        const nextDealer = this._nextSeat(
          this.dealerIndex,
          (p) => p.chips > 0 && !p.sittingOut
        );
        if (nextDealer >= 0) this.dealerIndex = nextDealer;
      }

      const level = Math.floor((this.handNumber - 1) / this.config.blindEvery);
      const levelChanged = level !== this.blindLevel;
      this.blindLevel = level;
      const blinds = this.getBlindsForLevel(level);
      this.smallBlind = blinds.smallBlind;
      this.bigBlind = blinds.bigBlind;

      this.phase = "preflop";
      this.community = [];
      this.pot = 0;
      this.currentBet = 0;
      this.lastFullRaise = this.bigBlind;
      this.currentPlayerId = null;
      this.streetComplete = false;
      this.handResult = null;
      this.showdown = null;
      this.deck = Cards.shuffle(Cards.createDeck(this.variant));

      for (const player of this.players) {
        const isOut = player.chips <= 0;
        const isAway = Boolean(player.sittingOut);
        player.hole = [];
        player.streetBet = 0;
        player.totalBet = 0;
        player.hasActed = false;
        player.folded = isOut || isAway;
        player.allIn = false;
        player.out = isOut;
        player.eliminated = isOut;
        player.dealtIn = !isOut && !isAway;
        player.revealed = false;
        player.bestHand = null;
        player.lastAction = isAway ? { type: "away", label: "暂离", amount: 0 } : null;
        player.winAmount = 0;
        player.isWinner = false;
      }

      this._log(
        "system",
        (this.variant === "short" ? "短牌 6+ · " : "") + "第 " + this.handNumber + " 手开始",
        { handStart: true }
      );
      if (levelChanged) {
        if (this.handNumber === 1) {
          this._log("level", "盲注 " + this.smallBlind + " / " + this.bigBlind);
        } else {
          this._log("level", "盲注提升至 " + this.smallBlind + " / " + this.bigBlind);
        }
      }

      // Button, blinds and deal.
      const activeSeats = this.players.filter((p) => p.dealtIn);
      const headsUp = activeSeats.length === 2;
      let sbIndex;
      let bbIndex;
      if (headsUp) {
        sbIndex = this.dealerIndex;
        bbIndex = this._nextSeat(sbIndex, (p) => p.dealtIn);
      } else {
        sbIndex = this._nextSeat(this.dealerIndex, (p) => p.dealtIn);
        bbIndex = this._nextSeat(sbIndex, (p) => p.dealtIn);
      }
      this.smallBlindIndex = sbIndex;
      this.bigBlindIndex = bbIndex;

      this._postBlind(this.players[sbIndex], this.smallBlind, "小盲");
      this._postBlind(this.players[bbIndex], this.bigBlind, "大盲");

      // Deal two cards to each player, one at a time, clockwise from the button.
      for (let round = 0; round < 2; round++) {
        let index = this.dealerIndex;
        for (let count = 0; count < activeSeats.length; count++) {
          index = this._nextSeat(index, (p) => p.dealtIn);
          if (index < 0) break;
          this.players[index].hole.push(this.deck.shift());
        }
      }

      this.currentBet = this.bigBlind;
      this.lastFullRaise = this.bigBlind;

      // First to act: heads-up the button acts first preflop; otherwise the
      // player left of the big blind. Postflop is always left of the button.
      let firstIndex;
      if (headsUp) {
        firstIndex = this.dealerIndex;
      } else {
        firstIndex = this._nextSeat(bbIndex, (p) => p.dealtIn);
      }

      const next = this._findNextNeedingAction(firstIndex, true);
      if (next >= 0) {
        this._markCurrentPlayer(next);
      } else {
        this.currentPlayerId = null;
        this.streetComplete = true;
      }

      if (!this._roundCanContinue() && this.inHandPlayers.length > 1) {
        this.currentPlayerId = null;
        this.streetComplete = true;
      }

      this._log("deal", "已发底牌", { private: true });
      this.version++;
      return true;
    }

    _postBlind(player, amount, label) {
      const paid = this._commit(player, Math.min(amount, player.chips));
      this._log(
        "blind",
        player.name + " 下" + label + " " + Cards.formatChips(paid),
        { playerId: player.id, amount: paid }
      );
      player.lastAction = {
        type: "blind",
        label: label + " " + Cards.formatChips(paid),
        amount: paid,
      };
      return paid;
    }

    /* ---------------------------------------------------------------- actions */

    getLegalActions(playerId) {
      const player = this.getPlayer(playerId);
      if (!player) throw new Error("Unknown player: " + playerId);
      const isTurn =
        this.currentPlayerId === player.id &&
        !this.streetComplete &&
        STREETS.includes(this.phase) &&
        !this.handResult;
      const inHand = this.inHandPlayers.length > 1;
      const canPlay = isTurn && inHand && !player.folded && !player.allIn && player.chips > 0;
      const rawToCall = Math.max(0, this.currentBet - player.streetBet);
      const callAmount = Math.min(player.chips, rawToCall);
      const maxRaiseTo = player.streetBet + player.chips;
      let minRaiseTo = this.currentBet > 0 ? this.currentBet + this.lastFullRaise : this.bigBlind;
      if (this.currentBet > 0 && this.lastFullRaise <= 0) minRaiseTo = this.currentBet + this.bigBlind;
      const canRaise =
        canPlay &&
        !player.hasActed &&
        player.chips > callAmount &&
        this._othersCanAct(player) &&
        maxRaiseTo > this.currentBet;

      return {
        isTurn,
        canPlay,
        canFold: canPlay,
        canCheck: canPlay && rawToCall === 0,
        canCall: canPlay && rawToCall > 0,
        canRaise,
        canAllIn: canPlay && player.chips > 0,
        toCall: rawToCall,
        callAmount,
        isAllInCall: rawToCall >= player.chips,
        minRaiseTo: Math.min(minRaiseTo, maxRaiseTo),
        maxRaiseTo,
        minRaiseLegal: minRaiseTo,
        playerChips: player.chips,
        pot: this.getTotalPot(),
        currentBet: this.currentBet,
        lastFullRaise: this.lastFullRaise,
        callLabel:
          rawToCall === 0
            ? "过牌"
            : rawToCall >= player.chips
              ? "跟注全下 " + Cards.formatChips(player.chips)
              : "跟注 " + Cards.formatChips(rawToCall),
        raiseLabel:
          this.currentBet === 0
            ? "下注"
            : "加注",
      };
    }

    act(playerId, type, amount) {
      const player = this.getPlayer(playerId);
      if (!player) throw new Error("Unknown player: " + playerId);
      if (this.currentPlayerId !== playerId) throw new Error("Not this player's turn");
      if (this.streetComplete || !STREETS.includes(this.phase) || this.handResult) {
        throw new Error("Betting is closed");
      }
      const legal = this.getLegalActions(playerId);
      if (!legal.canPlay) throw new Error("Player cannot act");

      const actionType = type === "bet" ? "raise" : type;
      const seat = this._seatOf(player);
      let paid = 0;
      let target = 0;
      let logText = "";

      if (actionType === "fold") {
        player.folded = true;
        player.hasActed = true;
        player.lastAction = { type: "fold", label: "弃牌", amount: 0 };
        logText = "弃牌";
        this._log("action", player.name + " 弃牌", {
          playerId: player.id,
          action: "fold",
        });
      } else if (actionType === "check") {
        if (!legal.canCheck) throw new Error("Cannot check facing a bet");
        player.hasActed = true;
        player.lastAction = { type: "check", label: "过牌", amount: 0 };
        logText = "过牌";
        this._log("action", player.name + " 过牌", {
          playerId: player.id,
          action: "check",
        });
      } else if (actionType === "call") {
        if (!legal.canCall) throw new Error("Nothing to call");
        paid = this._commit(player, Math.min(legal.toCall, player.chips));
        player.hasActed = true;
        const allIn = player.chips === 0;
        player.lastAction = {
          type: "call",
          label: allIn
            ? "跟注全下 " + Cards.formatChips(paid)
            : "跟注 " + Cards.formatChips(paid),
          amount: paid,
          allIn,
        };
        logText = player.lastAction.label;
        this._log(
          "action",
          player.name + " " + (allIn ? "跟注全下 " : "跟注 ") + Cards.formatChips(paid),
          { playerId: player.id, action: "call", amount: paid, allIn }
        );
      } else if (actionType === "raise") {
        if (!legal.canRaise) throw new Error("Cannot raise");
        target = Math.round(Number(amount));
        if (!Number.isFinite(target)) throw new Error("Invalid raise amount");
        if (target <= this.currentBet) throw new Error("Raise must exceed the current bet");
        if (target > legal.maxRaiseTo) throw new Error("Raise exceeds your stack");
        const minimum = this.currentBet > 0 ? this.currentBet + this.lastFullRaise : this.bigBlind;
        const isAllIn = target === legal.maxRaiseTo;
        if (target < minimum && !isAllIn) {
          throw new Error("Minimum raise is " + minimum);
        }
        const previousBet = this.currentBet;
        const wasOpeningBet = previousBet === 0;
        this.currentBet = target;
        paid = this._commit(player, target - player.streetBet);
        const raiseSize = target - previousBet;
        const fullRaise = wasOpeningBet ? target >= this.bigBlind : raiseSize >= this.lastFullRaise;

        if (fullRaise) {
          this.lastFullRaise = wasOpeningBet ? target : raiseSize;
          for (const other of this.players) {
            if (
              other.id !== player.id &&
              other.dealtIn &&
              !other.folded &&
              !other.allIn
            ) {
              other.hasActed = false;
            }
          }
        }
        player.hasActed = true;
        const allIn = player.chips === 0;
        const verb = wasOpeningBet ? "下注" : "加注到";
        player.lastAction = {
          type: wasOpeningBet ? "bet" : "raise",
          label: allIn
            ? "全下 " + Cards.formatChips(target)
            : verb + " " + Cards.formatChips(target),
          amount: target,
          allIn,
          fullRaise,
        };
        logText = player.lastAction.label;
        this._log(
          "action",
          player.name + " " + player.lastAction.label,
          {
            playerId: player.id,
            action: wasOpeningBet ? "bet" : "raise",
            amount: target,
            allIn,
            fullRaise,
          }
        );
      } else {
        throw new Error("Unknown action: " + type);
      }

      this.actionSeq++;
      this.version++;

      // If only one player remains, the hand is over immediately.
      const remaining = this.inHandPlayers;
      if (remaining.length === 1) {
        this._awardUncontested(remaining[0], "其余玩家弃牌");
        this.version++;
        return {
          ok: true,
          type,
          amount: target || paid,
          label: logText,
          legal,
        };
      }

      if (!this._roundCanContinue()) {
        this.currentPlayerId = null;
        this.streetComplete = true;
        this.version++;
        return {
          ok: true,
          type,
          amount: target || paid,
          label: logText,
          legal,
        };
      }

      const next = this._findNextNeedingAction(seat, false);
      if (next >= 0) {
        this._markCurrentPlayer(next);
      } else {
        this.streetComplete = true;
        this.currentPlayerId = null;
      }
      this.version++;
      return {
        ok: true,
        type,
        amount: target || paid,
        label: logText,
        legal,
      };
    }

    /* ---------------------------------------------------------------- streets */

    advanceStreet() {
      if (this.handResult || !STREETS.includes(this.phase)) return false;
      if (!this.streetComplete) throw new Error("Betting round is not complete");

      const remaining = this.inHandPlayers;
      if (remaining.length <= 1) {
        if (remaining.length === 1) this._awardUncontested(remaining[0], "其余玩家弃牌");
        return false;
      }

      this._collectBets();
      this._resetForStreet();
      this.version++;

      let nextPhase;
      if (this.phase === "preflop") {
        this.deck.shift(); // burn
        this.community = [this.deck.shift(), this.deck.shift(), this.deck.shift()];
        this.phase = "flop";
        nextPhase = "flop";
        this._log("street", "翻牌 · " + this.community.map(Cards.cardLabel).join("  "), {
          community: this.community.slice(),
        });
      } else if (this.phase === "flop") {
        this.deck.shift();
        this.community.push(this.deck.shift());
        this.phase = "turn";
        nextPhase = "turn";
        this._log("street", "转牌 · " + Cards.cardLabel(this.community[3]), {
          community: this.community.slice(),
        });
      } else if (this.phase === "turn") {
        this.deck.shift();
        this.community.push(this.deck.shift());
        this.phase = "river";
        nextPhase = "river";
        this._log("street", "河牌 · " + Cards.cardLabel(this.community[4]), {
          community: this.community.slice(),
        });
      } else if (this.phase === "river") {
        this.phase = "showdown";
        this._resolveShowdown();
        this.version++;
        return true;
      }

      this._beginPostflopRound(nextPhase);
      this.version++;
      return true;
    }

    _beginPostflopRound(phase) {
      const startIndex = this._nextSeat(this.dealerIndex, (p) => p.dealtIn);
      const next = this._findNextNeedingAction(startIndex, true);
      if (next >= 0) {
        this._markCurrentPlayer(next);
      } else {
        this.currentPlayerId = null;
        this.streetComplete = true;
      }
      if (!this._roundCanContinue() && this.inHandPlayers.length > 1) {
        this.currentPlayerId = null;
        this.streetComplete = true;
      }
    }

    /* ---------------------------------------------------------------- payouts */

    _awardUncontested(winner, reason) {
      this._collectBets();
      const amount = this.pot;
      winner.chips += amount;
      winner.winAmount = amount;
      winner.isWinner = true;
      winner.lastAction = { type: "win", label: "赢得底池", amount };

      this.currentPlayerId = null;
      this.streetComplete = true;
      this.phase = "handover";
      this.handResult = {
        type: "fold",
        totalPot: amount,
        winners: [
          {
            id: winner.id,
            name: winner.name,
            avatar: winner.avatar,
            amount,
            handName: "",
            bestCards: [],
          },
        ],
        pots: [{ amount, winnerIds: [winner.id], handName: "" }],
        reason: reason || "其余玩家弃牌",
      };
      this._log("win", winner.name + " 赢得底池 " + Cards.formatChips(amount) + "（" + reason + "）", {
        playerId: winner.id,
        amount,
      });
      this._afterHandSettled();
    }

    _buildSidePots() {
      const contributors = this.players.filter((p) => p.totalBet > 0);
      const levels = [...new Set(contributors.map((p) => p.totalBet))].sort((a, b) => a - b);
      const pots = [];
      let previous = 0;
      for (const level of levels) {
        let amount = 0;
        for (const player of contributors) {
          amount += Math.max(0, Math.min(player.totalBet, level) - previous);
        }
        if (amount <= 0) {
          previous = level;
          continue;
        }
        const eligible = this.players.filter(
          (p) => p.dealtIn && !p.folded && p.totalBet >= level
        );
        if (eligible.length === 0) {
          // Defensive fallback: a folded player's uncalled excess. Return it to
          // the contributor rather than losing chips.
          for (const player of contributors) {
            const part = Math.max(0, Math.min(player.totalBet, level) - previous);
            if (part > 0) player.chips += part;
          }
        } else {
          pots.push({ amount, level, eligible });
        }
        previous = level;
      }
      return pots;
    }

    _oddChipOrder(winners) {
      const ordered = [];
      const count = this.players.length;
      for (let offset = 1; offset <= count; offset++) {
        const index = (this.dealerIndex + offset) % count;
        const player = this.players[index];
        if (winners.includes(player)) ordered.push(player);
      }
      return ordered;
    }

    _resolveShowdown() {
      this._collectBets();
      this.streetComplete = true;
      this.currentPlayerId = null;

      const contenders = this.inHandPlayers;
      for (const player of contenders) {
        player.revealed = true;
        player.bestHand = HandEvaluator.evaluateHand(
          player.hole.concat(this.community),
          this.variant
        );
      }

      const sidePots = this._buildSidePots();
      const payouts = new Map(this.players.map((p) => [p.id, 0]));
      const potResults = [];

      for (let index = 0; index < sidePots.length; index++) {
        const pot = sidePots[index];
        let bestHand = null;
        let winners = [];
        for (const player of pot.eligible) {
          if (!bestHand) {
            bestHand = player.bestHand;
            winners = [player];
          } else {
            const comparison = HandEvaluator.compareHands(player.bestHand, bestHand);
            if (comparison > 0) {
              bestHand = player.bestHand;
              winners = [player];
            } else if (comparison === 0) {
              winners.push(player);
            }
          }
        }

        const orderedWinners = this._oddChipOrder(winners);
        const share = Math.floor(pot.amount / winners.length);
        let remainder = pot.amount - share * winners.length;
        for (const winner of orderedWinners) {
          let award = share;
          if (remainder > 0) {
            award += 1;
            remainder -= 1;
          }
          payouts.set(winner.id, payouts.get(winner.id) + award);
        }

        potResults.push({
          index: index + 1,
          amount: pot.amount,
          level: pot.level,
          winnerIds: orderedWinners.map((p) => p.id),
          winners: orderedWinners.map((p) => ({
            id: p.id,
            name: p.name,
            avatar: p.avatar,
            handName: bestHand.name,
            bestCards: bestHand.cards,
          })),
          handName: bestHand ? bestHand.name : "",
          eligibleCount: pot.eligible.length,
        });
      }

      const winnerSummary = new Map();
      for (const player of this.players) {
        const amount = payouts.get(player.id) || 0;
        player.chips += amount;
        player.winAmount = amount;
        player.isWinner = amount > 0;
        if (amount > 0) {
          winnerSummary.set(player.id, {
            id: player.id,
            name: player.name,
            avatar: player.avatar,
            amount,
            handName: player.bestHand ? player.bestHand.name : "",
            bestCards: player.bestHand ? player.bestHand.cards : [],
          });
        }
      }

      const winners = [...winnerSummary.values()].sort((a, b) => b.amount - a.amount);
      this.phase = "showdown";
      this.handResult = {
        type: "showdown",
        totalPot: this.pot,
        winners,
        pots: potResults,
        community: this.community.slice(),
        showdownHands: contenders.map((p) => ({
          id: p.id,
          name: p.name,
          avatar: p.avatar,
          hole: p.hole.slice(),
          handName: p.bestHand.name,
          bestCards: p.bestHand.cards.slice(),
        })),
      };

      const mainWinners = winners.filter((winner) => {
        return potResults[0] && potResults[0].winnerIds.includes(winner.id);
      });
      if (mainWinners.length === 1) {
        const w = mainWinners[0];
        this._log(
          "win",
          w.name +
            (w.handName ? " 以 " + w.handName : "") +
            " 赢得底池 " +
            Cards.formatChips(w.amount),
          { playerId: w.id, amount: w.amount }
        );
      } else {
        this._log(
          "win",
          mainWinners.map((w) => w.name).join(" / ") +
            " 平分底池 " +
            Cards.formatChips(potResults[0] ? potResults[0].amount : this.pot),
          { amount: potResults[0] ? potResults[0].amount : this.pot }
        );
      }
      if (potResults.length > 1) {
        this._log("pot", "本手共 " + potResults.length + " 个底池（含边池）");
      }
      this._afterHandSettled();
      this.version++;
    }

    _afterHandSettled() {
      const withChips = this.players.filter((p) => p.chips > 0);
      for (const player of this.players) {
        if (player.chips <= 0) {
          player.eliminated = true;
          player.out = true;
        }
      }
      if (withChips.length <= 1) {
        this.gameOver = true;
        this.champion = withChips[0] || null;
        if (this.champion) {
          this._log("win", "🏆 " + this.champion.name + " 成为最后赢家", {
            playerId: this.champion.id,
          });
        }
        if (this.handResult) this.handResult.champion = this.champion;
      }
      if (this.handResult) {
        const human = this.players.find((p) => p.isHuman);
        if (human && human.chips <= 0) this.handResult.humanEliminated = true;
        this.handResult.gameOver = this.gameOver;
      }
      this.version++;
    }

    /* ------------------------------------------------------------ snapshots */

    toSnapshot() {
      const config = { ...this.config };
      delete config.players;
      const snapshot = { ...this, config };
      return JSON.parse(JSON.stringify(snapshot));
    }

    static fromSnapshot(snapshot) {
      if (
        !snapshot ||
        typeof snapshot !== "object" ||
        !Array.isArray(snapshot.players) ||
        snapshot.players.length < 2
      ) {
        throw new Error("Invalid poker game snapshot");
      }
      const copy = JSON.parse(JSON.stringify(snapshot));
      const game = Object.create(PokerGame.prototype);
      Object.assign(game, copy);
      game.config = {
        startingChips: 5000,
        blindEvery: 8,
        variant: "holdem",
        ...(copy.config && typeof copy.config === "object" ? copy.config : {}),
      };
      delete game.config.players;
      game.variant = copy.variant === "short" ? "short" : "holdem";
      game.players = copy.players.map((player, index) => ({
        ...player,
        seat: Number.isInteger(player.seat) ? player.seat : index,
        hole: Array.isArray(player.hole) ? player.hole : [],
        bestHand: player.bestHand || null,
      }));
      game.community = Array.isArray(game.community) ? game.community : [];
      game.deck = Array.isArray(game.deck) ? game.deck : [];
      game.log = Array.isArray(game.log) ? game.log : [];
      if (game.champion) {
        const champion = game.players.find((player) => player.id === game.champion.id);
        game.champion = champion || null;
        if (game.handResult) game.handResult.champion = game.champion;
      }
      gameId = Math.max(gameId, Number(game.id) || 0);
      return game;
    }
  }

  return {
    PokerGame,
    STREETS,
    PHASE_LABELS,
    BLIND_LEVELS,
  };
});

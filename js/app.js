/*! Nocturne Hold'em — table UI and game controller (MIT) */
(function () {
  "use strict";

  const { PokerGame } = window.PokerEngine;
  const { PokerAI, createBotLineup } = window.PokerAI;
  const HE = window.HandEvaluator;
  const C = window.Cards;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const SETTINGS_KEY = "nocturne.holdem.settings.v1";
  const ONLINE_SESSION_PREFIX = "nocturne.online.session.";
  const SOLO_HISTORY_KEY = "nocturne.solo.history.v1";
  const SOLO_HISTORY_LIMIT = 100;
  const ONLINE_POLL_MS = 5000;
  const POSITIONS = {
    2: ["pos-bottom", "pos-top"],
    3: ["pos-bottom", "pos-top-left", "pos-top-right"],
    4: ["pos-bottom", "pos-left", "pos-top", "pos-right"],
    5: ["pos-bottom", "pos-bottom-left", "pos-top-left", "pos-top-right", "pos-bottom-right"],
    6: ["pos-bottom", "pos-bottom-left", "pos-left", "pos-top", "pos-right", "pos-bottom-right"],
  };
  const SPEEDS = [1, 2, 4];
  const QUICK_PHRASES = [
    { id: "praise_good", text: "你啲牌打得真係好喎", tone: "praise" },
    { id: "praise_god", text: "牌神附體，真係惹唔起", tone: "praise" },
    { id: "humble_lucky", text: "運氣好啫，承讓承讓", tone: "humble" },
    { id: "humble_steady", text: "都係你打得穩陣", tone: "humble" },
    { id: "tease_deep", text: "你啲牌收得咁深嘅", tone: "tease" },
    { id: "tease_seen", text: "畀你睇穿咗添", tone: "tease" },
    { id: "hurry_flower", text: "快啲啦，等到花兒都謝喇", tone: "hurry" },
    { id: "hurry_slow", text: "慢慢諗，我唔急", tone: "hurry" },
    { id: "feel_numb", text: "呢手牌打到我一額汗", tone: "feel" },
    { id: "feel_breath", text: "畀我唞吓先", tone: "feel" },
    { id: "feel_luck", text: "呢啲運氣真係冇得頂", tone: "feel" },
    { id: "invite_again", text: "再嚟一局？", tone: "invite" },
  ];
  const CHAT_VOICE_BASE = "audio/chat/";
  const CHAT_VOICE_VOLUME = 0.6;
  const chatVoices = new Map();
  const PHASE_NAMES = {
    idle: "等待开局",
    preflop: "翻牌前",
    flop: "翻牌圈",
    turn: "转牌圈",
    river: "河牌圈",
    showdown: "摊牌",
    handover: "本手结束",
    gameover: "牌局结束",
  };

  const DEFAULT_SETTINGS = {
    name: "你",
    bots: 3,
    difficulty: "standard",
    variant: "holdem",
    chips: 5000,
    sound: true,
    speed: 1,
    botFill: true,
  };

  const state = {
    game: null,
    mode: "solo",
    setupMode: "solo",
    onlineAvailable: location.protocol !== "file:",
    online: {
      code: null,
      token: null,
      playerId: null,
      hostId: null,
      view: null,
      status: "idle",
      eventSource: null,
      connected: false,
      actionPending: false,
      gameKey: "",
      lastStateAt: 0,
      serverOffset: 0,
      errorCount: 0,
      lastLogId: 0,
      lastChatId: 0,
      chatReady: false,
      chatSending: false,
      pollTimer: null,
      polling: false,
    },
    ais: new Map(),
    settings: loadSettings(),
    hero: null,
    paused: false,
    setupOpen: true,
    timer: null,
    timerDeadline: 0,
    timerRemaining: 0,
    pending: null,
    thinkingPlayerId: null,
    beginning: false,
    lastBoardCount: 0,
    lastHand: 0,
    lastLevel: -1,
    lastResultHand: 0,
    lastResultSoundHand: 0,
    lastTurnSignal: "",
    lastTimerWarnSignal: "",
    recordsRequest: 0,
    recordsScope: null,
    recordedSoloGameId: null,
    controlKey: "",
    raiseTarget: 0,
    sliderMin: 0,
    sliderMax: 0,
    autoNext: false,
    modalPausedGame: false,
    setupShown: true,
  };

  const el = {
    app: $("#app"),
    setup: $("#setupOverlay"),
    tableStage: $("#tableStage"),
    tableEmpty: $("#tableEmpty"),
    seats: $("#seats"),
    community: $("#community"),
    phaseLabel: $("#phaseLabel"),
    potValue: $("#potValue"),
    potSub: $("#potSub"),
    tableNote: $("#tableNote"),
    streetBanner: $("#streetBanner"),
    topHandNo: $("#topHandNo"),
    topBlinds: $("#topBlinds"),
    topLevel: $("#topLevel"),
    speedBtn: $("#speedBtn"),
    speedLabel: $("#speedLabel"),
    soundBtn: $("#soundBtn"),
    rulesBtn: $("#rulesBtn"),
    logBtn: $("#logBtn"),
    newGameBtn: $("#newGameBtn"),
    sideHeroAvatar: $("#sideHeroAvatar"),
    sideHeroChips: $("#sideHeroChips"),
    sideProfit: $("#sideProfit"),
    sideBlinds: $("#sideBlinds"),
    sideLevel: $("#sideLevel"),
    sidePlayers: $("#sidePlayers"),
    sidePot: $("#sidePot"),
    levelTrackLabel: $("#levelTrackLabel"),
    levelBarFill: $("#levelBarFill"),
    sideLog: $("#sideLog"),
    logExpandBtn: $("#logExpandBtn"),
    coachText: $("#coachText"),
    dockIdle: $("#dockIdle"),
    dockPlay: $("#dockPlay"),
    dockWaiting: $("#dockWaiting"),
    dockResult: $("#dockResult"),
    heroMiniCards: $("#heroMiniCards"),
    heroHandHint: $("#heroHandHint"),
    turnStatus: $("#turnStatus"),
    oddsReadout: $("#oddsReadout"),
    raisePanel: $("#raisePanel"),
    raiseCaption: $("#raiseCaption"),
    raiseValueLabel: $("#raiseValueLabel"),
    raiseRange: $("#raiseRange"),
    rangeMinLabel: $("#rangeMinLabel"),
    rangeMaxLabel: $("#rangeMaxLabel"),
    raiseBtnText: $("#raiseBtnText"),
    raiseBtnAmount: $("#raiseBtnAmount"),
    callBtnText: $("#callBtnText"),
    foldBtn: $("#foldBtn"),
    callBtn: $("#callBtn"),
    raiseBtn: $("#raiseBtn"),
    waitingAvatar: $("#waitingAvatar"),
    waitingText: $("#waitingText"),
    resultCrown: $("#resultCrown"),
    resultEyebrow: $("#resultEyebrow"),
    resultTitle: $("#resultTitle"),
    resultDetail: $("#resultDetail"),
    nextCountdown: $("#nextCountdown"),
    nextHandBtn: $("#nextHandBtn"),
    resultRestartBtn: $("#resultRestartBtn"),
    modalRoot: $("#modalRoot"),
    toastRoot: $("#toastRoot"),
    confettiRoot: $("#confettiRoot"),
    playerNameInput: $("#playerNameInput"),
    opponentCountLabel: $("#opponentCountLabel"),
    botCountGroup: $("#botCountGroup"),
    difficultyGroup: $("#difficultyGroup"),
    variantGroup: $("#variantGroup"),
    variantHint: $("#variantHint"),
    chipsGroup: $("#chipsGroup"),
    chipsHint: $("#chipsHint"),
    startBtn: $("#startBtn"),
    setupRulesBtn: $("#setupRulesBtn"),
    setupRecordsBtn: $("#setupRecordsBtn"),
    setupHistoryBtn: $("#setupHistoryBtn"),
    modeSwitch: $("#modeSwitch"),
    botCountField: $("#botCountField"),
    onlineOptions: $("#onlineOptions"),
    botFillToggle: $("#botFillToggle"),
    joinCodeInput: $("#joinCodeInput"),
    joinRoomBtn: $("#joinRoomBtn"),
    startBtnSmall: $("#startBtnSmall"),
    startBtnText: $("#startBtnText"),
    setupModeHint: $("#setupModeHint"),
    lobbyOverlay: $("#lobbyOverlay"),
    lobbyCode: $("#lobbyCode"),
    lobbyCodeBig: $("#lobbyCodeBig"),
    lobbyBotFill: $("#lobbyBotFill"),
    lobbyDifficulty: $("#lobbyDifficulty"),
    lobbyVariant: $("#lobbyVariant"),
    lobbyChips: $("#lobbyChips"),
    lobbyHumanCount: $("#lobbyHumanCount"),
    lobbyPlayerList: $("#lobbyPlayerList"),
    lobbyBotSlots: $("#lobbyBotSlots"),
    lobbyHint: $("#lobbyHint"),
    startOnlineBtn: $("#startOnlineBtn"),
    copyInviteLobbyBtn: $("#copyInviteLobbyBtn"),
    leaveLobbyBtn: $("#leaveLobbyBtn"),
    onlinePill: $("#onlinePill"),
    onlinePillDot: $("#onlinePillDot"),
    onlinePillStatus: $("#onlinePillStatus"),
    quickChatBtn: $("#quickChatBtn"),
    quickChatPanel: $("#quickChatPanel"),
    quickChatClose: $("#quickChatClose"),
    quickChatGrid: $("#quickChatGrid"),
    onlineRoomCode: $("#onlineRoomCode"),
    copyInvitePillBtn: $("#copyInvitePillBtn"),
    leaveOnlinePillBtn: $("#leaveOnlinePillBtn"),
    turnClock: $("#turnClock"),
  };

  /* ---------------------------------------------------------- utilities */

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      const parsed = JSON.parse(raw);
      return sanitizeSettings({ ...DEFAULT_SETTINGS, ...parsed });
    } catch (error) {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettings(next) {
    state.settings = sanitizeSettings(next);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    } catch (error) {
      /* file:// or private mode — settings simply won't persist */
    }
  }

  function loadSoloHistory() {
    try {
      const raw = localStorage.getItem(SOLO_HISTORY_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((entry) => entry && typeof entry.name === "string" && Number.isFinite(Number(entry.endedAt)))
        .slice(0, SOLO_HISTORY_LIMIT);
    } catch (error) {
      return [];
    }
  }

  function saveSoloHistory(rows) {
    try {
      localStorage.setItem(SOLO_HISTORY_KEY, JSON.stringify(rows.slice(0, SOLO_HISTORY_LIMIT)));
    } catch (error) {
      /* file:// or private mode — history simply won't persist */
    }
  }

  function recordSoloResult(game) {
    if (!game || !state.hero) return;
    if (state.recordedSoloGameId === game.id) return;
    const hero = state.hero;
    const finished = Boolean(game.gameOver || game.champion || hero.chips <= 0);
    if (!finished) return;
    state.recordedSoloGameId = game.id;

    const ranked = game.players
      .slice()
      .sort((a, b) => b.chips - a.chips || a.seat - b.seat);
    const place = ranked.findIndex((player) => player.id === hero.id) + 1;
    const buyIn = game.startingChips || state.settings.chips;
    const entry = {
      id: "solo-" + game.id + "-" + Date.now(),
      endedAt: Date.now(),
      name: hero.name,
      variant: game.variant === "short" ? "short" : "holdem",
      difficulty: state.settings.difficulty,
      bots: game.players.filter((player) => !player.isHuman).length,
      buyIn,
      finalChips: hero.chips,
      net: hero.chips - buyIn,
      place,
      hands: game.handNumber,
      won: Boolean(game.champion && game.champion.id === hero.id),
    };
    const rows = loadSoloHistory();
    rows.unshift(entry);
    saveSoloHistory(rows);
  }

  function soloHistoryFor(name) {
    const key = String(name || "").toLocaleLowerCase();
    return loadSoloHistory()
      .filter((entry) => String(entry.name || "").toLocaleLowerCase() === key)
      .sort((a, b) => b.endedAt - a.endedAt);
  }

  function soloSummaryFor(rows) {
    const summary = { sessions: rows.length, hands: 0, wins: 0, net: 0, bestPlace: null };
    for (const row of rows) {
      summary.hands += Number(row.hands) || 0;
      summary.wins += row.won ? 1 : 0;
      summary.net += Number(row.net) || 0;
      const place = Number(row.place);
      if (Number.isFinite(place) && (summary.bestPlace === null || place < summary.bestPlace)) {
        summary.bestPlace = place;
      }
    }
    return summary;
  }

  function sanitizeSettings(raw) {
    const name = String(raw.name || "你").trim().slice(0, 10) || "你";
    const bots = Math.max(1, Math.min(5, Number(raw.bots) || 3));
    const difficulty = ["casual", "standard", "pro"].includes(raw.difficulty) ? raw.difficulty : "standard";
    const variant = raw.variant === "short" ? "short" : "holdem";
    const chips = [2000, 5000, 10000].includes(Number(raw.chips)) ? Number(raw.chips) : 5000;
    const speed = SPEEDS.includes(Number(raw.speed)) ? Number(raw.speed) : 1;
    return {
      name,
      bots,
      difficulty,
      variant,
      chips,
      botFill: raw.botFill !== false,
      sound: raw.sound !== false,
      speed,
    };
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function format(value) {
    return C.formatChips(value, false);
  }

  function signedFormat(value) {
    const n = Math.round(value);
    return (n > 0 ? "+" : n < 0 ? "−" : "±") + format(Math.abs(n));
  }

  function cardParts(card) {
    const parsed = C.parseCard(card);
    return {
      rank: C.rankLabel(parsed.rank),
      suit: C.SUIT_SYMBOLS[parsed.suit],
      red: parsed.suit === "h" || parsed.suit === "d",
    };
  }

  function cardMarkup(card, options = {}) {
    if (options.faceDown) {
      const backStyle = options.delay ? ' style="animation-delay:' + options.delay + 'ms"' : "";
      return '<div class="playing-card card-back ' + (options.className || "") + '"' + backStyle + ' aria-label="暗牌"></div>';
    }
    if (!card) return '<span class="card-slot" aria-hidden="true"></span>';
    const parts = cardParts(card);
    const style = options.delay ? ' style="animation-delay:' + options.delay + 'ms"' : "";
    return (
      '<div class="playing-card ' +
      (parts.red ? "red " : "") +
      (options.className || "") +
      '" data-card="' +
      card +
      '" aria-label="' +
      parts.rank +
      parts.suit +
      '"' +
      style +
      ">" +
      '<span class="card-rank">' + parts.rank + "</span>" +
      '<span class="card-suit">' + parts.suit + "</span>" +
      "</div>"
    );
  }

  function setDockMode(mode) {
    el.dockIdle.hidden = mode !== "idle";
    el.dockPlay.hidden = mode !== "play";
    el.dockWaiting.hidden = mode !== "waiting";
    el.dockResult.hidden = mode !== "result";
  }

  function clearTimer() {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    state.pending = null;
    state.timerDeadline = 0;
    state.timerRemaining = 0;
  }

  function setTimer(fn, delay) {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    const milliseconds = Math.max(0, delay / (state.settings.speed || 1));
    state.pending = fn;
    state.timerDeadline = Date.now() + milliseconds;
    state.timerRemaining = milliseconds;
    state.timer = setTimeout(function () {
      state.timer = null;
      state.timerDeadline = 0;
      state.timerRemaining = 0;
      const pending = state.pending;
      state.pending = null;
      if (!pending) return;
      if (state.paused) {
        state.pending = pending;
        return;
      }
      pending();
    }, milliseconds);
  }

  function pauseGame() {
    if (!state.game || state.paused) return;
    state.paused = true;
    if (state.timer) {
      state.timerRemaining = Math.max(0, state.timerDeadline - Date.now());
      clearTimeout(state.timer);
      state.timer = null;
    }
  }

  function resumeGame() {
    if (!state.game || !state.paused) return;
    state.paused = false;
    if (state.pending) {
      const pending = state.pending;
      const remaining = state.timerRemaining || 180;
      state.pending = null;
      setTimer(pending, remaining);
    }
  }

  function toast(message, options = {}) {
    const node = document.createElement("div");
    node.className = "toast" + (options.gold ? " is-gold" : "");
    node.textContent = message;
    el.toastRoot.appendChild(node);
    const timeout = options.duration || 2600;
    setTimeout(() => {
      node.classList.add("is-leaving");
      setTimeout(() => node.remove(), 280);
    }, timeout);
  }

  function showStreetBanner(text) {
    el.streetBanner.textContent = text;
    el.streetBanner.classList.add("is-visible");
    clearTimeout(showStreetBanner._timer);
    showStreetBanner._timer = setTimeout(() => {
      el.streetBanner.classList.remove("is-visible");
    }, 1050);
  }

  function confetti() {
    const colors = ["", "red", "green", "cream"];
    for (let i = 0; i < 44; i++) {
      const piece = document.createElement("i");
      piece.className = "confetti-piece " + colors[i % colors.length];
      piece.style.left = Math.random() * 100 + "%";
      piece.style.setProperty("--duration", 1700 + Math.random() * 1500 + "ms");
      piece.style.setProperty("--drift", (Math.random() - 0.5) * 280 + "px");
      piece.style.setProperty("--spin", Math.random() * 900 - 450 + "deg");
      piece.style.width = 4 + Math.random() * 5 + "px";
      piece.style.height = 8 + Math.random() * 8 + "px";
      piece.style.animationDelay = Math.random() * 350 + "ms";
      el.confettiRoot.appendChild(piece);
      setTimeout(() => piece.remove(), 3800);
    }
  }

  /* ---------------------------------------------------------- audio */

  const sound = (function () {
    let ctx = null;
    let noiseBuffer = null;

    function ensure() {
      if (!state.settings.sound) return null;
      try {
        if (!ctx) {
          const AudioContext = window.AudioContext || window.webkitAudioContext;
          if (!AudioContext) return null;
          ctx = new AudioContext();
        }
        if (ctx.state === "suspended") ctx.resume().catch(() => {});
        return ctx;
      } catch (error) {
        return null;
      }
    }

    function noise(duration, gain, filterFreq) {
      const ac = ensure();
      if (!ac) return;
      if (!noiseBuffer) {
        noiseBuffer = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      }
      const source = ac.createBufferSource();
      source.buffer = noiseBuffer;
      const filter = ac.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = filterFreq || 1600;
      filter.Q.value = 0.8;
      const amp = ac.createGain();
      amp.gain.setValueAtTime(gain, ac.currentTime);
      amp.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + duration);
      source.connect(filter).connect(amp).connect(ac.destination);
      source.start();
      source.stop(ac.currentTime + duration);
    }

    function tone(freq, duration, gain, type, delay) {
      const ac = ensure();
      if (!ac) return;
      const osc = ac.createOscillator();
      const amp = ac.createGain();
      osc.type = type || "sine";
      osc.frequency.value = freq;
      const start = ac.currentTime + (delay || 0);
      amp.gain.setValueAtTime(0.0001, start);
      amp.gain.exponentialRampToValueAtTime(gain, start + 0.012);
      amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(amp).connect(ac.destination);
      osc.start(start);
      osc.stop(start + duration + 0.02);
    }

    return {
      unlock() {
        ensure();
      },
      card() {
        noise(0.055, 0.02, 2400);
      },
      deal() {
        noise(0.06, 0.02, 2500);
        setTimeout(() => noise(0.055, 0.017, 2250), 65);
        setTimeout(() => noise(0.05, 0.015, 2700), 130);
        setTimeout(() => noise(0.045, 0.013, 2400), 195);
      },
      flip() {
        noise(0.045, 0.02, 3200);
        tone(980, 0.045, 0.012, "triangle");
      },
      chip() {
        noise(0.1, 0.035, 1150);
        tone(680, 0.06, 0.018, "triangle");
      },
      call() {
        noise(0.075, 0.026, 1200);
        tone(610, 0.055, 0.014, "sine");
      },
      raise() {
        noise(0.12, 0.033, 900);
        tone(520, 0.075, 0.016, "triangle");
        tone(790, 0.08, 0.012, "triangle", 0.055);
      },
      check() {
        tone(190, 0.07, 0.045, "sine");
        tone(150, 0.09, 0.025, "sine", 0.04);
      },
      fold() {
        noise(0.12, 0.022, 700);
      },
      street() {
        noise(0.06, 0.025, 2600);
        tone(520, 0.16, 0.014, "sine", 0.02);
        tone(780, 0.2, 0.01, "sine", 0.08);
      },
      win() {
        tone(523.25, 0.55, 0.05, "sine");
        tone(659.25, 0.55, 0.04, "sine", 0.1);
        tone(783.99, 0.62, 0.035, "sine", 0.21);
        tone(1046.5, 0.8, 0.025, "sine", 0.34);
      },
      lose() {
        tone(220, 0.35, 0.025, "sine");
        tone(174.61, 0.5, 0.018, "sine", 0.1);
      },
      allIn() {
        noise(0.16, 0.045, 560);
        tone(330, 0.14, 0.03, "triangle");
        tone(440, 0.16, 0.03, "triangle", 0.08);
        tone(660, 0.3, 0.025, "triangle", 0.16);
        tone(880, 0.36, 0.014, "sine", 0.25);
      },
      blind() {
        tone(392, 0.18, 0.02, "sine");
        tone(523.25, 0.22, 0.016, "sine", 0.08);
        tone(659.25, 0.26, 0.012, "sine", 0.16);
      },
      showdown() {
        noise(0.07, 0.025, 2700);
        tone(440, 0.24, 0.018, "sine");
        tone(554.37, 0.3, 0.014, "sine", 0.06);
        tone(659.25, 0.36, 0.012, "sine", 0.13);
      },
      turn() {
        tone(880, 0.08, 0.018, "sine");
        tone(1174.66, 0.1, 0.012, "sine", 0.07);
      },
      warning() {
        tone(920, 0.055, 0.022, "square");
        tone(920, 0.06, 0.022, "square", 0.13);
      },
      chat() {
        tone(760, 0.06, 0.015, "sine");
        tone(1010, 0.075, 0.011, "sine", 0.06);
      },
      error() {
        tone(170, 0.12, 0.018, "sawtooth");
        tone(135, 0.18, 0.016, "sawtooth", 0.06);
      },
      click() {
        tone(420, 0.03, 0.012, "triangle");
      },
    };
  })();

  function playActionSound(action) {
    if (!state.settings.sound) return;
    if (action.type === "check") sound.check();
    else if (action.type === "fold") sound.fold();
    else if (action.type === "raise" || action.type === "bet") {
      if (action.allIn) sound.allIn();
      else sound.raise();
    } else if (action.type === "call") sound.call();
    else sound.click();
  }

  function maybeTurnCue(game) {
    if (!game || state.paused || game.handResult || game.streetComplete) return;
    const current = game.currentPlayer;
    if (!current || !current.isYou) return;
    const key = [
      game.id,
      game.handNumber,
      game.phase,
      game.version,
      current.id,
    ].join(":");
    if (state.lastTurnSignal === key) return;
    state.lastTurnSignal = key;
    sound.turn();
  }

  function playOnlineLogSound(entry) {
    if (!state.settings.sound || !entry || entry.kind !== "action" || !entry.action) return;
    if (state.hero && entry.playerId === state.hero.id) return;
    playActionSound({
      type: entry.action,
      allIn: Boolean(entry.allIn),
      fullRaise: Boolean(entry.fullRaise),
      amount: entry.amount,
    });
  }

  /* ---------------------------------------------------------- online plumbing */

  const DIFFICULTY_NAMES = { casual: "休闲", standard: "标准", pro: "职业" };

  function sessionKey(code) {
    return ONLINE_SESSION_PREFIX + code;
  }

  function saveOnlineSession(code, token) {
    try {
      localStorage.setItem(sessionKey(code), token);
    } catch (error) {
      /* ignore */
    }
  }

  function loadOnlineSession(code) {
    try {
      return localStorage.getItem(sessionKey(code)) || "";
    } catch (error) {
      return "";
    }
  }

  function clearOnlineSession(code) {
    try {
      localStorage.removeItem(sessionKey(code));
    } catch (error) {
      /* ignore */
    }
  }

  async function onlineApi(name, body, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || 10000);
    let response;
    try {
      response = await fetch("/api/" + name, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      if (error.name === "AbortError") throw new Error("服务器响应超时，请稍后再试。");
      throw new Error("连不上联机服务器，请确认服务已启动。");
    }
    clearTimeout(timer);
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch (error) {
      data = {};
    }
    if (!response.ok) {
      const failure = new Error(data.error || (response.status === 404 ? "联机服务器未启动。" : "服务器出错了。"));
      failure.status = response.status;
      throw failure;
    }
    return data;
  }

  function inviteUrl(code) {
    return location.origin + location.pathname + "?room=" + encodeURIComponent(code);
  }

  async function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (error) {
        /* fall through */
      }
    }
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch (error) {
      return false;
    }
  }

  function setupModeLabel(mode) {
    if (mode === "online") {
      el.startBtnSmall.textContent = "CREATE ROOM";
      el.startBtnText.textContent = "创建联机房间";
      el.setupModeHint.innerHTML = '<i class="meta-dot"></i>需要联机服务器 · 房间实时同步';
      el.opponentCountLabel.textContent = "空位补位";
    } else {
      el.startBtnSmall.textContent = "DEAL ME IN";
      el.startBtnText.textContent = "开始牌局";
      el.setupModeHint.innerHTML = '<i class="meta-dot"></i>本地运行，无需服务器';
      el.opponentCountLabel.textContent = state.settings.bots + " 位";
    }
  }

  function setSetupMode(mode, silent) {
    if (mode !== "solo" && mode !== "online") return;
    if (mode === "online" && !state.onlineAvailable) {
      if (!silent) {
        toast(
          location.protocol === "file:"
            ? "联机模式需要启动 Node 服务，当前是本地文件打开。"
            : "联机服务器未启动，当前只能单人游戏。",
          { duration: 4200 }
        );
      }
      return;
    }
    state.setupMode = mode;
    const online = mode === "online";
    $$("#modeSwitch button").forEach((button) => {
      const active = button.dataset.setupMode === mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    el.botCountField.hidden = online;
    el.onlineOptions.hidden = !online;
    el.setup.classList.toggle("is-online-mode", online);
    el.botFillToggle.checked = Boolean(state.settings.botFill);
    setupModeLabel(mode);
    if (!silent) sound.click();
  }

  function setStartBusy(busy, label) {
    el.startBtn.disabled = busy;
    if (busy) {
      el.startBtnText.textContent = label || "连接中…";
    } else if (state.setupMode === "online") {
      el.startBtnText.textContent = "创建联机房间";
    } else {
      el.startBtnText.textContent = "开始牌局";
    }
  }

  function setJoinBusy(busy) {
    el.joinRoomBtn.disabled = busy;
    el.joinRoomBtn.textContent = busy ? "加入中…" : "加入房间";
  }

  let activeChatVoice = null;

  function preloadChatVoices() {
    if (!state.settings.sound || typeof Audio === "undefined") return;
    for (const phrase of QUICK_PHRASES) {
      if (chatVoices.has(phrase.id)) continue;
      const audio = new Audio(CHAT_VOICE_BASE + phrase.id + ".m4a");
      audio.preload = "auto";
      audio.volume = CHAT_VOICE_VOLUME;
      audio.addEventListener("ended", () => {
        if (activeChatVoice === audio) activeChatVoice = null;
      });
      chatVoices.set(phrase.id, audio);
    }
  }

  function stopChatVoice() {
    if (!activeChatVoice) return;
    try {
      activeChatVoice.pause();
      activeChatVoice.currentTime = 0;
    } catch (error) {
      /* ignore */
    }
    activeChatVoice = null;
  }

  function fallbackChatVoice(phrase) {
    if (!phrase || !window.speechSynthesis || !window.SpeechSynthesisUtterance) {
      sound.chat();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(phrase.text);
    utterance.lang = "zh-HK";
    utterance.rate = 0.95;
    utterance.volume = 0.75;
    const voices = window.speechSynthesis.getVoices();
    const cantonese = voices.find((voice) => /^(zh[-_]HK|yue)/i.test(voice.lang));
    if (cantonese) utterance.voice = cantonese;
    try {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    } catch (error) {
      sound.chat();
    }
  }

  function playChatVoice(phraseId) {
    if (!state.settings.sound) return false;
    const phrase = QUICK_PHRASES.find((item) => item.id === phraseId);
    if (!phrase || typeof Audio === "undefined") {
      sound.chat();
      return false;
    }
    let audio = chatVoices.get(phrase.id);
    if (!audio) {
      audio = new Audio(CHAT_VOICE_BASE + phrase.id + ".m4a");
      audio.preload = "auto";
      audio.volume = CHAT_VOICE_VOLUME;
      chatVoices.set(phrase.id, audio);
    }
    stopChatVoice();
    activeChatVoice = audio;
    try {
      audio.currentTime = 0;
      const promise = audio.play();
      if (promise && typeof promise.catch === "function") {
        promise.catch((error) => {
          if (activeChatVoice !== audio || (error && error.name === "AbortError")) return;
          activeChatVoice = null;
          fallbackChatVoice(phrase);
        });
      }
      return true;
    } catch (error) {
      activeChatVoice = null;
      fallbackChatVoice(phrase);
      return false;
    }
  }

  function renderQuickChat() {
    if (!el.quickChatGrid) return;
    el.quickChatGrid.innerHTML = QUICK_PHRASES.map(
      (phrase) =>
        '<button type="button" data-phrase-id="' +
        escapeHtml(phrase.id) +
        '" data-tone="' +
        escapeHtml(phrase.tone) +
        '">' +
        escapeHtml(phrase.text) +
        "</button>"
    ).join("");
  }

  function openQuickChat() {
    if (state.mode !== "online" || !state.online.token) return;
    preloadChatVoices();
    renderQuickChat();
    el.quickChatPanel.hidden = false;
    el.quickChatBtn.setAttribute("aria-expanded", "true");
    const first = el.quickChatGrid.querySelector("button");
    if (first) setTimeout(() => first.focus(), 40);
    sound.click();
  }

  function closeQuickChat() {
    if (!el.quickChatPanel || el.quickChatPanel.hidden) {
      if (el.quickChatBtn) el.quickChatBtn.setAttribute("aria-expanded", "false");
      return;
    }
    const hadFocus = el.quickChatPanel.contains(document.activeElement);
    el.quickChatPanel.hidden = true;
    el.quickChatBtn.setAttribute("aria-expanded", "false");
    if (hadFocus) el.quickChatBtn.focus();
  }

  function toggleQuickChat() {
    if (el.quickChatPanel.hidden) openQuickChat();
    else closeQuickChat();
  }

  async function sendQuickChat(phraseId) {
    if (state.online.chatSending || state.mode !== "online" || !state.online.token) return;
    state.online.chatSending = true;
    try {
      const result = await onlineApi("chat", {
        room: state.online.code,
        token: state.online.token,
        phraseId,
      });
      if (result.message) handleChat(result.message);
      closeQuickChat();
    } catch (error) {
      sound.error();
      toast(error.message || "快捷语没有发出去", { duration: 2400 });
    } finally {
      state.online.chatSending = false;
    }
  }

  function chatBubbleSide(seat) {
    if (seat.classList.contains("pos-bottom-left")) return "right";
    if (seat.classList.contains("pos-bottom") || seat.classList.contains("pos-bottom-right")) {
      return "left";
    }
    if (seat.classList.contains("pos-left") || seat.classList.contains("pos-right")) {
      return "below";
    }
    if (
      seat.classList.contains("pos-top-right") ||
      seat.classList.contains("pos-right-top")
    ) {
      return "left";
    }
    return "right";
  }

  function showChatBubble(message) {
    const seats = Array.from(document.querySelectorAll(".seat"));
    const seat = seats.find((node) => node.dataset.playerId === message.playerId);
    const dock = document.getElementById("actionDock");
    const mobile = window.matchMedia("(max-width: 700px)").matches;
    if (!seat && !mobile) {
      toast((message.name || "牌友") + "：" + message.text, { duration: 2600 });
      return;
    }
    document.querySelectorAll(".seat-chat-bubble").forEach((node) => node.remove());
    const bubble = document.createElement("div");
    bubble.className = "seat-chat-bubble";
    if (mobile && dock) {
      bubble.classList.add("is-floating");
      bubble.textContent = (message.name || "牌友") + "：" + message.text;
      dock.appendChild(bubble);
    } else if (seat) {
      bubble.classList.add("chat-" + chatBubbleSide(seat));
      bubble.textContent = message.text;
      seat.appendChild(bubble);
    } else {
      return;
    }
    setTimeout(() => {
      bubble.classList.add("is-out");
      setTimeout(() => bubble.remove(), 220);
    }, 3400);
  }

  function handleChat(message) {
    if (!message || !Number.isFinite(Number(message.id)) || !message.text) return;
    const id = Number(message.id);
    if (id <= state.online.lastChatId) return;
    state.online.lastChatId = id;
    showChatBubble(message);
    playChatVoice(message.phraseId);
  }

  function syncOnlineChat(messages) {
    if (!Array.isArray(messages)) return;
    const maxId = messages.reduce((max, message) => Math.max(max, Number(message.id) || 0), 0);
    if (!state.online.chatReady) {
      state.online.chatReady = true;
      state.online.lastChatId = Math.max(state.online.lastChatId, maxId);
      return;
    }
    for (const message of messages) handleChat(message);
  }

  function updateOnlinePill() {
    const online = state.mode === "online" && state.online.code;
    const visible = online && (state.online.status === "playing" || state.online.status === "done");
    el.onlinePill.hidden = !visible;
    if (!visible) {
      closeQuickChat();
      return;
    }
    el.onlineRoomCode.textContent = state.online.code;
    const connected = state.online.connected;
    el.onlinePillStatus.textContent = connected ? "已连接" : "重连中…";
    el.onlinePill.classList.toggle("is-warn", !connected);
    el.onlinePill.classList.toggle("is-off", !connected && state.online.errorCount > 2);
    el.app.classList.add("is-online");
  }

  function resetTableForOnline() {
    state.lastBoardCount = 0;
    state.lastHand = -1;
    state.lastLevel = -1;
    state.lastResultHand = 0;
    state.lastResultSoundHand = 0;
    state.controlKey = "";
    state.thinkingPlayerId = null;
    state.autoNext = false;
    state.setupOpen = false;
    state.setupShown = false;
    state.paused = false;
    el.tableEmpty.hidden = true;
    el.setup.hidden = true;
    el.setup.classList.remove("is-leaving");
    closeModal(false, false);
  }

  function enterOnlineSession(code, token, view) {
    clearTimer();
    state.online.code = code;
    state.online.token = token;
    state.online.view = view || null;
    state.online.status = view ? view.status : "connecting";
    state.online.hostId = view ? view.hostId : null;
    state.online.playerId = view && view.you ? view.you.id : null;
    state.online.connected = false;
    state.online.actionPending = false;
    state.online.errorCount = 0;
    state.online.lastStateAt = 0;
    state.online.lastLogId = 0;
    state.online.lastChatId = 0;
    state.online.chatReady = false;
    state.online.chatSending = false;
    preloadChatVoices();
    state.mode = "online";
    state.setupMode = "online";
    state.game = null;
    state.hero = null;
    state.ais = new Map();
    resetTableForOnline();
    saveOnlineSession(code, token);
    try {
      history.replaceState(null, "", location.pathname + "?room=" + encodeURIComponent(code));
    } catch (error) {
      /* ignore */
    }
    el.app.classList.add("is-online");
    el.lobbyOverlay.hidden = true;
    el.onlinePill.hidden = true;
    if (view) handleOnlineView(view);
    connectOnlineEvents();
    startOnlinePolling();
    setTimeout(() => {
      if (state.mode === "online" && state.online.code === code && !state.online.connected) {
        el.onlinePillStatus.textContent = "连接中…";
      }
    }, 400);
  }

  async function onlineGet(pathAndQuery) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    try {
      const response = await fetch(pathAndQuery, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(data.error || "服务器没有响应。");
        error.status = response.status;
        throw error;
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  function stopOnlinePolling() {
    if (state.online.pollTimer) {
      clearInterval(state.online.pollTimer);
      state.online.pollTimer = null;
    }
    state.online.polling = false;
  }

  function startOnlinePolling() {
    stopOnlinePolling();
    state.online.pollTimer = setInterval(pollOnlineState, 1500);
    pollOnlineState();
  }

  async function pollOnlineState() {
    if (
      state.mode !== "online" ||
      !state.online.code ||
      !state.online.token ||
      state.online.polling ||
      document.hidden
    ) {
      return;
    }
    state.online.polling = true;
    try {
      const result = await onlineGet(
        "/api/state?room=" +
          encodeURIComponent(state.online.code) +
          "&token=" +
          encodeURIComponent(state.online.token)
      );
      if (!result.view || state.mode !== "online") return;
      const next = result.view;
      const previous = state.online.view;
      const changed =
        !previous ||
        next.seq !== previous.seq ||
        next.status !== previous.status ||
        next.turnDeadline !== previous.turnDeadline ||
        JSON.stringify(next.lobby || null) !== JSON.stringify(previous.lobby || null) ||
        JSON.stringify(next.chat || []) !== JSON.stringify(previous.chat || []);
      state.online.connected = true;
      if (changed) {
        handleOnlineView(next);
      } else {
        updateOnlinePill();
      }
    } catch (error) {
      if (error.status === 401 || error.status === 404) {
        toast("联机房间已失效，请重新加入。", { duration: 4000 });
        returnToSetupAfterOnline();
      }
    } finally {
      state.online.polling = false;
    }
  }

  function connectOnlineEvents() {
    if (state.online.eventSource) {
      try {
        state.online.eventSource.close();
      } catch (error) {
        /* ignore */
      }
    }
    if (!state.online.code || !state.online.token) return;
    const code = state.online.code;
    const token = state.online.token;
    const es = new EventSource(
      "/api/events?room=" + encodeURIComponent(code) + "&token=" + encodeURIComponent(token)
    );
    state.online.eventSource = es;
    es.addEventListener("state", (event) => {
      if (state.online.eventSource !== es) return;
      let view;
      try {
        view = JSON.parse(event.data);
      } catch (error) {
        return;
      }
      state.online.connected = true;
      state.online.errorCount = 0;
      handleOnlineView(view);
    });
    es.addEventListener("chat", (event) => {
      if (state.online.eventSource !== es) return;
      let message;
      try {
        message = JSON.parse(event.data);
      } catch (error) {
        return;
      }
      handleChat(message);
    });
    es.onopen = () => {
      if (state.online.eventSource !== es) return;
      state.online.connected = true;
      state.online.errorCount = 0;
      updateOnlinePill();
    };
    es.onerror = () => {
      if (state.online.eventSource !== es) return;
      state.online.connected = false;
      state.online.errorCount += 1;
      updateOnlinePill();
      if (state.online.errorCount === 3) {
        onlineApi("check", { room: code, token })
          .then((result) => {
            if (result.view && state.online.eventSource === es) handleOnlineView(result.view);
          })
          .catch((error) => {
            if (state.online.eventSource !== es) return;
            if (error.status === 401 || error.status === 404) {
              toast("联机房间已失效，请重新加入。", { duration: 4200 });
              returnToSetupAfterOnline();
            }
          });
      }
    };
  }

  function makeRemoteGame(view) {
    const g = view.game;
    const players = (g.players || []).map((player) => ({ ...player }));
    const emptyLegal = {
      isTurn: false,
      canPlay: false,
      canFold: false,
      canCheck: false,
      canCall: false,
      canRaise: false,
      canAllIn: false,
      toCall: 0,
      callAmount: 0,
      isAllInCall: false,
      minRaiseTo: 0,
      maxRaiseTo: players[0] ? players[0].chips : 0,
      minRaiseLegal: 0,
      playerChips: players[0] ? players[0].chips : 0,
      pot: g.pot || 0,
      currentBet: g.currentBet || 0,
      lastFullRaise: 0,
      callLabel: "等待",
      raiseLabel: "加注",
    };
    const remote = {
      id: view.room,
      remote: true,
      status: view.status,
      roomStatus: view.status,
      handNumber: g.handNumber,
      phase: g.phase,
      community: g.community || [],
      pot: g.pot || 0,
      currentBet: g.currentBet || 0,
      variant: g.variant || view.variant || "holdem",
      smallBlind: g.smallBlind,
      bigBlind: g.bigBlind,
      blindLevel: g.blindLevel,
      handsUntilNextLevel: g.handsUntilNextLevel,
      dealerIndex: g.dealerIndex,
      smallBlindIndex: g.smallBlindIndex,
      bigBlindIndex: g.bigBlindIndex,
      currentPlayerId: g.currentPlayerId,
      streetComplete: Boolean(g.streetComplete),
      handResult: g.handResult,
      gameOver: Boolean(g.gameOver),
      champion: g.champion,
      log: g.log || [],
      players,
      startingChips: view.startingChips || g.startingChips || state.settings.chips,
      turnDeadline: view.turnDeadline || 0,
      serverTime: view.serverTime || Date.now(),
      config: {
        blindEvery: g.blindEvery || 8,
        startingChips: view.startingChips || 5000,
        variant: g.variant || view.variant || "holdem",
      },
      version: view.seq,
      started: true,
      getTotalPot() {
        return g.pot || 0;
      },
      getHandsUntilBlindIncrease() {
        return g.handsUntilNextLevel || 1;
      },
      getPositionLabel(player) {
        return player && player.position ? player.position : "";
      },
      getPlayer(id) {
        return players.find((player) => player.id === id) || null;
      },
      getLegalActions() {
        return view.legal || emptyLegal;
      },
      get inHandPlayers() {
        return players.filter((player) => player.dealtIn && !player.folded);
      },
      get alivePlayers() {
        return players.filter((player) => player.chips > 0);
      },
      get currentPlayer() {
        return players.find((player) => player.id === g.currentPlayerId) || null;
      },
      startHand() {
        return false;
      },
    };
    return remote;
  }

  function handleOnlineView(view) {
    if (!view || !view.room) return;
    state.online.view = view;
    state.online.status = view.status;
    state.online.hostId = view.hostId;
    state.online.lastStateAt = Date.now();
    state.online.connected = true;
    state.online.errorCount = 0;
    state.online.actionPending = false;
    state.online.serverOffset = (view.serverTime || Date.now()) - Date.now();
    state.online.code = view.room;
    state.mode = "online";
    state.setupMode = "online";
    state.setupOpen = false;
    state.setupShown = false;
    state.online.playerId = (view.you && view.you.id) || state.online.playerId;
    syncOnlineChat(view.chat);
    el.app.classList.add("is-online");
    el.setup.hidden = true;
    el.setup.classList.remove("is-leaving");

    if (view.status === "lobby" && view.lobby) {
      state.game = null;
      state.hero = null;
      el.lobbyOverlay.hidden = false;
      el.onlinePill.hidden = true;
      closeQuickChat();
      renderLobby(view);
      return;
    }

    el.lobbyOverlay.hidden = true;
    const remote = makeRemoteGame(view);
    const gameKey = view.room + ":" + remote.players.map((player) => player.id).join(",");
    const firstGame = state.online.gameKey !== gameKey;
    const previousLogId = state.online.lastLogId;
    if (firstGame) {
      state.online.gameKey = gameKey;
      state.lastBoardCount = 0;
      state.lastHand = -1;
      state.lastResultHand = 0;
      state.lastResultSoundHand = 0;
      state.controlKey = "";
      state.lastTurnSignal = "";
      state.lastTimerWarnSignal = "";
    }
    const newEntries = (remote.log || []).filter((entry) => entry.id > previousLogId);
    const previousLevel = state.lastLevel;
    if (firstGame) {
      state.lastLevel = Number(remote.blindLevel) || 0;
    } else if (Number(remote.blindLevel) > previousLevel) {
      state.lastLevel = Number(remote.blindLevel) || 0;
      sound.blind();
      toast("盲注提升至 " + remote.smallBlind + " / " + remote.bigBlind, { gold: true, duration: 1500 });
    }
    if (!firstGame) {
      for (const entry of newEntries.slice(-4)) playOnlineLogSound(entry);
    }
    state.online.lastLogId = (remote.log || []).reduce(
      (max, entry) => Math.max(max, Number(entry.id) || 0),
      firstGame ? 0 : previousLogId
    );
    const previousHand = state.lastHand;
    const newHand = Boolean(
      remote.handNumber && remote.handNumber !== previousHand && !remote.handResult
    );
    state.game = remote;
    state.hero = remote.players[0] || null;
    state.ais = new Map();
    state.mode = "online";
    el.tableEmpty.hidden = true;
    if (firstGame) {
      buildSeats();
      updateStaticUi();
    }
    updateOnlinePill();
    if (newHand) sound.deal();
    renderAll(firstGame);
    if (firstGame && window.innerHeight >= 700) {
      toast("联机牌局开始 · 房间 " + view.room, { gold: true, duration: 2200 });
    }
    if (remote.handResult) {
      // renderDock() already delegates to showResult(); this also keeps the
      // online result panel in sync after every server update.
      updateTurnClock();
    } else {
      updateTurnClock();
    }
  }

  function renderLobby(view) {
    const lobby = view.lobby;
    if (!lobby) return;
    const humans = lobby.humans || [];
    el.lobbyCode.textContent = view.room;
    el.lobbyCodeBig.textContent = view.room;
    el.lobbyBotFill.textContent = lobby.botFill ? "开启" : "关闭";
    el.lobbyDifficulty.textContent = DIFFICULTY_NAMES[lobby.difficulty] || "标准";
    el.lobbyVariant.textContent = lobby.variant === "short" ? "短牌 6+" : "标准德州";
    el.lobbyChips.textContent = format(lobby.startingChips);
    el.lobbyHumanCount.textContent = humans.length + " / " + lobby.maxHumans;
    el.lobbyPlayerList.innerHTML = humans
      .map((human) => {
        const you = view.you && human.id === view.you.id;
        const host = human.id === view.hostId;
        return (
          '<li class="lobby-player' + (you ? " is-you" : "") + '">' +
          '<span class="lobby-player-avatar">' + escapeHtml(human.avatar || "♠") + "</span>" +
          '<span class="lobby-player-name">' + escapeHtml(human.name) + (you ? "（你）" : "") + "</span>" +
          (host ? '<span class="lobby-player-badge">房主</span>' : "") +
          '<span class="lobby-player-state' + (human.connected ? "" : " is-off") + '"><i></i>' +
          (human.connected ? "在线" : "重连中") +
          "</span></li>"
        );
      })
      .join("");
    const emptyCount = Math.max(0, lobby.maxHumans - humans.length);
    let slots = "";
    if (lobby.botFill) {
      for (let i = 0; i < emptyCount; i++) {
        slots += '<div class="lobby-bot-slot"><span>♠</span>电脑补位</div>';
      }
    } else {
      for (let i = 0; i < emptyCount; i++) {
        slots += '<div class="lobby-bot-slot"><span>·</span>等待玩家</div>';
      }
    }
    el.lobbyBotSlots.innerHTML = slots;
    el.startOnlineBtn.disabled = !lobby.canStart;
    if (lobby.canStart) {
      el.lobbyHint.textContent = lobby.botFill
        ? "任意玩家都可以开始。空位会由电脑玩家补足。"
        : "人数已够，任意玩家都可以开始。";
    } else {
      el.lobbyHint.textContent = lobby.botFill
        ? "等待玩家入座……"
        : "至少需要两位真人玩家，或返回开启电脑补位。";
    }
    el.lobbyOverlay.hidden = false;
    el.onlinePill.hidden = true;
  }

  function updateTurnClock() {
    const clock = el.turnClock;
    if (!clock) return;
    if (state.mode !== "online" || !state.game || state.game.handResult) {
      clock.hidden = true;
      clock.textContent = "";
      return;
    }
    const current = state.game.currentPlayer;
    const deadline = state.game.turnDeadline;
    if (!current || !current.isYou || !deadline) {
      clock.hidden = true;
      clock.textContent = "";
      if (state.online.connected) el.onlinePillStatus.textContent = "已连接";
      return;
    }
    const left = Math.max(0, Math.ceil((deadline - (Date.now() + state.online.serverOffset)) / 1000));
    clock.hidden = false;
    clock.textContent = left + "s";
    clock.classList.toggle("is-low", left <= 10);
    if (state.online.connected) el.onlinePillStatus.textContent = "行动 " + left + "s";
    if (left > 0 && left <= 5) {
      const warnKey = [state.online.code, state.game.handNumber, state.game.phase, state.game.version, current.id].join(":");
      if (state.lastTimerWarnSignal !== warnKey) {
        state.lastTimerWarnSignal = warnKey;
        sound.warning();
      }
    }
  }

  function returnToSetupAfterOnline() {
    const code = state.online.code;
    stopOnlinePolling();
    if (state.online.eventSource) {
      try {
        state.online.eventSource.close();
      } catch (error) {
        /* ignore */
      }
    }
    if (code) clearOnlineSession(code);
    state.mode = "solo";
    state.game = null;
    state.hero = null;
    state.online = {
      code: null,
      token: null,
      playerId: null,
      hostId: null,
      view: null,
      status: "idle",
      eventSource: null,
      connected: false,
      actionPending: false,
      gameKey: "",
      lastStateAt: 0,
      serverOffset: 0,
      errorCount: 0,
      lastLogId: 0,
      lastChatId: 0,
      chatReady: false,
      chatSending: false,
      pollTimer: null,
      polling: false,
    };
    el.app.classList.remove("is-online");
    el.lobbyOverlay.hidden = true;
    el.onlinePill.hidden = true;
    el.tableEmpty.hidden = false;
    try {
      history.replaceState(null, "", location.pathname);
    } catch (error) {
      /* ignore */
    }
    clearTimer();
    showSetup();
    setSetupMode("online", true);
  }

  function leaveOnlineRoom() {
    const code = state.online.code;
    const token = state.online.token;
    stopOnlinePolling();
    if (state.online.eventSource) {
      try {
        state.online.eventSource.close();
      } catch (error) {
        /* ignore */
      }
      state.online.eventSource = null;
    }
    if (code && token) {
      fetch("/api/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room: code, token }),
        keepalive: true,
      }).catch(() => {});
    }
    if (code) clearOnlineSession(code);
    state.mode = "solo";
    state.game = null;
    state.hero = null;
    state.online = {
      code: null,
      token: null,
      playerId: null,
      hostId: null,
      view: null,
      status: "idle",
      eventSource: null,
      connected: false,
      actionPending: false,
      gameKey: "",
      lastStateAt: 0,
      serverOffset: 0,
      errorCount: 0,
      lastLogId: 0,
      lastChatId: 0,
      chatReady: false,
      chatSending: false,
      pollTimer: null,
      polling: false,
    };
    el.app.classList.remove("is-online");
    el.lobbyOverlay.hidden = true;
    el.onlinePill.hidden = true;
    el.tableEmpty.hidden = false;
    el.seats.innerHTML = "";
    el.community.innerHTML = "";
    closeModal(false, false);
    clearTimer();
    try {
      history.replaceState(null, "", location.pathname);
    } catch (error) {
      /* ignore */
    }
    sound.click();
    showSetup();
    setSetupMode("online", true);
    toast("已离开联机房间", { duration: 1800 });
  }

  function confirmLeaveOnline() {
    const inGame = state.online.status === "playing" || state.online.status === "done";
    openModal({
      eyebrow: "LEAVE ROOM",
      title: "离开房间？",
      pause: true,
      body: inGame
        ? '<p class="confirm-copy">离开后你的座位会由系统自动弃牌处理，这一局将无法继续。确定要离开吗？</p>'
        : '<p class="confirm-copy">离开后房间号会失效，确定要离开吗？</p>',
      actions: [
        { label: "继续游戏", className: "", onClick: () => true },
        {
          label: "离开房间",
          className: "danger",
          onClick: () => {
            closeModal(false, false);
            leaveOnlineRoom();
            return false;
          },
        },
      ],
    });
  }

  async function createOnlineRoom() {
    if (state.setupMode !== "online") return;
    const name = (el.playerNameInput.value || "").trim().slice(0, 10) || "你";
    state.settings.name = name;
    state.settings.botFill = el.botFillToggle.checked;
    state.settings.difficulty = $("#difficultyGroup .is-active")?.dataset.difficulty || state.settings.difficulty;
    state.settings.variant = $("#variantGroup .is-active")?.dataset.variant === "short" ? "short" : "holdem";
    saveSettings(state.settings);
    setStartBusy(true, "创建中…");
    sound.unlock();
    try {
      const result = await onlineApi("create", {
        name,
        botFill: state.settings.botFill,
        difficulty: state.settings.difficulty,
        variant: state.settings.variant,
        startingChips: state.settings.chips,
      });
      enterOnlineSession(result.room, result.token, result.view);
    } catch (error) {
      toast(error.message || "创建房间失败", { duration: 3800 });
      setStartBusy(false);
    }
  }

  async function joinOnlineRoom() {
    if (state.setupMode !== "online") setSetupMode("online");
    const code = (el.joinCodeInput.value || "").replace(/\D/g, "").slice(0, 4);
    el.joinCodeInput.value = code;
    if (code.length !== 4) {
      toast("请输入 4 位房间号", { duration: 2200 });
      el.joinCodeInput.focus();
      return;
    }
    const name = (el.playerNameInput.value || "").trim().slice(0, 10) || "你";
    state.settings.name = name;
    saveSettings(state.settings);
    setJoinBusy(true);
    sound.unlock();
    const saved = loadOnlineSession(code);
    try {
      if (saved) {
        try {
          const checked = await onlineApi("check", { room: code, token: saved });
          if (checked.view) {
            enterOnlineSession(code, saved, checked.view);
            return;
          }
        } catch (error) {
          if (error.status === 401 || error.status === 404) clearOnlineSession(code);
          else throw error;
        }
      }
      const result = await onlineApi("join", { room: code, name });
      enterOnlineSession(result.room, result.token, result.view);
    } catch (error) {
      toast(error.message || "加入房间失败", { duration: 3800 });
    } finally {
      setJoinBusy(false);
    }
  }

  function updateOnlineStatusText() {
    if (!state.online.code) return;
    el.onlineRoomCode.textContent = state.online.code;
    const connected = state.online.connected;
    el.onlinePillStatus.textContent = connected ? "已连接" : "重连中…";
    el.onlinePill.classList.toggle("is-warn", !connected);
    el.onlinePill.classList.toggle("is-off", !connected && state.online.errorCount > 2);
  }

  async function copyInvite() {
    if (!state.online.code) return;
    const link = inviteUrl(state.online.code);
    const ok = await copyText(link);
    if (ok) toast("邀请链接已复制，发给朋友即可。", { gold: true, duration: 2600 });
    else toast("复制失败，请手动复制地址栏里的链接。", { duration: 3200 });
  }

  /* ---------------------------------------------------------- setup UI */

  function applySettingsToForm() {
    const s = state.settings;
    el.playerNameInput.value = s.name;
    $$("#botCountGroup button").forEach((button) => {
      button.classList.toggle("is-active", Number(button.dataset.bots) === s.bots);
    });
    $$("#difficultyGroup button").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.difficulty === s.difficulty);
    });
    $$("#variantGroup button").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.variant === s.variant);
    });
    el.variantHint.textContent =
      s.variant === "short"
        ? "36 张牌（去掉 2–5），同花大于葫芦，A-6-7-8-9 为最小顺子。"
        : "经典 52 张牌，标准德州牌型。";
    $$("#chipsGroup button").forEach((button) => {
      button.classList.toggle("is-active", Number(button.dataset.chips) === s.chips);
    });
    el.opponentCountLabel.textContent = s.bots + " 位";
    el.chipsHint.textContent = chipsHint(s.chips);
    el.botFillToggle.checked = Boolean(s.botFill);
    el.speedLabel.textContent = s.speed + "×";
    setSetupMode(state.setupMode, true);
    updateSoundButton();
  }

  function chipsHint(chips) {
    if (chips === 2000) return "40 个大盲，节奏更快。";
    if (chips === 10000) return "200 个大盲，深筹码对局。";
    return "100 个大盲，适合完整体验。";
  }

  function updateSoundButton() {
    el.soundBtn.classList.toggle("sound-off", !state.settings.sound);
    el.soundBtn.setAttribute("aria-label", state.settings.sound ? "关闭声音" : "打开声音");
    el.soundBtn.title = state.settings.sound ? "关闭声音" : "打开声音";
  }

  function bindSetupEvents() {
    el.playerNameInput.addEventListener("input", () => {
      state.settings.name = el.playerNameInput.value;
    });

    el.botCountGroup.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-bots]");
      if (!button) return;
      state.settings.bots = Number(button.dataset.bots);
      $$("#botCountGroup button").forEach((b) => b.classList.toggle("is-active", b === button));
      el.opponentCountLabel.textContent = state.settings.bots + " 位";
      sound.click();
    });

    el.variantGroup.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-variant]");
      if (!button) return;
      state.settings.variant = button.dataset.variant === "short" ? "short" : "holdem";
      sound.click();
      $$("#variantGroup button").forEach((b) => {
        b.classList.toggle("is-active", b === button);
      });
      el.variantHint.textContent =
        state.settings.variant === "short"
          ? "36 张牌（去掉 2–5），同花大于葫芦，A-6-7-8-9 为最小顺子。"
          : "经典 52 张牌，标准德州牌型。";
      saveSettings(state.settings);
    });

    el.difficultyGroup.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-difficulty]");
      if (!button) return;
      state.settings.difficulty = button.dataset.difficulty;
      $$("#difficultyGroup button").forEach((b) => {
        b.classList.toggle("is-active", b === button);
      });
      sound.click();
    });

    el.chipsGroup.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-chips]");
      if (!button) return;
      state.settings.chips = Number(button.dataset.chips);
      $$("#chipsGroup button").forEach((b) => b.classList.toggle("is-active", b === button));
      el.chipsHint.textContent = chipsHint(state.settings.chips);
      sound.click();
    });

    el.startBtn.addEventListener("click", () => {
      if (el.startBtn.disabled) return;
      state.settings.name = (el.playerNameInput.value || "").trim().slice(0, 10) || "你";
      saveSettings(state.settings);
      sound.unlock();
      if (state.setupMode === "online") createOnlineRoom();
      else beginGame();
    });

    el.modeSwitch.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-setup-mode]");
      if (!button) return;
      setSetupMode(button.dataset.setupMode);
    });

    el.botFillToggle.addEventListener("change", () => {
      state.settings.botFill = el.botFillToggle.checked;
      saveSettings(state.settings);
      sound.click();
    });

    el.joinRoomBtn.addEventListener("click", () => joinOnlineRoom());
    el.joinCodeInput.addEventListener("input", () => {
      el.joinCodeInput.value = el.joinCodeInput.value.replace(/\D/g, "").slice(0, 4);
    });
    el.joinCodeInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        joinOnlineRoom();
      }
    });

    el.copyInviteLobbyBtn.addEventListener("click", () => copyInvite());
    el.copyInvitePillBtn.addEventListener("click", () => copyInvite());
    el.quickChatBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleQuickChat();
    });
    el.quickChatClose.addEventListener("click", () => closeQuickChat());
    el.quickChatGrid.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-phrase-id]");
      if (!button) return;
      sendQuickChat(button.dataset.phraseId);
    });
    document.addEventListener("click", (event) => {
      if (el.quickChatPanel.hidden) return;
      if (event.target.closest("#quickChatPanel") || event.target.closest("#quickChatBtn")) return;
      closeQuickChat();
    });
    el.leaveLobbyBtn.addEventListener("click", () => confirmLeaveOnline());
    el.leaveOnlinePillBtn.addEventListener("click", () => confirmLeaveOnline());
    el.startOnlineBtn.addEventListener("click", async () => {
      if (el.startOnlineBtn.disabled) return;
      el.startOnlineBtn.disabled = true;
      try {
        await onlineApi("start", { room: state.online.code, token: state.online.token });
      } catch (error) {
        toast(error.message || "无法开始牌局", { duration: 3600 });
        el.startOnlineBtn.disabled = false;
      }
    });

    el.setupRecordsBtn.addEventListener("click", () => openRecords("board", false));
    el.setupHistoryBtn.addEventListener("click", () => openRecords("history", false));
    el.setupRulesBtn.addEventListener("click", () => openRules(false));
  }

  function showSetup() {
    closeQuickChat();
    stopChatVoice();
    document.querySelectorAll(".seat-chat-bubble").forEach((node) => node.remove());
    clearTimer();
    state.beginning = false;
    state.paused = true;
    state.setupOpen = true;
    state.setupShown = true;
    closeModal(false, false);
    el.lobbyOverlay.hidden = true;
    el.onlinePill.hidden = true;
    el.app.classList.remove("is-online");
    el.turnClock.hidden = true;
    if (state.mode !== "online") state.mode = "solo";
    applySettingsToForm();
    setStartBusy(false);
    setJoinBusy(false);
    el.setup.hidden = false;
    el.setup.classList.remove("is-leaving");
    requestAnimationFrame(() => {
      el.setup.classList.remove("is-leaving");
    });
    setTimeout(() => el.playerNameInput.focus(), 420);
  }

  function hideSetup() {
    state.setupOpen = false;
    state.setupShown = false;
    el.setup.classList.add("is-leaving");
    setTimeout(() => {
      el.setup.hidden = true;
    }, 420);
  }

  /* ---------------------------------------------------------- game start */

  function beginGame() {
    if (state.mode === "online") return;
    closeQuickChat();
    if (state.beginning || !state.setupShown) return;
    state.beginning = true;
    clearTimer();
    state.paused = false;
    state.setupOpen = false;
    state.thinkingPlayerId = null;
    state.lastBoardCount = 0;
    state.lastHand = 0;
    state.lastLevel = -1;
    state.lastResultHand = 0;
    state.lastResultSoundHand = 0;
    state.controlKey = "";
    state.autoNext = false;
    state.mode = "solo";
    state.setupMode = "solo";
    state.recordedSoloGameId = null;
    state.online.connected = false;
    el.app.classList.remove("is-online");
    el.lobbyOverlay.hidden = true;
    el.onlinePill.hidden = true;
    el.tableEmpty.hidden = true;
    closeModal(false, false);

    const settings = state.settings;
    const botProfiles = createBotLineup(settings.bots, settings.difficulty);
    const players = [
      {
        id: "hero",
        name: settings.name,
        avatar: "你",
        color: "#d6b36a",
        isHuman: true,
        chips: settings.chips,
      },
      ...botProfiles.map((profile, index) => ({
        id: "bot-" + (index + 1),
        name: profile.name,
        avatar: profile.avatar,
        color: profile.color,
        tag: profile.tag,
        style: profile.style,
        isHuman: false,
        chips: settings.chips,
      })),
    ];

    state.game = new PokerGame({
      players,
      startingChips: settings.chips,
      blindEvery: 8,
      variant: settings.variant,
    });
    state.hero = state.game.players[0];
    state.hero.isYou = true;
    state.ais = new Map();
    for (const player of state.game.players) {
      if (!player.isHuman) state.ais.set(player.id, new PokerAI(settings.difficulty));
    }

    buildSeats();
    updateStaticUi();
    state.game.startHand();
    state.lastLevel = state.game.blindLevel;
    state.lastHand = state.game.handNumber;
    state.lastBoardCount = 0;
    hideSetup();
    sound.deal();
    renderAll(true);
    if (window.innerHeight >= 700) {
      toast(
        (state.game.variant === "short" ? "短牌 6+ 开始" : "牌局开始") +
          " · " +
          state.game.smallBlind +
          " / " +
          state.game.bigBlind +
          " 盲注",
        { gold: true }
      );
    }
    setTimeout(() => {
      state.beginning = false;
    }, 700);
    advanceGame();
  }

  function startNextHand() {
    if (state.mode !== "solo") return;
    if (!state.game || state.paused) return;
    if (state.game.gameOver || !state.hero || state.hero.chips <= 0) {
      openEndedState();
      return;
    }
    clearTimer();
    state.lastResultHand = 0;
    state.thinkingPlayerId = null;
    state.game.startHand();
    if (!state.game.started) {
      openEndedState();
      return;
    }
    state.lastBoardCount = 0;
    state.lastHand = state.game.handNumber;
    if (state.game.blindLevel > state.lastLevel) {
      state.lastLevel = state.game.blindLevel;
      sound.blind();
      toast("盲注提升至 " + state.game.smallBlind + " / " + state.game.bigBlind, { gold: true });
    }
    sound.deal();
    renderAll(true);
    advanceGame();
  }

  function openEndedState() {
    if (state.mode !== "solo") return;
    if (!state.game) {
      showSetup();
      return;
    }
    if (state.game.gameOver || (state.hero && state.hero.chips <= 0)) {
      showResult(true);
    }
  }

  /* ---------------------------------------------------------- rendering */

  function buildSeats() {
    if (!state.game) return;
    const positions = POSITIONS[state.game.players.length] || POSITIONS[6];
    el.seats.innerHTML = state.game.players
      .map((player, index) => {
        return (
          '<article class="seat ' +
          positions[index] +
          (player.isYou ? " is-hero" : "") +
          '" data-player-id="' +
          player.id +
          '">' +
          '<div class="thinking-bubble" aria-hidden="true"><i></i><i></i><i></i></div>' +
          '<div class="dealer-chip" aria-hidden="true">D</div>' +
          '<div class="seat-cards" data-role="cards"></div>' +
          '<div class="seat-body">' +
          '<div class="avatar-wrap"><span class="avatar-ring"></span>' +
          '<div class="avatar ' +
          (player.isYou ? "avatar-human" : "") +
          '" style="--avatar-color:' +
          player.color +
          '">' +
          (player.isYou ? "你" : escapeHtml(player.avatar)) +
          "</div></div>" +
          '<div class="seat-info">' +
          '<div class="seat-name"><span class="name-text">' +
          escapeHtml(player.name) +
          '</span><span class="dealer-badge"></span></div>' +
          '<div class="seat-stack">0</div>' +
          '<div class="seat-role"></div>' +
          "</div></div>" +
          '<div class="seat-bet" data-role="bet"></div>' +
          '<div class="seat-action" data-role="action"></div>' +
          "</article>"
        );
      })
      .join("");
  }

  function renderAll(dealAnimation) {
    if (!state.game) {
      setDockMode("idle");
      return;
    }
    if (dealAnimation) {
      state.lastHand = -1;
    }
    renderHeader();
    renderBoard();
    renderSeats();
    renderSidebar();
    renderLog();
    renderDock();
  }

  function updateStaticUi() {
    if (!state.game) return;
    el.sideHeroAvatar.textContent = state.hero.name.slice(0, 1) || "你";
  }

  function renderHeader() {
    const game = state.game;
    if (!game) return;
    el.topHandNo.textContent = game.handNumber ? "#" + game.handNumber : "—";
    el.topBlinds.textContent =
      (game.variant === "short" ? "6+ · " : "") + game.smallBlind + " / " + game.bigBlind;
    el.topLevel.textContent = game.getHandsUntilBlindIncrease() + " 手后";
    el.phaseLabel.textContent = PHASE_NAMES[game.phase] || game.phase;
    const pot = game.getTotalPot();
    el.potValue.textContent = format(pot);
    el.potSub.textContent = game.handResult ? "" : game.currentBet ? "当前注 " + format(game.currentBet) : "";
    el.tableNote.textContent = game.handNumber
      ? (game.variant === "short" ? "短牌 6+ · " : "") +
        "第 " + game.handNumber + " 手 · 盲注 " + game.smallBlind + " / " + game.bigBlind +
        " · " + game.inHandPlayers.length + " 人在局"
      : "等待玩家入座";
  }

  function winningCardSet() {
    const result = state.game && state.game.handResult;
    if (!result || result.type !== "showdown") return new Set();
    const cards = new Set();
    for (const winner of result.winners || []) {
      for (const card of winner.bestCards || []) cards.add(card);
    }
    return cards;
  }

  function renderBoard() {
    const game = state.game;
    if (!game) return;
    const previousCount = state.lastBoardCount;
    const winning = winningCardSet();
    const community = game.community || [];
    if (community.length > previousCount) sound.flip();
    let html = "";
    for (let i = 0; i < 5; i++) {
      if (i < community.length) {
        const card = community[i];
        const isNew = community.length > previousCount && i >= previousCount;
        const cls = (isNew ? "is-new " : "") + (winning.has(card) ? "is-best " : "");
        html += cardMarkup(card, {
          className: cls,
          delay: isNew ? (i - previousCount) * 90 : 0,
        });
      } else {
        html += '<span class="card-slot" aria-hidden="true"></span>';
      }
    }
    el.community.innerHTML = html;
    state.lastBoardCount = community.length;
  }

  function renderSeats() {
    const game = state.game;
    if (!game) return;
    const winning = winningCardSet();
    const newHand = game.handNumber !== state.lastHand;
    if (newHand) {
      state.lastHand = game.handNumber;
    }
    const winnerIds = new Set((game.handResult ? game.handResult.winners || [] : []).map((w) => w.id));

    for (const player of game.players) {
      const seat = el.seats.querySelector('[data-player-id="' + player.id + '"]');
      if (!seat) continue;
      const isTurn =
        !game.streetComplete &&
        !game.handResult &&
        game.currentPlayerId === player.id &&
        game.phase !== "showdown";
      const isWinner = Boolean(game.handResult) && winnerIds.has(player.id);
      const thinking =
        state.thinkingPlayerId === player.id &&
        !state.paused &&
        isTurn;
      const classes = [
        "seat",
        POSITIONS[game.players.length][player.seat],
        player.isYou ? "is-hero" : "",
        isTurn ? "is-turn" : "",
        isWinner ? "is-winner" : "",
        player.folded && !isWinner ? "is-folded" : "",
        player.out ? "is-out" : "",
        thinking ? "is-thinking" : "",
        player.isHuman && player.connected === false && !player.isYou ? "is-offline" : "",
        game.dealerIndex === player.seat && player.dealtIn ? "has-dealer" : "",
      ]
        .filter(Boolean)
        .join(" ");
      seat.className = classes;

      const stack = seat.querySelector(".seat-stack");
      if (stack) stack.textContent = format(player.chips);
      const role = seat.querySelector(".seat-role");
      if (role) {
        const position = game.getPositionLabel(player);
        role.textContent =
          player.isHuman && player.connected === false && !player.isYou
            ? "掉线 · 等待重连"
            : position || player.tag || "";
      }
      const name = seat.querySelector(".name-text");
      if (name) name.textContent = player.name;

      renderHoleCards(seat, player, { newHand, winning, game });
      renderSeatAction(seat, player, { game, isWinner });
      const bet = seat.querySelector('[data-role="bet"]');
      if (bet) {
        const amount = player.streetBet || 0;
        bet.textContent = amount > 0 ? format(amount) : "";
        bet.classList.toggle("is-visible", amount > 0);
      }
    }
  }

  function renderHoleCards(seat, player, ctx) {
    const container = seat.querySelector('[data-role="cards"]');
    if (!container) return;
    const game = ctx.game;
    const cardCount = player.hole ? player.hole.length : (player.cardCount || 0);
    const hasCards = Boolean(player.dealtIn && cardCount > 0);
    const revealPhase = game.phase === "showdown" || Boolean(game.handResult);
    const faceUp =
      hasCards &&
      Boolean(
        player.isYou ||
        (player.hole && (player.revealed || (revealPhase && player.hole.length === 2)))
      );
    const knownCards = faceUp && player.hole ? player.hole : [];
    const sig = !hasCards
      ? "none"
      : (faceUp ? "up:" + knownCards.join("") : "down:" + cardCount) +
        (player.folded ? ":folded" : "");

    if (seat.dataset.cardSig !== sig) {
      const wasDown = (seat.dataset.cardSig || "").startsWith("down:");
      const flipping = wasDown && faceUp;
      let html = "";
      for (let index = 0; index < cardCount; index++) {
        const delay = ctx.newHand ? player.seat * 55 + index * 70 : 0;
        if (faceUp && player.hole && player.hole[index]) {
          html += cardMarkup(player.hole[index], {
            className:
              (ctx.newHand ? "is-new " : "") +
              (flipping ? "is-flipping " : "") +
              (player.folded && !player.isWinner ? "is-mucked " : ""),
            delay,
          });
        } else {
          html += cardMarkup(null, {
            faceDown: true,
            className:
              (ctx.newHand ? "is-new " : "") +
              (player.folded ? "is-mucked " : ""),
            delay,
          });
        }
      }
      container.innerHTML = html;
      seat.dataset.cardSig = sig;
    }

    // Highlight the winning five cards without re-rendering the cards.
    const nodes = $$(".playing-card[data-card]", container);
    for (const node of nodes) {
      const isBest = ctx.winning.has(node.dataset.card);
      node.classList.toggle("is-best", isBest);
    }
    container.style.visibility = hasCards ? "" : "hidden";
  }

  function renderSeatAction(seat, player, ctx) {
    const node = seat.querySelector('[data-role="action"]');
    if (!node) return;
    let label = "";
    let type = "";
    if (ctx.isWinner) {
      label = "赢得 " + format(player.winAmount);
      type = "win";
    } else if (player.lastAction && player.lastAction.label && player.dealtIn) {
      label = player.lastAction.label;
      type = player.lastAction.type || "";
    }
    if (player.out && !player.dealtIn) label = "已淘汰";
    node.textContent = label;
    node.className =
      "seat-action" +
      (label ? " is-visible" : "") +
      (type ? " action-" + type : "");
  }

  function renderSidebar() {
    const game = state.game;
    if (!game) return;
    el.sideHeroAvatar.textContent = state.hero.name.slice(0, 1) || "你";
    el.sideHeroChips.textContent = format(state.hero.chips);
    const buyIn = state.mode === "online"
      ? (state.game.startingChips || state.online.view && state.online.view.startingChips || state.settings.chips)
      : state.settings.chips;
    const delta = state.hero.chips - buyIn;
    el.sideProfit.textContent = signedFormat(delta);
    el.sideProfit.classList.toggle("is-negative", delta < 0);
    el.sideBlinds.textContent =
      (game.variant === "short" ? "6+ · " : "") + game.smallBlind + " / " + game.bigBlind;
    el.sideLevel.textContent = game.getHandsUntilBlindIncrease() + " 手后";
    const active = game.players.filter((p) => p.chips > 0).length;
    el.sidePlayers.textContent = active + " / " + game.players.length;
    el.sidePot.textContent = format(game.getTotalPot());
    el.levelTrackLabel.textContent = "第 " + (game.blindLevel + 1) + " 级";
    const progress = ((game.handNumber - 1) % game.config.blindEvery) / game.config.blindEvery;
    el.levelBarFill.style.width = Math.max(8, Math.min(100, progress * 100)) + "%";
    updateCoach(game);
  }

  function updateCoach(game) {
    if (game.handResult) {
      const result = game.handResult;
      if (result.type === "showdown") {
        const main = result.pots && result.pots[0];
        el.coachText.textContent =
          "摊牌看五张。公共牌也能成为你的牌，别只盯着底牌。";
      } else {
        el.coachText.textContent = "无人跟注时，底池直接归最后留下的玩家。";
      }
      return;
    }
    const hero = state.hero;
    if (game.currentPlayerId === hero.id) {
      const legal = game.getLegalActions(hero.id);
      if (legal.canCall) {
        const odds = legal.toCall > 0 ? (legal.pot / legal.toCall).toFixed(1) : "∞";
        el.coachText.textContent =
          "跟注 " +
          format(legal.callAmount) +
          " 争夺 " +
          format(legal.pot) +
          " 的底池，底池赔率约 " +
          odds +
          " : 1。";
      } else {
        el.coachText.textContent = "轮到你行动。过牌不花钱，但会让对手看到你的谨慎。";
      }
    } else if (game.phase === "preflop") {
      el.coachText.textContent = "位置比牌力更值钱。晚位可以玩得更宽，早位要更谨慎。";
    } else {
      el.coachText.textContent = "观察下注尺度：强牌通常下注更大，小额下注可能是试探。";
    }
  }

  function renderLog() {
    const game = state.game;
    if (!game) return;
    const entries = game.log.filter((entry) => entry.kind !== "deal").slice(-60);
    if (!entries.length) {
      el.sideLog.innerHTML = '<div class="log-empty">牌局开始后，这里会记录每一次行动。</div>';
      return;
    }
    const nearBottom =
      el.sideLog.scrollTop + el.sideLog.clientHeight >= el.sideLog.scrollHeight - 40;
    el.sideLog.innerHTML = entries
      .map(
        (entry) =>
          '<div class="log-item log-' +
          entry.kind +
          '"><i class="log-marker"></i><span class="log-text">' +
          escapeHtml(entry.text) +
          "</span></div>"
      )
      .join("");
    if (nearBottom) el.sideLog.scrollTop = el.sideLog.scrollHeight;
  }

  function renderDock() {
    const game = state.game;
    if (!game) {
      setDockMode("idle");
      return;
    }
    if (!state.online.actionPending) maybeTurnCue(game);
    if (state.mode === "online" && state.online.actionPending) {
      setDockMode("waiting");
      if (el.waitingAvatar) el.waitingAvatar.textContent = "你";
      el.waitingText.textContent = "已提交，正在同步行动…";
      const dots = el.dockWaiting.querySelector(".thinking-dots");
      if (dots) dots.style.visibility = "visible";
      return;
    }
    if (game.handResult) {
      showResult(false);
      return;
    }
    if (game.currentPlayer && game.currentPlayer.isYou && !game.streetComplete) {
      setDockMode("play");
      updateControls();
      return;
    }
    setDockMode("waiting");
    renderWaiting();
    updateTurnClock();
  }

  function renderWaiting() {
    const game = state.game;
    let avatar = "♠";
    let text = "等待发牌…";
    let thinking = false;
    if (game.streetComplete) {
      text = game.phase === "preflop" ? "正在发出翻牌…" : "正在发下一张公共牌…";
    } else if (game.currentPlayer) {
      const current = game.currentPlayer;
      const you = Boolean(current.isYou || (state.hero && current.id === state.hero.id));
      avatar = you ? "你" : current.avatar || "♠";
      text = you
        ? "轮到你行动"
        : current.isHuman
          ? current.name + (current.connected === false ? " 掉线，等待重连…" : " 正在行动…")
          : current.name + " 正在思考…";
      thinking = !current.isHuman;
    } else if (game.phase === "showdown") {
      text = "正在摊牌…";
    }
    el.waitingAvatar.textContent = avatar;
    el.waitingText.textContent = text;
    const dots = el.dockWaiting.querySelector(".thinking-dots");
    if (dots) dots.style.visibility = thinking ? "visible" : "hidden";
  }

  function updateControls() {
    const game = state.game;
    const hero = state.hero;
    if (!game || !hero) return;
    const legal = game.getLegalActions(hero.id);
    const key =
      game.handNumber +
      ":" +
      game.phase +
      ":" +
      game.currentPlayerId +
      ":" +
      game.currentBet +
      ":" +
      (state.mode === "solo" ? game.version : "online");
    if (state.controlKey !== key) {
      state.controlKey = key;
      state.raiseTarget = defaultRaiseTarget(legal);
    }
    state.sliderMin = Math.max(1, legal.minRaiseTo);
    state.sliderMax = Math.max(state.sliderMin, legal.maxRaiseTo);
    state.raiseTarget = clamp(
      Math.round(state.raiseTarget || state.sliderMin),
      state.sliderMin,
      state.sliderMax
    );

    el.turnStatus.classList.add("is-yours");
    el.turnStatus.classList.remove("is-result");
    el.turnStatus.querySelector("span").textContent = "轮到你行动";

    renderHeroReadout();
    el.oddsReadout.innerHTML = legal.canCall
      ? "底池 <b>" + format(legal.pot) + "</b> · 跟注 <b>" + format(legal.callAmount) + "</b>"
      : "过牌免费 · 底池 <b>" + format(legal.pot) + "</b>";

    el.foldBtn.disabled = !legal.canFold;
    el.callBtn.disabled = !(legal.canCall || legal.canCheck);
    el.raiseBtn.disabled = !legal.canRaise;
    el.callBtnText.textContent = legal.callLabel;

    const showRaise = legal.canRaise;
    el.raisePanel.hidden = !showRaise;
    if (showRaise) {
      el.raiseRange.min = String(state.sliderMin);
      el.raiseRange.max = String(state.sliderMax);
      el.raiseRange.step = "1";
      el.raiseRange.value = String(state.raiseTarget);
      updateRaiseUi();
    }
    if (!legal.canCall && !legal.canCheck) {
      el.callBtnText.textContent = "等待";
    }
    updateTurnClock();
  }

  function defaultRaiseTarget(legal) {
    const game = state.game;
    const pot = legal.pot || 0;
    let desired;
    if (legal.currentBet > 0) {
      desired = legal.currentBet + Math.max(legal.lastFullRaise, pot * 0.62);
    } else {
      desired = Math.max(game.bigBlind, pot * 0.62);
    }
    const unit = Math.max(1, Math.round(game.bigBlind / 2));
    desired = Math.round(desired / unit) * unit;
    return clamp(desired, legal.minRaiseTo, legal.maxRaiseTo);
  }

  function updateRaiseUi() {
    const legal = state.game && state.hero ? state.game.getLegalActions(state.hero.id) : null;
    if (!legal) return;
    const target = state.raiseTarget;
    el.raiseValueLabel.textContent = format(target);
    el.raiseRange.value = String(target);
    const pct =
      state.sliderMax > state.sliderMin
        ? ((target - state.sliderMin) / (state.sliderMax - state.sliderMin)) * 100
        : 100;
    el.raiseRange.style.setProperty("--range-progress", pct + "%");
    el.rangeMinLabel.textContent = format(state.sliderMin);
    el.rangeMaxLabel.textContent = format(state.sliderMax);
    el.raiseCaption.textContent = legal.currentBet > 0 ? "加注到" : "下注";
    const isAllIn = target >= legal.maxRaiseTo;
    el.raiseBtnText.textContent = isAllIn ? "全下" : legal.currentBet > 0 ? "加注到" : "下注";
    el.raiseBtnAmount.textContent = format(target);
    const half = clamp(
      Math.round((legal.currentBet + (legal.pot + legal.toCall) * 0.5) / 10) * 10,
      state.sliderMin,
      state.sliderMax
    );
    const full = clamp(
      Math.round((legal.currentBet + legal.pot + legal.toCall) / 10) * 10,
      state.sliderMin,
      state.sliderMax
    );
    const halfBtn = el.raisePanel.querySelector('[data-preset="half"]');
    const potBtn = el.raisePanel.querySelector('[data-preset="pot"]');
    if (halfBtn) halfBtn.dataset.amount = String(half);
    if (potBtn) potBtn.dataset.amount = String(full);
  }

  function renderHeroReadout() {
    const hero = state.hero;
    if (!hero) return;
    const hole = hero.hole || [];
    el.heroMiniCards.innerHTML = hole.length
      ? hole.map((card) => cardMarkup(card)).join("")
      : '<span class="card-slot" style="--card-w:25px;--card-h:35px"></span><span class="card-slot" style="--card-w:25px;--card-h:35px"></span>';
    el.heroHandHint.textContent = hole.length
      ? HE.describeHoleCards(
          hole,
          state.game ? state.game.community : [],
          state.game ? state.game.variant : "holdem"
        )
      : "等待发牌";
  }

  /* ---------------------------------------------------------- results */

  function showResult(force) {
    const game = state.game;
    if (!game || !game.handResult) {
      setDockMode("waiting");
      return;
    }
    setDockMode("result");
    el.streetBanner.classList.remove("is-visible");
    const result = game.handResult;
    const hero = state.hero;
    const winners = result.winners || [];
    const humanWin = winners.find((winner) => winner.id === hero.id) || null;
    const total = result.totalPot || game.pot;
    const isShowdown = result.type === "showdown";
    const online = state.mode === "online";
    const roomDone = online && state.online.status === "done";
    const humanEliminated = Boolean(result.humanEliminated || (hero && hero.chips <= 0));
    const gameOver = Boolean(result.gameOver || game.gameOver || roomDone);
    if (!online && (gameOver || humanEliminated)) recordSoloResult(game);

    el.resultEyebrow.textContent = isShowdown ? "SHOWDOWN · 摊牌" : "HAND COMPLETE · 本手结束";
    if (humanWin) {
      el.resultCrown.textContent = "♛";
      el.resultTitle.textContent =
        winners.length > 1 && result.pots && result.pots.length === 1
          ? "你分得 " + format(humanWin.amount)
          : "你赢得 " + format(humanWin.amount);
    } else if (winners.length === 1) {
      el.resultCrown.textContent = "♠";
      el.resultTitle.textContent = winners[0].name + " 赢得 " + format(winners[0].amount);
    } else if (winners.length > 1) {
      el.resultCrown.textContent = "♠";
      el.resultTitle.textContent = winners.map((winner) => winner.name).join(" / ") + " 分享底池";
    } else {
      el.resultCrown.textContent = "♠";
      el.resultTitle.textContent = "本手结束";
    }

    const details = [];
    if (isShowdown) {
      if (winners.length === 1 && winners[0].handName) {
        details.push(winners[0].handName + " · 底池 " + format(total));
      } else {
        details.push("底池 " + format(total));
        details.push(
          winners
            .map((winner) => winner.name + (winner.handName ? " " + winner.handName : "") + " +" + format(winner.amount))
            .join(" / ")
        );
      }
      if (result.pots && result.pots.length > 1) details.push("含 " + result.pots.length + " 个底池（边池）");
      if (!humanWin && hero && hero.bestHand) details.push("你的牌型：" + hero.bestHand.name);
      if (humanWin && winners.length === 1) details.push("筹码已收入你的记分牌");
    } else {
      details.push((winners[0] ? winners[0].name : "赢家") + " 收下底池 · " + (result.reason || "其余玩家弃牌"));
      if (hero && hero.folded) details.push("你已弃牌");
    }
    if (humanEliminated) details.push("你已被淘汰");
    if (gameOver) {
      const champion = game.champion;
      details.push(champion ? "🏆 " + champion.name + " 成为最后赢家" : "牌局结束");
    }
    el.resultDetail.textContent = details.filter(Boolean).join(" · ");

    const canContinue = !online && !humanEliminated && !gameOver && hero && hero.chips > 0;
    if (online) {
      el.nextHandBtn.hidden = true;
      el.resultRestartBtn.hidden = false;
      el.resultRestartBtn.textContent = "离开房间";
      el.nextCountdown.hidden = gameOver || humanEliminated;
      el.nextCountdown.textContent = gameOver ? "" : "下一手自动开始";
    } else {
      el.nextHandBtn.hidden = !canContinue;
      el.resultRestartBtn.hidden = canContinue;
      el.resultRestartBtn.textContent = "重新挑战";
      el.nextCountdown.hidden = !canContinue;
      el.nextCountdown.textContent = canContinue ? "自动下一手" : "";
    }

    if (!force && state.lastResultHand !== game.handNumber) {
      state.lastResultHand = game.handNumber;
      if (state.lastResultSoundHand !== game.handNumber) {
        state.lastResultSoundHand = game.handNumber;
        if (humanWin) {
          sound.win();
          confetti();
        } else {
          sound.lose();
        }
      }
      if (!online && canContinue) {
        state.autoNext = true;
        setTimer(() => {
          state.autoNext = false;
          startNextHand();
        }, 9000 * (state.settings.speed || 1));
      } else {
        state.autoNext = false;
      }
    }
  }

  /* ---------------------------------------------------------- game loop */

  function advanceGame() {
    if (state.mode === "online") return;
    const game = state.game;
    if (!game || state.paused) return;
    if (game.handResult || game.phase === "showdown" || game.phase === "handover" || game.phase === "gameover") {
      state.thinkingPlayerId = null;
      renderAll();
      return;
    }

    if (game.streetComplete) {
      state.thinkingPlayerId = null;
      renderDock();
      renderSeats();
      setTimer(() => {
        if (!state.game || state.paused) return;
        if (!state.game.streetComplete) return;
        const beforePhase = state.game.phase;
        const beforeCount = state.game.community.length;
        state.game.advanceStreet();
        const afterCount = state.game.community.length;
        if (state.game.phase === "showdown") {
          sound.showdown();
        } else if (afterCount > beforeCount) {
          const names = { flop: "翻 牌", turn: "转 牌", river: "河 牌" };
          showStreetBanner(names[state.game.phase] || "");
          sound.street();
        }
        renderAll();
        advanceGame();
      }, 680);
      return;
    }

    const current = game.currentPlayer;
    if (!current) {
      setTimer(() => advanceGame(), 500);
      return;
    }

    if (current.isHuman) {
      state.thinkingPlayerId = null;
      renderAll();
      return;
    }

    const ai = state.ais.get(current.id);
    if (!ai) {
      throw new Error("Missing AI for " + current.id);
    }
    state.thinkingPlayerId = current.id;
    renderSeats();
    renderDock();
    const delay = 500 + Math.random() * 600;
    setTimer(() => {
      if (!state.game || state.paused) return;
      if (state.game.currentPlayerId !== current.id || state.game.handResult) {
        return;
      }
      state.thinkingPlayerId = null;
      let action;
      try {
        action = ai.decide(state.game, current);
        state.game.act(current.id, action.type, action.amount);
      } catch (error) {
        console.error("AI action failed", error, action);
        try {
          const legal = state.game.getLegalActions(current.id);
          if (legal.canCheck) state.game.act(current.id, "check");
          else if (legal.canCall) state.game.act(current.id, "call");
          else state.game.act(current.id, "fold");
        } catch (fallbackError) {
          console.error("AI fallback failed", fallbackError);
        }
      }
      playActionSound({ ...(action || { type: "click" }), allIn: current.allIn });
      renderAll();
      advanceGame();
    }, delay);
  }

  function performHeroAction(type) {
    if (state.mode === "online") {
      performOnlineAction(type);
      return;
    }
    const game = state.game;
    const hero = state.hero;
    if (!game || !hero || state.paused) return;
    if (game.currentPlayerId !== hero.id || game.streetComplete || game.handResult) return;
    let amount;
    if (type === "raise") {
      const legal = game.getLegalActions(hero.id);
      if (!legal.canRaise) return;
      amount = clamp(Math.round(state.raiseTarget), legal.minRaiseTo, legal.maxRaiseTo);
    }
    try {
      const response = game.act(hero.id, type, amount);
      playActionSound({
        type: response.type,
        allIn: hero.allIn,
        fullRaise: true,
        amount: amount || response.amount,
      });
      state.controlKey = "";
      renderAll();
      advanceGame();
    } catch (error) {
      console.error(error);
      sound.error();
      toast(error.message || "无法执行该操作", { gold: false });
      renderAll();
    }
  }

  async function performOnlineAction(type) {
    const game = state.game;
    const hero = state.hero;
    if (!game || !hero || !state.online.token) return;
    if (state.online.actionPending || game.handResult || game.streetComplete) return;
    if (game.currentPlayerId !== hero.id) return;
    const legal = game.getLegalActions(hero.id);
    if (!legal || !legal.canPlay) return;
    let amount = 0;
    if (type === "raise") {
      if (!legal.canRaise) return;
      amount = clamp(Math.round(state.raiseTarget), legal.minRaiseTo, legal.maxRaiseTo);
    } else if (type === "call") {
      if (!legal.canCall) return;
    } else if (type === "check") {
      if (!legal.canCheck) return;
    } else if (type === "fold") {
      if (!legal.canFold) return;
    } else {
      return;
    }
    state.online.actionPending = true;
    renderDock();
    const allInAction =
      type === "raise" &&
      Number.isFinite(Number(amount)) &&
      Number(amount) >= Number(hero.streetBet || 0) + Number(hero.chips || 0);
    const roomCode = state.online.code;
    setTimeout(() => {
      if (state.online.actionPending && state.online.code === roomCode) {
        state.online.actionPending = false;
        renderDock();
      }
    }, 8000);
    try {
      await onlineApi("act", {
        room: state.online.code,
        token: state.online.token,
        type,
        amount,
      });
      playActionSound({
        type,
        allIn: Boolean(hero.allIn || allInAction),
        fullRaise: true,
        amount,
      });
    } catch (error) {
      state.online.actionPending = false;
      sound.error();
      toast(error.message || "操作未成功", { duration: 3200 });
      try {
        const result = await onlineApi("check", { room: state.online.code, token: state.online.token });
        if (result.view) handleOnlineView(result.view);
      } catch (checkError) {
        /* SSE will catch up if possible */
      }
      renderDock();
    }
  }

  /* ---------------------------------------------------------- action events */

  function bindGameEvents() {
    el.foldBtn.addEventListener("click", () => performHeroAction("fold"));
    el.callBtn.addEventListener("click", () => {
      const legal = state.game && state.hero ? state.game.getLegalActions(state.hero.id) : null;
      if (!legal) return;
      performHeroAction(legal.canCheck ? "check" : "call");
    });
    el.raiseBtn.addEventListener("click", () => performHeroAction("raise"));

    el.raiseRange.addEventListener("input", () => {
      state.raiseTarget = Number(el.raiseRange.value);
      updateRaiseUi();
    });

    el.raiseRange.addEventListener("change", () => songClick());

    el.raisePanel.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-preset]");
      if (!button) return;
      sound.click();
      const preset = button.dataset.preset;
      if (preset === "min") state.raiseTarget = state.sliderMin;
      else if (preset === "allin") state.raiseTarget = state.sliderMax;
      else if (preset === "half") state.raiseTarget = Number(button.dataset.amount) || state.sliderMin;
      else if (preset === "pot") state.raiseTarget = Number(button.dataset.amount) || state.sliderMin;
      state.raiseTarget = clamp(Math.round(state.raiseTarget), state.sliderMin, state.sliderMax);
      updateRaiseUi();
    });

    el.nextHandBtn.addEventListener("click", () => {
      clearTimer();
      sound.click();
      startNextHand();
    });

    el.resultRestartBtn.addEventListener("click", () => {
      sound.click();
      if (state.mode === "online") confirmLeaveOnline();
      else showSetup();
    });

    document.addEventListener("click", (event) => {
      const scope = event.target.closest("[data-records-scope]");
      if (scope && scope.closest("#modalRoot")) {
        loadHistoryScope(scope.dataset.recordsScope);
        return;
      }
      const tab = event.target.closest("[data-records-tab]");
      if (!tab || !tab.closest("#modalRoot") || tab.disabled) return;
      loadRecordsTab(tab.dataset.recordsTab);
    });

    el.speedBtn.addEventListener("click", () => {
      const index = SPEEDS.indexOf(state.settings.speed);
      state.settings.speed = SPEEDS[(index + 1) % SPEEDS.length];
      el.speedLabel.textContent = state.settings.speed + "×";
      saveSettings(state.settings);
      sound.click();
      toast("电脑思考速度 " + state.settings.speed + "×", { duration: 1400 });
    });

    el.soundBtn.addEventListener("click", () => {
      state.settings.sound = !state.settings.sound;
      saveSettings(state.settings);
      updateSoundButton();
      if (state.settings.sound) {
        sound.unlock();
        sound.click();
        if (state.mode === "online") preloadChatVoices();
      } else {
        stopChatVoice();
      }
    });

    el.rulesBtn.addEventListener("click", () => openRules(true));
    el.logBtn.addEventListener("click", () => openRecords("log", true));
    el.logExpandBtn.addEventListener("click", () => openRecords("log", true));
    el.newGameBtn.addEventListener("click", () => {
      if (state.mode === "online") confirmLeaveOnline();
      else confirmNewGame();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && el.quickChatPanel && !el.quickChatPanel.hidden) {
        event.preventDefault();
        closeQuickChat();
        return;
      }
      if (state.setupOpen || !state.game || state.paused) return;
      if (el.modalRoot.childElementCount) return;
      const tag = (event.target && event.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "f" && !el.foldBtn.disabled) {
        event.preventDefault();
        performHeroAction("fold");
      } else if (key === "c" && !el.callBtn.disabled) {
        event.preventDefault();
        const legal = state.game.getLegalActions(state.hero.id);
        performHeroAction(legal.canCheck ? "check" : "call");
      } else if (key === "r" && !el.raiseBtn.disabled) {
        event.preventDefault();
        performHeroAction("raise");
      }
    });
  }

  function songClick() {
    sound.click();
  }

  /* ---------------------------------------------------------- modals */

  function openModal(options) {
    closeQuickChat();
    const shouldPause = options.pause !== false && state.game && !state.paused;
    if (shouldPause) {
      pauseGame();
      state.modalPausedGame = true;
    } else {
      state.modalPausedGame = false;
    }
    state.modalRestoreFocus = document.activeElement;
    const actions = options.actions || [];
    const actionHtml = actions.length
      ? '<div class="modal-actions">' +
        actions
          .map(
            (action, index) =>
              '<button type="button" class="modal-btn ' +
              (action.className || "") +
              '" data-modal-action="' +
              index +
              '">' +
              escapeHtml(action.label) +
              "</button>"
          )
          .join("") +
        "</div>"
      : "";
    el.modalRoot.innerHTML =
      '<div class="modal-backdrop" data-modal-backdrop>' +
      '<section class="modal-card" role="dialog" aria-modal="true" aria-label="' +
      escapeHtml(options.title) +
      '">' +
      '<header class="modal-head"><div>' +
      (options.eyebrow ? '<span class="eyebrow">' + escapeHtml(options.eyebrow) + "</span>" : "") +
      "<h2>" +
      escapeHtml(options.title) +
      "</h2></div>" +
      '<button type="button" class="modal-close" data-modal-close aria-label="关闭">×</button>' +
      "</header>" +
      '<div class="modal-body">' +
      options.body +
      actionHtml +
      "</div></section></div>";
    state.modalActions = actions;
    document.body.style.overflow = "hidden";
    const closeBtn = el.modalRoot.querySelector("[data-modal-close]");
    if (closeBtn) closeBtn.focus();
    el.modalRoot.querySelector("[data-modal-backdrop]").addEventListener("click", (event) => {
      if (event.target === event.currentTarget) closeModal(true, true);
    });
    el.modalRoot.addEventListener("click", handleModalClick);
    document.addEventListener("keydown", handleModalKeydown);
  }

  function handleModalClick(event) {
    if (event.target.closest("[data-modal-close]")) {
      closeModal(true, true);
      return;
    }
    const actionButton = event.target.closest("[data-modal-action]");
    if (!actionButton) return;
    const index = Number(actionButton.dataset.modalAction);
    const action = state.modalActions && state.modalActions[index];
    if (!action) return;
    if (action.onClick) {
      const shouldClose = action.onClick();
      if (shouldClose === false) return;
    }
    if (action.close !== false) closeModal(true, true);
  }

  function handleModalKeydown(event) {
    if (!el.modalRoot.childElementCount) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeModal(true, true);
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = $$(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      el.modalRoot
    ).filter((node) => !node.disabled);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function closeModal(resume, restoreFocus) {
    if (!el.modalRoot.childElementCount) {
      if (resume) document.body.style.overflow = "";
      return;
    }
    el.modalRoot.removeEventListener("click", handleModalClick);
    document.removeEventListener("keydown", handleModalKeydown);
    el.modalRoot.innerHTML = "";
    document.body.style.overflow = "";
    if (resume && state.modalPausedGame) {
      state.modalPausedGame = false;
      resumeGame();
    } else {
      state.modalPausedGame = false;
    }
    if (restoreFocus && state.modalRestoreFocus && state.modalRestoreFocus.focus) {
      try {
        state.modalRestoreFocus.focus();
      } catch (error) {
        /* ignore */
      }
    }
  }

  function openRules(pause) {
    const short =
      (state.game && state.game.variant === "short") || state.settings.variant === "short";
    const rankings = short
      ? [
          ["皇家同花顺", ["As", "Ks", "Qs", "Js", "Ts"], "最高牌型"],
          ["同花顺", ["Th", "9h", "8h", "7h", "6h"], "同花 + 顺子"],
          ["四条", ["Ah", "Ad", "Ac", "As", "Kd"], "四张同点"],
          ["同花", ["Ah", "Jh", "8h", "7h", "6h"], "五张同花"],
          ["葫芦", ["Kh", "Kd", "Kc", "9s", "9d"], "三条 + 一对"],
          ["顺子", ["Ts", "9d", "8c", "7h", "6s"], "五张连续"],
          ["三条", ["Ah", "Ad", "Ac", "9s", "7d"], "三张同点"],
          ["两对", ["Ah", "Ad", "Kc", "Ks", "7d"], "两组对子"],
          ["一对", ["Ah", "Ad", "Kc", "Qs", "7d"], "一组对子"],
          ["高牌", ["Ah", "Kd", "Qc", "9s", "7d"], "比最大单牌"],
        ]
      : [
          ["皇家同花顺", ["As", "Ks", "Qs", "Js", "Ts"], "最高牌型"],
          ["同花顺", ["9h", "8h", "7h", "6h", "5h"], "同花 + 顺子"],
          ["四条", ["Ah", "Ad", "Ac", "As", "Kd"], "四张同点"],
          ["葫芦", ["Kh", "Kd", "Kc", "9s", "9d"], "三条 + 一对"],
          ["同花", ["Ah", "Jh", "8h", "5h", "2h"], "五张同花"],
          ["顺子", ["9s", "8d", "7c", "6h", "5s"], "五张连续"],
          ["三条", ["Ah", "Ad", "Ac", "5s", "7d"], "三张同点"],
          ["两对", ["Ah", "Ad", "Kc", "Ks", "7d"], "两组对子"],
          ["一对", ["Ah", "Ad", "Kc", "Qs", "7d"], "一组对子"],
          ["高牌", ["Ah", "Kd", "Qc", "9s", "7d"], "比最大单牌"],
        ];
    const rankingHtml = rankings
      .map(
        (row, index) =>
          '<div class="ranking-row"><span class="ranking-index">' +
          String(index + 1).padStart(2, "0") +
          '</span><span class="ranking-name">' +
          row[0] +
          '</span><span class="ranking-cards">' +
          row[1].map((card) => cardMarkup(card)).join("") +
          '</span><span class="ranking-desc">' +
          row[2] +
          "</span></div>"
      )
      .join("");
    openModal({
      eyebrow: "HOW TO PLAY",
      title: "玩法与牌型",
      pause: pause !== false,
      body:
        '<p class="modal-lead">' +
        (short
          ? "短牌 6+（Six-plus Hold'em）。使用 36 张牌，牌型与下注结构接近德州扑克，但同花大于葫芦，A-6-7-8-9 是最小顺子。"
          : "无上限德州扑克（No-Limit Texas Hold'em）。每位玩家发两张底牌，桌面上依次发出五张公共牌，用任意七张牌中最好的五张组成最终牌型。下注没有上限，你可以随时全下。") +
        '</p>' +
        '<div class="rules-section"><h3>一手牌的流程</h3><ul>' +
        "<li>按钮位左侧两位玩家分别下小盲和大盲，随后每人发两张底牌。</li>" +
        "<li>翻牌前下注 → 发出三张公共牌（翻牌）→ 下注 → 转牌 → 下注 → 河牌 → 最后下注 → 摊牌。</li>" +
        "<li>每轮从按钮左侧开始行动；翻牌前从大盲左侧开始。你可以过牌、跟注、下注/加注或弃牌。</li>" +
        "<li>如果只剩一名玩家没有弃牌，他直接赢得底池，无需摊牌。</li>" +
        "<li>全下时如果筹码不等，会按投入金额拆成主池和边池，各池分别结算。</li>" +
        "</ul></div>" +
        '<div class="rules-section"><h3>牌型大小</h3><div class="ranking-list">' +
        rankingHtml +
        "</div></div>" +
        (short
          ? '<div class="rules-section"><h3>短牌 6+ 规则</h3><p>使用 36 张牌，去掉 2、3、4、5。牌型顺序为：同花大于葫芦，其余与标准德州一致；A 可以组成 A-6-7-8-9 的最小顺子，也可以组成 A-K-Q-J-10 的最大顺子。本桌保留盲注结构，盲注 25 / 50，每 8 手提升一次。</p></div>'
          : '<div class="rules-section"><h3>本桌规则</h3><p>最多 6 人桌淘汰赛。起始筹码按入座设置，盲注 25 / 50，每 8 手提升一次盲注。筹码归零即被淘汰，最后留在桌上的玩家获胜。电脑玩家只会看到自己的底牌和公共牌，不会作弊。</p></div>') +
        '<div class="rules-section"><h3>快捷键</h3><div class="shortcut-grid">' +
        '<span class="shortcut"><kbd>F</kbd>弃牌</span>' +
        '<span class="shortcut"><kbd>C</kbd>过牌 / 跟注</span>' +
        '<span class="shortcut"><kbd>R</kbd>按当前金额加注</span>' +
        '<span class="shortcut"><kbd>Esc</kbd>关闭弹窗</span>' +
        "</div></div>",
    });
  }

  function currentPlayerName() {
    if (state.mode === "online" && state.hero && state.hero.name) return state.hero.name;
    const fromInput = el.playerNameInput ? el.playerNameInput.value.trim() : "";
    return fromInput || state.settings.name || "你";
  }

  function fullLogHtml() {
    const game = state.game;
    if (!game || !game.log || !game.log.length) {
      return '<div class="records-empty">还没有行动记录。开始一手牌后，这里会显示完整过程。</div>';
    }
    const entries = game.log.filter((entry) => entry.kind !== "deal");
    let currentHand = null;
    let html = '<div class="full-log">';
    for (const entry of entries) {
      if (entry.hand !== currentHand) {
        currentHand = entry.hand;
        html += '<div class="log-hand-separator">HAND #' + String(currentHand).padStart(3, "0") + "</div>";
      }
      html +=
        '<div class="log-item log-' +
        entry.kind +
        '"><i class="log-marker"></i><span class="log-text">' +
        escapeHtml(entry.text) +
        "</span></div>";
    }
    html += "</div>";
    return html;
  }

  function recordsTabsHtml(active) {
    const logDisabled = !state.game || !state.game.log || !state.game.log.length;
    return (
      '<div class="records-tabs" id="recordsTabs">' +
      '<button type="button" data-records-tab="log"' +
      (active === "log" ? ' class="is-active"' : "") +
      (logDisabled ? " disabled" : "") +
      ">本局牌谱</button>" +
      '<button type="button" data-records-tab="board"' +
      (active === "board" ? ' class="is-active"' : "") +
      ">排行榜</button>" +
      '<button type="button" data-records-tab="history"' +
      (active === "history" ? ' class="is-active"' : "") +
      ">我的战绩</button>" +
      "</div>" +
      '<div class="records-body" id="recordsBody"><div class="records-loading">读取中…</div></div>'
    );
  }

  async function recordsFetch(path) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(path, { cache: "no-store", signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(data.error || "读取失败。");
        error.status = response.status;
        throw error;
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  function recordsTableHtml(rows, kind) {
    if (!rows.length) {
      return '<div class="records-empty">' +
        (kind === "board"
          ? "还没有已结束的联机牌局。和朋友打一局，成绩会记录在这里。"
          : kind === "solo"
            ? "这个昵称还没有完成的单机牌局。"
            : "这个昵称还没有已结束的联机牌局。") +
        "</div>";
    }
    const me = currentPlayerName().toLocaleLowerCase();
    if (kind === "solo") {
      return (
        '<div class="records-table-wrap"><table class="records-table">' +
        "<thead><tr><th>时间</th><th>规则</th><th>名次</th><th class=hide-mobile>手数</th><th>最终筹码</th><th>输赢</th></tr></thead><tbody>" +
        rows.map((row) => {
          const netClass = row.net > 0 ? "net-pos" : row.net < 0 ? "net-neg" : "";
          const date = new Date(row.endedAt);
          const stamp =
            String(date.getMonth() + 1).padStart(2, "0") + "/" +
            String(date.getDate()).padStart(2, "0") + " " +
            String(date.getHours()).padStart(2, "0") + ":" +
            String(date.getMinutes()).padStart(2, "0");
          return (
            "<tr>" +
            "<td>" + stamp + "</td>" +
            "<td>" + (row.variant === "short" ? "短牌 6+" : "标准") + "</td>" +
            "<td>" + (row.place || "—") + "</td>" +
            '<td class="hide-mobile">' + (row.hands || 0) + "</td>" +
            "<td>" + format(row.finalChips) + "</td>" +
            '<td class="' + netClass + '">' + signedFormat(row.net) + "</td>" +
            "</tr>"
          );
        }).join("") +
        "</tbody></table></div>" +
        '<p class="records-note">单机战绩仅保存在当前浏览器 · 不计入全球排行榜</p>'
      );
    }
    if (kind === "board") {
      return (
        '<div class="records-table-wrap"><table class="records-table">' +
        "<thead><tr><th>排名</th><th>玩家</th><th>局数</th><th class=hide-mobile>手数</th><th>胜场</th><th>总积分</th></tr></thead><tbody>" +
        rows.map((row, index) => {
          const netClass = row.net > 0 ? "net-pos" : row.net < 0 ? "net-neg" : "";
          return (
            '<tr class="' + (row.name.toLocaleLowerCase() === me ? "is-me" : "") + '">' +
            '<td><span class="rank ' + (index < 3 ? "top" : "") + '">' + (index + 1) + "</span></td>" +
            '<td class="name-cell">' + escapeHtml(row.name) + "</td>" +
            "<td>" + row.sessions + "</td>" +
            '<td class="hide-mobile">' + row.hands + "</td>" +
            "<td>" + row.wins + "</td>" +
            '<td class="' + netClass + '">' + signedFormat(row.net) + "</td>" +
            "</tr>"
          );
        }).join("") +
        "</tbody></table></div>" +
        '<p class="records-note">仅统计已结束的联机牌局 · 按总积分排序</p>'
      );
    }
    return (
      '<div class="records-table-wrap"><table class="records-table">' +
      "<thead><tr><th>时间</th><th>房间</th><th>名次</th><th class=hide-mobile>手数</th><th>最终筹码</th><th>输赢</th></tr></thead><tbody>" +
      rows.map((row) => {
        const netClass = row.net > 0 ? "net-pos" : row.net < 0 ? "net-neg" : "";
        const date = new Date(row.endedAt);
        const stamp =
          String(date.getMonth() + 1).padStart(2, "0") + "/" +
          String(date.getDate()).padStart(2, "0") + " " +
          String(date.getHours()).padStart(2, "0") + ":" +
          String(date.getMinutes()).padStart(2, "0");
        return (
          "<tr>" +
          "<td>" + stamp + "</td>" +
          "<td>" + escapeHtml(row.room || "—") + "</td>" +
          "<td>" + (row.place || "—") + "</td>" +
          '<td class="hide-mobile">' + (row.hands || 0) + "</td>" +
          "<td>" + format(row.finalChips) + "</td>" +
          '<td class="' + netClass + '">' + signedFormat(row.net) + "</td>" +
          "</tr>"
        );
      }).join("") +
      "</tbody></table></div>" +
      '<p class="records-note">仅统计你参与并已结束的联机牌局</p>'
    );
  }

  function recordsSummaryHtml(summary) {
    const netClass = summary.net > 0 ? "is-pos" : summary.net < 0 ? "is-neg" : "";
    return (
      '<div class="records-summary">' +
      "<div><span>局数</span><b>" + (summary.sessions || 0) + "</b></div>" +
      "<div><span>手数</span><b>" + (summary.hands || 0) + "</b></div>" +
      "<div><span>胜场</span><b>" + (summary.wins || 0) + "</b></div>" +
      '<div><span>总积分</span><b class="' + netClass + '">' + signedFormat(summary.net || 0) + "</b></div>" +
      "</div>"
    );
  }

  function historyScopeTabsHtml(scope) {
    return (
      '<div class="records-scope">' +
      '<button type="button" data-records-scope="online" class="' +
      (scope === "online" ? "is-active" : "") +
      '">联机战绩</button>' +
      '<button type="button" data-records-scope="solo" class="' +
      (scope === "solo" ? "is-active" : "") +
      '">单机战绩</button>' +
      "</div>" +
      '<div id="recordsHistoryBody"><div class="records-loading">读取中…</div></div>'
    );
  }

  async function loadHistoryScope(scope) {
    const body = $("#recordsHistoryBody");
    if (!body) return;
    scope = scope === "solo" ? "solo" : "online";
    state.recordsScope = scope;
    $$("[data-records-scope]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.recordsScope === scope);
    });
    const requestId = ++state.recordsRequest;

    if (scope === "solo") {
      const rows = soloHistoryFor(currentPlayerName());
      body.innerHTML =
        recordsSummaryHtml(soloSummaryFor(rows)) +
        recordsTableHtml(rows, "solo");
      return;
    }

    if (!state.onlineAvailable) {
      body.innerHTML =
        '<div class="records-empty">联机战绩需要联机服务器。启动 <b>node server.js</b> 或使用 Render 后即可查看；单机战绩不受影响。</div>';
      return;
    }

    body.innerHTML = '<div class="records-loading">读取中…</div>';
    try {
      const name = currentPlayerName();
      const data = await recordsFetch("/api/history?name=" + encodeURIComponent(name));
      if (requestId !== state.recordsRequest || !$("#recordsHistoryBody")) return;
      const warning = data.storageError
        ? '<div class="records-warning">战绩文件写入失败，当前数据可能不会持久保存：' + escapeHtml(data.storageError) + "</div>"
        : "";
      const summary = data.summary || { sessions: 0, hands: 0, wins: 0, net: 0 };
      body.innerHTML =
        warning +
        recordsSummaryHtml(summary) +
        recordsTableHtml(data.sessions || [], "history") +
        '<p class="records-note">只统计已结束的联机牌局 · 单机战绩请切换到「单机战绩」</p>';
    } catch (error) {
      if (requestId !== state.recordsRequest) return;
      body.innerHTML = '<div class="records-empty">' + escapeHtml(error.message || "读取联机战绩失败。") + "</div>";
    }
  }

  async function loadRecordsTab(tab) {
    const body = $("#recordsBody");
    if (!body) return;
    $$("#recordsTabs button").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.recordsTab === tab);
    });
    if (tab === "log") {
      state.recordsRequest += 1;
      body.innerHTML = fullLogHtml();
      return;
    }
    if (tab === "history") {
      const scope =
        state.recordsScope || (state.mode === "online" ? "online" : "solo");
      body.innerHTML = historyScopeTabsHtml(scope);
      loadHistoryScope(scope);
      return;
    }
    const requestId = ++state.recordsRequest;
    if (!state.onlineAvailable) {
      body.innerHTML = '<div class="records-empty">排行榜需要联机服务器。启动 <b>node server.js</b> 或部署到 Render 后即可使用。</div>';
      return;
    }
    body.innerHTML = '<div class="records-loading">读取中…</div>';
    try {
      const data = await recordsFetch("/api/leaderboard");
      if (requestId !== state.recordsRequest || !$("#recordsBody")) return;
      const warning = data.storageError
        ? '<div class="records-warning">战绩文件写入失败，当前数据可能不会持久保存：' + escapeHtml(data.storageError) + "</div>"
        : "";
      body.innerHTML = warning + recordsTableHtml(data.board || [], "board");
    } catch (error) {
      if (requestId !== state.recordsRequest) return;
      body.innerHTML = '<div class="records-empty">' + escapeHtml(error.message || "读取排行榜失败。") + "</div>";
    }
  }

  function openRecords(tab, pause) {
    const hasGame = Boolean(state.game && state.game.log && state.game.log.length);
    state.recordsScope =
      state.mode === "online" || state.setupMode === "online" ? "online" : "solo";
    const active = tab === "log" && !hasGame ? "board" : (tab || "board");
    openModal({
      eyebrow: "CLUB RECORDS",
      title: "牌局与战绩",
      pause: pause !== false,
      body: recordsTabsHtml(active),
    });
    loadRecordsTab(active);
  }

  function confirmNewGame() {
    if (state.mode === "online") {
      confirmLeaveOnline();
      return;
    }
    openModal({
      eyebrow: "NEW TABLE",
      title: "开始新牌局？",
      pause: true,
      body:
        '<p class="confirm-copy">当前牌局将被放弃，筹码和手牌都会被重置。你可以在新的牌局里重新选择对手数量与难度。</p>',
      actions: [
        { label: "继续当前牌局", className: "", onClick: () => true },
        {
          label: "重新开始",
          className: "primary",
          onClick: () => {
            closeModal(false, false);
            state.setupMode = "solo";
            showSetup();
            return false;
          },
        },
      ],
    });
  }

  /* ---------------------------------------------------------- init */

  async function probeOnlineServer() {
    if (location.protocol === "file:") {
      state.onlineAvailable = false;
    } else {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1800);
      try {
        const response = await fetch("/api/health", { signal: controller.signal, cache: "no-store" });
        state.onlineAvailable = response.ok;
      } catch (error) {
        state.onlineAvailable = false;
      }
      clearTimeout(timer);
    }
    const onlineTab = $("#modeSwitch button[data-setup-mode='online']");
    if (!state.onlineAvailable && onlineTab) {
      onlineTab.classList.add("is-unavailable");
      onlineTab.setAttribute("aria-disabled", "true");
      onlineTab.title = "联机模式需要启动 Node 服务（node server.js）";
    }
    if (!state.onlineAvailable && state.setupMode === "online") {
      setSetupMode("solo", true);
    }
  }

  async function prepareInitialRoute() {
    if (location.protocol === "file:" || !state.onlineAvailable) return;
    const params = new URLSearchParams(location.search);
    const code = (params.get("room") || "").replace(/\D/g, "").slice(0, 4);
    if (code.length !== 4) return;
    setSetupMode("online", true);
    el.joinCodeInput.value = code;
    const saved = loadOnlineSession(code);
    if (!saved) {
      setTimeout(() => {
        if (state.setupOpen) el.joinCodeInput.focus({ preventScroll: true });
      }, 650);
      return;
    }
    try {
      const result = await onlineApi("check", { room: code, token: saved });
      if (result.view) {
        enterOnlineSession(code, saved, result.view);
      }
    } catch (error) {
      clearOnlineSession(code);
      toast("上次的房间已失效，请输入房间号重新加入。", { duration: 3800 });
      setTimeout(() => {
        if (state.setupOpen) el.joinCodeInput.focus({ preventScroll: true });
      }, 650);
    }
  }

  function init() {
    applySettingsToForm();
    bindSetupEvents();
    bindGameEvents();
    updateSoundButton();
    setDockMode("idle");
    renderSetupPreview();
    // Open the setup screen without focusing an invisible element too early.
    setTimeout(() => {
      if (!state.setupOpen) return;
      el.playerNameInput.focus({ preventScroll: true });
    }, 500);
    probeOnlineServer().then(() => prepareInitialRoute());
    setInterval(() => {
      if (state.mode === "online") updateTurnClock();
    }, 500);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && state.mode === "online") pollOnlineState();
    });
  }

  function renderSetupPreview() {
    if (!state.game) {
      el.tableEmpty.hidden = false;
      el.potValue.textContent = "0";
      el.phaseLabel.textContent = "等待开局";
      el.topHandNo.textContent = "—";
      el.topBlinds.textContent = "25 / 50";
      el.topLevel.textContent = "8 手后";
    }
  }

  // Debug / automation hook. It is intentionally read-only for game state.
  window.__NOCTURNE__ = {
    get game() {
      return state.game;
    },
    get settings() {
      return state.settings;
    },
    get state() {
      return state;
    },
    startNewGame: beginGame,
    nextHand: startNextHand,
    cards: C,
    evaluator: HE,
  };

  init();
})();

(function () {
  // ------- Décodage de la liste des solutions (XOR + base64) -------
  // La donnée encodée est décodée à l'intérieur de l'IIFE puis effacée de window.
  // La validation des essais se fait via l'API Wiktionary (voir plus bas).
  function decodeWords(enc) {
    if (!enc) return [];
    const KEY = "weurdeule-secret-key-42";
    const bin = atob(enc);
    let out = "";
    for (let i = 0; i < bin.length; i++) {
      out += String.fromCharCode(bin.charCodeAt(i) ^ KEY.charCodeAt(i % KEY.length));
    }
    return out.split(",");
  }

  const SOLUTIONS = [...new Set(decodeWords(window.__wd_sol).filter(w => w.length === 5))];
  try { delete window.__wd_sol; } catch (_) { window.__wd_sol = undefined; }

  // ------- Validation via l'API Wiktionary -------
  const WIKTI_CACHE_KEY = "weurdeule.validCache";
  const WIKTI_INVALID_KEY = "weurdeule.invalidCache";
  // Cache local pour éviter de re-vérifier les mêmes mots
  const validCache = new Set([...SOLUTIONS, ...loadCache(WIKTI_CACHE_KEY)]);
  const invalidCache = new Set(loadCache(WIKTI_INVALID_KEY));

  function loadCache(key) {
    try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; }
  }
  function saveCache(key, set) {
    localStorage.setItem(key, JSON.stringify([...set]));
  }

  async function isValidWord(word) {
    if (validCache.has(word)) return true;
    if (invalidCache.has(word)) return false;
    try {
      const url = `https://fr.wiktionary.org/w/api.php?action=query&titles=${encodeURIComponent(word)}&format=json&origin=*`;
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timeout);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      const pages = data?.query?.pages || {};
      const exists = Object.values(pages).some(p => !p.missing && p.pageid);
      if (exists) {
        validCache.add(word);
        saveCache(WIKTI_CACHE_KEY, validCache);
      } else {
        invalidCache.add(word);
        saveCache(WIKTI_INVALID_KEY, invalidCache);
      }
      return exists;
    } catch (e) {
      // En cas d'erreur réseau, on est indulgent : le mot est accepté
      console.warn("Validation API indisponible, mot accepté par défaut");
      return true;
    }
  }

  const ROWS = 6;
  const COLS = 5;
  const EPOCH = new Date(2026, 0, 1);
  const STORAGE_KEY = "weurdeule.state";
  const STATS_KEY = "weurdeule.stats";

  const board = document.getElementById("board");
  const keyboardEl = document.getElementById("keyboard");
  const toastEl = document.getElementById("toast");

  let currentRow = 0;
  let currentGuess = "";
  let gameOver = false;
  let won = false;
  const guesses = [];
  const keyStates = {};

  // ------- Mot du jour -------
  function dayIndex() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const epoch = new Date(EPOCH);
    epoch.setHours(0, 0, 0, 0);
    return Math.floor((today - epoch) / 86400000);
  }

  // SOLUTION reste dans la closure de l'IIFE — invisible depuis la console.
  const TODAY_INDEX = dayIndex();
  const SOLUTION = SOLUTIONS[((TODAY_INDEX % SOLUTIONS.length) + SOLUTIONS.length) % SOLUTIONS.length];

  // ------- Construction de la grille -------
  function buildBoard() {
    board.innerHTML = "";
    for (let r = 0; r < ROWS; r++) {
      const row = document.createElement("div");
      row.className = "row";
      row.dataset.row = r;
      for (let c = 0; c < COLS; c++) {
        const cell = document.createElement("div");
        cell.className = "cell";
        cell.dataset.col = c;
        row.appendChild(cell);
      }
      board.appendChild(row);
    }
  }

  // ------- Clavier virtuel (AZERTY) -------
  const KEYBOARD_LAYOUT = [
    ["a","z","e","r","t","y","u","i","o","p"],
    ["q","s","d","f","g","h","j","k","l","m"],
    ["ENTRER","w","x","c","v","b","n","RETOUR"],
  ];

  function buildKeyboard() {
    keyboardEl.innerHTML = "";
    for (const row of KEYBOARD_LAYOUT) {
      const rowEl = document.createElement("div");
      rowEl.className = "keyboard-row";
      for (const k of row) {
        const btn = document.createElement("button");
        btn.className = "key";
        btn.dataset.key = k;
        btn.textContent = k === "RETOUR" ? "⌫" : k.toUpperCase();
        if (k === "ENTRER" || k === "RETOUR") btn.classList.add("wide");
        if (k === "ENTRER") btn.textContent = "ENTRER";
        btn.addEventListener("click", () => handleKey(k));
        rowEl.appendChild(btn);
      }
      keyboardEl.appendChild(rowEl);
    }
  }

  // ------- Gestion des entrées -------
  function handleKey(key) {
    if (gameOver) return;
    const k = key.toUpperCase();
    if (k === "ENTRER") return submitGuess();
    if (k === "RETOUR" || k === "BACKSPACE") return removeLetter();
    if (/^[A-Z]$/.test(k) && currentGuess.length < COLS) addLetter(k.toLowerCase());
  }

  function addLetter(letter) {
    currentGuess += letter;
    const cell = board.children[currentRow].children[currentGuess.length - 1];
    cell.textContent = letter.toUpperCase();
    cell.classList.add("filled");
  }

  function removeLetter() {
    if (currentGuess.length === 0) return;
    currentGuess = currentGuess.slice(0, -1);
    const cell = board.children[currentRow].children[currentGuess.length];
    cell.textContent = "";
    cell.classList.remove("filled");
  }

  function stripAccents(s) {
    return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

  let isValidating = false;
  async function submitGuess() {
    if (isValidating) return;
    if (currentGuess.length !== COLS) {
      shakeRow();
      showToast("Pas assez de lettres");
      return;
    }
    const guess = stripAccents(currentGuess.toLowerCase());

    isValidating = true;
    showToast("Vérification…", 800);
    const ok = await isValidWord(guess);
    isValidating = false;

    if (!ok) {
      shakeRow();
      showToast("Mot inconnu");
      return;
    }
    revealRow(guess);
  }

  function shakeRow() {
    const row = board.children[currentRow];
    row.classList.remove("shake");
    void row.offsetWidth;
    row.classList.add("shake");
  }

  // ------- Révélation des couleurs -------
  function evaluateGuess(guess, solution) {
    const result = Array(COLS).fill("absent");
    const solChars = solution.split("");
    const guessChars = guess.split("");

    for (let i = 0; i < COLS; i++) {
      if (guessChars[i] === solChars[i]) {
        result[i] = "correct";
        solChars[i] = null;
      }
    }
    for (let i = 0; i < COLS; i++) {
      if (result[i] === "correct") continue;
      const idx = solChars.indexOf(guessChars[i]);
      if (idx !== -1) {
        result[i] = "present";
        solChars[idx] = null;
      }
    }
    return result;
  }

  function revealRow(guess) {
    const result = evaluateGuess(guess, SOLUTION);
    const row = board.children[currentRow];

    for (let i = 0; i < COLS; i++) {
      const cell = row.children[i];
      setTimeout(() => {
        cell.classList.add("flip");
        setTimeout(() => {
          cell.classList.add(result[i]);
          updateKeyState(guess[i], result[i]);
        }, 300);
      }, i * 300);
    }

    setTimeout(() => {
      guesses.push({ guess, result });
      const isWin = guess === SOLUTION;
      currentRow++;
      currentGuess = "";

      if (isWin) {
        gameOver = true;
        won = true;
        row.classList.add("bounce");
        setTimeout(() => showToast("Bravo !"), 200);
        setTimeout(() => openModal("stats-modal"), 1800);
        recordResult(true, currentRow);
      } else if (currentRow >= ROWS) {
        gameOver = true;
        won = false;
        showToast(`Le mot était : ${SOLUTION.toUpperCase()}`, 4000);
        setTimeout(() => openModal("stats-modal"), 2200);
        recordResult(false, ROWS);
      }
      saveState();
    }, COLS * 300 + 200);
  }

  function updateKeyState(letter, state) {
    const priority = { correct: 3, present: 2, absent: 1 };
    const current = keyStates[letter];
    if (!current || priority[state] > priority[current]) {
      keyStates[letter] = state;
      const btn = keyboardEl.querySelector(`[data-key="${letter}"]`);
      if (btn) {
        btn.classList.remove("correct", "present", "absent");
        btn.classList.add(state);
      }
    }
  }

  // ------- Toast -------
  let toastTimer = null;
  function showToast(msg, duration = 1800) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), duration);
  }

  // ------- Persistance -------
  // Note : on ne sauvegarde PAS la solution. On stocke seulement les essais et leurs
  // résultats colorés. Comme ça, l'état dans localStorage ne révèle pas le mot.
  function saveState() {
    const state = { dayIndex: TODAY_INDEX, guesses, gameOver, won };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function loadState() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const state = JSON.parse(raw);
      if (state.dayIndex !== TODAY_INDEX) {
        localStorage.removeItem(STORAGE_KEY);
        return;
      }
      for (const g of state.guesses) {
        const row = board.children[currentRow];
        for (let i = 0; i < COLS; i++) {
          const cell = row.children[i];
          cell.textContent = g.guess[i].toUpperCase();
          cell.classList.add("filled", g.result[i]);
          updateKeyState(g.guess[i], g.result[i]);
        }
        guesses.push(g);
        currentRow++;
      }
      gameOver = state.gameOver;
      won = state.won;
      if (gameOver && !won) {
        setTimeout(() => showToast(`Le mot était : ${SOLUTION.toUpperCase()}`, 4000), 300);
      }
    } catch (e) {
      console.warn("Impossible de charger l'état");
    }
  }

  // ------- Statistiques -------
  function defaultStats() {
    return { played: 0, wins: 0, currentStreak: 0, maxStreak: 0, distribution: [0,0,0,0,0,0], lastWonDay: -2, lastDayRecorded: -1 };
  }

  function loadStats() {
    try {
      return Object.assign(defaultStats(), JSON.parse(localStorage.getItem(STATS_KEY)) || {});
    } catch {
      return defaultStats();
    }
  }

  function saveStats(s) {
    localStorage.setItem(STATS_KEY, JSON.stringify(s));
  }

  function recordResult(isWin, attempts) {
    const stats = loadStats();
    if (stats.lastDayRecorded === TODAY_INDEX) return;
    stats.lastDayRecorded = TODAY_INDEX;
    stats.played++;
    if (isWin) {
      stats.wins++;
      stats.distribution[attempts - 1]++;
      stats.currentStreak = stats.lastWonDay === TODAY_INDEX - 1 ? stats.currentStreak + 1 : 1;
      stats.maxStreak = Math.max(stats.maxStreak, stats.currentStreak);
      stats.lastWonDay = TODAY_INDEX;
    } else {
      stats.currentStreak = 0;
    }
    saveStats(stats);
  }

  function renderStats() {
    const stats = loadStats();
    document.getElementById("stat-played").textContent = stats.played;
    const winrate = stats.played ? Math.round((stats.wins / stats.played) * 100) : 0;
    document.getElementById("stat-winrate").textContent = winrate;
    document.getElementById("stat-streak").textContent = stats.currentStreak;
    document.getElementById("stat-maxstreak").textContent = stats.maxStreak;

    const distEl = document.getElementById("distribution");
    distEl.innerHTML = "";
    const max = Math.max(1, ...stats.distribution);
    for (let i = 0; i < 6; i++) {
      const count = stats.distribution[i];
      const pct = (count / max) * 100;
      const isWinningRow = won && guesses.length === i + 1;
      const row = document.createElement("div");
      row.className = "dist-row";
      row.innerHTML = `<div class="dist-num">${i + 1}</div>
        <div class="dist-bar">
          <div class="dist-fill ${isWinningRow ? "win" : ""}" style="width:${Math.max(pct, 8)}%">${count}</div>
        </div>`;
      distEl.appendChild(row);
    }
  }

  // ------- Compte à rebours minuit -------
  function updateCountdown() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setHours(24, 0, 0, 0);
    const diff = tomorrow - now;
    const h = String(Math.floor(diff / 3600000)).padStart(2, "0");
    const m = String(Math.floor((diff % 3600000) / 60000)).padStart(2, "0");
    const s = String(Math.floor((diff % 60000) / 1000)).padStart(2, "0");
    const el = document.getElementById("countdown");
    if (el) el.textContent = `${h}:${m}:${s}`;
  }

  // ------- Partage -------
  function buildShareText() {
    const emojiMap = { correct: "🟩", present: "🟨", absent: "⬛" };
    const lines = guesses.map(g => g.result.map(r => emojiMap[r]).join(""));
    const score = won ? guesses.length : "X";
    const num = (TODAY_INDEX + 1).toLocaleString("fr-FR");
    return `Weurdeule ${num} ${score}/${ROWS}\n\n${lines.join("\n")}`;
  }

  function share() {
    const text = buildShareText();
    if (navigator.share) {
      navigator.share({ text }).catch(() => copyToClipboard(text));
    } else {
      copyToClipboard(text);
    }
  }

  function copyToClipboard(text) {
    navigator.clipboard?.writeText(text).then(
      () => showToast("Résultat copié !"),
      () => showToast("Copie impossible")
    );
  }

  // ------- Modales -------
  function openModal(id) {
    document.getElementById(id).classList.remove("hidden");
    if (id === "stats-modal") renderStats();
  }

  function closeModals() {
    document.querySelectorAll(".modal").forEach(m => m.classList.add("hidden"));
  }

  // ------- Initialisation -------
  function init() {
    buildBoard();
    buildKeyboard();
    loadState();

    document.addEventListener("keydown", (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Enter") return handleKey("ENTRER");
      if (e.key === "Backspace") return handleKey("RETOUR");
      if (/^[a-zA-Z]$/.test(e.key)) handleKey(e.key);
    });

    document.getElementById("help-btn").addEventListener("click", () => openModal("help-modal"));
    document.getElementById("stats-btn").addEventListener("click", () => openModal("stats-modal"));
    document.getElementById("share-btn").addEventListener("click", share);
    document.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", closeModals));
    document.querySelectorAll(".modal").forEach(m => {
      m.addEventListener("click", (e) => { if (e.target === m) closeModals(); });
    });

    updateCountdown();
    setInterval(updateCountdown, 1000);

    if (!localStorage.getItem("weurdeule.seenHelp")) {
      openModal("help-modal");
      localStorage.setItem("weurdeule.seenHelp", "1");
    }
  }

  init();
})();

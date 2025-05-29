// Import Firebase (adapter selon ta config)
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";
import { getDatabase, ref, set, get, onValue, update, child, remove } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-analytics.js";

// --- CONFIGURATION FIREBASE ---
const firebaseConfig = {
  apiKey: "AIzaSyA-e19z8T3c1K46YmJY8s9EAbO9BRes7fA",
  authDomain: "mini-duel-de-cartes.firebaseapp.com",
  databaseURL: "https://mini-duel-de-cartes-default-rtdb.firebaseio.com",
  projectId: "mini-duel-de-cartes",
  storageBucket: "mini-duel-de-cartes.firebasestorage.app",
  messagingSenderId: "1084207708579",
  appId: "1:1084207708579:web:f1312b68b7eb08f9d44216",
  measurementId: "G-7YW3J41XZF"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const db = getDatabase(app);

// --- VARIABLES GLOBALES ---
let currentUser = null;
let currentMatch = null;
let hasPlayedThisTurn = false;
let timerInterval = null;
let timerMax = 30;
let timerCount = timerMax;

// --- FONCTIONS UTILITAIRES ---
function showMessage(id, message, success = false) {
  const el = document.getElementById(id);
  el.style.color = success ? "#00ff88" : "#ff4d6d";
  el.textContent = message;
}

function disableActionButtons(disabled) {
  document.getElementById("attack-btn").disabled = disabled;
  document.getElementById("defend-btn").disabled = disabled;
  document.getElementById("heal-btn").disabled = disabled;
}

// --- AUTHENTIFICATION ---
document.getElementById("signup-btn").onclick = () => {
  const pseudo = document.getElementById("pseudo").value.trim();
  const code = document.getElementById("code").value.trim();

  if (pseudo.length < 2) {
    showMessage("auth-msg", "Pseudo trop court");
    return;
  }
  if (!/^\d{4}$/.test(code)) {
    showMessage("auth-msg", "Code doit faire 4 chiffres");
    return;
  }

  const userRef = ref(db, `users/${pseudo}`);
  get(userRef).then(snapshot => {
    if (snapshot.exists()) {
      showMessage("auth-msg", "Pseudo déjà pris");
    } else {
      set(userRef, { code, wins: 0, losses: 0 })
        .then(() => {
          showMessage("auth-msg", "Inscription réussie", true);
          currentUser = { pseudo, code };
          afterLogin();
        });
    }
  });
};

document.getElementById("login-btn").onclick = () => {
  const pseudo = document.getElementById("pseudo").value.trim();
  const code = document.getElementById("code").value.trim();

  const userRef = ref(db, `users/${pseudo}`);
  get(userRef).then(snapshot => {
    if (!snapshot.exists()) {
      showMessage("auth-msg", "Pseudo inconnu");
    } else {
      const data = snapshot.val();
      if (data.code === code) {
        showMessage("auth-msg", "Connexion réussie", true);
        currentUser = { pseudo, code };
        afterLogin();
      } else {
        showMessage("auth-msg", "Code incorrect");
      }
    }
  });
};

function afterLogin() {
  document.getElementById("auth").style.display = "none";
  document.getElementById("match").style.display = "block";
  document.getElementById("player-name").textContent = currentUser.pseudo;
  showMessage("auth-msg", "");
}

// --- MATCH ---
document.getElementById("create-match-btn").onclick = () => {
  const matchId = document.getElementById("match-id").value.trim();
  if (!matchId) {
    showMessage("match-msg", "Indique un code de match");
    return;
  }

  const matchRef = ref(db, `matches/${matchId}`);
  get(matchRef).then(snapshot => {
    if (snapshot.exists()) {
      showMessage("match-msg", "Match déjà existant");
    } else {
      set(matchRef, {
        players: {
          p1: { pseudo: currentUser.pseudo, pv: 100, defending: false },
          p2: null
        },
        turn: "p1",
        actions: {},
        history: []
      }).then(() => {
        showMessage("match-msg", "Match créé, en attente adversaire...", true);
        startMatch(matchId, true);
      });
    }
  });
};

document.getElementById("join-match-btn").onclick = () => {
  const matchId = document.getElementById("match-id").value.trim();
  if (!matchId) {
    showMessage("match-msg", "Indique un code de match");
    return;
  }

  const matchRef = ref(db, `matches/${matchId}`);
  get(matchRef).then(snapshot => {
    if (!snapshot.exists()) {
      showMessage("match-msg", "Match inexistant");
      return;
    }

    const match = snapshot.val();
    if (match.players.p2) {
      showMessage("match-msg", "Match complet");
      return;
    }

    update(child(matchRef, "players"), {
      p2: { pseudo: currentUser.pseudo, pv: 100, defending: false }
    }).then(() => {
      showMessage("match-msg", "Rejoint le match !", true);
      startMatch(matchId, false);
    });
  });
};

// --- DÉBUT DU MATCH ---
function startMatch(id, isCreator) {
  currentMatch = id;
  const matchRef = ref(db, `matches/${id}`);

  document.getElementById("match").style.display = "none";
  document.getElementById("game").style.display = "block";
  document.getElementById("current-match").textContent = id;
  document.getElementById("you-name").textContent = currentUser.pseudo;
  document.getElementById("history").innerHTML = "";

  hasPlayedThisTurn = false;
  disableActionButtons(false);
  document.getElementById("action-msg").textContent = "";

  startTimer();

  onValue(matchRef, (snapshot) => {
    const data = snapshot.val();
    if (!data) return;

    const p1 = data.players.p1;
    const p2 = data.players.p2;

    if (!p1 || !p2) {
      document.getElementById("action-msg").textContent = "En attente de l'adversaire...";
      return;
    }

    let you, opponent, youKey, opponentKey;
    if (p1.pseudo === currentUser.pseudo) {
      you = p1; youKey = "p1";
      opponent = p2; opponentKey = "p2";
    } else if (p2.pseudo === currentUser.pseudo) {
      you = p2; youKey = "p2";
      opponent = p1; opponentKey = "p1";
    } else {
      document.getElementById("action-msg").textContent = "Tu n'es pas dans ce match.";
      disableActionButtons(true);
      return;
    }

    document.getElementById("you-pv").textContent = you.pv;
    document.getElementById("opponent-name").textContent = opponent.pseudo;
    document.getElementById("opponent-pv").textContent = opponent.pv;

    if (data.turn !== youKey) {
      disableActionButtons(true);
      document.getElementById("action-msg").textContent = "Tour de l'adversaire, patience...";
      clearInterval(timerInterval);
      timerInterval = null;
    } else {
      if (hasPlayedThisTurn) {
        disableActionButtons(true);
        document.getElementById("action-msg").textContent = "Action jouée, en attente du tour suivant...";
      } else {
        hasPlayedThisTurn = false;
        disableActionButtons(false);
        document.getElementById("action-msg").textContent = "C'est ton tour, choisis une action.";
        resetTimer();
      }
    }

    const histEl = document.getElementById("history");
    histEl.innerHTML = "";
    (data.history || []).forEach(entry => {
      const p = document.createElement("p");
      p.textContent = entry;
      histEl.appendChild(p);
    });

    if (you.pv <= 0 || opponent.pv <= 0) {
      disableActionButtons(true);
      clearInterval(timerInterval);
      if (you.pv <= 0 && opponent.pv <= 0) {
        document.getElementById("action-msg").textContent = "Match nul !";
      } else if (you.pv <= 0) {
        document.getElementById("action-msg").textContent = "Tu as perdu...";
      } else {
        document.getElementById("action-msg").textContent = "Tu as gagné !";
      }
    }
  });
}

// --- ACTIONS ---
document.getElementById("attack-btn").onclick = () => doAction("attack");
document.getElementById("defend-btn").onclick = () => doAction("defend");
document.getElementById("heal-btn").onclick = () => doAction("heal");

// (la fonction doAction() reste inchangée)
// (les fonctions de timer aussi)

// --- BOUTON RETOUR ---
document.getElementById("back-to-menu-btn").onclick = () => {
  if (currentMatch) {
    currentMatch = null;
  }

  clearInterval(timerInterval);
  timerInterval = null;
  hasPlayedThisTurn = false;

  document.getElementById("game").style.display = "none";
  document.getElementById("match").style.display = "block";
  document.getElementById("match-id").value = "";
  document.getElementById("match-msg").textContent = "";
};

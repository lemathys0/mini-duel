// Import Firebase (adapter selon ta config)
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";
import { getDatabase, ref, set, get, onValue, update, push, child, remove } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js";

// --- CONFIGURATION FIREBASE ---
const firebaseConfig = {
  apiKey: "TA_CLE_API",
  authDomain: "tonprojet.firebaseapp.com",
  databaseURL: "https://tonprojet-default-rtdb.firebaseio.com",
  projectId: "tonprojet",
  storageBucket: "tonprojet.appspot.com",
  messagingSenderId: "TON_ID",
  appId: "TON_APP_ID"
};
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// --- VARIABLES GLOBALES ---
let currentUser = null; // { pseudo, code }
let currentMatch = null;
let hasPlayedThisTurn = false;
let timerInterval = null;
let timerMax = 30; // secondes
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

// --- AUTHENTIFICATION (simplifiée, sans sécurité réelle) ---

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
      // Créer utilisateur
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
      // Créer match avec currentUser comme joueur 1
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

    // Ajouter currentUser en p2
    update(matchRef.child("players"), {
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

    // Trouver joueur et adversaire
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
      // Spectateur non géré
      document.getElementById("action-msg").textContent = "Tu n'es pas dans ce match.";
      disableActionButtons(true);
      return;
    }

    // Afficher PV
    document.getElementById("you-pv").textContent = you.pv;
    document.getElementById("opponent-name").textContent = opponent.pseudo;
    document.getElementById("opponent-pv").textContent = opponent.pv;

    // Gestion tour
    if (data.turn !== youKey) {
      disableActionButtons(true);
      if (!hasPlayedThisTurn)
        document.getElementById("action-msg").textContent = "Tour de l'adversaire, patience...";
    } else {
      if (!hasPlayedThisTurn) {
        disableActionButtons(false);
        document.getElementById("action-msg").textContent = "C'est ton tour, choisis une action.";
      } else {
        disableActionButtons(true);
        document.getElementById("action-msg").textContent = "Action jouée, en attente du tour suivant...";
      }
    }

    // Historique
    const histEl = document.getElementById("history");
    histEl.innerHTML = "";
    (data.history || []).forEach(entry => {
      const p = document.createElement("p");
      p.textContent = entry;
      histEl.appendChild(p);
    });

    // Fin de partie
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

function doAction(action) {
  if (hasPlayedThisTurn) return;

  const matchRef = ref(db, `matches/${currentMatch}`);

  get(matchRef).then(snapshot => {
    const data = snapshot.val();
    if (!data) return;

    let youKey = null;
    if (data.players.p1.pseudo === currentUser.pseudo) youKey = "p1";
    else if (data.players.p2 && data.players.p2.pseudo === currentUser.pseudo) youKey = "p2";

    if (!youKey || data.turn !== youKey) {
      showMessage("action-msg", "Ce n'est pas ton tour");
      return;
    }

    // Appliquer action
    const opponentKey = youKey === "p1" ? "p2" : "p1";
    const you = data.players[youKey];
    const opponent = data.players[opponentKey];

    if (!opponent) {
      showMessage("action-msg", "En attente de l'adversaire...");
      return;
    }

    let newYouPV = you.pv;
    let newOpponentPV = opponent.pv;
    let historyEntry = "";

    switch(action) {
      case "attack":
        let damage = 20;
        if (opponent.defending) damage = 10;
        newOpponentPV = Math.max(0, opponent.pv - damage);
        historyEntry = `${you.pseudo} attaque et inflige ${damage} dégâts à ${opponent.pseudo}.`;
        break;

      case "defend":
        // Défense active jusqu'au prochain tour
        historyEntry = `${you.pseudo} se met en position défensive.`;
        break;

      case "heal":
        let healAmount = 15;
        newYouPV = Math.min(100, you.pv + healAmount);
        historyEntry = `${you.pseudo} se soigne et récupère ${healAmount} PV.`;
        break;

      default:
        return;
    }

    // Préparer nouvelle valeur players
    let newPlayers = {...data.players};

    // Reset défense joueur tour précédent
    newPlayers[youKey].defending = false;
    newPlayers[opponentKey].defending = opponent.defending || false;

    if (action === "attack") {
      newPlayers[opponentKey].pv = newOpponentPV;
    } else if (action === "defend") {
      newPlayers[youKey].defending = true;
    } else if (action === "heal") {
      newPlayers[youKey].pv = newYouPV;
    }

    // Changer tour
    const newTurn = opponentKey;

    // Ajouter historique
    const newHistory = data.history || [];
    newHistory.push(historyEntry);

    // Mise à jour Firebase
    update(matchRef, {
      players: newPlayers,
      turn: newTurn,
      history: newHistory
    });

    hasPlayedThisTurn = true;
    disableActionButtons(true);
    document.getElementById("action-msg").textContent = "Action envoyée, en attente du tour adversaire.";
    resetTimer();
  });
}

// --- TIMER ---

function startTimer() {
  resetTimer();

  timerInterval = setInterval(() => {
    timerCount--;
    updateTimerUI(timerCount);

    if (timerCount <= 0) {
      clearInterval(timerInterval);
      // Si joueur n'a pas joué, forcer passage de tour (optionnel)
      if (!hasPlayedThisTurn) {
        autoPassTurn();
      }
    }
  }, 1000);
}

function resetTimer() {
  clearInterval(timerInterval);
  timerCount = timerMax;
  updateTimerUI(timerCount);
  if (!hasPlayedThisTurn) {
    startTimer();
  }
}

function updateTimerUI(seconds) {
  document.getElementById("timer").textContent = seconds + "s";
  const progress = (seconds / timerMax) * 100;
  document.getElementById("timer-progress").style.width = progress + "%";
}

function autoPassTurn() {
  // Passe le tour si joueur n'a rien fait
  const matchRef = ref(db, `matches/${currentMatch}`);

  get(matchRef).then(snapshot => {
    const data = snapshot.val();
    if (!data) return;

    let youKey = null;
    if (data.players.p1.pseudo === currentUser.pseudo) youKey = "p1";
    else if (data.players.p2 && data.players.p2.pseudo === currentUser.pseudo) youKey = "p2";

    if (!youKey || data.turn !== youKey) return;

    const opponentKey = youKey === "p1" ? "p2" : "p1";
    const newHistory = data.history || [];
    newHistory.push(`${currentUser.pseudo} n'a pas joué, tour passé.`);

    update(ref(db, `matches/${currentMatch}`), {
      turn: opponentKey,
      history: newHistory
    });

    hasPlayedThisTurn = true;
    disableActionButtons(true);
    document.getElementById("action-msg").textContent = "Temps écoulé, tour passé automatiquement.";
  });
}

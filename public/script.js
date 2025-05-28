// Import Firebase v9 modules
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import { getDatabase, ref, get, set, update, onValue } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";

// Configuration Firebase
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

// Initialiser Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

let currentUser = null;
let currentMatch = null;
let opponent = null;
let hasPlayedThisTurn = false; // Bloque action multiple par tour
let timerInterval = null;
let timerSeconds = 30;

// Helper to get input values
function getInput(id) {
  const elem = document.getElementById(id);
  return elem ? elem.value.trim() : "";
}

// SIGNUP
export function signup() {
  const pseudo = getInput('pseudo');
  const code = getInput('code');
  const msg = document.getElementById('auth-msg');

  if (!pseudo || code.length !== 4) {
    msg.textContent = "Remplis correctement les champs";
    return;
  }

  const userKey = `${pseudo}_${code}`;
  const userRef = ref(db, `users/${userKey}`);

  get(userRef).then(snapshot => {
    if (snapshot.exists()) {
      msg.textContent = "Ce compte existe déjà.";
    } else {
      set(userRef, { pseudo, code }).then(() => {
        login();
      });
    }
  });
}

// LOGIN
export function login() {
  const pseudo = getInput('pseudo');
  const code = getInput('code');
  const msg = document.getElementById('auth-msg');

  const userKey = `${pseudo}_${code}`;
  const userRef = ref(db, `users/${userKey}`);

  get(userRef).then(snapshot => {
    if (snapshot.exists()) {
      currentUser = { pseudo, code, key: userKey };
      document.getElementById("auth").style.display = "none";
      document.getElementById("match").style.display = "block";
      document.getElementById("player-name").textContent = pseudo;
      msg.textContent = "";
    } else {
      msg.textContent = "Compte introuvable.";
    }
  });
}

// CREATE MATCH
export function createMatch() {
  const matchID = getInput('match-id');
  if (!matchID) return;

  const matchRef = ref(db, `matches/${matchID}`);

  set(matchRef, {
    joueur1: currentUser.pseudo,
    joueur2: "",
    joueur1_pv: 100,
    joueur2_pv: 100,
    joueur1_action: null,
    joueur2_action: null,
    turn_result: "waiting"
  }).then(() => {
    startMatch(matchID, true);
  });
}

// JOIN MATCH
export function joinMatch() {
  const matchID = getInput('match-id');
  if (!matchID) return;

  const matchRef = ref(db, `matches/${matchID}`);

  get(matchRef).then(snapshot => {
    if (snapshot.exists()) {
      const data = snapshot.val();
      if (data.joueur2 === "") {
        update(matchRef, { joueur2: currentUser.pseudo }).then(() => {
          startMatch(matchID, false);
        });
      } else {
        alert("Match plein.");
      }
    } else {
      alert("Match introuvable.");
    }
  });
}

// START MATCH
function startMatch(id, isCreator) {
  currentMatch = id;
  const matchRef = ref(db, `matches/${id}`);

  document.getElementById("match").style.display = "none";
  document.getElementById("game").style.display = "block";
  document.getElementById("current-match").textContent = id;
  document.getElementById("you-name").textContent = currentUser.pseudo;
  document.getElementById("history").innerHTML = ""; // reset historique

  hasPlayedThisTurn = false;
  disableActionButtons(false);
  document.getElementById("action-msg").textContent = "";

  onValue(matchRef, (snapshot) => {
    const data = snapshot.val();
    if (!data) return;

    // Timer démarre seulement quand les 2 joueurs sont présents
    if (data.joueur1 && data.joueur2) {
      if (!timerInterval) startTimer();
    } else {
      clearInterval(timerInterval);
      timerInterval = null;
      document.getElementById('timer').textContent = "--";
    }

    const you = currentUser.pseudo === data.joueur1 ? "joueur1" : "joueur2";
    const opp = you === "joueur1" ? "joueur2" : "joueur1";
    opponent = data[opp];

    document.getElementById("you-pv").textContent = data[you + "_pv"];
    document.getElementById("opponent-pv").textContent = data[opp + "_pv"];
    document.getElementById("opponent-name").textContent = opponent || "(en attente)";

    // Résolution si les deux ont joué et tour en attente
    if (data[you + "_action"] && data[opp + "_action"] && data.turn_result === "waiting") {
      resolveTurn(data, you, opp, matchRef);
    }

    if (data.turn_result === "done") {
      resetTurn(matchRef);
    }
  });
}

// TIMER
function startTimer() {
  clearInterval(timerInterval);
  timerSeconds = 30;
  document.getElementById('timer').textContent = `${timerSeconds}s`;

  timerInterval = setInterval(() => {
    timerSeconds--;
    document.getElementById('timer').textContent = `${timerSeconds}s`;

    if (timerSeconds <= 0) {
      clearInterval(timerInterval);
      timerInterval = null;
      autoPlayIfNeeded();
    }
  }, 1000);
}

function autoPlayIfNeeded() {
  if (!currentMatch) return;

  const matchRef = ref(db, `matches/${currentMatch}`);
  get(matchRef).then(snapshot => {
    const data = snapshot.val();
    if (!data) return;

    const me = currentUser.pseudo === data.joueur1 ? "joueur1" : "joueur2";
    if (!data[me + "_action"]) {
      let updates = {};
      updates[me + "_action"] = "defend"; // action par défaut
      update(matchRef, updates);
      document.getElementById("action-msg").textContent = "Action automatique : Défendre";
      hasPlayedThisTurn = true;
      disableActionButtons(true);
    }
  });
}

// RESOLVE TURN
function resolveTurn(data, you, opp, matchRef) {
  hasPlayedThisTurn = true;
  disableActionButtons(true);

  clearInterval(timerInterval); // stop timer
  timerInterval = null;

  const actionYou = data[you + "_action"];
  const actionOpp = data[opp + "_action"];

  let pvYou = data[you + "_pv"];
  let pvOpp = data[opp + "_pv"];
  let actionMsg = "";

  if (actionYou === "attack" && actionOpp === "attack") {
    pvYou = Math.max(0, pvYou - 10);
    pvOpp = Math.max(0, pvOpp - 10);
    actionMsg = "Vous vous êtes tous les deux attaqués !";
  } else if (actionYou === "attack" && actionOpp === "defend") {
    actionMsg = "Tu as attaqué, ton adversaire s'est défendu, pas de dégâts.";
  } else if (actionYou === "defend" && actionOpp === "attack") {
    pvYou = Math.max(0, pvYou - 10);
    actionMsg = "Tu as défendu, mais ton adversaire t'a attaqué ! Tu perds 10 PV.";
  } else if (actionYou === "defend" && actionOpp === "defend") {
    actionMsg = "Vous vous êtes tous les deux défendus, rien ne se passe.";
  }

  if (actionYou === "heal") {
    pvYou = Math.min(100, pvYou + 10);
    actionMsg += " Tu t'es soigné (+10 PV).";
  }
  if (actionOpp === "heal") {
    pvOpp = Math.min(100, pvOpp + 10);
  }

  let updates = {};
  updates[you + "_pv"] = pvYou;
  updates[opp + "_pv"] = pvOpp;
  updates["turn_result"] = "done";

  update(matchRef, updates).then(() => {
    document.getElementById("action-msg").textContent = actionMsg;
    addHistoryMessage(`${currentUser.pseudo} a fait ${actionYou}. ${opponent} a fait ${actionOpp}.`);

    if (pvYou <= 0 || pvOpp <= 0) {
      const winner = pvYou > pvOpp ? currentUser.pseudo : opponent || "Personne";
      alert("Match terminé ! Gagnant : " + winner);
      disableActionButtons(true);
      hasPlayedThisTurn = true;
      clearInterval(timerInterval);
      timerInterval = null;
      document.getElementById('timer').textContent = "--";
    }
  });
}

// RESET TURN
function resetTurn(matchRef) {
  const updates = {
    joueur1_action: null,
    joueur2_action: null,
    turn_result: "waiting"
  };
  update(matchRef, updates).then(() => {
    hasPlayedThisTurn = false;
    disableActionButtons(false);
    document.getElementById("action-msg").textContent = "Nouveau tour, à toi de jouer !";
    startTimer();
  });
}

// Ajouter message dans historique
function addHistoryMessage(message) {
  const historyDiv = document.getElementById("history");
  const p = document.createElement("p");
  p.textContent = message;
  historyDiv.prepend(p); // ajoute en haut
}

// ACTIONS
export function attack() {
  applyAction("attack");
}

export function defend() {
  applyAction("defend");
}

export function heal() {
  applyAction("heal");
}

function applyAction(type) {
  if (hasPlayedThisTurn) return;

  if (!currentMatch) return;

  const matchRef = ref(db, `matches/${currentMatch}`);

  get(matchRef).then(snapshot => {
    const data = snapshot.val();
    if (!data) return;

    const me = currentUser.pseudo === data.joueur1 ? "joueur1" : "joueur2";

    if (data[me + "_action"] === null) {
      let updates = {};
      updates[me + "_action"] = type;

      update(matchRef, updates).then(() => {
        hasPlayedThisTurn = true;
        disableActionButtons(true);
        document.getElementById("action-msg").textContent = `Tu as choisi : ${type}`;
      });
    }
  });
}

// Désactiver ou activer les boutons d'action
function disableActionButtons(disabled) {
  document.getElementById("attack-btn").disabled = disabled;
  document.getElementById("defend-btn").disabled = disabled;
  document.getElementById("heal-btn").disabled = disabled;
}

// Expose functions globally for HTML onclick
window.signup = signup;
window.login = login;
window.createMatch = createMatch;
window.joinMatch = joinMatch;
window.attack = attack;
window.defend = defend;
window.heal = heal;

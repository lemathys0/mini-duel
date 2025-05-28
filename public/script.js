// Import Firebase v9 modules
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import { getDatabase, ref, get, set, update, onValue } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyA-e19z8T3c1K46YmJY8s9EAbO9BRes7fA",
  authDomain: "mini-duel-de-cartes.firebaseapp.com",
  databaseURL: "https://mini-duel-de-cartes-default-rtdb.firebaseio.com",
  projectId: "mini-duel-de-cartes",
  storageBucket: "mini-duel-de-cartes.appspot.com",
  messagingSenderId: "1084207708579",
  appId: "1:1084207708579:web:f1312b68b7eb08f9d44216",
  measurementId: "G-7YW3J41XZF"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

let currentUser = null;
let currentMatch = null;
let opponent = null;
let hasPlayedThisTurn = false;
let timerInterval = null;
let timerSeconds = 30;

function getInput(id) {
  const elem = document.getElementById(id);
  return elem ? elem.value.trim() : "";
}

function signup() {
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

function login() {
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

function createMatch() {
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

function joinMatch() {
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

  onValue(matchRef, (snapshot) => {
    const data = snapshot.val();
    if (!data) return;

    const you = currentUser.pseudo === data.joueur1 ? "joueur1" : "joueur2";
    const opp = you === "joueur1" ? "joueur2" : "joueur1";
    opponent = data[opp];

    document.getElementById("you-pv").textContent = data[you + "_pv"];
    document.getElementById("opponent-pv").textContent = data[opp + "_pv"];
    document.getElementById("opponent-name").textContent = opponent || "(en attente)";

    if (data[you + "_action"] && data[opp + "_action"] && data.turn_result === "waiting") {
      resolveTurn(data, you, opp, matchRef);
    }

    if (data.turn_result === "done") {
      resetTurn(matchRef);
    }
  });
}

function startTimer() {
  clearInterval(timerInterval);
  timerSeconds = 30;
  updateTimerDisplay();

  timerInterval = setInterval(() => {
    timerSeconds--;
    updateTimerDisplay();
    if (timerSeconds <= 0) {
      clearInterval(timerInterval);
      timerInterval = null;
      autoPlayIfNeeded();
    }
  }, 1000);
}

function updateTimerDisplay() {
  document.getElementById('timer').textContent = `${timerSeconds}s`;
  document.getElementById('timer-progress').style.width = `${(timerSeconds / 30) * 100}%`;
}

function autoPlayIfNeeded() {
  if (!currentMatch) return;
  const matchRef = ref(db, `matches/${currentMatch}`);
  get(matchRef).then(snapshot => {
    const data = snapshot.val();
    if (!data) return;
    const me = currentUser.pseudo === data.joueur1 ? "joueur1" : "joueur2";
    if (!data[me + "_action"]) {
      update(matchRef, { [me + "_action"]: "defend" });
      document.getElementById("action-msg").textContent = "Action automatique : Défendre";
      hasPlayedThisTurn = true;
      disableActionButtons(true);
    }
  });
}

function resolveTurn(data, you, opp, matchRef) {
  hasPlayedThisTurn = true;
  disableActionButtons(true);
  clearInterval(timerInterval);
  timerInterval = null;

  const actionYou = data[you + "_action"];
  const actionOpp = data[opp + "_action"];

  let pvYou = data[you + "_pv"];
  let pvOpp = data[opp + "_pv"];
  let msg = "";

  if (actionYou === "attack" && actionOpp === "attack") {
    pvYou -= 10; pvOpp -= 10;
    msg = "Vous vous êtes attaqués !";
  } else if (actionYou === "attack" && actionOpp === "defend") {
    msg = "Tu as attaqué, ton adversaire s'est défendu.";
  } else if (actionYou === "defend" && actionOpp === "attack") {
    pvYou -= 10;
    msg = "Tu as défendu, mais ton adversaire t'a attaqué ! Tu perds 10 PV.";
  } else if (actionYou === "defend" && actionOpp === "defend") {
    msg = "Vous vous êtes tous les deux défendus.";
  }
  if (actionYou === "heal") {
    pvYou = Math.min(100, pvYou + 10);
    msg += " Tu t'es soigné.";
  }
  if (actionOpp === "heal") {
    pvOpp = Math.min(100, pvOpp + 10);
  }

  const updates = {
    [you + "_pv"]: Math.max(0, pvYou),
    [opp + "_pv"]: Math.max(0, pvOpp),
    turn_result: "done"
  };
  update(matchRef, updates).then(() => {
    document.getElementById("action-msg").textContent = msg;
    addHistoryMessage(`${currentUser.pseudo} a fait ${actionYou}. ${opponent} a fait ${actionOpp}.`);
    if (pvYou <= 0 || pvOpp <= 0) {
      alert("Match terminé ! Gagnant : " + (pvYou > pvOpp ? currentUser.pseudo : opponent));
      disableActionButtons(true);
      clearInterval(timerInterval);
      document.getElementById('timer').textContent = "--";
    }
  });
}

function resetTurn(matchRef) {
  update(matchRef, {
    joueur1_action: null,
    joueur2_action: null,
    turn_result: "waiting"
  }).then(() => {
    hasPlayedThisTurn = false;
    disableActionButtons(false);
    document.getElementById("action-msg").textContent = "Nouveau tour, à toi de jouer !";
    startTimer();
  });
}

function addHistoryMessage(msg) {
  const div = document.getElementById("history");
  const p = document.createElement("p");
  p.textContent = msg;
  div.prepend(p);
}

function attack() { applyAction("attack"); }
function defend() { applyAction("defend"); }
function heal() { applyAction("heal"); }

function applyAction(type) {
  if (hasPlayedThisTurn || !currentMatch) return;
  const matchRef = ref(db, `matches/${currentMatch}`);
  get(matchRef).then(snapshot => {
    const data = snapshot.val();
    if (!data) return;
    const me = currentUser.pseudo === data.joueur1 ? "joueur1" : "joueur2";
    if (data[me + "_action"] === null) {
      update(matchRef, { [me + "_action"]: type }).then(() => {
        hasPlayedThisTurn = true;
        disableActionButtons(true);
        document.getElementById("action-msg").textContent = `Tu as choisi : ${type}`;
      });
    }
  });
}

function disableActionButtons(disabled) {
  document.getElementById("attack-btn").disabled = disabled;
  document.getElementById("defend-btn").disabled = disabled;
  document.getElementById("heal-btn").disabled = disabled;
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('signup-btn').addEventListener('click', signup);
  document.getElementById('login-btn').addEventListener('click', login);
  document.getElementById('create-match-btn').addEventListener('click', createMatch);
  document.getElementById('join-match-btn').addEventListener('click', joinMatch);
  document.getElementById('attack-btn').addEventListener('click', attack);
  document.getElementById('defend-btn').addEventListener('click', defend);
  document.getElementById('heal-btn').addEventListener('click', heal);
});

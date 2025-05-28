// ... firebaseConfig et firebase.initializeApp() inchangés
// ... db = firebase.database();

let currentUser = null;
let currentMatch = null;
let opponent = null;
let hasPlayedThisTurn = false;
let turnTimer = null;
let turnTimeLeft = 30;

// Nouvelle fonction : mettre à jour l'historique dans le DOM
function addToHistory(text) {
  const history = document.getElementById("history");
  const entry = document.createElement("div");
  entry.textContent = text;
  history.appendChild(entry);
  history.scrollTop = history.scrollHeight;
}

// Démarre un timer de tour
function startTurnTimer() {
  clearInterval(turnTimer);
  turnTimeLeft = 30;
  document.getElementById("timer").textContent = `${turnTimeLeft}s`;

  turnTimer = setInterval(() => {
    turnTimeLeft--;
    document.getElementById("timer").textContent = `${turnTimeLeft}s`;

    if (turnTimeLeft <= 0) {
      clearInterval(turnTimer);
      if (!hasPlayedThisTurn) {
        applyAction("defend"); // Défend automatiquement si inactif
      }
    }
  }, 1000);
}

function startMatch(id, isCreator) {
  currentMatch = id;
  const matchRef = db.ref("matches/" + id);

  document.getElementById("match").style.display = "none";
  document.getElementById("game").style.display = "block";
  document.getElementById("current-match").textContent = id;
  document.getElementById("you-name").textContent = currentUser.pseudo;
  hasPlayedThisTurn = false;
  disableActionButtons(false);
  document.getElementById("action-msg").textContent = "";
  document.getElementById("history").innerHTML = "";
  startTurnTimer();

  matchRef.on("value", snap => {
    const data = snap.val();
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

function resolveTurn(data, you, opp, matchRef) {
  hasPlayedThisTurn = true;
  disableActionButtons(true);
  clearInterval(turnTimer);

  const actionYou = data[you + "_action"];
  const actionOpp = data[opp + "_action"];

  let pvYou = data[you + "_pv"];
  let pvOpp = data[opp + "_pv"];
  let actionMsg = "";

  // Logique des actions (inclut "heal")
  if (actionYou === "attack" && actionOpp === "attack") {
    pvYou -= 10;
    pvOpp -= 10;
    actionMsg = "Vous vous êtes tous les deux attaqués !";
  } else if (actionYou === "attack" && actionOpp === "defend") {
    actionMsg = "Tu as attaqué, ton adversaire s'est défendu.";
  } else if (actionYou === "defend" && actionOpp === "attack") {
    pvYou -= 10;
    actionMsg = "Tu t'es défendu, mais l'adversaire t'a touché.";
  } else if (actionYou === "defend" && actionOpp === "defend") {
    actionMsg = "Deux défenses, personne n'attaque.";
  } else if (actionYou === "heal") {
    pvYou = Math.min(100, pvYou + 15);
    actionMsg = "Tu t'es soigné de 15 PV.";
  } else if (actionOpp === "heal") {
    pvOpp = Math.min(100, pvOpp + 15);
    actionMsg = "Ton adversaire s'est soigné.";
  }

  pvYou = Math.max(0, pvYou);
  pvOpp = Math.max(0, pvOpp);

  let updates = {};
  updates[you + "_pv"] = pvYou;
  updates[opp + "_pv"] = pvOpp;
  updates["turn_result"] = "done";

  matchRef.update(updates).then(() => {
    document.getElementById("action-msg").textContent = actionMsg;
    addToHistory(`Tour : ${actionYou} / ${actionOpp}`);
    if (pvYou <= 0 || pvOpp <= 0) {
      endGame(pvYou > pvOpp ? currentUser.pseudo : opponent);
    }
  });
}

function endGame(winner) {
  alert("Match terminé ! Gagnant : " + winner);
  disableActionButtons(true);
  clearInterval(turnTimer);
  const userRef = db.ref("users/" + currentUser.key);
  userRef.once("value").then(snapshot => {
    const userData = snapshot.val() || {};
    let wins = userData.wins || 0;
    let losses = userData.losses || 0;

    if (winner === currentUser.pseudo) {
      wins++;
    } else {
      losses++;
    }

    userRef.update({ wins, losses });
  });
}

function resetTurn(matchRef) {
  let updates = {
    joueur1_action: null,
    joueur2_action: null,
    turn_result: "waiting"
  };
  matchRef.update(updates).then(() => {
    hasPlayedThisTurn = false;
    disableActionButtons(false);
    document.getElementById("action-msg").textContent = "Nouveau tour, à toi !";
    startTurnTimer();
  });
}

function attack() {
  applyAction("attack");
}
function defend() {
  applyAction("defend");
}
function heal() {
  applyAction("heal");
}

function applyAction(type) {
  if (hasPlayedThisTurn) return;

  const matchRef = db.ref("matches/" + currentMatch);
  matchRef.once("value").then(snapshot => {
    const data = snapshot.val();
    const me = currentUser.pseudo === data.joueur1 ? "joueur1" : "joueur2";

    if (data[me + "_action"]) return;

    let updates = {};
    updates[me + "_action"] = type;
    updates["turn_result"] = "waiting";

    matchRef.update(updates).then(() => {
      hasPlayedThisTurn = true;
      document.getElementById("action-msg").textContent = `Action "${type}" enregistrée.`;
      disableActionButtons(true);
    });
  });
}

function disableActionButtons(disable) {
  document.querySelector('button[onclick="attack()"]').disabled = disable;
  document.querySelector('button[onclick="defend()"]').disabled = disable;
  document.querySelector('button[onclick="heal()"]').disabled = disable;
}

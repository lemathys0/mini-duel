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
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

let currentUser = null;
let currentMatch = null;
let opponent = null;
let hasPlayedThisTurn = false; // Bloque action multiple par tour

function signup() {
  const pseudo = document.getElementById('pseudo').value.trim();
  const code = document.getElementById('code').value.trim();
  const msg = document.getElementById('auth-msg');

  if (!pseudo || code.length !== 4) {
    msg.textContent = "Remplis correctement les champs";
    return;
  }

  const userKey = pseudo + "_" + code;
  db.ref("users/" + userKey).once("value").then(snapshot => {
    if (snapshot.exists()) {
      msg.textContent = "Ce compte existe déjà.";
    } else {
      db.ref("users/" + userKey).set({ pseudo, code }).then(() => {
        login();
      });
    }
  });
}

function login() {
  const pseudo = document.getElementById('pseudo').value.trim();
  const code = document.getElementById('code').value.trim();
  const msg = document.getElementById('auth-msg');

  const userKey = pseudo + "_" + code;
  db.ref("users/" + userKey).once("value").then(snapshot => {
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
  const matchID = document.getElementById('match-id').value.trim();
  if (!matchID) return;

  const matchRef = db.ref("matches/" + matchID);
  matchRef.set({
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
  const matchID = document.getElementById('match-id').value.trim();
  if (!matchID) return;

  const matchRef = db.ref("matches/" + matchID);
  matchRef.once("value").then(snapshot => {
    if (snapshot.exists()) {
      const data = snapshot.val();
      if (data.joueur2 === "") {
        matchRef.update({ joueur2: currentUser.pseudo }).then(() => {
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
  const matchRef = db.ref("matches/" + id);

  document.getElementById("match").style.display = "none";
  document.getElementById("game").style.display = "block";
  document.getElementById("current-match").textContent = id;
  document.getElementById("you-name").textContent = currentUser.pseudo;

  // Au départ, active les boutons
  hasPlayedThisTurn = false;
  disableActionButtons(false);
  document.getElementById("action-msg").textContent = "";

  matchRef.on("value", snap => {
    const data = snap.val();
    if (!data) return;

    const you = currentUser.pseudo === data.joueur1 ? "joueur1" : "joueur2";
    const opp = you === "joueur1" ? "joueur2" : "joueur1";
    opponent = data[opp];

    document.getElementById("you-pv").textContent = data[you + "_pv"];
    document.getElementById("opponent-pv").textContent = data[opp + "_pv"];
    document.getElementById("opponent-name").textContent = opponent || "(en attente)";

    // Si les deux actions sont enregistrées et que le résultat n'a pas encore été appliqué
    if (data[you + "_action"] && data[opp + "_action"] && data.turn_result === "waiting") {
      // Applique le résultat du tour
      resolveTurn(data, you, opp, matchRef);
    }

    // Si le tour est terminé, on reset pour nouveau tour
    if (data.turn_result === "done") {
      resetTurn(matchRef);
    }
  });
}

function resolveTurn(data, you, opp, matchRef) {
  // Empêche de rejouer avant reset
  hasPlayedThisTurn = true;
  disableActionButtons(true);

  const actionYou = data[you + "_action"];
  const actionOpp = data[opp + "_action"];

  let pvYou = data[you + "_pv"];
  let pvOpp = data[opp + "_pv"];
  let actionMsg = "";

  // Exemple simple de résolution :
  // attaque vs défense => pas de dégâts
  // attaque vs attaque => les deux perdent 10 pv
  // défense vs défense => rien ne se passe
  // défense vs attaque => attaquant inflige 10 pv

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

  // Met à jour la base et marque le tour comme done
  let updates = {};
  updates[you + "_pv"] = pvYou;
  updates[opp + "_pv"] = pvOpp;
  updates["turn_result"] = "done";

  matchRef.update(updates).then(() => {
    document.getElementById("action-msg").textContent = actionMsg;

    // Si l'un des joueurs est à 0 PV, fin du match
    if (pvYou <= 0 || pvOpp <= 0) {
      const winner = pvYou > pvOpp ? currentUser.pseudo : opponent || "Personne";
      alert("Match terminé ! Gagnant : " + winner);
      // Tu peux ici ajouter un reset ou redirection
      disableActionButtons(true);
      hasPlayedThisTurn = true;
      // Optionnel : déconnecter ou revenir à l'accueil
    }
  });
}

function resetTurn(matchRef) {
  // Reset des actions pour un nouveau tour
  let updates = {
    joueur1_action: null,
    joueur2_action: null,
    turn_result: "waiting"
  };
  matchRef.update(updates).then(() => {
    hasPlayedThisTurn = false;
    disableActionButtons(false);
    document.getElementById("action-msg").textContent = "Nouveau tour, à toi de jouer !";
  });
}

function attack() {
  applyAction("attack");
}

function defend() {
  applyAction("defend");
}

function applyAction(type) {
  if (hasPlayedThisTurn) {
    document.getElementById("action-msg").textContent = "Tu as déjà joué ce tour.";
    return;
  }

  const matchRef = db.ref("matches/" + currentMatch);
  matchRef.once("value").then(snapshot => {
    const data = snapshot.val();
    if (!data) return;

    const me = currentUser.pseudo === data.joueur1 ? "joueur1" : "joueur2";

    if (data[me + "_action"] !== null) {
      document.getElementById("action-msg").textContent = "Action déjà enregistrée, en attente de l'adversaire.";
      hasPlayedThisTurn = true;
      disableActionButtons(true);
      return;
    }

    let updates = {};
    updates[me + "_action"] = type;
    updates["turn_result"] = "waiting";

    matchRef.update(updates).then(() => {
      hasPlayedThisTurn = true;
      document.getElementById("action-msg").textContent = "Action enregistrée, en attente de l'adversaire...";
      disableActionButtons(true);
    });
  });
}

function disableActionButtons(disable) {
  document.querySelector('button[onclick="attack()"]').disabled = disable;
  document.querySelector('button[onclick="defend()"]').disabled = disable;
}

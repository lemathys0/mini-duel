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
let hasPlayedThisTurn = false;

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
    turn_result: "waiting" // waiting, processing, done
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
  hasPlayedThisTurn = false;
  const matchRef = db.ref("matches/" + id);

  document.getElementById("match").style.display = "none";
  document.getElementById("game").style.display = "block";
  document.getElementById("current-match").textContent = id;
  document.getElementById("you-name").textContent = currentUser.pseudo;
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

    // Gestion du tour synchronisé
    if (data.joueur1_action !== null && data.joueur2_action !== null && data.turn_result === "waiting") {
      // Marquer que le calcul est en cours pour éviter les doubles calculs
      matchRef.update({ turn_result: "processing" });

      // Calcul des dégâts selon actions
      let joueur1_pv = data.joueur1_pv;
      let joueur2_pv = data.joueur2_pv;

      if (data.joueur1_action === "attack" && data.joueur2_action !== "defend") {
        joueur2_pv = Math.max(0, joueur2_pv - 10);
      }
      if (data.joueur2_action === "attack" && data.joueur1_action !== "defend") {
        joueur1_pv = Math.max(0, joueur1_pv - 10);
      }

      // Mise à jour des PV et réinitialisation des actions
      matchRef.update({
        joueur1_pv: joueur1_pv,
        joueur2_pv: joueur2_pv,
        joueur1_action: null,
        joueur2_action: null,
        turn_result: "done"
      }).then(() => {
        // Afficher le résultat pour le joueur courant
        if (currentUser.pseudo === data.joueur1) {
          document.getElementById("action-msg").textContent = `Tour fini : Tu as ${joueur1_pv} PV, adversaire ${joueur2_pv} PV.`;
        } else {
          document.getElementById("action-msg").textContent = `Tour fini : Tu as ${joueur2_pv} PV, adversaire ${joueur1_pv} PV.`;
        }
        hasPlayedThisTurn = false;

        // Vérifier fin du match
        if (joueur1_pv <= 0 || joueur2_pv <= 0) {
          const winner = joueur1_pv <= 0 ? data.joueur2 : data.joueur1;
          alert(`Match terminé ! Le gagnant est ${winner}.`);
          // Revenir à l'écran de sélection ou reset la partie
          document.getElementById("game").style.display = "none";
          document.getElementById("match").style.display = "block";
        }
      });
    }

    if (data.turn_result === "done") {
      // Reset du statut pour un nouveau tour
      matchRef.update({ turn_result: "waiting" });
    }
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

    // Si déjà joué cette action (sécurité)
    if (data[me + "_action"] !== null) {
      document.getElementById("action-msg").textContent = "Action déjà enregistrée, en attente de l'adversaire.";
      return;
    }

    // Enregistrer l'action du joueur
    let updates = {};
    updates[me + "_action"] = type;
    updates["turn_result"] = "waiting"; // s'assure qu'on attend toujours l'autre joueur

    matchRef.update(updates).then(() => {
      hasPlayedThisTurn = true;
      document.getElementById("action-msg").textContent = "Action enregistrée, en attente de l'adversaire...";
    });
  });
}

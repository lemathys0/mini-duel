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

let currentUser = null;
let currentMatch = null;
let opponent = null;

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
      db.ref("users/" + userKey).set({ pseudo, code });
      login(); // connecte automatiquement
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
    joueur2_pv: 100
  });

  startMatch(matchID, true);
}

function joinMatch() {
  const matchID = document.getElementById('match-id').value.trim();
  const matchRef = db.ref("matches/" + matchID);

  matchRef.once("value").then(snapshot => {
    if (snapshot.exists()) {
      const data = snapshot.val();
      if (data.joueur2 === "") {
        matchRef.update({ joueur2: currentUser.pseudo });
        startMatch(matchID, false);
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

  matchRef.on("value", snap => {
    const data = snap.val();
    if (!data) return;

    const you = currentUser.pseudo === data.joueur1 ? "joueur1" : "joueur2";
    const opp = you === "joueur1" ? "joueur2" : "joueur1";
    opponent = data[opp];

    document.getElementById("you-pv").textContent = data[you + "_pv"];
    document.getElementById("opponent-pv").textContent = data[opp + "_pv"];
    document.getElementById("opponent-name").textContent = opponent || "(en attente)";
  });
}

function attack() {
  applyAction("attack");
}

function defend() {
  applyAction("defend");
}

function applyAction(type) {
  const matchRef = db.ref("matches/" + currentMatch);
  matchRef.once("value").then(snapshot => {
    const data = snapshot.val();
    const me = currentUser.pseudo === data.joueur1 ? "joueur1" : "joueur2";
    const opp = me === "joueur1" ? "joueur2" : "joueur1";

    let newPV = data[opp + "_pv"];
    if (type === "attack") {
      newPV = Math.max(0, newPV - 10);
      document.getElementById("action-msg").textContent = "Tu attaques ton adversaire !";
    } else {
      document.getElementById("action-msg").textContent = "Tu te défends (pas de dégâts subis) !";
      return;
    }

    let update = {};
    update[opp + "_pv"] = newPV;
    matchRef.update(update);
  });
}

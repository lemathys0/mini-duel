// --- Configuration Firebase ---
const firebaseConfig = {
  apiKey: "AIzaSyA-e19z8T3c1K46YmJY8s9EAbO9BRes7fA",
  authDomain: "mini-duel-de-cartes.firebaseapp.com",
  databaseURL: "https://mini-duel-de-cartes-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "mini-duel-de-cartes",
  storageBucket: "mini-duel-de-cartes.appspot.com",
  messagingSenderId: "1084207708579",
  appId: "1:1084207708579:web:f1312b68b7eb08f9d44216"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

let currentUser = null;
let roomId = null;

// Afficher la page d'inscription
function showSignup() {
  document.getElementById('signup-section').style.display = 'block';
  document.getElementById('login-section').style.display = 'none';
  document.getElementById('game-section').style.display = 'none';
}

// Afficher la page de connexion
function showLogin() {
  document.getElementById('signup-section').style.display = 'none';
  document.getElementById('login-section').style.display = 'block';
  document.getElementById('game-section').style.display = 'none';
}

// Afficher la page de jeu
function showGame() {
  document.getElementById('signup-section').style.display = 'none';
  document.getElementById('login-section').style.display = 'none';
  document.getElementById('game-section').style.display = 'block';
  document.getElementById('user-name').textContent = currentUser.pseudo;
}

// Inscription
function signup() {
  const pseudo = document.getElementById('signup-pseudo').value.trim();
  const code = document.getElementById('signup-code').value.trim();

  const msg = document.getElementById('signup-msg');
  msg.textContent = '';

  if (!pseudo || code.length !== 4 || !/^\d{4}$/.test(code)) {
    msg.textContent = 'Pseudo invalide ou code doit être 4 chiffres';
    return;
  }

  const key = `${pseudo}_${code}`;
  const userRef = db.ref('users/' + key);

  userRef.once('value').then(snapshot => {
    if (snapshot.exists()) {
      msg.textContent = 'Ce compte existe déjà, connecte-toi';
    } else {
      userRef.set({ pseudo, code, trophées: 100, pv: 100 }).then(() => {
        currentUser = { pseudo, code, trophées: 100, pv: 100, key };
        showGame();
      });
    }
  });
}

// Connexion
function login() {
  const pseudo = document.getElementById('login-pseudo').value.trim();
  const code = document.getElementById('login-code').value.trim();

  const msg = document.getElementById('login-msg');
  msg.textContent = '';

  if (!pseudo || code.length !== 4 || !/^\d{4}$/.test(code)) {
    msg.textContent = 'Pseudo invalide ou code doit être 4 chiffres';
    return;
  }

  const key = `${pseudo}_${code}`;
  const userRef = db.ref('users/' + key);

  userRef.once('value').then(snapshot => {
    if (snapshot.exists()) {
      currentUser = snapshot.val();
      currentUser.key = key;
      showGame();
    } else {
      msg.textContent = "Compte non trouvé, inscris-toi d'abord";
    }
  });
}

// Création room, rejoindre, jouer et logique restent identiques à ton précédent code
function createRoom() {
  const id = Math.random().toString(36).substring(2, 6).toUpperCase();
  roomId = id;
  const ref = db.ref('rooms/' + id);
  ref.set({
    player1: currentUser.key,
    pv: { [currentUser.key]: 100 },
    actions: {}
  });
  listenToRoom();
  document.getElementById('status').textContent = `Room créée : ${id}`;
}

function joinRoom() {
  const id = document.getElementById('room-code').value.trim().toUpperCase();
  if (!id) return;

  roomId = id;
  const ref = db.ref('rooms/' + id);
  ref.once('value').then(snapshot => {
    if (snapshot.exists() && !snapshot.val().player2) {
      ref.update({ player2: currentUser.key, pv: { ...snapshot.val().pv, [currentUser.key]: 100 } });
      listenToRoom();
      document.getElementById('status').textContent = `Rejoint la room ${id}`;
    } else {
      document.getElementById('status').textContent = 'Room introuvable ou déjà pleine';
    }
  });
}

function listenToRoom() {
  const ref = db.ref('rooms/' + roomId);
  ref.on('value', snapshot => {
    const data = snapshot.val();
    if (!data) return;
    if (data.player1 && data.player2) {
      document.getElementById('actions').style.display = 'block';
      // Logique simplifiée, afficher PV etc.
      document.getElementById('status').textContent = `Joueurs : ${data.player1} vs ${data.player2}`;
    }
  });
}

function play(action) {
  if (!roomId) return;
  const ref = db.ref('rooms/' + roomId + '/actions/' + currentUser.key);
  ref.set(action);
  document.getElementById('result').textContent = `Action jouée : ${action}`;
}

// Affiche la page d'inscription au départ
showSignup();

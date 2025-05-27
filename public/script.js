// Config Firebase
const firebaseConfig = {
  apiKey: "AIzaSyA-e19z8T3c1K46YmJY8s9EAbO9BRes7fA",
  authDomain: "mini-duel-de-cartes.firebaseapp.com",
  databaseURL: "https://mini-duel-de-cartes-default-rtdb.firebaseio.com",
  projectId: "mini-duel-de-cartes",
  storageBucket: "mini-duel-de-cartes.appspot.com",
  messagingSenderId: "1084207708579",
  appId: "1:1084207708579:web:f1312b68b7eb08f9d44216"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

let currentUser = null;
let roomId = null;
let roomData = null;
let playerRole = null; // 'player1' ou 'player2'
let turn = null; // clé du joueur dont c'est le tour

// Affichage des sections
window.showSignup = function() {
  document.getElementById('signup-section').style.display = 'block';
  document.getElementById('login-section').style.display = 'none';
  document.getElementById('game-section').style.display = 'none';
  document.getElementById('combat-section').style.display = 'none';
};

window.showLogin = function() {
  document.getElementById('signup-section').style.display = 'none';
  document.getElementById('login-section').style.display = 'block';
  document.getElementById('game-section').style.display = 'none';
  document.getElementById('combat-section').style.display = 'none';
};

window.showGame = function() {
  document.getElementById('signup-section').style.display = 'none';
  document.getElementById('login-section').style.display = 'none';
  document.getElementById('game-section').style.display = 'block';
  document.getElementById('combat-section').style.display = 'none';
  document.getElementById('user-name').textContent = currentUser.pseudo;
};

function showCombat() {
  document.getElementById('signup-section').style.display = 'none';
  document.getElementById('login-section').style.display = 'none';
  document.getElementById('game-section').style.display = 'none';
  document.getElementById('combat-section').style.display = 'block';
}

// Inscription
window.signup = function() {
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
        window.showGame();
      });
    }
  });
};

// Connexion
window.login = function() {
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
      window.showGame();
    } else {
      msg.textContent = "Compte non trouvé, inscris-toi d'abord";
    }
  });
};

// Création de la room
window.createRoom = function() {
  const id = Math.random().toString(36).substring(2, 6).toUpperCase();
  roomId = id;
  const ref = db.ref('rooms/' + id);
  ref.set({
    player1: currentUser.key,
    player2: null,
    pv: { [currentUser.key]: 100 },
    actions: {},
    turn: currentUser.key,
    winner: null
  });
  playerRole = 'player1';
  listenToRoom();
  document.getElementById('status').textContent = `Room créée : ${id}`;
};

// Rejoindre une room
window.joinRoom = function() {
  const id = document.getElementById('room-code').value.trim().toUpperCase();
  if (!id) return;

  roomId = id;
  const ref = db.ref('rooms/' + id);

  ref.once('value').then(snapshot => {
    if (!snapshot.exists()) {
      document.getElementById('status').textContent = 'Room introuvable';
      return;
    }
    const room = snapshot.val();
    if (room.player2 && room.player2 !== currentUser.key) {
      document.getElementById('status').textContent = 'Room pleine';
      return;
    }
    if (!room.player2) {
      ref.update({ player2: currentUser.key, ['pv/' + currentUser.key]: 100 });
      playerRole = 'player2';
      listenToRoom();
      document.getElementById('status').textContent = `Rejoint la room : ${id}`;
    } else if (room.player2 === currentUser.key) {
      playerRole = 'player2';
      listenToRoom();
      document.getElementById('status').textContent = `Déjà dans la room : ${id}`;
    }
  });
};

// Écoute les changements dans la room + logique combat
function listenToRoom() {
  const ref = db.ref('rooms/' + roomId);
  ref.on('value', snapshot => {
    roomData = snapshot.val();
    if (!roomData) return;

    // Si les deux joueurs sont là, afficher le combat
    if (roomData.player1 && roomData.player2) {
      showCombat();

      // Affiche noms et PV
      getUserPseudo(roomData.player1).then(name1 => {
        document.getElementById('player1-name').textContent = name1;
        document.getElementById('player1-name-pv').textContent = name1;
      });
      getUserPseudo(roomData.player2).then(name2 => {
        document.getElementById('player2-name').textContent = name2;
        document.getElementById('player2-name-pv').textContent = name2;
      });

      // Affiche PV
      document.getElementById('player1-pv').textContent = roomData.pv[roomData.player1];
      document.getElementById('player2-pv').textContent = roomData.pv[roomData.player2];

      // Affiche tour actuel
      turn = roomData.turn;
      const combatStatus = document.getElementById('combat-status');

      if (roomData.winner) {
        const winnerName = (roomData.winner === currentUser.key) ? 'Tu as gagné 🎉' : 'Tu as perdu 😞';
        combatStatus.textContent = `Partie terminée : ${winnerName}`;
        document.getElementById('combat-actions').style.display = 'none';
        return;
      }

      if (turn === currentUser.key) {
        combatStatus.textContent = 'À ton tour de jouer';
        document.getElementById('combat-actions').style.display = 'block';
      } else {
        combatStatus.textContent = 'En attente du tour de l\'adversaire...';
        document.getElementById('combat-actions').style.display = 'none';
      }

      // Si les 2 joueurs ont joué leurs actions, calcule le résultat
      if (roomData.actions[roomData.player1] && roomData.actions[roomData.player2]) {
        processActions(roomData);
      }
    } else {
      document.getElementById('combat-section').style.display = 'none';
      document.getElementById('status').textContent = 'En attente d\'un adversaire...';
    }
  });
}

function getUserPseudo(userKey) {
  return db.ref('users/' + userKey).once('value').then(snap => {
    if (snap.exists()) return snap.val().pseudo;
    else return userKey;
  });
}

// Traite les actions des deux joueurs
function processActions(room) {
  const p1 = room.player1;
  const p2 = room.player2;
  const a1 = room.actions[p1];
  const a2 = room.actions[p2];
  let pv = {...room.pv}; // copie des PV

  // Calcul des effets
  // Par exemple :
  // Attaque fait 20 dégâts
  // Défense réduit les dégâts reçus de 10
  // Soin restaure 15 PV (max 100)
  const damageBase = 20;
  const defenseValue = 10;
  const healValue = 15;

  // Dégâts subis par chaque joueur
  let dmgToP1 = 0;
  let dmgToP2 = 0;

  // Calcul des dégâts infligés
  // P1 attaque p2
  if (a1 === 'Attaque') {
    if (a2 === 'Défense') dmgToP2 = Math.max(0, damageBase - defenseValue);
    else dmgToP2 = damageBase;
  } else if (a1 === 'Soin') {
    pv[p1] = Math.min(100, pv[p1] + healValue);
  }

  // P2 attaque p1
  if (a2 === 'Attaque') {
    if (a1 === 'Défense') dmgToP1 = Math.max(0, damageBase - defenseValue);
    else dmgToP1 = damageBase;
  } else if (a2 === 'Soin') {
    pv[p2] = Math.min(100, pv[p2] + healValue);
  }

  // Applique les dégâts
  pv[p1] = Math.max(0, pv[p1] - dmgToP1);
  pv[p2] = Math.max(0, pv[p2] - dmgToP2);

  // Mets à jour la BDD
  const updates = {
    pv,
    actions: {}, // reset actions pour le prochain tour
    turn: (room.turn === p1) ? p2 : p1
  };

  // Vérifie si quelqu'un a gagné
  if (pv[p1] === 0) updates.winner = p2;
  else if (pv[p2] === 0) updates.winner = p1;

  db.ref('rooms/' + roomId).update(updates);

  // Affiche résultat texte
  const res = [];

  if (a1 === 'Attaque') res.push(`Tu as attaqué`);
  else if (a1 === 'Défense') res.push(`Tu t'es défendu`);
  else if (a1 === 'Soin') res.push(`Tu t'es soigné`);

  if (a2 === 'Attaque') res.push(`Adversaire a attaqué`);
  else if (a2 === 'Défense') res.push(`Adversaire s'est défendu`);
  else if (a2 === 'Soin') res.push(`Adversaire s'est soigné`);

  document.getElementById('combat-result').textContent = res.join(' | ');
}

// Jouer une action
window.play = function(action) {
  if (!roomId || !roomData) return;
  if (roomData.turn !== currentUser.key) {
    alert("Ce n'est pas ton tour !");
    return;
  }
  // Vérifie si déjà joué
  if (roomData.actions[currentUser.key]) {
    alert("Tu as déjà joué ce tour !");
    return;
  }

  // Enregistre l'action dans Firebase
  db.ref('rooms/' + roomId + '/actions/' + currentUser.key).set(action);
};

// Quitter la room
window.leaveRoom = function() {
  if (!roomId) return;

  // Nettoyage local
  roomId = null;
  roomData = null;
  playerRole = null;
  turn = null;

  // Supprime l'écoute Firebase
  db.ref('rooms').off();

  // Retour à l'écran de jeu
  showGame();
  document.getElementById('status').textContent = 'Tu as quitté la partie.';
  document.getElementById('combat-result').textContent = '';
  document.getElementById('combat-actions').style.display = 'none';
};
  
// Affiche la page d'inscription au départ
window.showSignup();

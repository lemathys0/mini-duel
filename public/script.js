// Firebase config
const firebaseConfig = {
  apiKey: \"AIzaSyA-e19z8T3c1K46YmJY8s9EAbO9BRes7fA\",
  authDomain: \"mini-duel-de-cartes.firebaseapp.com\",
  databaseURL: \"https://mini-duel-de-cartes-default-rtdb.europe-west1.firebasedatabase.app\",
  projectId: \"mini-duel-de-cartes\",
  storageBucket: \"mini-duel-de-cartes.appspot.com\",
  messagingSenderId: \"1084207708579\",
  appId: \"1:1084207708579:web:f1312b68b7eb08f9d44216\"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

let currentUser = {};
let roomId = null;

function login() {
  const pseudo = document.getElementById('pseudo').value.trim();
  const code = document.getElementById('code').value.trim();
  const key = \\_\\;

  if (pseudo === '' || code.length !== 4) {
    document.getElementById('authMsg').innerText = 'Pseudo ou code invalide';
    return;
  }

  const userRef = db.ref('users/' + key);
  userRef.once('value').then(snapshot => {
    if (snapshot.exists()) {
      currentUser = snapshot.val();
      currentUser.key = key;
      startGame();
    } else {
      userRef.set({ pseudo, code, trophées: 100, pv: 100 }).then(() => {
        currentUser = { pseudo, code, trophées: 100, pv: 100, key };
        startGame();
      });
    }
  });
}

function startGame() {
  document.getElementById('auth').style.display = 'none';
  document.getElementById('game').style.display = 'block';
  document.getElementById('welcome').innerText = 'Bienvenue ' + currentUser.pseudo;
}

function createRoom() {
  const id = Math.random().toString(36).substring(2, 6);
  roomId = id;
  const ref = db.ref('rooms/' + id);
  ref.set({
    player1: currentUser.key,
    pv: { [currentUser.key]: 100 },
    actions: {}
  });
  listenToRoom();
}

function joinRoom() {
  const id = document.getElementById('roomInput').value.trim();
  if (!id) return;

  roomId = id;
  const ref = db.ref('rooms/' + id);
  ref.once('value').then(snapshot => {
    if (snapshot.exists() && !snapshot.val().player2) {
      ref.update({ player2: currentUser.key, pv: { ...snapshot.val().pv, [currentUser.key]: 100 } });
      listenToRoom();
    } else {
      document.getElementById('status').innerText = 'Room introuvable ou déjà pleine';
    }
  });
}

function listenToRoom() {
  const ref = db.ref('rooms/' + roomId);
  ref.on('value', snapshot => {
    const data = snapshot.val();
    if (!data) return;
    document.getElementById('status').innerText = 'Partie en cours...';
    if (data.player1 && data.player2) {
      document.getElementById('actions').style.display = 'block';
    }
    const actions = data.actions || {};
    if (actions[currentUser.key] && actions[data.player1 === currentUser.key ? data.player2 : data.player1]) {
      resolveRound(data);
    }
  });
}

function play(action) {
  const ref = db.ref('rooms/' + roomId + '/actions/' + currentUser.key);
  ref.set(action);
}

function resolveRound(data) {
  const [p1, p2] = [data.player1, data.player2];
  const a1 = data.actions[p1];
  const a2 = data.actions[p2];

  let pv1 = data.pv[p1];
  let pv2 = data.pv[p2];

  if (a1 === 'Attaque' && a2 !== 'Défense') pv2 -= 20;
  if (a2 === 'Attaque' && a1 !== 'Défense') pv1 -= 20;
  if (a1 === 'Soin') pv1 += 10;
  if (a2 === 'Soin') pv2 += 10;

  const newData = {
    actions: {},
    pv: { [p1]: pv1, [p2]: pv2 }
  };

  const result = \\ vs \ → \ PV / \ PV\;
  db.ref('rooms/' + roomId).update(newData);
  document.getElementById('resultat').innerText = result;

  if (pv1 <= 0 || pv2 <= 0) {
    const gagnant = pv1 <= 0 ? p2 : p1;
    const perdant = pv1 <= 0 ? p1 : p2;

    db.ref('users/' + gagnant + '/trophées').transaction(t => (t || 100) + 30);
    db.ref('users/' + perdant + '/trophées').transaction(t => Math.max((t || 100) - 20, 0));

    document.getElementById('resultat').innerText += \n\ a gagné !;
    db.ref('rooms/' + roomId).remove();
  }
}

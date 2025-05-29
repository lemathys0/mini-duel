// Import Firebase  
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";
import { getDatabase, ref, set, get, onValue, update, push, child, remove, onDisconnect, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-analytics.js";

// --- CONFIGURATION FIREBASE ---
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
const analytics = getAnalytics(app);
const db = getDatabase(app);

// --- VARIABLES GLOBALES ---
let currentUser = null; // { pseudo, code }
let currentMatch = null;
let hasPlayedThisTurn = false;
let timerInterval = null;
let timerMax = 30; // secondes  
let timerCount = timerMax;

// Variables pour gérer les timeouts/intervals de nettoyage des matchs  
let unsubscribeMatchCleanupListener = null;
let matchForfeitDeletionTimeout = null;
let currentMatchOnValueOffFunction = null;

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

// --- AUTHENTIFICATION ---

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
            // Créer utilisateur avec des stats initiales  
            set(userRef, { code, wins: 0, losses: 0 })
                .then(() => {
                    showMessage("auth-msg", "Inscription réussie", true);
                    currentUser = { pseudo, code };
                    afterLogin();
                });
        }
    }).catch(error => console.error("Error during signup:", error));
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
    }).catch(error => console.error("Error during login:", error));
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
                    p1: { pseudo: currentUser.pseudo, pv: 100, defending: false, status: 'connected' },
                    p2: null  
                },
                turn: "p1",
                actions: {},
                history: [],
                status: "waiting",
                createdAt: serverTimestamp()
            }).then(() => {
                showMessage("match-msg", "Match créé, en attente adversaire...", true);
                startMatch(matchId, true);
                unsubscribeMatchCleanupListener = onValue(matchRef, (matchSnapshot) => {
                    const matchData = matchSnapshot.val();
                    if (matchData && !matchData.players.p2 && matchData.createdAt) {
                        if (typeof matchData.createdAt === 'number') {
                            const timeElapsed = Date.now() - matchData.createdAt;
                            if (timeElapsed > 60000) {
                                console.log(`Match ${matchId} non rejoint après 1 minute, suppression.`);
                                remove(matchRef).then(() => {
                                    showMessage("match-msg", "Match expiré et supprimé car aucun adversaire n'a rejoint.", false);
                                    if (currentMatch === matchId) {
                                        backToMenu(true);
                                    }
                                }).catch(error => console.error("Error removing expired match:", error));
                                if (unsubscribeMatchCleanupListener) {
                                    unsubscribeMatchCleanupListener();
                                    unsubscribeMatchCleanupListener = null;
                                }
                            }
                        }
                    } else if (matchData && matchData.players.p2) {
                        console.log(`Match ${matchId} rejoint, nettoyage annulé.`);
                        if (unsubscribeMatchCleanupListener) {
                            unsubscribeMatchCleanupListener();
                            unsubscribeMatchCleanupListener = null;
                        }
                    } else if (!matchData) {
                        if (unsubscribeMatchCleanupListener) {
                            unsubscribeMatchCleanupListener();
                            unsubscribeMatchCleanupListener = null;
                        }
                    }
                });

            }).catch(error => console.error("Error creating match:", error));
        }
    }).catch(error => console.error("Error checking match existence:", error));
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
        update(child(matchRef, "players"), {
            p2: { pseudo: currentUser.pseudo, pv: 100, defending: false, status: 'connected' }
        }).then(() => {
            showMessage("match-msg", "Rejoint le match !", true);
            update(matchRef, { status: "playing" });
            startMatch(matchId, false);
        }).catch(error => console.error("Error joining match:", error));
    }).catch(error => console.error("Error getting match to join:", error));
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

    if (currentMatchOnValueOffFunction) {
        currentMatchOnValueOffFunction();
    }

    currentMatchOnValueOffFunction = onValue(matchRef, (snapshot) => {
        const data = snapshot.val();
        if (!data) {
            if (currentMatch === id) {
                showMessage("action-msg", "Le match a été terminé ou supprimé.");
                setTimeout(() => backToMenu(true), 3000);
            }
            if (currentMatchOnValueOffFunction) {
                currentMatchOnValueOffFunction();
                currentMatchOnValueOffFunction = null;
            }
            return;
        }

        const p1 = data.players.p1;
        const p2 = data.players.p2;

        if (!p1 || !p2) {
            document.getElementById("action-msg").textContent = "En attente de l'adversaire...";
            clearInterval(timerInterval);
            timerInterval = null;
            return;
        }

        const bothPlayersReady = (p1.status === 'connected' && p2.status === 'connected');

        if (!bothPlayersReady) {
            document.getElementById("action-msg").textContent = "En attente de l'adversaire pour commencer le duel...";
            clearInterval(timerInterval);
            timerInterval = null;
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
            document.getElementById("action-msg").textContent = "Tu n'es pas dans ce match.";
            disableActionButtons(true);
            clearInterval(timerInterval);
            timerInterval = null;
            return;
        }

        // GESTION DE L'ON DISCONNECT  
        const yourPlayerRef = ref(db, `matches/${id}/players/${youKey}`);
        onDisconnect(yourPlayerRef).update({
            pv: 0,
            status: 'disconnected',
            lastSeen: new Date().toISOString()
        }).catch(error => console.error("Error setting onDisconnect:", error));

        // Afficher PV  
        document.getElementById("you-pv").textContent = you.pv;
        document.getElementById("opponent-name").textContent = opponent.pseudo;
        document.getElementById("opponent-pv").textContent = opponent.pv;

        // Mise à jour des barres de vie visuelles  
        const youHealthBar = document.getElementById("you-health-bar");
        const opponentHealthBar = document.getElementById("opponent-health-bar");

        youHealthBar.style.width = `${you.pv}%`;
        opponentHealthBar.style.width = `${opponent.pv}%`;

        // Changer la couleur de la barre de vie si les PV sont bas  
        youHealthBar.style.backgroundColor = you.pv < 30 ? (you.pv < 10 ? "#ff0000" : "#ff7700") : "#00ff88";
        opponentHealthBar.style.backgroundColor = opponent.pv < 30 ? (opponent.pv < 10 ? "#ff0000" : "#ff7700") : "#ff4d6d";

        // Gestion du tour  
        if (data.turn !== youKey) {
            disableActionButtons(true);
            document.getElementById("action-msg").textContent = `Tour de ${opponent.pseudo}, patience...`;
            clearInterval(timerInterval);
            timerInterval = null;
            hasPlayedThisTurn = false;
        } else {
            if (hasPlayedThisTurn) {
                disableActionButtons(true);
                document.getElementById("action-msg").textContent = "Action jouée, en attente du tour adversaire...";
                clearInterval(timerInterval);
                timerInterval = null;
            } else {
                disableActionButtons(false);
                document.getElementById("action-msg").textContent = "C'est ton tour, choisis une action.";

                // Gestion d'un timer pour la durée du tour  
                timerCount = timerMax;
                timerInterval = setInterval(() => {
                    timerCount--;
                    if (timerCount <= 0) {
                        clearInterval(timerInterval);
                        document.getElementById("action-msg").textContent = "Temps écoulé, tour passé.";
                        passTurn(); // Implémentez cette fonction pour passer le tour  
                    }
                }, 1000);
            }
        }
    });
}

// --- AUTRES FONCTIONS ---

function passTurn() {
    const matchRef = ref(db, `matches/${currentMatch}`);
    const nextTurn = currentMatch.turn === "p1" ? "p2" : "p1";
    update(matchRef, { turn: nextTurn }).catch(error => console.error("Error passing turn:", error));
}

function backToMenu(showMessage = false) {
    // Réinitialiser l'état du jeu et retourner au menu  
    currentMatch = null;
    currentUser = null;
    document.getElementById("game").style.display = "none";
    document.getElementById("match").style.display = "block";
    document.getElementById("auth").style.display = "block";

    if (showMessage) {
        showMessage("auth-msg", "Retour au menu.");
    }
}
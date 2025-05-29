// Import Firebase (adapter selon ta config)
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";
import { getDatabase, ref, set, get, onValue, update, push, child, remove, onDisconnect } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js";
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

// --- AUTHENTIFICATION (simplifiée, sans sécurité réelle) ---

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
    });
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
    });
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
                    p1: { pseudo: currentUser.pseudo, pv: 100, defending: false },
                    p2: null // En attente du joueur 2
                },
                turn: "p1",
                actions: {},
                history: [],
                status: "waiting" // Nouveau champ pour gérer l'état du match
            }).then(() => {
                showMessage("match-msg", "Match créé, en attente adversaire...", true);
                startMatch(matchId, true);
            });
        }
    });
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
            p2: { pseudo: currentUser.pseudo, pv: 100, defending: false }
        }).then(() => {
            showMessage("match-msg", "Rejoint le match !", true);
            // Mettre à jour le statut du match une fois que le second joueur rejoint
            update(matchRef, { status: "playing" });
            startMatch(matchId, false);
        });
    });
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

    startTimer(); // Démarre ou réinitialise le timer

    // Listener onDisconnect pour le joueur actuel
    // Ceci est crucial pour la robustesse du jeu en cas de déconnexion inattendue
    onValue(matchRef, (snapshot) => {
        const data = snapshot.val();
        if (!data) {
            // Le match a été supprimé ou n'existe plus
            if (currentMatch === id) { // S'assurer que c'est bien le match en cours
                showMessage("action-msg", "Le match a été terminé ou supprimé par l'adversaire.");
                setTimeout(() => backToMenu(true), 3000); // Retourne au menu après un délai
            }
            return;
        }

        // Trouver joueur et adversaire
        const p1 = data.players.p1;
        const p2 = data.players.p2;

        if (!p1 || !p2) {
            document.getElementById("action-msg").textContent = "En attente de l'adversaire...";
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
            // Spectateur non géré ou problème
            document.getElementById("action-msg").textContent = "Tu n'es pas dans ce match.";
            disableActionButtons(true);
            clearInterval(timerInterval); // Arrête le timer
            timerInterval = null;
            return;
        }

        // --- GESTION DE L'ON DISCONNECT (ajouté ici pour s'assurer que youKey est bien défini) ---
        const yourPlayerRef = ref(db, `matches/${id}/players/${youKey}`);
        onDisconnect(yourPlayerRef).update({
            pv: 0, // Le joueur perd s'il se déconnecte
            status: 'disconnected', // Marquer comme déconnecté
            lastSeen: new Date().toISOString()
        }).catch(error => console.error("Error setting onDisconnect:", error));

        // Afficher PV
        document.getElementById("you-pv").textContent = you.pv;
        document.getElementById("opponent-name").textContent = opponent.pseudo;
        document.getElementById("opponent-pv").textContent = opponent.pv;

        // Gestion tour
        if (data.turn !== youKey) {
            disableActionButtons(true);
            document.getElementById("action-msg").textContent = `Tour de ${opponent.pseudo}, patience...`;
            // S'assurer que le timer ne tourne pas pour toi si ce n'est pas ton tour
            clearInterval(timerInterval);
            timerInterval = null;
        } else {
            if (hasPlayedThisTurn) {
                disableActionButtons(true);
                document.getElementById("action-msg").textContent = "Action jouée, en attente du tour suivant...";
                // Assurez-vous que le timer ne tourne pas si vous avez déjà joué
                clearInterval(timerInterval);
                timerInterval = null;
            } else {
                // Nouveau tour pour ce joueur
                // hasPlayedThisTurn = false; // Cette ligne est cruciale et doit être gérée si le tour est à nouveau à ce joueur
                disableActionButtons(false);
                document.getElementById("action-msg").textContent = "C'est ton tour, choisis une action.";
                resetTimer(); // Démarre ou réinitialise le timer
            }
        }

        // Historique
        const histEl = document.getElementById("history");
        histEl.innerHTML = "";
        (data.history || []).forEach(entry => {
            const p = document.createElement("p");
            p.textContent = entry;
            histEl.appendChild(p);
        });
        histEl.scrollTop = histEl.scrollHeight; // Scroll vers le bas pour voir le dernier message

        // Fin de partie
        if (you.pv <= 0 || opponent.pv <= 0 || data.status === 'finished') { // Vérifie aussi le statut du match
            disableActionButtons(true);
            clearInterval(timerInterval);
            timerInterval = null;

            // Annuler l'onDisconnect pour les joueurs qui terminent le match normalement
            if (currentUser && currentMatch) {
                const playerRefToCancel = ref(db, `matches/${currentMatch}/players/${youKey}`);
                onDisconnect(playerRefToCancel).cancel();
            }

            let yourResult = "draw";
            if (you.pv <= 0 && opponent.pv <= 0) {
                document.getElementById("action-msg").textContent = "Match nul !";
            } else if (you.pv <= 0) {
                document.getElementById("action-msg").textContent = "Tu as perdu...";
                yourResult = "loss";
            } else {
                document.getElementById("action-msg").textContent = "Tu as gagné !";
                yourResult = "win";
            }

            // Mise à jour des stats du joueur actuel
            const userStatsRef = ref(db, `users/${currentUser.pseudo}`);
            get(userStatsRef).then(snapshot => {
                if (snapshot.exists()) {
                    const userData = snapshot.val();
                    let newWins = userData.wins || 0;
                    let newLosses = userData.losses || 0;

                    if (yourResult === "win") newWins++;
                    else if (yourResult === "loss") newLosses++;

                    update(userStatsRef, {
                        wins: newWins,
                        losses: newLosses
                    });
                    console.log(`Stats updated for ${currentUser.pseudo}: Wins: ${newWins}, Losses: ${newLosses}`);
                }
            }).catch(error => console.error("Error updating user stats:", error));

            // Marquer le match comme terminé
            update(matchRef, { status: 'finished' }).catch(error => console.error("Error setting match status to finished:", error));
            // Optionnel : un bouton pour "Retour au menu" après la fin du match
        }
    }, (error) => {
        console.error("Error listening to match data:", error);
        // Gérer l'erreur, par exemple en retournant au menu
        showMessage("action-msg", "Erreur de connexion au match, retour au menu.");
        setTimeout(() => backToMenu(true), 3000);
    });
}

// --- ACTIONS ---

document.getElementById("attack-btn").onclick = () => doAction("attack");
document.getElementById("defend-btn").onclick = () => doAction("defend");
document.getElementById("heal-btn").onclick = () => doAction("heal");

function doAction(action) {
    if (hasPlayedThisTurn) return;

    const matchRef = ref(db, `matches/${currentMatch}`);

    get(matchRef).then(snapshot => {
        const data = snapshot.val();
        if (!data) return;

        let youKey = null;
        if (data.players.p1.pseudo === currentUser.pseudo) youKey = "p1";
        else if (data.players.p2 && data.players.p2.pseudo === currentUser.pseudo) youKey = "p2";

        if (!youKey || data.turn !== youKey) {
            showMessage("action-msg", "Ce n'est pas ton tour");
            return;
        }

        // Appliquer action
        const opponentKey = youKey === "p1" ? "p2" : "p1";
        const you = data.players[youKey];
        const opponent = data.players[opponentKey];

        if (!opponent) {
            showMessage("action-msg", "En attente de l'adversaire...");
            return;
        }

        let newYouPV = you.pv;
        let newOpponentPV = opponent.pv;
        let historyEntry = "";

        // Préparer nouvelle valeur players
        let newPlayers = { ...data.players };

        // Réinitialise toujours la défense du joueur actuel avant d'appliquer la nouvelle action
        newPlayers[youKey].defending = false;

        switch (action) {
            case "attack":
                // Dégâts de base entre 15 et 25
                let damage = Math.floor(Math.random() * 11) + 15;
                if (opponent.defending) {
                    damage = Math.floor(damage / 2); // Moitié des dégâts si l'adversaire défend
                    newPlayers[opponentKey].defending = false; // La défense de l'adversaire est consommée
                }
                newOpponentPV = Math.max(0, opponent.pv - damage);
                historyEntry = `${you.pseudo} attaque et inflige ${damage} dégâts à ${opponent.pseudo}.`;
                newPlayers[opponentKey].pv = newOpponentPV;
                break;

            case "defend":
                // Le joueur actuel se met en défense pour le prochain tour de l'adversaire
                newPlayers[youKey].defending = true;
                historyEntry = `${you.pseudo} se met en position défensive.`;
                break;

            case "heal":
                // Soin de base entre 10 et 20
                let healAmount = Math.floor(Math.random() * 11) + 10;
                newYouPV = Math.min(100, you.pv + healAmount);
                historyEntry = `${you.pseudo} se soigne et récupère ${healAmount} PV.`;
                newPlayers[youKey].pv = newYouPV;
                break;

            default:
                return;
        }

        // Changer tour
        const newTurn = opponentKey;

        // Ajouter historique
        const newHistory = data.history || [];
        newHistory.push(historyEntry);

        // Mise à jour Firebase
        update(matchRef, {
            players: newPlayers,
            turn: newTurn,
            history: newHistory
        });

        hasPlayedThisTurn = true;
        disableActionButtons(true);
        document.getElementById("action-msg").textContent = "Action envoyée, en attente du tour adversaire.";
        resetTimer(); // Réinitialise le timer pour le prochain joueur
    });
}

// --- TIMER ---

function startTimer() {
    resetTimer(); // Appelle resetTimer pour initialiser et lancer le timer
}

function resetTimer() {
    clearInterval(timerInterval); // Nettoie tout intervalle précédent
    timerCount = timerMax; // Réinitialise le compteur
    updateTimerUI(timerCount); // Met à jour l'affichage immédiatement

    timerInterval = setInterval(() => {
        timerCount--;
        updateTimerUI(timerCount);

        if (timerCount <= 0) {
            clearInterval(timerInterval);
            timerInterval = null;
            if (!hasPlayedThisTurn) {
                autoPassTurn(); // Passer le tour si le joueur n'a rien fait
            }
        }
    }, 1000);
}

function updateTimerUI(seconds) {
    document.getElementById("timer").textContent = seconds + "s";
    const progress = (seconds / timerMax) * 100;
    document.getElementById("timer-progress").style.width = progress + "%";
}

function autoPassTurn() {
    // Passe le tour si le joueur n'a rien fait
    const matchRef = ref(db, `matches/${currentMatch}`);

    get(matchRef).then(snapshot => {
        const data = snapshot.val();
        if (!data) return;

        let youKey = null;
        if (data.players.p1.pseudo === currentUser.pseudo) youKey = "p1";
        else if (data.players.p2 && data.players.p2.pseudo === currentUser.pseudo) youKey = "p2";

        if (!youKey || data.turn !== youKey) return; // Ce n'est pas ton tour ou tu n'es pas dans le match

        const opponentKey = youKey === "p1" ? "p2" : "p1";
        const newHistory = data.history || [];
        newHistory.push(`${currentUser.pseudo} n'a pas joué à temps, tour passé automatiquement.`);

        // Important : Réinitialise la défense du joueur qui a laissé le temps s'écouler
        let newPlayers = { ...data.players };
        newPlayers[youKey].defending = false;

        update(ref(db, `matches/${currentMatch}`), {
            players: newPlayers,
            turn: opponentKey,
            history: newHistory
        });

        hasPlayedThisTurn = true; // Pour éviter une double action si le onValue est lent
        disableActionButtons(true);
        document.getElementById("action-msg").textContent = "Temps écoulé, tour passé automatiquement.";
    }).catch(error => console.error("Error in autoPassTurn:", error));
}

document.getElementById("back-to-menu-btn").onclick = () => backToMenu(false);

function backToMenu(matchEndedUnexpectedly = false) {
    if (currentMatch && currentUser) {
        // Annuler l'onDisconnect mis en place pour ce match
        const matchRef = ref(db, `matches/${currentMatch}`);
        get(matchRef).then(snapshot => {
            const data = snapshot.val();
            if (data) {
                let youKey = null;
                if (data.players.p1 && data.players.p1.pseudo === currentUser.pseudo) youKey = "p1";
                else if (data.players.p2 && data.players.p2.pseudo === currentUser.pseudo) youKey = "p2";

                if (youKey) {
                    const yourPlayerRef = ref(db, `matches/${currentMatch}/players/${youKey}`);
                    onDisconnect(yourPlayerRef).cancel(); // Annule l'action onDisconnect
                    // Optionnel : marquer le joueur comme 'online' mais 'not-in-match'
                    update(yourPlayerRef, { status: 'available' }).catch(e => console.error("Failed to update status on menu back:", e));
                }
            }

            // Si le match n'était pas déjà marqué comme 'finished' et que tu le quittes (pas une fin normale)
            if (!matchEndedUnexpectedly && data && data.status !== 'finished') {
                // Notifier l'adversaire que tu as quitté
                const opponentKey = youKey === "p1" ? "p2" : "p1";
                const opponentPlayerRef = ref(db, `matches/${currentMatch}/players/${opponentKey}`);
                if (data.players[opponentKey]) { // S'assurer que l'adversaire existe
                    const newHistory = data.history || [];
                    newHistory.push(`${currentUser.pseudo} a quitté le match.`);
                    update(matchRef, {
                        history: newHistory,
                        status: 'forfeited', // Marquer le match comme 'forfeited'
                        turn: opponentKey // Optionnel : donner la victoire à l'adversaire en changeant son tour
                    });
                }
            }
        }).catch(error => console.error("Error getting match data for backToMenu:", error));
    }

    // Nettoyer les variables globales et l'interface
    currentMatch = null;
    clearInterval(timerInterval);
    timerInterval = null;
    hasPlayedThisTurn = false;

    // Réinitialiser l'interface
    document.getElementById("game").style.display = "none";
    document.getElementById("match").style.display = "block";
    document.getElementById("match-id").value = "";
    document.getElementById("match-msg").textContent = "";
    document.getElementById("action-msg").textContent = ""; // Nettoyer le message d'action
}
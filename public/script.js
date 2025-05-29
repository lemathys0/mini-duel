// Import Firebase (adapter selon ta config)
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

// NOUVEAU: Variables pour gérer les timeouts de nettoyage des matchs
let creatorMatchCleanupInterval = null;
let matchForfeitDeletionTimeout = null;

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
            // Ajout de 'status: connected' pour le p1 et 'createdAt'
            set(matchRef, {
                players: {
                    p1: { pseudo: currentUser.pseudo, pv: 100, defending: false, status: 'connected' },
                    p2: null
                },
                turn: "p1",
                actions: {},
                history: [],
                status: "waiting",
                createdAt: serverTimestamp() // Utilisation de serverTimestamp() pour la précision
            }).then(() => {
                showMessage("match-msg", "Match créé, en attente adversaire...", true);
                startMatch(matchId, true);

                // NOUVEAU: Démarrer un timer pour nettoyer le match si personne ne rejoint après 1 minute
                // On utilise un onValue pour être sûr que createdAt est bien synchronisé
                onValue(matchRef, (matchSnapshot) => {
                    const matchData = matchSnapshot.val();
                    if (matchData && !matchData.players.p2 && matchData.createdAt) {
                        const timeElapsed = Date.now() - matchData.createdAt; // Comparaison avec Date.now() après synchronisation
                        if (timeElapsed > 60000) { // 60 secondes
                            console.log(`Match ${matchId} non rejoint après 1 minute, suppression.`);
                            remove(matchRef) // Supprime le match
                                .then(() => {
                                    showMessage("match-msg", "Match expiré et supprimé car aucun adversaire n'a rejoint.", false);
                                    // Assure-toi que la suppression ne relance pas backToMenu si déjà en cours
                                    if (currentMatch === matchId) {
                                        backToMenu(true);
                                    }
                                })
                                .catch(error => console.error("Error removing expired match:", error));
                            // Arrête l'écoute et le timer si le match est supprimé ou rejoint
                            matchSnapshot.ref.off();
                        }
                    } else if (matchData && matchData.players.p2) {
                        // Adversaire a rejoint, arrêter l'écoute pour ce timer de nettoyage
                        matchSnapshot.ref.off();
                        console.log(`Match ${matchId} rejoint, nettoyage annulé.`);
                    } else if (!matchData) {
                        // Match déjà supprimé
                        matchSnapshot.ref.off();
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
        // Ajout de 'status: connected' pour le p2
        update(child(matchRef, "players"), {
            p2: { pseudo: currentUser.pseudo, pv: 100, defending: false, status: 'connected' }
        }).then(() => {
            showMessage("match-msg", "Rejoint le match !", true);
            // Mettre à jour le statut du match une fois que le second joueur rejoint
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

    // Listener onDisconnect pour le joueur actuel
    onValue(matchRef, (snapshot) => {
        const data = snapshot.val();
        if (!data) {
            // Le match a été supprimé ou n'existe plus
            if (currentMatch === id) { // S'assurer que c'est bien le match en cours
                showMessage("action-msg", "Le match a été terminé ou supprimé.");
                setTimeout(() => backToMenu(true), 3000); // Retourne au menu après un délai
            }
            return;
        }

        // Trouver joueur et adversaire
        const p1 = data.players.p1;
        const p2 = data.players.p2;

        if (!p1 || !p2) {
            document.getElementById("action-msg").textContent = "En attente de l'adversaire...";
            // S'assurer que le timer est bien arrêté tant qu'il manque un joueur
            clearInterval(timerInterval);
            timerInterval = null;
            return; // Ne pas continuer tant que p2 n'est pas là
        }

        // NOUVEAU: Vérifier le statut de connexion des deux joueurs
        const bothPlayersReady = (p1.status === 'connected' && p2.status === 'connected');

        if (!bothPlayersReady) {
            document.getElementById("action-msg").textContent = "En attente de l'adversaire pour commencer le duel...";
            clearInterval(timerInterval);
            timerInterval = null;
            return; // Attendre que les deux joueurs soient marqués comme 'connected'
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

        // GESTION DE L'ON DISCONNECT (ajouté ici pour s'assurer que youKey est bien défini)
        // Ceci est important pour marquer le joueur comme déconnecté si le navigateur est fermé
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

        // Mise à jour des barres de vie visuelles
        const youHealthBar = document.getElementById("you-health-bar");
        const opponentHealthBar = document.getElementById("opponent-health-bar");

        youHealthBar.style.width = `${you.pv}%`;
        opponentHealthBar.style.width = `${opponent.pv}%`;

        // Changer la couleur de la barre de vie si les PV sont bas
        if (you.pv < 30) {
            youHealthBar.style.backgroundColor = "#ff7700"; // Orange
        } else if (you.pv < 10) {
            youHealthBar.style.backgroundColor = "#ff0000"; // Rouge
        } else {
            youHealthBar.style.backgroundColor = "#00ff88"; // Vert par défaut
        }

        if (opponent.pv < 30) {
            opponentHealthBar.style.backgroundColor = "#ff7700";
        } else if (opponent.pv < 10) {
            opponentHealthBar.style.backgroundColor = "#ff0000";
        } else {
            opponentHealthBar.style.backgroundColor = "#ff4d6d"; // Rouge par défaut pour l'adversaire
        }


        // Gestion tour
        if (data.turn !== youKey) {
            disableActionButtons(true);
            document.getElementById("action-msg").textContent = `Tour de ${opponent.pseudo}, patience...`;
            clearInterval(timerInterval);
            timerInterval = null;
            // CORRECTION BUG TOURS BLOQUÉS: Réinitialise hasPlayedThisTurn pour le prochain tour du joueur
            hasPlayedThisTurn = false;
        } else {
            // C'est ton tour
            if (hasPlayedThisTurn) { // Si tu as déjà joué ce tour
                disableActionButtons(true);
                document.getElementById("action-msg").textContent = "Action jouée, en attente du tour adversaire.";
                clearInterval(timerInterval);
                timerInterval = null;
            } else { // C'est ton tour et tu n'as pas encore joué
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
        // Vérifie aussi si l'adversaire s'est déconnecté (status: 'disconnected' ou 'forfeited')
        const opponentDisconnected = (opponent.status === 'disconnected' || opponent.status === 'forfeited');

        if (you.pv <= 0 || opponent.pv <= 0 || data.status === 'finished' || data.status === 'forfeited' || opponentDisconnected) {
            disableActionButtons(true);
            clearInterval(timerInterval);
            timerInterval = null;

            // Annuler l'onDisconnect pour les joueurs qui terminent le match normalement
            if (currentUser && currentMatch) {
                const playerRefToCancel = ref(db, `matches/${currentMatch}/players/${youKey}`);
                onDisconnect(playerRefToCancel).cancel();
            }

            let yourResult = "draw";
            let finalMessage = "";

            if (you.pv <= 0 && opponent.pv <= 0) {
                finalMessage = "Match nul !";
            } else if (you.pv <= 0) {
                finalMessage = "Tu as perdu...";
                yourResult = "loss";
            } else { // you.pv > 0
                finalMessage = "Tu as gagné !";
                yourResult = "win";
            }

            // Si l'adversaire s'est déconnecté/a fait forfait, ajuster le message et la victoire
            if (opponentDisconnected && you.pv > 0) { // Si tu es toujours en vie et l'adversaire a quitté
                 finalMessage = "Ton adversaire a quitté le match. Tu as gagné par forfait !";
                 yourResult = "win";
            } else if (opponentDisconnected && you.pv <= 0) { // Si tu es mort et l'adversaire a quitté
                finalMessage = "Ton adversaire a quitté le match, mais tu as perdu tes PV.";
                yourResult = "loss"; // Ou "draw" si c'est simultané
            }


            document.getElementById("action-msg").textContent = finalMessage;

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

            // NOUVEAU: Démarrer un timer pour la suppression du match et le retour au menu
            if (!matchForfeitDeletionTimeout) { // Pour éviter de créer plusieurs timeouts
                document.getElementById("action-msg").textContent += " Retour au menu dans 10 secondes...";
                matchForfeitDeletionTimeout = setTimeout(() => {
                    console.log(`Match ${id} terminé/forfait, suppression.`);
                    remove(matchRef)
                        .then(() => {
                            console.log(`Match ${id} supprimé.`);
                            backToMenu(true); // Renvoie au menu après suppression
                        })
                        .catch(error => console.error("Error removing finished match:", error));
                    matchForfeitDeletionTimeout = null; // Réinitialise la variable du timeout
                }, 10000); // 10 secondes avant la suppression
            }
        }
    }, (error) => {
        console.error("Error listening to match data:", error);
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

                // Animation de dégâts
                const opponentPVEl = document.getElementById("opponent-pv");
                if (opponentPVEl) {
                    opponentPVEl.classList.add('damage-effect');
                    setTimeout(() => {
                        opponentPVEl.classList.remove('damage-effect');
                    }, 500);
                }
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

                // Animation de soin
                const youPVEl = document.getElementById("you-pv");
                if (youPVEl) {
                    youPVEl.classList.add('heal-effect');
                    setTimeout(() => {
                        youPVEl.classList.remove('heal-effect');
                    }, 1000);
                }
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
    }).catch(error => console.error("Error performing action:", error));
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
    // NOUVEAU: Nettoie les intervalles/timeouts de nettoyage de match
    if (creatorMatchCleanupInterval) {
        clearInterval(creatorMatchCleanupInterval);
        creatorMatchCleanupInterval = null;
    }
    if (matchForfeitDeletionTimeout) {
        clearTimeout(matchForfeitDeletionTimeout);
        matchForfeitDeletionTimeout = null;
    }

    if (currentMatch && currentUser) {
        const matchRef = ref(db, `matches/${currentMatch}`);
        get(matchRef).then(snapshot => {
            const data = snapshot.val();
            if (data) {
                let youKey = null;
                if (data.players.p1 && data.players.p1.pseudo === currentUser.pseudo) youKey = "p1";
                else if (data.players.p2 && data.players.p2.pseudo === currentUser.pseudo) youKey = "p2";

                if (youKey) {
                    const yourPlayerRef = ref(db, `matches/${currentMatch}/players/${youKey}`);
                    // Annuler l'onDisconnect mis en place pour ce match
                    yourPlayerRef.onDisconnect().cancel().catch(e => console.error("Failed to cancel onDisconnect:", e));

                    // Si le match n'était pas déjà marqué comme 'finished' ou 'forfeited' et que tu le quittes (pas une fin normale)
                    if (!matchEndedUnexpectedly && data.status !== 'finished' && data.status !== 'forfeited') {
                        // Marquer le joueur comme déconnecté/forfait
                        update(yourPlayerRef, { status: 'forfeited', pv: 0 })
                            .then(() => {
                                console.log(`${currentUser.pseudo} a quitté le match par le bouton. Marqué comme forfait.`);
                                // Notifier l'adversaire via l'historique
                                const opponentKey = youKey === "p1" ? "p2" : "p1";
                                if (data.players[opponentKey]) { // S'assurer que l'adversaire existe
                                    const newHistory = data.history || [];
                                    newHistory.push(`${currentUser.pseudo} a quitté le match. ${data.players[opponentKey].pseudo} gagne par forfait.`);
                                    update(matchRef, {
                                        history: newHistory,
                                        status: 'forfeited', // Marquer le match comme 'forfeited'
                                        turn: opponentKey // Donner la victoire à l'adversaire
                                    }).catch(error => console.error("Error updating match on explicit forfeit:", error));
                                }
                            })
                            .catch(e => console.error("Failed to update player status on backToMenu:", e));
                    }
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
// main.js

console.log("main.js chargé."); // DEBUG : Confirme le chargement de main.js

import { app } from "./firebaseConfig.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js";
import { db } from "./firebaseConfig.js";
import { ref, push, set, onValue, update, remove, serverTimestamp, get } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js";
import { startMatchMonitoring } from "./game.js";
import { showMessage, updateHealthBar, updateTimerUI, clearHistory, disableActionButtons } from "./utils.js";

const auth = getAuth(app);

// Variables globales pour le match
export let currentUser = null;
export let currentMatchId = null;
export let youKey = null; // 'p1' or 'p2'
export let opponentKey = null; // 'p1' or 'p2'
export let gameMode = null; // 'PvAI' or 'PvP'

// Variables de contrôle du timer et de déconnexion
export const timerMax = 30; // 30 secondes par tour
export let timerInterval = null;
export function setTimerInterval(interval) { timerInterval = interval; } // Cette fonction est utilisée par game.js

export let onDisconnectRef = null;
export function setOnDisconnectRef(ref) { onDisconnectRef = ref; }

export let matchDeletionTimeout = null;
export function setMatchDeletionTimeout(timeout) { matchDeletionTimeout = timeout; }

export let hasPlayedThisTurn = false;
export function setHasPlayedThisTurn(bool) { hasPlayedThisTurn = bool; }

// Permet à game.js de mettre à jour les variables globales du match
export function setMatchVariables(id, user, playerKey, mode) {
    currentMatchId = id;
    currentUser = user;
    youKey = playerKey;
    opponentKey = (playerKey === 'p1') ? 'p2' : 'p1';
    gameMode = mode;
    console.log(`Match variables set: ID=${currentMatchId}, YouKey=${youKey}, OpponentKey=${opponentKey}, Mode=${gameMode}`);
}


// --- GESTION DES MODES DE JEU ET AUTHENTIFICATION ---

// Fonction pour configurer les écouteurs de sélection de mode de jeu
function setupGameModeSelection() {
    document.getElementById("start-ai-game-btn").addEventListener("click", () => {
        if (currentUser) {
            console.log("Clic sur 'Jouer contre l'IA'.");
            createMatch('PvAI');
        } else {
            showMessage("auth-msg", "Veuillez vous connecter pour démarrer un match IA.");
        }
    });

    document.getElementById("start-pvp-game-btn").addEventListener("click", () => {
        if (currentUser) {
            console.log("Clic sur 'Rejoindre un match PvP'.");
            findOrCreatePvPMatch();
        } else {
            showMessage("auth-msg", "Veuillez vous connecter pour démarrer un match PvP.");
        }
    });

    document.getElementById("cancel-matchmaking-btn").addEventListener("click", () => {
        console.log("Clic sur 'Annuler la recherche'.");
        backToMenu(true);
        showMessage("match-msg", "Recherche de match annulée.");
    });
}


// Fonction d'authentification anonyme
async function authenticateAnonymously() {
    try {
        const userCredential = await signInAnonymously(auth);
        currentUser = userCredential.user;
        console.log("Authenticated anonymously:", currentUser.uid);

        const userRef = ref(db, `users/${currentUser.uid}`);
        const snapshot = await get(userRef);
        const userData = snapshot.val();

        if (userData && userData.pseudo) {
            currentUser.pseudo = userData.pseudo;
        } else {
            currentUser.pseudo = `Joueur_${Math.floor(Math.random() * 10000)}`;
            await set(userRef, { pseudo: currentUser.pseudo, wins: 0, losses: 0, draws: 0 });
        }
        document.getElementById("pseudo-display").textContent = `Connecté en tant que : ${currentUser.pseudo}`;
        document.getElementById("player-name").textContent = currentUser.pseudo;
        document.getElementById("auth-msg").textContent = "Connecté. Choisissez un mode de jeu.";
        document.getElementById("main-menu").style.display = "block";
        document.getElementById("auth").style.display = "none";
        setupGameModeSelection();
        setupLogoutButton();
    } catch (error) {
        console.error("Authentication error:", error);
        showMessage("auth-msg", "Échec de l'authentification. Veuillez réessayer.");
    }
}

// Configure le bouton de déconnexion
function setupLogoutButton() {
    document.getElementById("logout-btn").addEventListener("click", async () => {
        if (currentUser) {
            try {
                await signOut(auth);
                currentUser = null;
                console.log("Utilisateur déconnecté.");
                document.getElementById("pseudo-display").textContent = "Non connecté";
                document.getElementById("player-name").textContent = "";
                document.getElementById("auth-msg").textContent = "Déconnecté.";
                document.getElementById("main-menu").style.display = "none";
                document.getElementById("auth").style.display = "block";
            } catch (error) {
                console.error("Error signing out:", error);
                showMessage("auth-msg", "Erreur lors de la déconnexion.");
            }
        }
    });
}


// Vérifie l'état de l'authentification au chargement de la page
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        const userRef = ref(db, `users/${currentUser.uid}`);
        const snapshot = await get(userRef);
        const userData = snapshot.val();

        if (userData && userData.pseudo) {
            currentUser.pseudo = userData.pseudo;
        } else {
            currentUser.pseudo = `Joueur_${Math.floor(Math.random() * 10000)}`;
            await set(userRef, { pseudo: currentUser.pseudo, wins: 0, losses: 0, draws: 0 });
        }
        document.getElementById("pseudo-display").textContent = `Connecté en tant que : ${currentUser.pseudo}`;
        document.getElementById("player-name").textContent = currentUser.pseudo;
        document.getElementById("auth-msg").textContent = "Connecté. Choisissez un mode de jeu.";
        document.getElementById("main-menu").style.display = "block";
        document.getElementById("auth").style.display = "none";
        setupGameModeSelection();
        setupLogoutButton();
    } else {
        currentUser = null;
        document.getElementById("pseudo-display").textContent = "Non connecté";
        document.getElementById("player-name").textContent = "";
        document.getElementById("auth-msg").textContent = "Veuillez vous connecter.";
        document.getElementById("main-menu").style.display = "none";
        document.getElementById("auth").style.display = "block";
        document.getElementById("login-btn").addEventListener("click", authenticateAnonymously);
    }
});


// --- LOGIQUE DE CRÉATION/RECHERCHE DE MATCH ---

// Fonction pour créer un match (PvAI ou PvP)
async function createMatch(mode) {
    if (!currentUser || !currentUser.pseudo) {
        showMessage("match-msg", "Erreur: Pseudo non défini. Veuillez vous reconnecter.");
        return;
    }

    const pseudo = currentUser.pseudo;
    const newMatchRef = push(ref(db, 'matches'));
    const newMatchId = newMatchRef.key;

    const initialData = {
        createdAt: serverTimestamp(),
        status: mode === 'PvP' ? 'waiting' : 'playing',
        turn: 'p1',
        mode: mode,
        players: {
            p1: {
                pseudo: pseudo,
                pv: 100,
                status: 'connected',
                lastSeen: serverTimestamp(),
                action: null,
                lastAction: null,
                healCooldown: 0,
            }
        },
        history: [`Match ${mode === 'PvP' ? 'PvP' : 'IA'} créé par ${pseudo}. ${mode === 'PvP' ? 'En attente d\'un adversaire...' : 'Le duel contre l\'IA commence !'}`],
        lastTurnProcessedAt: serverTimestamp(),
        turnStartTime: serverTimestamp() // Ajout du timestamp de début de tour
    };

    if (mode === 'PvAI') {
        initialData.players.p2 = {
            pseudo: 'IA',
            pv: 100,
            status: 'connected',
            lastSeen: serverTimestamp(),
            action: null,
            lastAction: null,
            healCooldown: 0,
        };
    }

    try {
        await set(newMatchRef, initialData);
        if (mode === 'PvP') {
            showMessage("match-msg", `Match PvP créé. ID: ${newMatchId}. En attente d'un adversaire...`);
            document.getElementById("main-menu").style.display = "none";
            document.getElementById("matchmaking-status").style.display = "block";
            document.getElementById("matchmaking-message").textContent = `Recherche un adversaire pour le match ${newMatchId}...`;

            startMatchMonitoring(newMatchId, currentUser, 'p1', mode);
        } else {
            console.log(`Lancement de startMatchMonitoring pour PvAI avec ID: ${newMatchId}`);
            startMatchMonitoring(newMatchId, currentUser, 'p1', mode);
        }
    } catch (error) {
        console.error("Error creating match:", error);
        showMessage("match-msg", "Erreur lors de la création du match.");
    }
}

let pvpMatchFinderUnsubscribe = null;

async function findOrCreatePvPMatch() {
    showMessage("match-msg", "Recherche de matchs PvP disponibles...");
    document.getElementById("main-menu").style.display = "none";
    document.getElementById("matchmaking-status").style.display = "block";
    document.getElementById("matchmaking-message").textContent = "Recherche un adversaire...";

    const matchesRef = ref(db, 'matches');
    let foundAndJoinedMatch = false;

    if (pvpMatchFinderUnsubscribe) {
        pvpMatchFinderUnsubscribe();
        pvpMatchFinderUnsubscribe = null;
    }

    pvpMatchFinderUnsubscribe = onValue(matchesRef, async (snapshot) => {
        const matchesData = snapshot.val();

        if (foundAndJoinedMatch) {
            return;
        }

        let matchFound = false;
        for (const matchId in matchesData) {
            const match = matchesData[matchId];
            if (match.status === 'waiting' && match.mode === 'PvP' && match.players && match.players.p1 && !match.players.p2) {
                if (match.players.p1.pseudo !== currentUser.pseudo) {
                    foundAndJoinedMatch = true;
                    matchFound = true;
                    try {
                        const updates = {};
                        updates[`matches/${matchId}/players/p2`] = {
                            pseudo: currentUser.pseudo,
                            pv: 100,
                            status: 'connected',
                            lastSeen: serverTimestamp(),
                            action: null,
                            lastAction: null,
                            healCooldown: 0,
                        };
                        updates[`matches/${matchId}/status`] = 'playing';
                        updates[`matches/${matchId}/history`] = [...(match.history || []), `${currentUser.pseudo} a rejoint le match ! Le duel commence !`];
                        updates[`matches/${matchId}/turnStartTime`] = serverTimestamp(); // IMPORTANT : Démarrer le chrono pour les deux !

                        await update(ref(db), updates);
                        showMessage("match-msg", `Vous avez rejoint le match ${matchId} !`);
                        document.getElementById("matchmaking-status").style.display = "none";
                        console.log(`Lancement de startMatchMonitoring pour PvP (joueur 2) avec ID: ${matchId}`);
                        startMatchMonitoring(matchId, currentUser, 'p2', 'PvP');

                        if (pvpMatchFinderUnsubscribe) {
                            pvpMatchFinderUnsubscribe();
                            pvpMatchFinderUnsubscribe = null;
                        }
                        return;
                    } catch (error) {
                        console.error("Error joining match:", error);
                        showMessage("match-msg", "Erreur lors de la tentative de rejoindre un match.");
                        foundAndJoinedMatch = false;
                        matchFound = false;
                    }
                }
            }
        }

        if (!matchFound && !foundAndJoinedMatch && !currentMatchId) {
            showMessage("match-msg", "Aucun match disponible. Création d'un nouveau match PvP...");
            document.getElementById("matchmaking-message").textContent = "Aucun match disponible. Création d'un nouveau match...";
            createMatch('PvP');
            foundAndJoinedMatch = true;

            if (pvpMatchFinderUnsubscribe) {
                pvpMatchFinderUnsubscribe();
                pvpMatchFinderUnsubscribe = null;
            }
        }
    }, (error) => {
        console.error("Error listening for matches:", error);
        showMessage("match-msg", "Erreur lors de la recherche de matchs.");
    });
}


// --- GESTION DE LA FIN DE MATCH ET DU RETOUR AU MENU ---

export function backToMenu(fromGame = false) { // <-- Ajout de 'export' ici
    console.log("Retour au menu demandé. From game:", fromGame);
    if (fromGame) {
        document.getElementById("game").style.display = "none";
        document.getElementById("main-menu").style.display = "block";
        document.getElementById("matchmaking-status").style.display = "none";
        showMessage("match-msg", "");
        showMessage("action-msg", "");
        document.getElementById("matchmaking-message").textContent = "";

        currentMatchId = null;
        youKey = null;
        opponentKey = null;
        gameMode = null;

        if (timerInterval) { clearInterval(timerInterval); setTimerInterval(null); }
        if (onDisconnectRef) { onDisconnectRef.cancel().catch(err => console.error("Error cancelling old onDisconnect:", err)); setOnDisconnectRef(null); }
        if (matchDeletionTimeout) { clearTimeout(matchDeletionTimeout); setMatchDeletionTimeout(null); }
        setHasPlayedThisTurn(false);

        if (pvpMatchFinderUnsubscribe) {
            pvpMatchFinderUnsubscribe();
            pvpMatchFinderUnsubscribe = null;
        }

    } else {
        document.getElementById("main-menu").style.display = "block";
        document.getElementById("auth").style.display = "none";
        document.getElementById("matchmaking-status").style.display = "none";
        showMessage("match-msg", "");
    }
}

// Mise à jour des statistiques de l'utilisateur
export async function updateUserStats(result) {
    if (!currentUser || !currentUser.uid) return;

    const userStatsRef = ref(db, `users/${currentUser.uid}`);
    const snapshot = await get(userStatsRef);
    const currentStats = snapshot.val() || { wins: 0, losses: 0, draws: 0 };

    let updates = { ...currentStats };

    if (result === 'win') {
        updates.wins = (updates.wins || 0) + 1;
    } else if (result === 'loss') {
        updates.losses = (updates.losses || 0) + 1;
    } else if (result === 'draw') {
        updates.draws = (updates.draws || 0) + 1;
    }

    try {
        await update(userStatsRef, updates);
        console.log("User stats updated:", updates);
    } catch (error) {
        console.error("Error updating user stats:", error);
    }
}
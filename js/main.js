import { setupAuthListeners } from "./auth.js";
import { setupMatchListeners } from "./match.js";
import { startMatchMonitoring, performAction, handleGameEnd } from "./game.js";
import { showMessage, disableActionButtons } from "./utils.js";
import { db } from "./firebaseConfig.js"; // Pour updateUserStats
import { ref, get, update } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js";

// --- VARIABLES GLOBALES PARTAGÉES ---
export let currentUser = null; // { pseudo, code }
export let currentMatchId = null;
export let hasPlayedThisTurn = false; // Gérée par game.js, mais exposée
export let timerInterval = null; // Gérée par game.js, mais exposée
export const timerMax = 20; // secondes
export let youKey = null; // 'p1' or 'p2'
export let opponentKey = null; // 'p1' or 'p2'
export let gameMode = 'PvP'; // 'PvP' ou 'PvAI'
export let onDisconnectRef = null;
export let matchDeletionTimeout = null;

// Fonctions pour mettre à jour les variables globales (pour éviter les importations mutuelles directes)
export function setMatchVariables(id, user, playerKey, mode) {
    currentMatchId = id;
    currentUser = user; // S'assurer que currentUser est bien défini partout
    youKey = playerKey;
    opponentKey = (playerKey === 'p1') ? 'p2' : 'p1';
    gameMode = mode;
    hasPlayedThisTurn = false; // Réinitialiser ici aussi au début de chaque match
}

export function setHasPlayedThisTurn(value) {
    hasPlayedThisTurn = value;
}

export function setTimerInterval(interval) {
    timerInterval = interval;
}

export function setOnDisconnectRef(ref) {
    onDisconnectRef = ref;
}

export function setMatchDeletionTimeout(timeout) {
    matchDeletionTimeout = timeout;
}

// --- FONCTIONS DE COORDINATION ---

export function afterLogin(user) {
    currentUser = user;
    document.getElementById("auth").style.display = "none";
    document.getElementById("match").style.display = "block";
    document.getElementById("player-name").textContent = currentUser.pseudo;
    showMessage("auth-msg", "");
    document.getElementById("pseudo").value = "";
    document.getElementById("code").value = "";
    setupMatchListeners(currentUser); // Initialise les listeners de match après connexion
}

export function startGame(matchId, user, playerKey, mode) {
    document.getElementById("match").style.display = "none";
    document.getElementById("game").style.display = "block";
    startMatchMonitoring(matchId, user, playerKey, mode); // Lance la surveillance du match
}

export function backToMenu(force = false) {
    // Logique de nettoyage et de gestion du forfait (déplacée ici pour centralisation)
    if (currentMatchId && currentUser && !force && gameMode === 'PvP') {
        const matchRef = ref(db, `matches/${currentMatchId}`);
        get(matchRef).then(snapshot => {
            const matchData = snapshot.val();
            if (matchData && matchData.status === 'playing') {
                let quitterKey = null;
                let opponentKeyForForfeit = null;

                if (matchData.players.p1 && matchData.players.p1.pseudo === currentUser.pseudo) {
                    quitterKey = "p1"; opponentKeyForForfeit = "p2";
                } else if (matchData.players.p2 && matchData.players.p2.pseudo === currentUser.pseudo) {
                    quitterKey = "p2"; opponentKeyForForfeit = "p1";
                }

                if (quitterKey && matchData.players[opponentKeyForForfeit] && matchData.players[opponentKeyForForfeit].status === 'connected') {
                    const updates = {};
                    updates[`players/${quitterKey}/pv`] = 0;
                    updates[`players/${quitterKey}/status`] = 'forfeited';
                    updates.status = 'forfeited';
                    updates.winner = opponentKeyForForfeit;
                    updates.history = [...(matchData.history || [])];
                    updates.history.push(`${currentUser.pseudo} a quitté le match. ${matchData.players[opponentKeyForForfeit].pseudo} gagne par forfait.`);

                    update(matchRef, updates)
                        .then(() => console.log(`${currentUser.pseudo} left and forfeited match ${currentMatchId}`))
                        .catch(err => console.error("Error updating match on forfeit:", err));
                }
            }
        }).catch(err => console.error("Error getting match for backToMenu forfeit:", err));
    }

    // Réinitialisation des variables globales
    currentMatchId = null;
    hasPlayedThisTurn = false;
    youKey = null;
    opponentKey = null;
    gameMode = 'PvP'; // Default mode

    // Nettoyage des UI
    showMessage("action-msg", "");
    showMessage("match-msg", "");
    document.getElementById("opponent-action-status").textContent = "";
    disableActionButtons(true); // Ensure buttons are disabled when returning to menu

    // Changement d'écran
    document.getElementById("game").style.display = "none";
    document.getElementById("match").style.display = "block";
    document.getElementById("match-id").value = "";

    // Nettoyage des timers et listeners résiduels (important!)
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    if (onDisconnectRef) { onDisconnectRef.cancel().catch(e => console.error("Error canceling onDisconnect on backToMenu:", e)); onDisconnectRef = null; }
    if (matchDeletionTimeout) { clearTimeout(matchDeletionTimeout); matchDeletionTimeout = null; }
    // Ajoutez d'autres nettoyages de listeners si nécessaire
}

// --- MISE À JOUR DES STATISTIQUES UTILISATEUR ---
export async function updateUserStats(result) {
    if (!currentUser || !currentUser.pseudo) return;

    const userStatsRef = ref(db, `users/${currentUser.pseudo}`);
    try {
        const snapshot = await get(userStatsRef);
        if (snapshot.exists()) {
            let { wins, losses } = snapshot.val();
            wins = wins || 0;
            losses = losses || 0;

            if (result === 'win') {
                wins++;
            } else if (result === 'loss') {
                losses++;
            }
            await update(userStatsRef, { wins, losses });
            console.log(`Stats for <span class="math-inline">\{currentUser\.pseudo\} updated\: Wins\=</span>{wins}, Losses=${losses}`);
        }
    } catch (error) {
        console.error("Error updating user stats:", error);
    }
}

// --- INITIALISATION AU CHARGEMENT DE LA PAGE ---
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById("auth").style.display = "block";
    setupAuthListeners(); // Initialise les listeners d'authentification au démarrage
    document.getElementById("attack-btn").onclick = () => performAction('attack');
    document.getElementById("defend-btn").onclick = () => performAction('defend');
    document.getElementById("heal-btn").onclick = () => performAction('heal');
    document.getElementById("back-to-menu-btn").onclick = () => backToMenu();
}); 

// js/main.js

console.log("main.js chargé.");

import { auth, db, ref, set, get, update, remove, onValue, off, serverTimestamp, runTransaction } from "./firebaseConfig.js";
import { setupAuthListeners } from "./auth.js"; // Import de la fonction d'écouteurs d'authentification
import { startMatchMonitoring, currentMatchId, youKey, gameMode } from "./game.js"; // Importe les fonctions de démarrage du monitoring du match
import { showMessage, updateHealthBar, updateTimerUI, clearHistory, disableActionButtons, enableActionButtons, showAuthScreen, showMainMenu, showMatchmakingScreen, showGameScreen } from "./utils.js"; // Importe les fonctions utilitaires

// Variables globales de l'état de l'application
export let currentUser = null; // Contient { uid, pseudo }
let matchmakingTimeout = null; // Pour gérer le timeout de suppression du match en attente

// --- Références aux éléments du DOM pour une meilleure performance ---
const authSection = document.getElementById('auth');
const mainMenuSection = document.getElementById('main-menu');
const matchmakingStatusSection = document.getElementById('matchmaking-status');
const gameScreenSection = document.getElementById('game-screen');

const userInfoDisplay = document.getElementById('user-info');
const playerNameDisplay = document.getElementById('player-name');
const pseudoDisplay = document.getElementById('pseudo-display');
const playerStatsDiv = document.getElementById('player-stats');
const mainMenuMsgDisplay = document.getElementById('main-menu-msg');

const playIaBtn = document.getElementById('play-ia-btn');
const playPlayerBtn = document.getElementById('play-player-btn');
const howToPlayBtn = document.getElementById('how-to-play-btn');
const cancelMatchmakingBtn = document.getElementById('cancel-matchmaking-btn');
const aiDifficultySelect = document.getElementById('ai-difficulty-select'); // Assurez-vous que cet ID existe dans votre HTML

// Initialisation au chargement du DOM
document.addEventListener('DOMContentLoaded', () => {
    setupAuthListeners(); // Configure les écouteurs d'authentification
    attachMenuListeners(); // Attache les écouteurs des boutons du menu
    showAuthScreen(); // Affiche l'écran d'authentification par défaut
    // Création du sélecteur de difficulté de l'IA s'il n'existe pas déjà
    if (!aiDifficultySelect) {
        createAIDifficultySelect(); // Fonction pour créer le sélecteur dynamiquement si besoin
    }
});


// Fonction pour créer le sélecteur de difficulté (si non présent dans le HTML)
function createAIDifficultySelect() {
    const existingSelect = document.getElementById('ai-difficulty-select');
    if (existingSelect) return; // Si déjà là, ne rien faire

    const select = document.createElement('select');
    select.id = 'ai-difficulty-select';
    select.innerHTML = `
        <option value="easy">Facile</option>
        <option value="normal">Normal</option>
        <option value="hard">Difficile</option>
    `;
    select.style.cssText = `
        padding: 8px;
        margin-bottom: 15px;
        border-radius: 5px;
        background-color: #34495e;
        color: #ecf0f1;
        border: 1px solid #2c3e50;
        font-size: 0.9em;
    `;
    // Insérer avant le bouton "Jouer contre l'IA"
    const playIaButton = document.getElementById('play-ia-btn');
    if (playIaButton && playIaButton.parentNode) {
        playIaButton.parentNode.insertBefore(select, playIaButton);
        console.log("Sélecteur de difficulté AI créé dynamiquement.");
    }
}

// Fonction pour attacher les écouteurs d'événements du menu
function attachMenuListeners() {
    if (playIaBtn) {
        playIaBtn.addEventListener('click', () => handlePlayAI());
    }
    if (playPlayerBtn) {
        playPlayerBtn.addEventListener('click', () => handlePlayPlayer());
    }
    if (howToPlayBtn) {
        howToPlayBtn.addEventListener('click', () => showHowToPlay());
    }
    if (cancelMatchmakingBtn) {
        cancelMatchmakingBtn.addEventListener('click', () => cancelMatchmaking());
    }
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            await auth.signOut(); // Utilise la méthode signOut de Firebase Auth
        });
    }
}


// --- Fonctions de gestion de l'état de connexion de l'utilisateur (appelées par auth.js) ---
export async function handleUserLogin(uid, pseudo) {
    currentUser = { uid: uid, pseudo: pseudo };
    console.log("Utilisateur connecté :", currentUser.pseudo, "(UID:", currentUser.uid + ")");

    if (userInfoDisplay) userInfoDisplay.textContent = `Connecté en tant que : ${currentUser.pseudo}`;
    if (playerNameDisplay) playerNameDisplay.textContent = currentUser.pseudo;
    if (pseudoDisplay) pseudoDisplay.textContent = `Pseudo: ${currentUser.pseudo}`;

    await loadPlayerStats(currentUser.uid);
    showMainMenu();
    showMessage(mainMenuMsgDisplay.id, `Bienvenue, ${currentUser.pseudo} ! Choisissez un mode de jeu.`, true);
}

export function handleUserLogout() {
    currentUser = null;
    console.log("Utilisateur déconnecté.");
    if (userInfoDisplay) userInfoDisplay.textContent = 'Non connecté';
    if (playerNameDisplay) playerNameDisplay.textContent = 'Invité'; // Réinitialise l'affichage
    if (pseudoDisplay) pseudoDisplay.textContent = 'Pseudo: N/A';
    if (playerStatsDiv) playerStatsDiv.innerHTML = '<p>Connectez-vous pour voir vos statistiques.</p>';
    showAuthScreen();
    showMessage('auth-msg', 'Connectez-vous pour commencer à jouer.', true);
}


// --- Fonctions de statistiques ---
async function loadPlayerStats(uid) {
    try {
        const statsRef = ref(db, `users/${uid}/stats`);
        const snapshot = await get(statsRef);
        const stats = snapshot.val();
        if (stats) {
            updateUserStatsDisplay(stats);
        } else {
            playerStatsDiv.innerHTML = '<p>Pas de statistiques disponibles.</p>';
        }
    } catch (error) {
        console.error("Erreur lors du chargement des stats:", error);
        playerStatsDiv.innerHTML = '<p>Erreur lors du chargement des statistiques.</p>';
    }
}

function updateUserStatsDisplay(stats) {
    if (playerStatsDiv && stats) {
        playerStatsDiv.innerHTML = `
            <p>Victoires: ${stats.wins || 0}</p>
            <p>Défaites: ${stats.losses || 0}</p>
            <p>Égalités: ${stats.draws || 0}</p>
        `;
    }
}

export async function updateMatchResult(result) {
    if (!currentUser || !currentUser.uid) {
        console.error("Impossible de mettre à jour les statistiques : utilisateur non connecté.");
        return;
    }

    const userStatsRef = ref(db, `users/${currentUser.uid}/stats`);
    await runTransaction(userStatsRef, (currentStats) => {
        if (currentStats === null) {
            currentStats = { wins: 0, losses: 0, draws: 0 };
        }
        if (result === 'win') {
            currentStats.wins = (currentStats.wins || 0) + 1;
        } else if (result === 'loss') {
            currentStats.losses = (currentStats.losses || 0) + 1;
        } else if (result === 'draw') {
            currentStats.draws = (currentStats.draws || 0) + 1;
        }
        return currentStats;
    }).then(() => {
        console.log(`Statistiques mises à jour : ${result}`);
        loadPlayerStats(currentUser.uid); // Recharge les stats pour l'affichage
    }).catch(error => {
        console.error("Erreur lors de la mise à jour des stats :", error);
    });
}

// --- Fonctions de jeu ---

/**
 * Lance un match contre l'IA.
 */
async function handlePlayAI() {
    if (!currentUser) {
        showMessage(mainMenuMsgDisplay.id, 'Vous devez être connecté pour jouer contre l\'IA.', false);
        return;
    }

    const difficulty = aiDifficultySelect ? aiDifficultySelect.value : 'easy'; // Récupère la difficulté

    const newMatchRef = push(ref(db, 'matches')); // Crée un nouvel ID de match unique
    const newMatchId = newMatchRef.key;

    const initialMatchData = {
        players: {
            p1: {
                uid: currentUser.uid,
                pseudo: currentUser.pseudo,
                pv: 100,
                action: null,
                healCooldown: 0,
                disconnected: false
            },
            p2: { // L'IA est considérée comme P2
                uid: 'AI',
                pseudo: `IA (${difficulty})`,
                pv: 100,
                action: null,
                healCooldown: 0,
                disconnected: false
            }
        },
        status: 'playing',
        turn: 'p1', // Le joueur commence toujours
        turnCounter: 0, // Compteur de tours pour la synchronisation
        turnStartTime: serverTimestamp(),
        matchMode: 'PvAI',
        difficulty: difficulty,
        history: []
    };

    try {
        await set(newMatchRef, initialMatchData);
        startMatchMonitoring(newMatchId, 'p1', 'PvAI'); // Démarre la surveillance du match
        showMessage(mainMenuMsgDisplay.id, `Match contre l'IA (${difficulty}) créé !`, true);
    } catch (error) {
        console.error("Erreur lors de la création du match PvAI:", error);
        showMessage(mainMenuMsgDisplay.id, `Erreur lors de la création du match PvAI: ${error.message}`, false);
    }
}

/**
 * Lance le processus de matchmaking PvP.
 */
async function handlePlayPlayer() {
    if (!currentUser) {
        showMessage(mainMenuMsgDisplay.id, 'Vous devez être connecté pour jouer contre un autre joueur.', false);
        return;
    }
    showMatchmakingScreen();
    showMessage('matchmaking-message', 'Recherche d\'un adversaire...', true);
    findOrCreatePvPMatch();
}

/**
 * Cherche ou crée un match PvP.
 */
async function findOrCreatePvPMatch() {
    const publicMatchesRef = ref(db, 'matches');
    let foundMatchId = null;

    // Tente de trouver un match en attente
    const snapshot = await get(publicMatchesRef);
    snapshot.forEach((childSnapshot) => {
        const match = childSnapshot.val();
        if (match.status === 'waiting' && match.matchMode === 'PvP' && match.players.p1 && match.players.p1.uid !== currentUser.uid) {
            foundMatchId = childSnapshot.key;
            return true; // Arrête la boucle forEach
        }
    });

    if (foundMatchId) {
        // Rejoindre un match existant
        const matchToJoinRef = ref(db, `matches/${foundMatchId}`);
        try {
            await runTransaction(matchToJoinRef, (currentMatch) => {
                if (currentMatch && currentMatch.status === 'waiting' && currentMatch.players.p1 && currentMatch.players.p1.uid !== currentUser.uid) {
                    currentMatch.players.p2 = {
                        uid: currentUser.uid,
                        pseudo: currentUser.pseudo,
                        pv: 100,
                        action: null,
                        healCooldown: 0,
                        disconnected: false
                    };
                    currentMatch.status = 'playing';
                    currentMatch.turn = 'p1'; // P1 commence toujours en PvP
                    currentMatch.turnCounter = 0;
                    currentMatch.turnStartTime = serverTimestamp();
                    currentMatch.history = [...(currentMatch.history || []), `${currentUser.pseudo} a rejoint le match !`];
                    return currentMatch;
                }
                return undefined; // Abort the transaction
            });
            // Si la transaction a réussi
            showMessage('matchmaking-message', 'Match trouvé et rejoint !', true);
            startMatchMonitoring(foundMatchId, 'p2', 'PvP'); // On est P2
        } catch (error) {
            console.error("Erreur lors de la tentative de rejoindre un match:", error);
            showMessage('matchmaking-message', `Erreur lors de la jonction du match: ${error.message}`, false);
            showMainMenu(); // Retour au menu en cas d'échec
        }
    } else {
        // Créer un nouveau match si aucun n'est trouvé
        const newMatchRef = push(publicMatchesRef);
        const newMatchId = newMatchRef.key;
        try {
            await set(newMatchRef, {
                players: {
                    p1: {
                        uid: currentUser.uid,
                        pseudo: currentUser.pseudo,
                        pv: 100,
                        action: null,
                        healCooldown: 0,
                        disconnected: false
                    }
                },
                status: 'waiting',
                turn: 'p1', // P1 commence, mais seulement quand un adversaire rejoint
                turnCounter: 0,
                turnStartTime: null, // Pas de timer tant qu'un adversaire n'a pas rejoint
                matchMode: 'PvP',
                history: [`${currentUser.pseudo} a créé un match en attente.`],
                difficulty: 'N/A' // Non pertinent pour PvP
            });
            showMessage('matchmaking-message', 'Match créé, en attente d\'un adversaire...', true);
            startMatchMonitoring(newMatchId, 'p1', 'PvP'); // On surveille le match en tant que P1 en attente

            // Configurer un timeout pour supprimer le match s'il n'est pas rejoint (ex: 5 minutes)
            matchmakingTimeout = setTimeout(async () => {
                const matchSnapshot = await get(newMatchRef);
                const matchData = matchSnapshot.val();
                if (matchData && matchData.status === 'waiting') {
                    await remove(newMatchRef);
                    console.log(`Match ${newMatchId} supprimé car aucun adversaire n'a rejoint.`);
                    if (currentMatchId === newMatchId) { // Si c'est le match actuel que l'utilisateur attend
                        backToMenu(false); // Retour au menu
                        showMessage('main-menu-msg', 'Votre recherche d\'adversaire a expiré.', false);
                    }
                }
            }, 5 * 60 * 1000); // 5 minutes
        } catch (error) {
            console.error("Erreur lors de la création du match PvP:", error);
            showMessage('matchmaking-message', `Erreur lors de la création du match PvP: ${error.message}`, false);
            showMainMenu(); // Retour au menu en cas d'échec
        }
    }
}

/**
 * Annule le matchmaking en cours.
 */
async function cancelMatchmaking() {
    if (currentMatchId && gameMode === 'PvP') {
        const matchRef = ref(db, `matches/${currentMatchId}`);
        try {
            await runTransaction(matchRef, (currentData) => {
                if (currentData && currentData.status === 'waiting' && currentData.players.p1.uid === currentUser.uid) {
                    // Supprimer le match si le joueur P1 annule et qu'il n'y a personne d'autre
                    return null; // Supprime le nœud
                }
                return undefined; // Abort the transaction
            });
            showMessage(mainMenuMsgDisplay.id, 'Recherche annulée.', false);
        } catch (error) {
            console.error("Erreur lors de l'annulation du matchmaking:", error);
            showMessage('matchmaking-message', `Erreur lors de l'annulation: ${error.message}`, false);
        } finally {
            if (matchmakingTimeout) {
                clearTimeout(matchmakingTimeout);
                matchmakingTimeout = null;
            }
            backToMenu(false);
        }
    } else {
        backToMenu(false);
    }
}

/**
 * Affiche la fenêtre "Comment jouer ?".
 */
function showHowToPlay() {
    alert("Comment jouer :\n\n- Attaque : Inflige des dégâts à l'adversaire.\n- Défense : Réduit les dégâts du prochain coup de l'adversaire.\n- Soin : Restaure des points de vie (disponible tous les 3 tours).\n\nLe joueur dont les PV tombent à 0 perd le match.");
}

// Fonction pour revenir au menu principal (appelée par game.js ou main.js)
// Cette fonction est le point central pour quitter un match.
export async function backToMenu(fromMatchEnd = false) {
    console.log("Retour au menu demandé depuis main.js.");

    // Annuler tous les écouteurs Firebase liés au match
    if (currentMatchId) {
        const matchRef = ref(db, `matches/${currentMatchId}`);
        off(matchRef); // Désinscrit tous les listeners pour ce chemin
        console.log(`Écouteurs Firebase pour le match ${currentMatchId} désactivés.`);
    }

    // Effacer le timeout de suppression du match
    if (matchmakingTimeout) {
        clearTimeout(matchmakingTimeout);
        matchmakingTimeout = null;
        console.log("Timeout de suppression du match annulé.");
    }

    // Réinitialiser les variables de match globales
    // Note: les variables de game.js (currentMatchId, youKey, gameMode) sont réinitialisées
    // par la fonction returnToMainMenu de game.js qui sera appelée en premier via l'onValue.
    // Ici, on s'assure juste que notre état local est cohérent.
    // L'idéal est d'avoir une seule source de vérité pour ces variables.
    // Pour simplifier, on laisse game.js les réinitialiser et on s'assure juste que les listeners sont coupés.

    // Réinitialiser l'interface utilisateur
    clearHistory();
    updateHealthBar("you-health-bar", 100);
    document.getElementById("player1-pv").textContent = "100 PV";
    updateHealthBar("opponent-health-bar", 100);
    document.getElementById("player2-pv").textContent = "100 PV";
    updateTimerUI(30, 30);
    document.getElementById("timer-display").style.color = '#ecf0f1'; // Réinitialiser la couleur du timer
    document.getElementById("player2-pseudo").textContent = "Adversaire";
    // player1-pseudo sera mis à jour par handleUserLogin si nécessaire
    showMessage("action-msg", "");
    showMessage("match-msg", "");
    document.getElementById('return-to-menu').style.display = 'none';

    // Cacher l'écran de jeu et montrer le menu principal
    showMainMenu();

    if (fromMatchEnd) {
        // Mettre à jour les statistiques si le match vient de se terminer
        // Le "winner" est stocké dans les données du match, on le récupère.
        // Puis on appelle updateMatchResult avec 'win', 'loss', ou 'draw'.
        // Ceci nécessiterait de récupérer le matchData ici ou de passer le résultat à cette fonction.
        // Pour l'instant, je vais laisser cette partie commentée car c'est plus complexe avec les exports circulaires.
        // L'idéal serait de passer le résultat du match (win/loss/draw) directement à cette fonction si elle est appelée depuis processTurn de game.js.

        // Exemple (logique à affiner pour récupérer le résultat correct)
        // if (currentMatchId) {
        //     const matchRef = ref(db, `matches/${currentMatchId}`);
        //     const snapshot = await get(matchRef);
        //     const matchData = snapshot.val();
        //     if (matchData && matchData.status === 'finished') {
        //         if (matchData.winner === youKey) {
        //             await updateMatchResult('win');
        //         } else if (matchData.winner === opponentKey) {
        //             await updateMatchResult('loss');
        //         } else if (matchData.winner === 'draw') {
        //             await updateMatchResult('draw');
        //         }
        //     }
        // }
        showMessage(mainMenuMsgDisplay.id, "Le match est terminé. Bienvenue au menu principal.");

    } else {
        showMessage(mainMenuMsgDisplay.id, "Vous avez quitté le match. Bienvenue au menu principal.");
    }
}
// js/main.js

console.log("main.js chargé.");

// Importe toutes les fonctions nécessaires de Firebase
import { auth, db, ref, set, get, update, remove, onValue, off, serverTimestamp, runTransaction, push } from "./firebaseConfig.js";
import { setupAuthListeners } from "./auth.js"; // Import de la fonction d'écouteurs d'authentification
// Importe les fonctions et variables nécessaires de game.js
import { startMatchMonitoring, returnToMainMenu, gameId, processAIDecision } from "./game.js";
// Importe les fonctions utilitaires
import { showMessage, updateHealthBar, updateTimerUI, clearHistory, disableActionButtons, enableActionButtons, showAuthScreen, showMainMenu, showMatchmakingScreen, showGameScreen, showLeaderboardScreen, showHowToPlayScreen } from "./utils.js";

// Constante pour l'ID du message global (pour showMessage)
const GLOBAL_AUTH_MESSAGE_ID = 'global-auth-message'; // Assurez-vous que cet ID existe dans votre HTML !

// Variables globales de l'état de l'application
export let currentUser = null; // Contient { uid, pseudo }
let matchmakingTimeout = null; // Pour gérer le timeout de suppression du match en attente

// --- Références aux éléments du DOM pour une meilleure performance ---
const authSection = document.getElementById('auth');
const mainMenuSection = document.getElementById('main-menu');
const matchmakingStatusSection = document.getElementById('matchmaking-status');
const gameScreenSection = document.getElementById('game-screen');
const leaderboardScreen = document.getElementById('leaderboard-screen'); // Ajout
const howToPlayScreen = document.getElementById('how-to-play-screen'); // Ajout

const userInfoDisplay = document.getElementById('user-info');
const playerNameDisplay = document.getElementById('player-name');
const pseudoDisplay = document.getElementById('pseudo-display');
const playerStatsDiv = document.getElementById('player-stats');
const mainMenuMsgDisplay = document.getElementById('main-menu-msg');

const playIaBtn = document.getElementById('play-ia-btn');
const playPlayerBtn = document.getElementById('play-player-btn');
const howToPlayBtn = document.getElementById('how-to-play-btn');
const cancelMatchmakingBtn = document.getElementById('cancel-matchmaking-btn');
// Assurez-vous que aiDifficultySelect est récupéré après sa potentielle création dynamique
let aiDifficultySelect = document.getElementById('ai-difficulty-select');

// Boutons de retour au menu
const backToMenuBtnLeaderboard = document.getElementById('back-to-menu-btn-leaderboard');
const backToMenuBtnHowToPlay = document.getElementById('back-to-menu-btn-how-to-play');


// Initialisation au chargement du DOM
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM entièrement chargé et analysé.");
    setupAuthListeners(); // Configure les écouteurs d'authentification

    // Création du sélecteur de difficulté de l'IA s'il n'existe pas déjà
    createAIDifficultySelect(); // Appelle cette fonction pour s'assurer que le select existe
    // Mettre à jour la référence après la création si elle a eu lieu
    aiDifficultySelect = document.getElementById('ai-difficulty-select');

    attachMenuListeners(); // Attache les écouteurs des boutons du menu
    showAuthScreen(); // Affiche l'écran d'authentification par défaut
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
        howToPlayBtn.addEventListener('click', () => showHowToPlayScreen()); // Utilise la fonction de utils.js
    }
    if (cancelMatchmakingBtn) {
        cancelMatchmakingBtn.addEventListener('click', () => cancelMatchmaking());
    }
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            try {
                await signOut(auth); // Utilise la méthode signOut de Firebase Auth
                // handleUserLogout sera appelé par onAuthStateChanged dans auth.js
            } catch (error) {
                console.error("Erreur de déconnexion:", error);
                showMessage(GLOBAL_AUTH_MESSAGE_ID, `Erreur de déconnexion: ${error.message}`, false);
            }
        });
    }
    // Écouteurs pour les boutons "Retour au menu" des autres écrans
    if (document.getElementById('back-to-menu-btn-game')) {
        document.getElementById('back-to-menu-btn-game').addEventListener('click', () => backToMenu(false));
    }
    if (backToMenuBtnLeaderboard) {
        backToMenuBtnLeaderboard.addEventListener('click', () => showMainMenu());
    }
    if (backToMenuBtnHowToPlay) {
        backToMenuBtnHowToPlay.addEventListener('click', () => showMainMenu());
    }
    if (document.getElementById('leaderboard-btn')) { // Ajout de l'écouteur pour le classement
        document.getElementById('leaderboard-btn').addEventListener('click', displayLeaderboard);
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
    // Utilise l'ID de message global pour les messages d'authentification
    showMessage(GLOBAL_AUTH_MESSAGE_ID, 'Connectez-vous pour commencer à jouer.', true);
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
        // Lance le monitoring du match depuis game.js
        startMatchMonitoring(newMatchId, 'p1', 'PvAI');
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
    const snapshot = await get(query(publicMatchesRef, orderByChild('status'), equalTo('waiting'))); // Query pour les matchs en attente
    snapshot.forEach((childSnapshot) => {
        const match = childSnapshot.val();
        // S'assurer que le match est en attente, en mode PvP, et que ce n'est pas nous-mêmes qui l'avons créé
        if (match.matchMode === 'PvP' && match.players.p1 && match.players.p1.uid !== currentUser.uid) {
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
                    // Si c'est le match actuel que l'utilisateur attend
                    // La vérification gameId === newMatchId est redondante car startMatchMonitoring gère déjà l'état
                    // On appelle simplement backToMenu pour nettoyer l'UI et le game.js s'occupera du reste
                    backToMenu(false);
                    showMessage(mainMenuMsgDisplay.id, 'Votre recherche d\'adversaire a expiré.', false);
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
    if (gameId) { // gameId est l'ID du match en cours de surveillance
        const matchRef = ref(db, `matches/${gameId}`);
        try {
            await runTransaction(matchRef, (currentData) => {
                // S'assurer que le match est en attente et que c'est bien notre match créé
                if (currentData && currentData.status === 'waiting' && currentData.players.p1 && currentData.players.p1.uid === currentUser.uid) {
                    return null; // Supprime le nœud
                }
                return undefined; // Abort the transaction si ce n'est pas le cas
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
            backToMenu(false); // Retour au menu principal et nettoyage de l'état
        }
    } else {
        // Si aucun gameId n'est défini, juste retourner au menu
        backToMenu(false);
    }
}


/**
 * Affiche le classement.
 */
async function displayLeaderboard() {
    showLeaderboardScreen(); // Utilise la fonction de utils.js
    const leaderboardList = document.getElementById('leaderboard-list');
    leaderboardList.innerHTML = '<li>Chargement du classement...</li>';

    try {
        const usersRef = ref(db, 'users');
        const snapshot = await get(usersRef);

        const usersData = [];
        if (snapshot.exists()) {
            snapshot.forEach((childSnapshot) => {
                const uid = childSnapshot.key;
                const userData = childSnapshot.val();
                const pseudo = userData.pseudo || 'Anonyme';
                const stats = userData.stats || { wins: 0, losses: 0, draws: 0 };
                usersData.push({ pseudo, stats });
            });
        }

        usersData.sort((a, b) => b.stats.wins - a.stats.wins);

        leaderboardList.innerHTML = '';
        if (usersData.length > 0) {
            usersData.forEach((user, index) => {
                const listItem = document.createElement('li');
                listItem.textContent = `${index + 1}. ${user.pseudo} (V: ${user.stats.wins}, D: ${user.stats.losses}, N: ${user.stats.draws})`;
                leaderboardList.appendChild(listItem);
            });
        } else {
            leaderboardList.innerHTML = '<li>Aucun joueur dans le classement pour le moment.</li>';
        }

    } catch (error) {
        console.error("Erreur lors du chargement du classement:", error);
        leaderboardList.innerHTML = '<li>Erreur lors du chargement du classement.</li>';
    }
}

// Fonction pour revenir au menu principal (appelée par game.js ou main.js)
// Cette fonction est le point central pour quitter un match et nettoyer l'UI.
export async function backToMenu(fromMatchEnd = false) {
    console.log("Retour au menu demandé depuis main.js.");

    // Demande à game.js de désactiver ses écouteurs et de nettoyer son état
    returnToMainMenu(); // Cette fonction est exportée par game.js

    // Effacer le timeout de suppression du match
    if (matchmakingTimeout) {
        clearTimeout(matchmakingTimeout);
        matchmakingTimeout = null;
        console.log("Timeout de suppression du match annulé.");
    }

    // Réinitialiser l'interface utilisateur de manière générique
    clearHistory();
    updateHealthBar("you-health-bar", 100);
    document.getElementById("player1-pv").textContent = "100 PV";
    updateHealthBar("opponent-health-bar", 100);
    document.getElementById("player2-pv").textContent = "100 PV";
    updateTimerUI(30, 30);
    document.getElementById("timer-display").style.color = '#ecf0f1';
    document.getElementById("player2-pseudo").textContent = "Adversaire";
    showMessage("action-msg", "");
    showMessage("match-msg", "");
    const returnToMenuBtn = document.getElementById('return-to-menu');
    if (returnToMenuBtn) {
        returnToMenuBtn.style.display = 'none';
    }


    // Cacher tous les écrans et montrer le menu principal
    showMainMenu(); // Cette fonction est de utils.js et gère l'affichage correct

    if (fromMatchEnd) {
        showMessage(mainMenuMsgDisplay.id, "Le match est terminé. Bienvenue au menu principal.");
    } else {
        showMessage(mainMenuMsgDisplay.id, "Vous avez quitté le match. Bienvenue au menu principal.");
    }
}
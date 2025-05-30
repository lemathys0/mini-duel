// js/game.js

// Importer les modules Firebase depuis ton fichier de configuration centralisé
import { app, db, auth, ref, get, set, runTransaction, onValue, off, push } from './firebaseConfig.js';
// Note: onAuthStateChanged est importé dans auth.js et main.js pour sa gestion globale
// mais si tu as besoin de l'utiliser spécifiquement ici, tu devras l'importer aussi depuis firebase-auth.js.
// Pour l'instant, je le retire car il est géré par auth.js et main.js
// import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js"; // Removed this line

console.log("game.js chargé.");

export let currentUser = null; // Should be set by main.js after login
export let gameDataListener = null;
export let gameId = null; // ID unique de la session de jeu

// Variables pour suivre la clé du joueur actuel dans le match (p1 ou p2) et le mode de jeu
export let youKey = null;
export let gameMode = null; // 'PvP' ou 'PvAI'


// Éléments de l'interface utilisateur (s'assure que les IDs sont corrects dans ton HTML)
const gameContainer = document.getElementById('game-screen'); // Using 'game-screen' as per main.js
const matchmakingStatusSection = document.getElementById('matchmaking-status'); // For waiting
const player1HealthElement = document.getElementById('player1-pv');
const player1NameElement = document.getElementById('player1-pseudo');
const player1HealthBar = document.getElementById('player1-health-bar'); // Assuming you have a health bar element
const player2HealthElement = document.getElementById('player2-pv');
const player2NameElement = document.getElementById('player2-pseudo');
const player2HealthBar = document.getElementById('player2-health-bar'); // Assuming you have a health bar element

const attackButton = document.getElementById('attack-btn'); // As per main.js
const healButton = document.getElementById('heal-btn'); // As per main.js
const gameLog = document.getElementById('game-history'); // As per main.js

const actionMessageElement = document.getElementById('action-msg'); // As per main.js
const matchMessageElement = document.getElementById('match-msg'); // As per main.js
const timerDisplayElement = document.getElementById('timer-display'); // As per main.js
const returnToMenuButton = document.getElementById('return-to-menu'); // As per main.js

// Import functions from utils.js (assuming you have them)
import { showMessage, updateHealthBar, updateTimerUI, clearHistory, showGameScreen, showMainMenu, disableActionButtons, enableActionButtons } from './utils.js';
import { backToMenu, updateMatchResult } from './main.js'; // Import backToMenu from main.js

// --- Core Game Logic ---

/**
 * Starts monitoring a specific match. This is the main entry point from main.js.
 * @param {string} matchId The ID of the match to monitor.
 * @param {string} playerKey 'p1' or 'p2', indicating which player the current user is.
 * @param {string} mode 'PvP' or 'PvAI'.
 */
export function startMatchMonitoring(matchId, playerKey, mode) {
    gameId = matchId;
    youKey = playerKey; // 'p1' or 'p2' for the current user
    gameMode = mode;
    console.log(`Démarrage du monitoring du match ${gameId} pour ${youKey} en mode ${gameMode}`);

    // Set up UI for game screen
    showGameScreen();
    clearHistory(); // Clear previous game history

    // Detach any existing listener to prevent duplicates
    if (gameDataListener) {
        off(ref(db, `matches/${gameDataListener.matchId}`), 'value', gameDataListener.callback);
    }

    // Attach the new listener
    const matchRef = ref(db, `matches/${gameId}`);
    gameDataListener = {
        matchId: gameId,
        callback: onValue(matchRef, (snapshot) => {
            const gameData = snapshot.val();
            if (gameData) {
                updateGameUI(gameData);
                if (gameData.status === 'playing') {
                    // No specific action needed here beyond UI update,
                    // turn logic is handled in updateGameUI and performAction
                } else if (gameData.status === 'finished') {
                    handleMatchEnd(gameData);
                } else if (gameData.status === 'waiting' && gameMode === 'PvP') {
                    // Show waiting status if PvP and still waiting
                    showWaitingScreen(`En attente d'un adversaire pour le match ${gameId}...`);
                }
            } else {
                // Game session was deleted or does not exist
                if (gameId === matchId) { // Only if it's the game we were actively monitoring
                    console.log("La session de jeu a été supprimée ou n'existe plus.");
                    showMessage(matchMessageElement.id, "La partie a été terminée par votre adversaire ou n'existe plus.", false);
                    backToMenu(false); // Return to main menu
                }
            }
        })
    };

    // Attach event listeners for game actions
    attachGameActionListeners();
    // Enable buttons at start if it's your turn (handled by updateGameUI)
    enableActionButtons();
}

function attachGameActionListeners() {
    // Remove previous listeners to prevent duplicates if startMatchMonitoring is called multiple times
    attackButton.removeEventListener('click', handleAttack);
    healButton.removeEventListener('click', handleHeal);
    returnToMenuButton.removeEventListener('click', handleLeaveGame); // For the 'return to menu' button during game

    attackButton.addEventListener('click', handleAttack);
    healButton.addEventListener('click', handleHeal);
    returnToMenuButton.addEventListener('click', handleLeaveGame);
}

function handleAttack() {
    performAction('attack');
}

function handleHeal() {
    performAction('heal');
}

function handleLeaveGame() {
    leaveGame();
}

// --- Mise à jour de l'interface utilisateur ---

function updateGameUI(gameData) {
    if (!currentUser || !gameData) return;

    // Determine current player and opponent based on `youKey`
    const yourPlayerState = gameData.players[youKey];
    const opponentKey = youKey === 'p1' ? 'p2' : 'p1';
    const opponentPlayerState = gameData.players[opponentKey];

    if (!yourPlayerState || !opponentPlayerState) {
        // One of the players is not yet defined (e.g., still waiting in PvP)
        // If PvP, and opponent is null, show waiting screen.
        if (gameMode === 'PvP' && !opponentPlayerState) {
             showWaitingScreen(`En attente d'un adversaire...`);
             return;
        }
        return;
    }

    // Update your player's display
    player1NameElement.textContent = yourPlayerState.pseudo;
    updateHealthBar('player1-health-bar', yourPlayerState.pv);
    player1HealthElement.textContent = `${yourPlayerState.pv} PV`;
    // Update player avatar (if you have one)
    // player1AvatarElement.src = yourPlayerState.avatar;

    // Update opponent's display
    player2NameElement.textContent = opponentPlayerState.pseudo;
    updateHealthBar('player2-health-bar', opponentPlayerState.pv);
    player2HealthElement.textContent = `${opponentPlayerState.pv} PV`;
    // Update opponent avatar (if you have one)
    // opponentAvatarElement.src = opponentPlayerState.avatar;

    // Update game history/log
    clearHistory(); // Clears existing content
    gameData.history.forEach(entry => {
        showMessage('game-history', entry, false, true); // Append to history, don't clear
    });


    // Update turn indicator and button states
    const isYourTurn = gameData.turn === youKey; // Assuming 'turn' in gameData is 'p1' or 'p2'
    if (isYourTurn) {
        showMessage('action-msg', "C'est votre tour ! Choisissez une action.", true);
        enableActionButtons();
        // Update heal button text based on cooldown
        checkHealButtonAvailability(yourPlayerState.healCooldown || 0);
    } else {
        showMessage('action-msg', `C'est le tour de ${opponentPlayerState.pseudo}...`, true);
        disableActionButtons();
    }

    // If game is finished, disable all action buttons
    if (gameData.status === 'finished') {
        disableActionButtons();
        // Hide return to menu button if it's meant to be only for in-game surrender
        // returnToMenuButton.style.display = 'none';
    } else {
        // Ensure buttons are clickable if game is playing
        // This handles cases where buttons might be disabled prematurely due to network lag
        if(isYourTurn) {
            enableActionButtons();
        }
    }

    // Update timer UI (assuming gameData has turnStartTime for countdown)
    if (gameData.turnStartTime) {
        // You'll need to pass the initial total time for a turn here (e.g., 30 seconds)
        updateTimerUI(30, gameData.turnStartTime); // You'll need to adjust updateTimerUI to use serverTimestamp or calculate remaining time
    }
}

function checkHealButtonAvailability(healCooldown) {
    if (healCooldown > 0) {
        healButton.textContent = `Soin (${healCooldown} tours)`;
        healButton.disabled = true; // Disable if on cooldown
        healButton.classList.add('cooldown');
    } else {
        healButton.textContent = `Soin`;
        healButton.classList.remove('cooldown');
        // Only enable if it's your turn AND not on cooldown
        if (!attackButton.disabled) { // check if other buttons are enabled (i.e., it's your turn)
            healButton.disabled = false;
        }
    }
}

function showWaitingScreen(message) {
    showMessage('matchmaking-message', message, true);
    // You might need to hide game-screen and show matchmaking-status section
    showMainMenu(); // Or a specific waiting screen function if you have one
}


// --- Fonctions d'action de jeu ---

async function performAction(actionType) {
    if (!currentUser || !gameId || !youKey) {
        console.error("Impossible d'effectuer l'action : utilisateur ou partie non définis.");
        return;
    }

    disableActionButtons(); // Désactiver immédiatement pour éviter les doubles clics

    const matchRef = ref(db, `matches/${gameId}`);

    try {
        await runTransaction(matchRef, (currentMatch) => {
            if (!currentMatch || currentMatch.status !== 'playing' || currentMatch.turn !== youKey) {
                console.log("Transaction annulée: Ce n'est pas votre tour ou la partie n'est pas en cours.");
                return undefined; // Abort the transaction
            }

            const yourPlayer = currentMatch.players[youKey];
            const opponentKey = youKey === 'p1' ? 'p2' : 'p1';
            const opponentPlayer = currentMatch.players[opponentKey];

            let actionMessage = '';

            if (actionType === 'attack') {
                const damage = yourPlayer.attack || 10; // Default attack
                opponentPlayer.pv -= damage;
                actionMessage = `[${yourPlayer.pseudo}] attaque [${opponentPlayer.pseudo}] et lui inflige ${damage} points de dégâts.`;
            } else if (actionType === 'heal') {
                if ((yourPlayer.healCooldown || 0) > 0) {
                    actionMessage = `[Erreur] Le soin sera disponible dans ${yourPlayer.healCooldown} tour(s).`;
                    // This will be displayed in log, but transaction will still proceed to next turn.
                    // If you want to completely block and not advance turn for invalid heal,
                    // you would return undefined here and re-enable buttons.
                    console.log(actionMessage);
                    // Re-enable buttons if this was an invalid heal attempt
                    enableActionButtons();
                    return undefined; // Abort transaction if heal is not allowed
                }
                const healAmount = yourPlayer.healAmount || 15; // Default heal
                yourPlayer.pv += healAmount;
                if (yourPlayer.pv > 100) { // Assuming max health is 100
                    yourPlayer.pv = 100;
                }
                yourPlayer.healCooldown = 3; // Set cooldown
                actionMessage = `[${yourPlayer.pseudo}] utilise Soin et regagne ${healAmount} points de vie.`;
            }

            // Add action message to history
            if (!currentMatch.history) {
                currentMatch.history = [];
            }
            currentMatch.history.push(actionMessage);

            // Decrease heal cooldown for both players for the *next* turn
            if (currentMatch.players.p1.healCooldown > 0) {
                currentMatch.players.p1.healCooldown--;
            }
            if (currentMatch.players.p2.healCooldown > 0) {
                currentMatch.players.p2.healCooldown--;
            }

            // Check for game end
            if (opponentPlayer.pv <= 0) {
                opponentPlayer.pv = 0; // Ensure health doesn't go negative
                currentMatch.winner = youKey;
                currentMatch.status = 'finished';
                currentMatch.history.push(`[${opponentPlayer.pseudo}] a été vaincu !`);
                currentMatch.history.push(`[${yourPlayer.pseudo}] remporte la partie !`);
                console.log("Match terminé. Vainqueur:", yourPlayer.pseudo);
            } else {
                // Advance turn
                currentMatch.turn = opponentKey; // Pass turn to opponent
                currentMatch.turnCounter = (currentMatch.turnCounter || 0) + 1; // Increment turn counter
                // Reset timer for next turn
                currentMatch.turnStartTime = Date.now(); // Use client timestamp for immediate update, serverTimestamp() for server accuracy
                currentMatch.history.push(`C'est le tour ${currentMatch.turnCounter + 1}. C'est au tour de [${opponentPlayer.pseudo}].`);
            }

            // Update disconnected status to false as player just made a move
            yourPlayer.disconnected = false;

            return currentMatch; // Return the updated data to commit the transaction
        });

        // After successful transaction, UI will update via onValue listener
        // The buttons will be re-enabled or disabled based on whose turn it is
    } catch (error) {
        console.error("Erreur lors de l'action ou de la transaction:", error);
        showMessage(actionMessageElement.id, `Erreur lors de l'action : ${error.message}`, false);
        enableActionButtons(); // Re-enable if transaction failed unexpectedly
    }
}

async function handleMatchEnd(gameData) {
    disableActionButtons(); // Ensure buttons are disabled
    gameContainer.classList.add('hidden'); // Hide game UI

    let resultMsg = '';
    let winOrLoss = '';

    if (gameData.winner === youKey) {
        resultMsg = `Félicitations ! Vous avez gagné la partie contre ${gameData.players[youKey === 'p1' ? 'p2' : 'p1'].pseudo} !`;
        winOrLoss = 'win';
    } else if (gameData.winner && gameData.winner !== youKey) {
        resultMsg = `Dommage ! Vous avez perdu la partie contre ${gameData.players[gameData.winner].pseudo}.`;
        winOrLoss = 'loss';
    } else { // Should ideally not happen if a winner is always set
        resultMsg = "La partie est terminée, c'est une égalité ou un résultat inattendu.";
        winOrLoss = 'draw';
    }

    showMessage(matchMessageElement.id, `Partie terminée ! ${resultMsg}`, true);
    document.getElementById('game-result-text').textContent = resultMsg; // Update specific result text area if you have one

    // Show rematch button if it's PvP (PvAI might not have rematch)
    if (gameMode === 'PvP') {
        // Implement rematch UI elements and logic if you have them
        // For now, let's just log it and assume main.js handles full transition back to menu
        console.log("Partie terminée, affichage de l'option de revanche si PvP.");
    }
    
    // Update player stats
    if (winOrLoss && currentUser && currentUser.uid) {
        await updateMatchResult(winOrLoss); // Call the update function from main.js
    }

    // Give a short delay then return to main menu
    setTimeout(() => {
        backToMenu(true); // Indicate that it's from a match end
    }, 5000); // Wait 5 seconds before going back to menu
}


async function leaveGame() {
    if (!currentUser || !gameId || !youKey) return;

    if (!confirm("Voulez-vous vraiment quitter la partie ? La partie sera enregistrée comme une défaite pour vous.")) {
        return;
    }

    const matchRef = ref(db, `matches/${gameId}`);

    try {
        // Detach listener immediately to avoid further updates for this game
        if (gameDataListener) {
            off(matchRef, 'value', gameDataListener.callback);
            gameDataListener = null;
        }

        await runTransaction(matchRef, (currentMatch) => {
            if (currentMatch && currentMatch.status === 'playing' && !currentMatch.winner) {
                const opponentKey = youKey === 'p1' ? 'p2' : 'p1';
                currentMatch.winner = opponentKey; // Opponent wins by default
                currentMatch.status = 'finished';
                if (!currentMatch.history) currentMatch.history = [];
                currentMatch.history.push(`[${currentMatch.players[youKey].pseudo}] a quitté la partie.`);
                currentMatch.history.push(`[${currentMatch.players[opponentKey].pseudo}] remporte la partie par forfait !`);
                console.log(`Partie terminée par forfait de ${currentMatch.players[youKey].pseudo}`);
            } else if (currentMatch && currentMatch.status === 'waiting' && currentMatch.players[youKey] && !currentMatch.players[opponentKey]) {
                // If it's a waiting PvP match and you are the only one, delete the match
                return null; // This deletes the match node
            }
            return currentMatch; // Return updated data or null for deletion
        });

        showMessage(matchMessageElement.id, "Vous avez quitté la partie.", true);
        backToMenu(false); // Return to main menu, not as a match end
    } catch (error) {
        console.error("Erreur lors de la sortie de partie :", error);
        showMessage(matchMessageElement.id, `Erreur lors de la sortie : ${error.message}`, false);
    }
}

// Gérer la déconnexion inattendue ou la fermeture de l'onglet (pour PvAI, on supprime le match; pour PvP, on marque comme défaite)
window.addEventListener('beforeunload', async () => {
    // This is a best-effort attempt and not guaranteed to run in all browser closing scenarios.
    // For robust presence, Cloud Functions and real-time presence systems are recommended.
    if (currentUser && gameId && youKey) {
        const matchRef = ref(db, `matches/${gameId}`);
        try {
            await runTransaction(matchRef, (currentMatch) => {
                if (currentMatch) {
                    if (gameMode === 'PvAI' && currentMatch.status === 'playing') {
                        // For PvAI, simply delete the match if the player leaves
                        return null; // Deletes the match
                    } else if (gameMode === 'PvP' && currentMatch.status === 'playing' && !currentMatch.winner) {
                        const opponentKey = youKey === 'p1' ? 'p2' : 'p1';
                        if (currentMatch.players[opponentKey]) { // Ensure opponent exists
                            currentMatch.winner = opponentKey;
                            currentMatch.status = 'finished';
                            if (!currentMatch.history) currentMatch.history = [];
                            currentMatch.history.push(`[${currentMatch.players[youKey].pseudo}] s'est déconnecté.`);
                            currentMatch.history.push(`[${currentMatch.players[opponentKey].pseudo}] remporte la partie par forfait !`);
                        }
                    } else if (gameMode === 'PvP' && currentMatch.status === 'waiting' && currentMatch.players[youKey] && !currentMatch.players[youKey === 'p1' ? 'p2' : 'p1']) {
                        // If it's a waiting PvP match and you are the only one, delete it
                        return null;
                    }
                }
                return currentMatch;
            });
            console.log("Traitement de déconnexion inattendue pour le match effectué.");
        } catch (error) {
            console.warn("Échec de la gestion de la déconnexion inattendue:", error);
        }
    }
});

// The following functions (checkAndJoinGame, createGame, joinGame, etc.)
// are no longer directly called in game.js due to the startMatchMonitoring
// function being the entry point from main.js.
// Their logic has been replaced or adapted into startMatchMonitoring and related game functions.
// I'm commenting them out to avoid confusion and redundant logic.

/*
async function checkAndJoinGame() {
    // Logic moved to main.js and startMatchMonitoring
}

async function createGame(newGameId, player1Uid) {
    // Logic moved to main.js's handlePlayAI and findOrCreatePvPMatch
}

async function joinGame(existingGameId, player2Uid) {
    // Logic moved to main.js's findOrCreatePvPMatch
}
*/
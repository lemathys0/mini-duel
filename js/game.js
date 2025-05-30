// js/game.js

import { db, ref, onValue, off, runTransaction, serverTimestamp } from './firebaseConfig.js';
// Updated imports to match the new utils.js exports and function names
import {
    showMessage,
    updateHealthBar,
    updateTimerUI,
    addHistoryMessage, // New function name
    clearHistory,      // New function
    disableActionButtons, // New function
    enableActionButtons,  // New function
    showGameScreen,    // New function name for showing game screen
    showMainMenu       // New function name for showing main menu
} from './utils.js';
import { auth } from './auth.js';
import { processAITurn } from './aiLogic.js';

console.log("game.js loaded.");

// Game state variables
let gameId = null;
let youKey = null; // 'p1' or 'p2'
let opponentKey = null; // 'p1' or 'p2'
let gameMode = null; // 'PvAI' or 'PvP'
let matchRef = null;
let gameListener = null;
let countdownInterval = null; // For managing the turn timer

// DOM elements (already initialized in utils.js now, but kept for clarity and potential direct access)
// It's generally better to pass these elements to functions or retrieve them if they're not global in utils.
// For now, we'll keep local references if needed for direct game.js manipulation.
let player1PseudoSpan;
let player2PseudoSpan;
let player1PVDisplay;
let player2PVDisplay;
let youHealthBar;
let opponentHealthBar;
let actionAttackButton;
let actionDefendButton;
let actionHealButton;
let opponentActionStatus;
let timerProgressBar;
let timerDisplay;
let historyDiv; // This is the old history container ID. utils.js now uses 'game-history-list'
let backToMenuButtonGame;

const GAME_TURN_DURATION_SECONDS = 30; // Duration of a turn in seconds

// Function to initialize DOM elements that game.js directly manipulates
// This is still useful even if utils.js has its own references,
// to ensure game.js has access to what it needs.
function initializeGameDOMElements() {
    player1PseudoSpan = document.getElementById('player1-pseudo');
    player2PseudoSpan = document.getElementById('player2-pseudo');
    player1PVDisplay = document.getElementById('player1-pv');
    player2PVDisplay = document.getElementById('player2-pv');
    youHealthBar = document.getElementById('you-health-bar');
    opponentHealthBar = document.getElementById('opponent-health-bar');
    actionAttackButton = document.getElementById('action-attack');
    actionDefendButton = document.getElementById('action-defend');
    actionHealButton = document.getElementById('action-heal');
    opponentActionStatus = document.getElementById('opponent-action-status');
    timerProgressBar = document.getElementById('timer-progress-bar');
    timerDisplay = document.getElementById('timer-display');
    historyDiv = document.getElementById('history'); // Still referencing 'history' for compatibility if needed
    backToMenuButtonGame = document.getElementById('back-to-menu-btn-game');

    if (!backToMenuButtonGame) {
        console.warn("The 'Retour au Menu' button (#back-to-menu-btn-game) was not found. Please check your HTML.");
    }
    if (!historyDiv) {
        console.warn("The game history div with ID 'history' was not found. Using 'game-history-list' from utils.js.");
        historyDiv = document.getElementById('game-history-list'); // Fallback to new ID
    }
}

// Ensure DOM elements are initialized when the script loads
document.addEventListener('DOMContentLoaded', initializeGameDOMElements);

// Attach event listeners for game action buttons
export function attachGameActionListeners() {
    // Ensure elements are initialized in case of early call
    if (!actionAttackButton) initializeGameDOMElements();

    if (actionAttackButton) {
        actionAttackButton.onclick = () => performAction('attack');
    }
    if (actionDefendButton) {
        actionDefendButton.onclick = () => performAction('defend');
    }
    if (actionHealButton) {
        actionHealButton.onclick = () => performAction('heal');
    }

    if (backToMenuButtonGame) {
        backToMenuButtonGame.onclick = () => leaveGame();
    }
}

// Function to start a match
export async function startMatch(match_id, player_key, mode = 'PvP') {
    gameId = match_id;
    youKey = player_key;
    opponentKey = (youKey === 'p1') ? 'p2' : 'p1';
    gameMode = mode;
    matchRef = ref(db, `matches/${gameId}`);

    console.log(`Starting match monitoring ${gameId} for ${youKey} in ${gameMode} mode`);

    showGameScreen(); // Use the new function from utils.js
    showMessage('action-msg', 'Waiting for the match to start...', true);
    disableActionButtons(); // Use the new function from utils.js

    clearHistory(); // Use the new function from utils.js
    if (opponentActionStatus) opponentActionStatus.textContent = '';


    // Ensure elements are initialized and listeners attached
    attachGameActionListeners();

    // Stop previous listener if it exists
    if (gameListener) {
        off(matchRef, 'value', gameListener);
    }
    // Stop previous countdown interval if it exists
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }

    // Real-time listener for match updates
    gameListener = onValue(matchRef, (snapshot) => {
        const gameData = snapshot.val();
        if (!gameData) {
            console.log("Match ended or deleted.");
            leaveGame(); // Return to menu if match no longer exists
            return;
        }

        updateGameUI(gameData);
    }, (error) => {
        console.error("Error reading match:", error);
        showMessage('action-msg', `Error connecting to match: ${error.message}`, false);
        leaveGame();
    });
}

// Updates the game user interface
function updateGameUI(gameData) {
    if (!player1PseudoSpan) initializeGameDOMElements(); // Ensure elements are ready

    const player1 = gameData.players.p1;
    const player2 = gameData.players.p2;

    document.getElementById('current-match').textContent = gameId;

    // Update pseudos and HP
    player1PseudoSpan.textContent = player1.pseudo;
    player2PseudoSpan.textContent = player2.pseudo;

    // Use updateHealthBar with string IDs as required by utils.js
    updateHealthBar('you-health-bar', player1.pv);
    updateHealthBar('opponent-health-bar', player2.pv);

    // Update history using the new function
    if (gameData.history) {
        clearHistory(); // Clear before adding to avoid duplicates
        gameData.history.forEach(entry => addHistoryMessage(entry));
    }


    // Turn and action management logic
    if (gameData.status === 'playing') {
        const isYourTurn = (gameData.turn === youKey);
        const yourPlayer = gameData.players[youKey];
        const opponentPlayer = gameData.players[opponentKey];

        // Manage action button states
        if (isYourTurn && yourPlayer.action === null) {
            showMessage('action-msg', 'It\'s your turn! Choose an action.', true);
            enableActionButtons(); // Use the new function
        } else if (yourPlayer.action !== null && opponentPlayer.action === null) {
            showMessage('action-msg', 'Waiting for opponent\'s action...', true);
            disableActionButtons(); // Use the new function
        } else {
            // Either it's opponent's turn and they haven't played,
            // or both have played and the turn will be resolved.
            showMessage('action-msg', 'Opponent\'s turn...', true);
            disableActionButtons(); // Use the new function
        }

        // --- AI TURN MANAGEMENT (if in PvAI mode) ---
        // Trigger AI if it's its turn, it hasn't acted yet, and it's actually the AI (UID 'AI')
        if (gameMode === 'PvAI' && gameData.turn === opponentKey && opponentPlayer.uid === 'AI' && opponentPlayer.action === null) {
            console.log("It's AI's turn. Triggering AI action...");
            // Pass gameData directly to processAITurn
            // aiLogic.js will handle not executing if already in progress or already played for this turn
            processAITurn(gameData);
        }

        // --- TURN RESOLUTION (if both players have acted) ---
        if (gameData.players.p1.action !== null && gameData.players.p2.action !== null) {
            console.log("Both players have acted. Resolving turn...");
            resolveTurn(gameData); // Call the turn resolution function
        }

        // Update timer
        if (gameData.turnStartTime) {
            // Clear previous interval to avoid overlaps
            if (countdownInterval) {
                clearInterval(countdownInterval);
            }

            const startTime = gameData.turnStartTime;

            // Start new interval only if it's your turn and you haven't acted yet
            if (isYourTurn && yourPlayer.action === null) {
                countdownInterval = setInterval(() => {
                    const elapsedMilliseconds = Date.now() - startTime;
                    const remainingSeconds = Math.max(0, GAME_TURN_DURATION_SECONDS - (elapsedMilliseconds / 1000));

                    if (remainingSeconds <= 0) {
                        clearInterval(countdownInterval);
                        countdownInterval = null;
                        // Handle case where time runs out (e.g., skip turn, default action)
                        if (isYourTurn && yourPlayer.action === null) {
                            console.log("Time's up! Default action (defend).");
                            performAction('defend'); // Default action if time runs out
                        }
                    }
                    updateTimerUI(remainingSeconds, GAME_TURN_DURATION_SECONDS); // Call utils.js function
                }, 1000); // Update every second
            } else {
                // If it's not your turn or you've already acted, stop the countdown
                if (countdownInterval) {
                    clearInterval(countdownInterval);
                    countdownInterval = null;
                }
                updateTimerUI(GAME_TURN_DURATION_SECONDS, GAME_TURN_DURATION_SECONDS); // Reset visually
                if (timerDisplay) timerDisplay.textContent = 'Waiting...';
            }
        }

    } else if (gameData.status === 'finished') {
        disableActionButtons(); // Use the new function
        if (countdownInterval) { // Stop timer if game is finished
            clearInterval(countdownInterval);
            countdownInterval = null;
        }
        const winnerPseudo = gameData.players[gameData.winner].pseudo;
        showMessage('action-msg', `The match is over! ${winnerPseudo} won!`, true);
        if (opponentActionStatus) opponentActionStatus.textContent = '';
    }
}

// Function to perform an action (for human player)
async function performAction(actionType) {
    if (!gameId || !youKey || !matchRef) {
        console.error("Match not initialized.");
        showMessage('action-msg', 'Error: Match not initialized.', false);
        return;
    }

    // Disable buttons immediately to prevent multiple clicks
    disableActionButtons(); // Use the new function
    showMessage('action-msg', 'Sending your action...', true);

    try {
        await runTransaction(matchRef, (currentMatch) => {
            if (!currentMatch || currentMatch.status !== 'playing' || currentMatch.turn !== youKey) {
                console.log("Transaction aborted: Not your turn or game not in progress.");
                // Do not re-enable buttons here, the listener will handle it
                return undefined; // Abort the transaction
            }

            const yourPlayer = currentMatch.players[youKey];
            // Handle cooldowns
            if (actionType === 'heal' && yourPlayer.healCooldown > 0) {
                showMessage('action-msg', `Heal on cooldown. Wait ${yourPlayer.healCooldown} turns.`, false);
                enableActionButtons(); // Re-enable buttons if cooldown
                return undefined; // Abort the transaction
            }

            // Record player's action
            yourPlayer.action = actionType;

            // Return the updated match object
            return currentMatch;
        });

        console.log(`Action "${actionType}" recorded for ${youKey}.`);
        // The UI will be updated via the onValue listener when Firebase confirms the action
    } catch (error) {
        console.error("Error recording action:", error);
        showMessage('action-msg', `Error during action: ${error.message}`, false);
        enableActionButtons(); // Re-enable buttons on failure
    }
}

// --- New function to resolve a game turn ---
async function resolveTurn(gameData) {
    const matchRef = ref(db, `matches/${gameData.id}`);

    try {
        await runTransaction(matchRef, (currentMatch) => {
            if (!currentMatch || currentMatch.status !== 'playing') {
                return undefined; // Abort if game state changed
            }

            // Check if this turn has already been resolved
            // If actions are already null, the turn has been processed.
            if (currentMatch.players.p1.action === null && currentMatch.players.p2.action === null) {
                 return undefined; // Turn has already been resolved.
            }

            const p1 = currentMatch.players.p1;
            const p2 = currentMatch.players.p2;

            let logMessages = [];
            let p1DamageTaken = 0;
            let p2DamageTaken = 0;

            // Pre-calculate base damage/healing for each action
            const actionEffects = {
                'attack': { damage: 10 },
                'defend': { mitigation: 5 }, // Damage reduction received
                'heal': { amount: 15, cooldown: 3 }
            };

            // Apply P1's actions
            if (p1.action === 'attack') {
                logMessages.push(`[${p1.pseudo}] attacks!`);
                p2DamageTaken += actionEffects.attack.damage;
            } else if (p1.action === 'defend') {
                logMessages.push(`[${p1.pseudo}] defends!`);
                p1.isDefending = true; // Mark as defending
            } else if (p1.action === 'heal') {
                logMessages.push(`[${p1.pseudo}] heals!`);
                p1.pv += actionEffects.heal.amount;
                if (p1.pv > 100) p1.pv = 100;
                p1.healCooldown = actionEffects.heal.cooldown;
            }

            // Apply P2's actions
            if (p2.action === 'attack') {
                logMessages.push(`[${p2.pseudo}] attacks!`);
                p1DamageTaken += actionEffects.attack.damage;
            } else if (p2.action === 'defend') {
                logMessages.push(`[${p2.pseudo}] defends!`);
                p2.isDefending = true; // Mark as defending
            } else if (p2.action === 'heal') {
                logMessages.push(`[${p2.pseudo}] heals!`);
                p2.pv += actionEffects.heal.amount;
                if (p2.pv > 100) p2.pv = 100;
                p2.healCooldown = actionEffects.heal.cooldown;
            }

            // Apply defense mitigation
            if (p1.isDefending) {
                p1DamageTaken = Math.max(0, p1DamageTaken - actionEffects.defend.mitigation);
                p1.isDefending = false; // Reset for next turn
            }
            if (p2.isDefending) {
                p2DamageTaken = Math.max(0, p2DamageTaken - actionEffects.defend.mitigation);
                p2.isDefending = false; // Reset for next turn
            }

            // Apply final damage
            p1.pv -= p1DamageTaken;
            p2.pv -= p2DamageTaken;

            if (p1DamageTaken > 0) logMessages.push(`[${p1.pseudo}] receives ${p1DamageTaken} damage.`);
            if (p2DamageTaken > 0) logMessages.push(`[${p2.pseudo}] receives ${p2DamageTaken} damage.`);

            // Decrement heal cooldowns
            if (p1.healCooldown > 0) p1.healCooldown--;
            if (p2.healCooldown > 0) p2.healCooldown--;


            // Add messages to history log
            if (!currentMatch.history) currentMatch.history = [];
            currentMatch.history.push(...logMessages);

            // Check if the match is over
            if (p1.pv <= 0 && p2.pv <= 0) {
                 // Double K.O. case - can decide a draw or based on who had less HP before this turn.
                 // For now, AI wins on double K.O.
                p1.pv = 0;
                p2.pv = 0;
                currentMatch.winner = 'p2'; // AI wins on double K.O.
                currentMatch.status = 'finished';
                currentMatch.history.push(`Double K.O.!`);
                currentMatch.history.push(`[${currentMatch.players.p2.pseudo}] wins the game!`); // AI
            } else if (p1.pv <= 0) {
                p1.pv = 0;
                currentMatch.winner = 'p2'; // AI wins
                currentMatch.status = 'finished';
                currentMatch.history.push(`[${p1.pseudo}] has been defeated!`);
                currentMatch.history.push(`[${currentMatch.players.p2.pseudo}] wins the game!`);
            } else if (p2.pv <= 0) {
                p2.pv = 0;
                currentMatch.winner = 'p1'; // Human player wins
                currentMatch.status = 'finished';
                currentMatch.history.push(`[${currentMatch.players.p2.pseudo}] has been defeated!`);
                currentMatch.history.push(`[${currentMatch.players.p1.pseudo}] wins the game!`);
            } else {
                // Advance to the next turn if the match continues
                currentMatch.turnCounter = (currentMatch.turnCounter || 0) + 1;
                // The turn is always passed to the human player (p1) for the next decision
                currentMatch.turn = 'p1';
                currentMatch.turnStartTime = serverTimestamp(); // Use server timestamp for synchronization
                currentMatch.history.push(`--- Start of Turn ${currentMatch.turnCounter + 1} ---`);
                currentMatch.history.push(`It's [${currentMatch.players.p1.pseudo}]'s turn.`);
            }

            // Reset actions for the next turn
            // This is important to prevent resolveTurn from triggering in a loop
            p1.action = null;
            p2.action = null;

            return currentMatch;
        });
        console.log("Turn successfully resolved in Firebase.");
    } catch (error) {
        console.error("Error resolving turn:", error);
    }
}

// Function to leave the match
export function leaveGame() {
    console.log("Leaving the match.");
    if (gameListener) {
        off(matchRef, 'value', gameListener); // Stop Firebase listener
    }
    if (countdownInterval) { // Stop timer when leaving the game
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
    gameId = null;
    youKey = null;
    opponentKey = null;
    gameMode = null;
    matchRef = null;
    gameListener = null;

    // Reset UI and return to main menu
    showMainMenu(); // Use the new function from utils.js
    showMessage('action-msg', '', true); // Clear action message
    disableActionButtons(); // Ensure buttons are disabled
    if (opponentActionStatus) opponentActionStatus.textContent = '';
    // For a complete game UI reset
    if (player1PVDisplay) player1PVDisplay.textContent = '100 PV';
    if (player2PVDisplay) player2PVDisplay.textContent = '100 PV';
    // Use updateHealthBar with string IDs as required by utils.js
    if (youHealthBar) updateHealthBar('you-health-bar', 100);
    if (opponentHealthBar) updateHealthBar('opponent-health-bar', 100);
    // Call updateTimerUI without specific elements for reset
    updateTimerUI(GAME_TURN_DURATION_SECONDS, GAME_TURN_DURATION_SECONDS);
    if (timerDisplay) timerDisplay.textContent = `${GAME_TURN_DURATION_SECONDS}s`; // Reset timer text
    clearHistory(); // Use the new function from utils.js
}
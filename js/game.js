// game.js - relevant parts to check

import { db } from "./firebaseConfig.js";
import { ref, update, serverTimestamp, onValue, off, remove } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js";
import { currentUser, currentMatchId, youKey, opponentKey, gameMode,
         timerMax, timerInterval, setTimerInterval,
         onDisconnectRef, setOnDisconnectRef,
         matchDeletionTimeout, setMatchDeletionTimeout,
         hasPlayedThisTurn, setHasPlayedThisTurn, setMatchVariables, backToMenu, updateUserStats } from "./main.js";
import { showMessage, updateHealthBar, updateTimerUI, clearHistory, appendToHistory, enableActionButtons, disableActionButtons } from "./utils.js";


let currentMatchUnsubscribe = null; // To store the unsubscribe function for the match listener

export function startMatchMonitoring(matchId, user, playerKey, mode) {
    setMatchVariables(matchId, user, playerKey, mode); // Update global variables from main.js

    // Show game UI, hide other UIs
    document.getElementById("main-menu").style.display = "none"; // Corrected from "match"
    document.getElementById("matchmaking-status").style.display = "none"; // Hide matchmaking
    document.getElementById("auth").style.display = "none"; // Hide auth if visible
    document.getElementById("game").style.display = "block"; // Show game UI

    // Initialize UI for new game
    document.getElementById("current-match").textContent = matchId;
    document.getElementById("you-name").textContent = currentUser.pseudo;
    document.getElementById("opponent-name").textContent = (gameMode === 'PvAI' ? 'IA' : 'Adversaire'); // Correct opponent name for AI
    updateHealthBar('you', 100);
    updateHealthBar('opponent', 100);
    clearHistory();
    appendToHistory(`Début du match ${matchId} en mode ${gameMode}.`);
    showMessage("action-msg", "C'est votre tour ! Choisissez une action.");
    enableActionButtons(); // Make sure buttons are enabled at the start

    const matchRef = ref(db, `matches/${currentMatchId}`);

    // Set up onDisconnect to handle player leaving
    // This should be done only once when a player connects to a match
    if (!onDisconnectRef) { // Ensure it's not set multiple times
        const statusPath = `players/${youKey}/status`;
        const lastSeenPath = `players/${youKey}/lastSeen`;
        const actionPath = `players/${youKey}/action`;

        const disconnectRef = ref(db, `matches/${currentMatchId}/${statusPath}`);
        setOnDisconnectRef(disconnectRef.onDisconnect());
        onDisconnectRef.set('forfeited').then(() => {
            console.log(`onDisconnect set for ${youKey}`);
        }).catch(error => {
            console.error("Failed to set onDisconnect for status:", error);
        });

        // Also update lastSeen on disconnect
        const lastSeenDisconnectRef = ref(db, `matches/${currentMatchId}/${lastSeenPath}`);
        lastSeenDisconnectRef.onDisconnect().set(serverTimestamp()).catch(error => {
             console.error("Failed to set onDisconnect for lastSeen:", error);
        });

        // Clear player action on disconnect
        const actionDisconnectRef = ref(db, `matches/${currentMatchId}/${actionPath}`);
        actionDisconnectRef.onDisconnect().remove().catch(error => {
             console.error("Failed to set onDisconnect for action:", error);
        });
    }

    // Main match listener
    // Unsubscribe from previous listener if any
    if (currentMatchUnsubscribe) {
        currentMatchUnsubscribe();
        currentMatchUnsubscribe = null;
    }

    currentMatchUnsubscribe = onValue(matchRef, (snapshot) => {
        const matchData = snapshot.val();
        if (!matchData) {
            console.log("Match data not found or deleted. Returning to menu.");
            if (currentMatchUnsubscribe) {
                currentMatchUnsubscribe(); // Unsubscribe immediately
                currentMatchUnsubscribe = null;
            }
            if (matchDeletionTimeout) {
                clearTimeout(matchDeletionTimeout);
                setMatchDeletionTimeout(null);
            }
            backToMenu(true);
            return;
        }

        const youData = matchData.players[youKey];
        const opponentData = matchData.players[opponentKey];

        // Update UI health and names
        document.getElementById("you-name").textContent = youData.pseudo;
        document.getElementById("opponent-name").textContent = opponentData.pseudo;
        updateHealthBar('you', youData.pv);
        updateHealthBar('opponent', opponentData.pv);
        document.getElementById("you-pv-display").textContent = `${youData.pv} PV`;
        document.getElementById("opponent-pv-display").textContent = `${opponentData.pv} PV`;
        
        // Update history
        clearHistory(); // Clear previous history
        if (matchData.history) {
            matchData.history.forEach(entry => appendToHistory(entry));
        }

        // Check for game end conditions
        if (matchData.status === 'finished') {
            handleGameEnd(matchData);
            return;
        }

        // Check for opponent disconnection/forfeit in PvP
        if (gameMode === 'PvP' && opponentData.status === 'forfeited') {
            handleGameEnd(matchData, `${opponentData.pseudo} a abandonné le match. Vous avez gagné !`);
            return;
        }


        // --- Turn Management ---
        const currentTurnPlayerKey = matchData.turn;

        // Update timer UI only if a timer is active
        if (timerInterval) {
            const timeElapsed = Math.floor((Date.now() - new Date(matchData.lastTurnProcessedAt).getTime()) / 1000);
            const timeLeft = Math.max(0, timerMax - timeElapsed);
            updateTimerUI(timeLeft, timerMax);
        }

        if (currentTurnPlayerKey === youKey) {
            // Your Turn
            enableActionButtons();
            showMessage("action-msg", "C'est votre tour ! Choisissez une action.");
            document.getElementById("opponent-action-status").textContent = ""; // Clear opponent's action status
            setHasPlayedThisTurn(false); // Reset for current player
            
            // Start or reset timer for your turn
            if (timerInterval) clearInterval(timerInterval);
            let timeLeft = timerMax;
            updateTimerUI(timeLeft, timerMax);
            setTimerInterval(setInterval(() => {
                timeLeft--;
                updateTimerUI(timeLeft, timerMax);
                if (timeLeft <= 0) {
                    clearInterval(timerInterval);
                    setTimerInterval(null);
                    // Automatically pass turn or perform default action if time runs out
                    if (!hasPlayedThisTurn) { // Only if player hasn't played yet
                        appendToHistory(`${currentUser.pseudo} n'a pas agi à temps.`);
                        // Forfeit or a default action (e.g., defend) can be implemented here
                        update(ref(db, `matches/${currentMatchId}/players/${youKey}`), { action: 'defend' }); // Default action
                        // Note: processTurn will be triggered by opponent's action or next turn.
                        // For AI, AI action will be triggered. For PvP, opponent waits for their turn.
                    }
                }
            }, 1000));

        } else {
            // Opponent's Turn (or AI's Turn)
            disableActionButtons();
            showMessage("action-msg", `C'est le tour de ${opponentData.pseudo}...`);
            setHasPlayedThisTurn(true); // Player cannot act on opponent's turn

            // Clear your timer if active
            if (timerInterval) {
                clearInterval(timerInterval);
                setTimerInterval(null);
                updateTimerUI(timerMax, timerMax); // Reset timer UI
            }

            if (opponentData.action) {
                // If opponent has already submitted an action, process it
                // This typically happens if the previous turn was ours and we submitted an action.
                // Or if AI processes its action quickly.
                document.getElementById("opponent-action-status").textContent = "Action choisie.";
                processTurn(matchData); // Process turn as both actions are available (or AI has acted)
            } else {
                // If opponent hasn't acted yet (PvP) or it's AI's turn
                document.getElementById("opponent-action-status").textContent = "En attente de l'action...";
                if (gameMode === 'PvAI' && opponentData.pseudo === 'IA' && currentMatchId === matchData.id) {
                    // It's the AI's turn and it hasn't acted yet
                    // Add a slight delay for realism
                    if (!timerInterval) { // Prevent multiple AI actions
                         console.log("AI's turn. Waiting for AI action.");
                         setTimerInterval(setTimeout(() => { // Using setTimeout as a simple delay for AI
                             performAIAction(matchId, matchData);
                             // The AI action will trigger the onValue listener again,
                             // which will then process the turn if both actions are ready.
                             setTimerInterval(null); // Clear this specific AI timeout
                         }, 1500)); // 1.5 second delay for AI
                    }
                }
            }
        }
    });

    // Event listeners for action buttons
    document.getElementById("action-attack").onclick = () => performAction('attack');
    document.getElementById("action-defend").onclick = () => performAction('defend');
    document.getElementById("action-heal").onclick = () => performAction('heal');
    document.getElementById("back-to-menu-btn").onclick = () => handleForfeit(); // Forfeit logic
}

async function performAction(actionType) {
    if (!currentMatchId || !currentUser || !youKey || hasPlayedThisTurn) {
        showMessage("action-msg", "Ce n'est pas votre tour ou vous avez déjà agi.");
        return;
    }

    // Set player's action in Firebase
    try {
        const playerActionRef = ref(db, `matches/${currentMatchId}/players/${youKey}/action`);
        await set(playerActionRef, actionType);
        showMessage("action-msg", `Vous avez choisi : ${actionType}`);
        disableActionButtons();
        setHasPlayedThisTurn(true); // Mark that player has played this turn
    } catch (error) {
        console.error("Error setting player action:", error);
        showMessage("action-msg", "Erreur lors de l'envoi de l'action.");
    }
}

// THIS IS THE KEY FUNCTION FOR AI LOGIC
async function performAIAction(matchId, matchData) {
    if (!matchId || !matchData || matchData.players[opponentKey].action) {
        // AI already acted or match data is invalid
        return;
    }

    const aiPlayer = matchData.players[opponentKey]; // opponentKey holds 'p2' for AI
    const player1 = matchData.players[youKey]; // youKey holds 'p1' for player

    let aiAction = 'attack'; // Default AI action

    // Simple AI logic
    if (aiPlayer.pv < 30 && aiPlayer.healCooldown === 0) {
        aiAction = 'heal'; // Heal if low health and heal is off cooldown
    } else if (player1.pv > 50 && Math.random() < 0.7) {
        aiAction = 'attack'; // More likely to attack if player has high health
    } else {
        aiAction = 'defend'; // Otherwise, defend
    }

    // Set AI's action in Firebase
    try {
        const aiActionRef = ref(db, `matches/${matchId}/players/${opponentKey}/action`);
        await set(aiActionRef, aiAction);
        console.log(`AI chose: ${aiAction}`);
    } catch (error) {
        console.error("Error setting AI action:", error);
    }
}


async function processTurn(matchData) {
    // Only process if both players (or player and AI) have chosen an action
    if (!matchData.players.p1.action || !matchData.players.p2.action) {
        console.log("Waiting for both players to act.");
        return; // Wait until both actions are set
    }

    // Stop timer if it's running
    if (timerInterval) {
        clearInterval(timerInterval);
        setTimerInterval(null);
    }

    disableActionButtons(); // Disable buttons while processing

    const p1 = matchData.players.p1;
    const p2 = matchData.players.p2;
    const p1Action = p1.action;
    const p2Action = p2.action;

    let p1Damage = 10;
    let p2Damage = 10;
    let p1Heal = 15;
    let p2Heal = 15;

    let historyUpdates = [];
    historyUpdates.push(`--- Tour ${matchData.turnCount || 1} ---`); // Add turn count to history

    // Apply heal cooldowns
    if (p1.healCooldown > 0) {
        p1.healCooldown--;
    }
    if (p2.healCooldown > 0) {
        p2.healCooldown--;
    }

    // Determine damage based on actions
    if (p1Action === 'defend') {
        p2Damage -= 5; // P1 defends, P2's attack is reduced
        historyUpdates.push(`${p1.pseudo} se défend.`);
    } else if (p1Action === 'heal') {
        if (p1.healCooldown === 0) {
            p1.pv = Math.min(100, p1.pv + p1Heal);
            p1.healCooldown = 2; // 2 turns cooldown
            historyUpdates.push(`${p1.pseudo} se soigne et récupère ${p1Heal} PV. PV: ${p1.pv}`);
        } else {
            historyUpdates.push(`${p1.pseudo} tente de se soigner mais c'est en CD (${p1.healCooldown} tours restants).`);
            // Default to defend if heal is on cooldown
            p2Damage -= 5;
            historyUpdates.push(`${p1.pseudo} se défend par défaut.`);
        }
    } else if (p1Action === 'attack') {
        historyUpdates.push(`${p1.pseudo} attaque.`);
    }

    if (p2Action === 'defend') {
        p1Damage -= 5; // P2 defends, P1's attack is reduced
        historyUpdates.push(`${p2.pseudo} se défend.`);
    } else if (p2Action === 'heal') {
        if (p2.healCooldown === 0) {
            p2.pv = Math.min(100, p2.pv + p2Heal);
            p2.healCooldown = 2; // 2 turns cooldown
            historyUpdates.push(`${p2.pseudo} se soigne et récupère ${p2Heal} PV. PV: ${p2.pv}`);
        } else {
            historyUpdates.push(`${p2.pseudo} tente de se soigner mais c'est en CD (${p2.healCooldown} tours restants).`);
            // Default to defend if heal is on cooldown
            p1Damage -= 5;
            historyUpdates.push(`${p2.pseudo} se défend par défaut.`);
        }
    } else if (p2Action === 'attack') {
        historyUpdates.push(`${p2.pseudo} attaque.`);
    }

    // Apply damage (only if not healing)
    if (p1Action !== 'heal' || p1.healCooldown > 0) { // Only take damage if not successfully healed (or heal was on CD, so they defended)
        p1.pv -= Math.max(0, p1Damage);
        historyUpdates.push(`${p1.pseudo} a reçu ${Math.max(0, p1Damage)} dégâts. PV restants: ${p1.pv}`);
    }
    if (p2Action !== 'heal' || p2.healCooldown > 0) { // Same for p2
        p2.pv -= Math.max(0, p2Damage);
        historyUpdates.push(`${p2.pseudo} a reçu ${Math.max(0, p2Damage)} dégâts. PV restants: ${p2.pv}`);
    }

    // Ensure PV doesn't go below zero
    p1.pv = Math.max(0, p1.pv);
    p2.pv = Math.max(0, p2.pv);

    // Update Firebase with new PVs and clear actions
    const updates = {};
    updates[`matches/${currentMatchId}/players/p1/pv`] = p1.pv;
    updates[`matches/${currentMatchId}/players/p1/action`] = null;
    updates[`matches/${currentMatchId}/players/p1/lastAction`] = p1Action; // Store last action for display
    updates[`matches/${currentMatchId}/players/p1/healCooldown`] = p1.healCooldown;

    updates[`matches/${currentMatchId}/players/p2/pv`] = p2.pv;
    updates[`matches/${currentMatchId}/players/p2/action`] = null;
    updates[`matches/${currentMatchId}/players/p2/lastAction`] = p2Action; // Store last action for display
    updates[`matches/${currentMatchId}/players/p2/healCooldown`] = p2.healCooldown;

    // Advance turn and update turn count
    updates[`matches/${currentMatchId}/turn`] = (matchData.turn === 'p1') ? 'p2' : 'p1';
    updates[`matches/${currentMatchId}/turnCount`] = (matchData.turnCount || 0) + 1;
    updates[`matches/${currentMatchId}/lastTurnProcessedAt`] = serverTimestamp(); // Mark turn processed

    // Add current turn's history to match history
    const newHistory = (matchData.history || []).concat(historyUpdates);
    updates[`matches/${currentMatchId}/history`] = newHistory;

    // Check for game end conditions after applying damage
    let gameEnded = false;
    let winnerKey = null;
    let loserKey = null;

    if (p1.pv <= 0 && p2.pv <= 0) {
        updates[`matches/${currentMatchId}/status`] = 'finished';
        updates[`matches/${currentMatchId}/result`] = 'draw';
        newHistory.push("Match nul ! Les deux joueurs sont à terre.");
        gameEnded = true;
        updateUserStats('draw');
    } else if (p1.pv <= 0) {
        updates[`matches/${currentMatchId}/status`] = 'finished';
        updates[`matches/${currentMatchId}/result`] = `${p2.pseudo} gagne !`;
        newHistory.push(`${p2.pseudo} gagne !`);
        gameEnded = true;
        winnerKey = 'p2';
        loserKey = 'p1';
    } else if (p2.pv <= 0) {
        updates[`matches/${currentMatchId}/status`] = 'finished';
        updates[`matches/${currentMatchId}/result`] = `${p1.pseudo} gagne !`;
        newHistory.push(`${p1.pseudo} gagne !`);
        gameEnded = true;
        winnerKey = 'p1';
        loserKey = 'p2';
    }

    try {
        await update(ref(db), updates);
        console.log("Turn processed and Firebase updated.");

        if (gameEnded) {
            handleGameEnd(matchData); // Will be triggered by status 'finished' in onValue listener
        }

    } catch (error) {
        console.error("Error processing turn:", error);
    }
}


function handleGameEnd(matchData, customMessage = null) {
    if (currentMatchUnsubscribe) {
        currentMatchUnsubscribe(); // Stop listening to this match
        currentMatchUnsubscribe = null;
    }
    if (timerInterval) {
        clearInterval(timerInterval);
        setTimerInterval(null);
    }
    disableActionButtons(); // Ensure buttons are disabled

    let resultMessage = customMessage;
    if (!resultMessage) {
        const youWon = (matchData.players[youKey].pv > 0 && matchData.players[opponentKey].pv <= 0);
        const opponentWon = (matchData.players[opponentKey].pv > 0 && matchData.players[youKey].pv <= 0);
        const isDraw = (matchData.players[youKey].pv <= 0 && matchData.players[opponentKey].pv <= 0);

        if (youWon) {
            resultMessage = "Vous avez gagné le match !";
            updateUserStats('win');
        } else if (opponentWon) {
            resultMessage = "Vous avez perdu le match...";
            updateUserStats('loss');
        } else if (isDraw) {
            resultMessage = "Le match est un match nul !";
            updateUserStats('draw');
        } else {
            resultMessage = matchData.result || "Le match est terminé."; // Fallback for various end conditions
        }
    }

    showMessage("action-msg", resultMessage);
    appendToHistory(resultMessage);
    
    // Schedule match deletion for PvP after a delay (e.g., 5 minutes)
    // For PvAI, we can delete immediately or after a shorter delay
    if (gameMode === 'PvP') {
        appendToHistory("Ce match sera supprimé dans 5 minutes.");
        // Set a timeout to clean up the match from Firebase
        if (matchDeletionTimeout) clearTimeout(matchDeletionTimeout); // Clear previous timeout if exists
        setMatchDeletionTimeout(setTimeout(async () => {
            try {
                await remove(ref(db, `matches/${currentMatchId}`));
                console.log(`Match ${currentMatchId} deleted.`);
                backToMenu(true);
            } catch (error) {
                console.error("Error deleting match:", error);
            }
        }, 5 * 60 * 1000)); // 5 minutes
    } else { // PvAI
        appendToHistory("Match IA terminé. Retour au menu après 5 secondes.");
        if (matchDeletionTimeout) clearTimeout(matchDeletionTimeout);
        setMatchDeletionTimeout(setTimeout(async () => {
            try {
                await remove(ref(db, `matches/${currentMatchId}`));
                console.log(`PvAI match ${currentMatchId} deleted.`);
                backToMenu(true);
            } catch (error) {
                console.error("Error deleting PvAI match:", error);
            }
        }, 5000)); // 5 seconds for AI match
    }
}


async function handleForfeit() {
    if (!currentMatchId || !currentUser || !youKey) {
        backToMenu(true); // Just go back if no match context
        return;
    }

    // Confirm with user
    const confirmForfeit = confirm("Êtes-vous sûr de vouloir abandonner le match ? Cela comptera comme une défaite.");
    if (!confirmForfeit) {
        return;
    }

    try {
        // Update player status to 'forfeited'
        const playerStatusRef = ref(db, `matches/${currentMatchId}/players/${youKey}/status`);
        await set(playerStatusRef, 'forfeited');

        // Add to history
        const matchHistoryRef = ref(db, `matches/${currentMatchId}/history`);
        const historyEntry = `${currentUser.pseudo} a abandonné le match.`;
        await update(matchHistoryRef, { [Date.now()]: historyEntry }); // Use timestamp as key to avoid overwriting

        // For PvP, opponent listener will catch this and declare victory.
        // For PvAI, the game end condition will be met as AI will be the only one standing.
        // The onDisconnect will also ensure this status is set if connection is lost.
        updateUserStats('loss'); // Record a loss for the forfeiting player
        showMessage("action-msg", "Vous avez abandonné le match.");
        backToMenu(true); // Return to menu immediately
    } catch (error) {
        console.error("Error forfeiting match:", error);
        showMessage("action-msg", "Erreur lors de l'abandon du match.");
    }
}

document.getElementById("back-to-menu-btn").addEventListener("click", handleForfeit);
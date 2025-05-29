import { db } from "./firebaseConfig.js";
import { ref, get, update, onValue, onDisconnect, remove, serverTimestamp, deleteField } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js";
import { showMessage, disableActionButtons, updateHealthBar, updateTimerUI, clearHistory } from "./utils.js";
import { backToMenu, currentUser, currentMatchId, youKey, opponentKey, gameMode, setMatchVariables, timerMax, timerInterval, setTimerInterval, setOnDisconnectRef, onDisconnectRef, matchDeletionTimeout, setMatchDeletionTimeout, hasPlayedThisTurn, setHasPlayedThisTurn, updateUserStats } from "./main.js";

let currentMatchUnsubscribe = null;

export async function startMatchMonitoring(id, user, playerKey, mode) {
    // Clean up previous listeners and timers
    if (currentMatchUnsubscribe) { currentMatchUnsubscribe(); currentMatchUnsubscribe = null; }
    if (timerInterval) { clearInterval(timerInterval); setTimerInterval(null); }
    if (onDisconnectRef) { onDisconnectRef.cancel().catch(err => console.error("Error canceling old onDisconnect:", err)); setOnDisconnectRef(null); }
    if (matchDeletionTimeout) { clearTimeout(matchDeletionTimeout); setMatchDeletionTimeout(null); }

    setMatchVariables(id, user, playerKey, mode); // Update global variables in main.js

    // Initialize UI
    document.getElementById("match").style.display = "none";
    document.getElementById("game").style.display = "block";
    document.getElementById("current-match").textContent = id;
    document.getElementById("you-name").textContent = user.pseudo;
    clearHistory();
    document.getElementById("opponent-action-status").textContent = "";

    setHasPlayedThisTurn(false);
    disableActionButtons(true);
    showMessage("action-msg", "Loading match...");

    const matchRef = ref(db, `matches/${id}`);

    currentMatchUnsubscribe = onValue(matchRef, async (snapshot) => {
        console.log("onValue triggered (full snapshot):", snapshot.val());
        const data = snapshot.val();

        // --- START DEBUG LOGS FOR ONVALUE ---
        console.log("DEBUG onValue - Current data.turn:", data?.turn);
        console.log("DEBUG onValue - Current data.players.p1.action:", data?.players?.p1?.action);
        console.log("DEBUG onValue - Current data.players.p2.action:", data?.players?.p2?.action);
        console.log("DEBUG onValue - Current data.status:", data?.status);
        console.log("DEBUG onValue - youKey:", youKey);
        console.log("DEBUG onValue - opponentKey:", opponentKey);
        // --- END DEBUG LOGS FOR ONVALUE ---


        // 1. Handle deleted or non-existent match
        if (!data) {
            if (currentMatchId === id) {
                showMessage("action-msg", "The match has ended or been deleted.");
                if (currentMatchUnsubscribe) currentMatchUnsubscribe();
                currentMatchUnsubscribe = null;
                setTimeout(() => backToMenu(true), 3000);
            }
            return;
        }

        // Determine current player's role (p1 or p2) and opponent
        const you = data.players[youKey];
        const opponent = data.players[opponentKey];

        // 2. Check if the player is in the match
        if (!you) {
            showMessage("action-msg", "You are not a player in this match.");
            disableActionButtons(true);
            if (timerInterval) { clearInterval(timerInterval); setTimerInterval(null); }
            return;
        }

        // 3. Update lastSeen and set onDisconnect (PvP only)
        if (gameMode === 'PvP') {
            const yourPlayerRef = ref(db, `matches/${id}/players/${youKey}`);
            if (!onDisconnectRef) {
                const newOnDisconnectRef = onDisconnect(yourPlayerRef);
                newOnDisconnectRef.update({
                    pv: 0,
                    status: 'forfeited',
                    lastSeen: serverTimestamp()
                }).catch(error => console.error("Error setting onDisconnect:", error));
                setOnDisconnectRef(newOnDisconnectRef);
            }
            update(yourPlayerRef, { lastSeen: serverTimestamp(), status: 'connected' });
        }

        // 4. Update UI with player data (HP, names)
        updateHealthBar(document.getElementById("you-health-bar"), document.getElementById("you-pv-display"), you.pv);
        document.getElementById("you-name").textContent = `${you.pseudo} (You)`;
        console.log("Player PV (onValue - UI Update):", you.pv); // Debugging: Player's HP

        let opponentActionStatus = "";
        if (opponent) {
            updateHealthBar(document.getElementById("opponent-health-bar"), document.getElementById("opponent-pv-display"), opponent.pv, true);
            document.getElementById("opponent-name").textContent = opponent.pseudo;
            console.log("Opponent PV (onValue - UI Update):", opponent.pv); // Debugging: Opponent's HP
            if (opponent.action) {
                opponentActionStatus = "Action submitted!";
            } else if (data.turn === opponentKey) {
                opponentActionStatus = "Waiting for opponent's action...";
            }
            // Handle opponent forfeit in PvP
            if (gameMode === 'PvP' && (opponent.status === 'forfeited' || opponent.pv <= 0)) {
                showMessage("action-msg", `The opponent (${opponent.pseudo}) has left the match or is defeated.`);
                handleGameEnd(data, 'win');
                return; // Exit after handling game end
            }
        } else {
            // Case where opponent doesn't exist yet (e.g., waiting in PvP)
            document.getElementById("opponent-pv-display").textContent = "N/A";
            document.getElementById("opponent-health-bar").style.width = "0%";
            document.getElementById("opponent-health-bar").textContent = "0%";
            document.getElementById("opponent-name").textContent = "Waiting...";
            opponentActionStatus = "Waiting for an opponent...";
        }
        document.getElementById("opponent-action-status").textContent = opponentActionStatus;

        // 5. Game end conditions (after HP update for correct display)
        if (data.status === 'finished' || you.pv <= 0 || (opponent && opponent.pv <= 0)) {
            if (onDisconnectRef) { onDisconnectRef.cancel().catch(error => console.error("Error cancelling onDisconnect:", error)); setOnDisconnectRef(null); }
            let finalResult = "draw";
            if (you.pv > 0 && (opponent && opponent.pv <= 0)) {
                finalResult = "win";
            } else if (you.pv <= 0 && (opponent && opponent.pv > 0)) {
                finalResult = "loss";
            }
            handleGameEnd(data, finalResult);
            return; // Exit if game is over
        }

        // 6. If match is waiting for P2 (PvP only)
        if (gameMode === 'PvP' && (data.status === "waiting" || !opponent)) {
            showMessage("action-msg", "Waiting for opponent...");
            disableActionButtons(true);
            if (timerInterval) { clearInterval(timerInterval); setTimerInterval(null); }
            updateTimerUI(timerMax);
            return; // Wait for opponent
        }

        // --- START KEY TURN LOGIC ---
        const currentTime = Date.now();
        // Ensure lastTurnProcessedAt is a number
        const lastTurnProcessedTime = data.lastTurnProcessedAt && typeof data.lastTurnProcessedAt.toMillis === 'function'
            ? data.lastTurnProcessedAt.toMillis()
            : (data.lastTurnProcessedAt || currentTime); 
        
        // Timer is managed by setInterval, not directly here.
        if (timerInterval) { clearInterval(timerInterval); setTimerInterval(null); } // Always clear old timer

        let activePlayerKey = data.turn;
        let activePlayer = data.players[activePlayerKey];
        
        console.log("Current turn in onValue (activePlayerKey):", activePlayerKey); // Debugging: Who is supposed to play this turn

        // HUMAN PLAYER LOGIC
        if (youKey === activePlayerKey) {
            if (!you.action) { // Check directly if player's action is not yet submitted
                disableActionButtons(false);
                showMessage("action-msg", "It's your turn! Choose an action.");
                
                // Start timer for human player
                setTimerInterval(setInterval(() => {
                    const currentElapsed = Math.floor((Date.now() - lastTurnProcessedTime) / 1000);
                    const currentRemaining = Math.max(0, timerMax - currentElapsed);
                    updateTimerUI(currentRemaining);
                    if (currentRemaining <= 0) {
                        clearInterval(timerInterval);
                        setTimerInterval(null);
                        // Submit default action if time runs out
                        submitDefaultAction(youKey, matchRef, data);
                    }
                }, 1000));
            } else {
                // Player has already submitted their action
                disableActionButtons(true);
                showMessage("action-msg", "Action played. Waiting for opponent...");
                updateTimerUI(timerMax); // Reset visual timer
            }
        } else { // It's not the human player's turn (it's the opponent's turn, or processing)
            disableActionButtons(true);
            showMessage("action-msg", `It's ${opponent ? opponent.pseudo : 'the opponent'}'s turn. Please wait...`);
            updateTimerUI(timerMax); // Reset visual timer
        }

        // TURN PROCESSING LOGIC (if both actions are submitted)
        if (data.players.p1?.action && data.players.p2?.action) {
            // It's P1's role (or the client in PvAI mode) to process the turn
            if (youKey === 'p1' || gameMode === 'PvAI') { // For PvAI, the P1 client always handles processing.
                console.log("Both actions submitted. P1/AI client processing turn.");
                disableActionButtons(true);
                showMessage("action-msg", "Actions submitted. Processing turn...");
                updateTimerUI(timerMax);

                // Add a small delay before processing the turn
                setTimeout(() => processTurn(data, matchRef), 500);
            } else {
                // P2 waits for P1 to process the turn
                console.log("Both actions submitted. P2 waiting for P1 to process turn.");
                disableActionButtons(true);
                showMessage("action-msg", "Actions submitted. Waiting for turn processing...");
                updateTimerUI(timerMax);
            }
        } 
        // NEW BLOCK: Trigger AI AFTER human player has played (in PvAI mode)
        else if (gameMode === 'PvAI' && youKey === 'p1' && data.players.p1?.action && !data.players.p2?.action) {
            // If it's an AI match, human player (P1) has played, and AI (P2) hasn't played yet,
            // then it's time to ask the AI to play.
            console.log("Player P1 has submitted action in PvAI. Triggering AI's turn now.");
            disableActionButtons(true);
            showMessage("action-msg", `Your action is played. Waiting for AI...`);
            setTimeout(async () => {
                const latestSnapshot = await get(matchRef);
                const latestData = latestSnapshot.val();
                // Double check before triggering AI
                if (latestData && latestData.status === 'playing' && latestData.turn === 'p1' && latestData.players.p1?.action && !latestData.players.p2?.action) {
                    aiTurn(latestData.players.p1.pv, latestData.players.p2.pv, matchRef);
                } else {
                    console.log("AI trigger skipped: State changed, or AI already played.");
                }
            }, 1000); // Short delay to simulate AI reaction time
            return; // Important: exit because AI will modify DB and re-trigger onValue
        }


        // Update history
        const histEl = document.getElementById("history");
        histEl.innerHTML = "";
        (data.history || []).forEach(entry => {
            const p = document.createElement("p");
            p.textContent = entry;
            histEl.appendChild(p);
        });
        histEl.scrollTop = histEl.scrollHeight;

    }, (error) => {
        console.error("Error listening to match data:", error);
        showMessage("action-msg", "Match connection error. Returning to menu.");
        if (currentMatchUnsubscribe) currentMatchUnsubscribe();
        currentMatchUnsubscribe = null;
        setTimeout(() => backToMenu(true), 3000);
    });
}

async function processTurn(data, matchRef) {
    console.log("processTurn started with data:", JSON.stringify(data));

    // IMPORTANT: Get the latest data from DB just before processing to avoid inconsistencies.
    const latestMatchSnapshot = await get(matchRef);
    const latestMatchData = latestMatchSnapshot.val();

    if (!latestMatchData || !latestMatchData.players.p1?.action || !latestMatchData.players.p2?.action) {
        console.warn("processTurn called but one or both actions were null (or missing) in latest data. Exiting (possibly already processed or not ready).");
        return; // Do not process if actions are not there or if match has changed
    }
    // Use the most recent data for calculation
    data = latestMatchData;

    if (timerInterval) { clearInterval(timerInterval); setTimerInterval(null); }
    disableActionButtons(true);
    setHasPlayedThisTurn(false); // Reset for next turn

    const p1Action = data.players.p1.action;
    const p2Action = data.players.p2.action;

    let p1PV = data.players.p1.pv;
    let p2PV = data.players.p2.pv;
    let historyUpdates = [...(data.history || [])];

    historyUpdates.push(`--- Turn End ---`);

    // Logic for applying actions
    if (p1Action === 'attack') {
        historyUpdates.push(`${data.players.p1.pseudo} attacks!`);
        if (p2Action === 'defend') { p2PV -= 5; historyUpdates.push(`${data.players.p2.pseudo} defends, takes 5 HP damage.`); }
        else { p2PV -= 10; historyUpdates.push(`${data.players.p2.pseudo} takes 10 HP damage.`); }
    }
    if (p2Action === 'attack') {
        historyUpdates.push(`${data.players.p2.pseudo} attacks!`);
        if (p1Action === 'defend') { p1PV -= 5; historyUpdates.push(`${data.players.p1.pseudo} defends, takes 5 HP damage.`); }
        else { p1PV -= 10; historyUpdates.push(`${data.players.p1.pseudo} takes 10 HP damage.`); }
    }
    if (p1Action === 'heal') { p1PV = Math.min(100, p1PV + 15); historyUpdates.push(`${data.players.p1.pseudo} heals and recovers 15 HP.`); }
    if (p2Action === 'heal') { p2PV = Math.min(100, p2PV + 15); historyUpdates.push(`${data.players.p2.pseudo} heals and recovers 15 HP.`); }
    if (p1Action === 'defend' && p2Action !== 'attack') { historyUpdates.push(`${data.players.p1.pseudo} takes a defensive stance.`); }
    if (p2Action === 'defend' && p1Action !== 'attack') { historyUpdates.push(`${data.players.p2.pseudo} takes a defensive stance.`); }

    historyUpdates.push(`--- End of Turn ---`);

    p1PV = Math.max(0, p1PV);
    p2PV = Math.max(0, p2PV);

    console.log("New P1 PV (before DB update):", p1PV); // Debugging: New P1 HP
    console.log("New P2 PV (before DB update):", p2PV); // Debugging: New P2 HP


    let nextTurn = (data.turn === 'p1') ? 'p2' : 'p1';
    let gameStatus = 'playing';
    let winner = null;
    let loser = null;

    if (p1PV <= 0 && p2PV <= 0) { gameStatus = "finished"; winner = "draw"; historyUpdates.push("Both players are down. It's a draw!"); }
    else if (p1PV <= 0) { gameStatus = "finished"; winner = "p2"; loser = "p1"; historyUpdates.push(`${data.players.p1.pseudo} is defeated! ${data.players.p2.pseudo} wins the match.`); }
    else if (p2PV <= 0) { gameStatus = "finished"; winner = "p1"; loser = "p2"; historyUpdates.push(`${data.players.p2.pseudo} is defeated! ${data.players.p1.pseudo} wins the match.`); }

    const updates = {
        [`players/p1/pv`]: p1PV,
        [`players/p2/pv`]: p2PV,
        [`players/p1/action`]: deleteField(), // Reset P1's action
        [`players/p2/action`]: deleteField(), // Reset P2's action
        history: historyUpdates,
        turn: nextTurn, // <--- This is where the next turn is set
        status: gameStatus,
        lastTurnProcessedAt: serverTimestamp() // Update turn processing timestamp
    };
    if (winner) { updates.winner = winner; if (loser) updates.loser = loser; }

    try {
        await update(matchRef, updates);
        console.log("DEBUG: Firebase update completed successfully (processTurn). New turn set to:", nextTurn); // Debugging: Confirm next turn sent
    } catch (error) {
        console.error("DEBUG: ERROR during Firebase update in processTurn:", error);
        showMessage("action-msg", "Critical error during turn processing. Please reload the page.");
    }
}

async function submitDefaultAction(playerKey, matchRef, currentMatchData) {
    if (!playerKey || !matchRef || !currentMatchData) return;
    
    // Get the latest version of the match to avoid conflicts
    const snapshot = await get(matchRef);
    const data = snapshot.val();
    if (!data || data.players[playerKey]?.action) {
        console.log(`Default action for ${playerKey} already submitted or match ended.`);
        return;
    }

    const defaultAction = 'defend';
    const updates = {};
    updates[`players/${playerKey}/action`] = defaultAction;

    const newHistory = [...(data.history || [])]; // Use latest data
    const pseudo = data.players[playerKey]?.pseudo || "A player";
    newHistory.push(`${pseudo} did not act in time and automatically defended.`);
    updates.history = newHistory;

    try {
        await update(matchRef, updates);
    } catch (error) {
        console.error(`ERROR submitting default action for ${playerKey}:`, error);
    }
}

export async function aiTurn(playerPV, aiPV, matchRef) {
    // Get the latest version of the match to ensure current state before playing
    const snapshot = await get(matchRef);
    const currentMatchData = snapshot.val();

    // Critical checks before AI plays
    if (!currentMatchData || currentMatchData.status !== 'playing' || currentMatchData.turn !== 'p1' || currentMatchData.players.p2?.action) {
        // The condition `currentMatchData.turn !== 'p1'` is intentional here to ensure AI plays
        // during player 1's turn, after player 1 has submitted their action.
        console.log("AI skip: Not correct turn for AI to play, AI already played, or match ended.");
        return;
    }

    let aiAction = 'defend';
    // AI decision logic based on current HP
    if (aiPV < 30 && playerPV > 0) { aiAction = 'heal'; }
    else if (playerPV < 40 && aiPV > 0) { aiAction = 'attack'; }
    else { const actions = ['attack', 'defend']; aiAction = actions[Math.floor(Math.random() * actions.length)]; }

    const updates = {};
    updates[`players/p2/action`] = aiAction;

    const newHistory = [...(currentMatchData.history || [])];
    newHistory.push(`AI chose: ${aiAction === 'attack' ? 'Attack' : (aiAction === 'defend' ? 'Defend' : 'Heal')}.`);
    updates.history = newHistory;

    try {
        await update(matchRef, updates);
        console.log("AI action submitted:", aiAction);
    } catch (error) {
        console.error("Error submitting AI action:", error);
    }
}

export async function performAction(actionType) {
    // Check `hasPlayedThisTurn` first
    if (hasPlayedThisTurn) {
        showMessage("action-msg", "You have already submitted an action for this turn.");
        return;
    }
    
    if (!currentMatchId || !currentUser) { return; }

    const matchRef = ref(db, `matches/${currentMatchId}`);
    const matchSnapshot = await get(matchRef);
    const matchData = matchSnapshot.val();

    if (!matchData) { showMessage("action-msg", "Match not found or ended."); backToMenu(true); return; }
    
    // Add a log to check the turn before playing
    console.log("Attempting to perform action. Current turn in DB:", matchData.turn, "Your key:", youKey);

    if (matchData.turn !== youKey) {
        showMessage("action-msg", "It's not your turn!");
        return;
    }
    if (matchData.players[youKey].action) {
         showMessage("action-msg", "You have already submitted an action for this turn (Firebase check).");
         setHasPlayedThisTurn(true); // Ensure local state is updated
         disableActionButtons(true);
         return;
    }

    const updates = {};
    updates[`players/${youKey}/action`] = actionType;

    const actionDisplayName = { 'attack': 'Attack', 'defend': 'Defend', 'heal': 'Heal' }[actionType];
    showMessage("action-msg", `You chose: ${actionDisplayName}. Waiting for opponent...`);

    try {
        await update(matchRef, updates);
        setHasPlayedThisTurn(true); // Update local state AFTER successful submission
        disableActionButtons(true);
        if (timerInterval) { clearInterval(timerInterval); setTimerInterval(null); }
    } catch (error) {
        console.error("Error performing action:", error);
        showMessage("action-msg", "Error sending your action.");
    }
}

export async function handleGameEnd(data, finalResult) {
    disableActionButtons(true);
    if (timerInterval) { clearInterval(timerInterval); setTimerInterval(null); }
    if (onDisconnectRef) { onDisconnectRef.cancel().catch(error => console.error("Error cancelling onDisconnect:", error)); setOnDisconnectRef(null); }

    let finalMessage = "";
    let yourResultForStats = finalResult;

    const opponentName = data.players[opponentKey] ? data.players[opponentKey].pseudo : 'the opponent';

    if (finalResult === 'win') { finalMessage = `Victory! You won the match against ${opponentName}!`; }
    else if (finalResult === 'loss') { finalMessage = `Defeat... You lost against ${opponentName}.`; }
    else if (finalResult === 'draw') { finalMessage = "Draw! Nobody won."; }
    else if (finalResult === 'forfeit_win') { finalMessage = `Victory by forfeit! The opponent (${opponentName}) disconnected.`; yourResultForStats = 'win'; }
    else if (finalResult === 'forfeit_loss') { finalMessage = "You lost by forfeit (disconnection)."; yourResultForStats = 'loss'; }
    else { finalMessage = "The match is over."; }

    showMessage("action-msg", finalMessage);
    updateUserStats(yourResultForStats);

    if (!matchDeletionTimeout) {
        showMessage("action-msg", finalMessage + " Returning to menu in 10 seconds...");
        setMatchDeletionTimeout(setTimeout(async () => {
            const matchRef = ref(db, `matches/${currentMatchId}`);
            const snapshot = await get(matchRef);
            const currentData = snapshot.val();

            if (currentData && (currentData.status === 'finished' || currentData.status === 'forfeited')) {
                 const shouldDelete = (youKey === 'p1') || // P1 is the creator and thus responsible for deletion after the end
                                      (currentData.status === 'forfeited' && currentData.winner === youKey); // If the match was "forfeit" and you are the winner
                 if (shouldDelete) {
                     try { await remove(matchRef); } catch (err) { console.error("Error removing finished match:", err); }
                 }
            }
            backToMenu(true);
            setMatchDeletionTimeout(null);
        }, 10000));
    }
}
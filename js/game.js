import { db } from "./firebaseConfig.js";
import { ref, get, update, onValue, onDisconnect, remove, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js";
import { showMessage, disableActionButtons, updateHealthBar, updateTimerUI, clearHistory } from "./utils.js";
import { backToMenu, currentUser, currentMatchId, youKey, opponentKey, gameMode, setMatchVariables, timerMax, timerInterval, setTimerInterval, setOnDisconnectRef, onDisconnectRef, matchDeletionTimeout, setMatchDeletionTimeout, hasPlayedThisTurn, setHasPlayedThisTurn, updateUserStats } from "./main.js"; // Import variables et fonctions de main

let currentMatchUnsubscribe = null;

export async function startMatchMonitoring(id, user, playerKey, mode) {
    // Nettoyage des listeners précédents
    if (currentMatchUnsubscribe) { currentMatchUnsubscribe(); currentMatchUnsubscribe = null; }
    if (timerInterval) { clearInterval(timerInterval); setTimerInterval(null); }
    if (onDisconnectRef) { onDisconnectRef.cancel().catch(err => console.error("Error canceling old onDisconnect:", err)); setOnDisconnectRef(null); }
    if (matchDeletionTimeout) { clearTimeout(matchDeletionTimeout); setMatchDeletionTimeout(null); }

    setMatchVariables(id, user, playerKey, mode); // Met à jour les variables globales dans main.js

    document.getElementById("match").style.display = "none";
    document.getElementById("game").style.display = "block";
    document.getElementById("current-match").textContent = id;
    document.getElementById("you-name").textContent = user.pseudo;
    clearHistory(); // Clear history on new match start
    document.getElementById("opponent-action-status").textContent = "";

    setHasPlayedThisTurn(false);
    disableActionButtons(true);
    showMessage("action-msg", "Chargement du match...");

    const matchRef = ref(db, `matches/${id}`);

    currentMatchUnsubscribe = onValue(matchRef, async (snapshot) => {
        console.log("onValue triggered (full snapshot):", snapshot.val());
        const data = snapshot.val();
        if (!data) {
            if (currentMatchId === id) { // S'assurer que c'est le match actuel qui est supprimé
                showMessage("action-msg", "Le match a été terminé ou supprimé.");
                if (currentMatchUnsubscribe) currentMatchUnsubscribe();
                currentMatchUnsubscribe = null;
                setTimeout(() => backToMenu(true), 3000);
            }
            return;
        }

        // Déterminer le rôle du joueur actuel (p1 ou p2) et l'adversaire
        const you = data.players[youKey];
        const opponent = data.players[opponentKey];

        if (!you) {
            showMessage("action-msg", "Vous n'êtes pas un joueur dans ce match.");
            disableActionButtons(true);
            if (timerInterval) { clearInterval(timerInterval); setTimerInterval(null); }
            return;
        }

        // Mettre à jour lastSeen et définir onDisconnect (seulement pour PvP)
        if (gameMode === 'PvP') {
            const yourPlayerRef = ref(db, `matches/<span class="math-inline">\{id\}/players/</span>{youKey}`);
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

        // Mettre à jour l'interface avec les données des joueurs
        updateHealthBar(document.getElementById("you-health-bar"), document.getElementById("you-pv-display"), you.pv);
        document.getElementById("you-name").textContent = `${you.pseudo} (Vous)`;

        let opponentActionStatus = "";
        if (opponent) {
            updateHealthBar(document.getElementById("opponent-health-bar"), document.getElementById("opponent-pv-display"), opponent.pv, true);
            document.getElementById("opponent-name").textContent = opponent.pseudo;
            if (opponent.action) {
                opponentActionStatus = "Action soumise !";
            } else if (data.turn === opponentKey) {
                opponentActionStatus = "En attente d'action de l'adversaire...";
            }
            if (gameMode === 'PvP' && (opponent.status === 'forfeited' || opponent.pv <= 0)) {
                showMessage("action-msg", `L'adversaire (${opponent.pseudo}) a quitté le match ou est vaincu.`);
                handleGameEnd(data, 'win'); // Vous gagnez par forfait ou KO
            }
        } else {
            document.getElementById("opponent-pv-display").textContent = "N/A";
            document.getElementById("opponent-health-bar").style.width = "0%";
            document.getElementById("opponent-health-bar").textContent = "0%";
            document.getElementById("opponent-name").textContent = "En attente...";
            opponentActionStatus = "En attente d'un adversaire...";
        }
        document.getElementById("opponent-action-status").textContent = opponentActionStatus;

        // Conditions de fin de jeu
        if (data.status === 'finished' || you.pv <= 0 || (opponent && opponent.pv <= 0)) {
            if (onDisconnectRef) { onDisconnectRef.cancel().catch(error => console.error("Error cancelling onDisconnect:", error)); setOnDisconnectRef(null); }
            let finalResult = "draw";
            if (you.pv > 0 && (opponent && opponent.pv <= 0)) {
                finalResult = "win";
            } else if (you.pv <= 0 && (opponent && opponent.pv > 0)) {
                finalResult = "loss";
            }
            handleGameEnd(data, finalResult);
            return;
        }

        // Si le match est en attente du P2 (PvP seulement)
        if (gameMode === 'PvP' && (data.status === "waiting" || !opponent)) {
            showMessage("action-msg", "En attente de l'adversaire...");
            disableActionButtons(true);
            if (timerInterval) { clearInterval(timerInterval); setTimerInterval(null); }
            updateTimerUI(timerMax);
            return;
        }

        // Logique clé pour gérer le tour et le timer
        const currentTime = Date.now();
        const lastTurnProcessedTime = data.lastTurnProcessedAt && typeof data.lastTurnProcessedAt.toMillis === 'function'
            ? data.lastTurnProcessedAt.toMillis()
            : currentTime;
        const elapsedSinceLastTurn = Math.floor((currentTime - lastTurnProcessedTime) / 1000);

        let activePlayerKey = data.turn;
        let activePlayer = data.players[activePlayerKey];

        if (!activePlayer.action) {
            const timeRemaining = Math.max(0, timerMax - elapsedSinceLastTurn);
            updateTimerUI(timeRemaining);

            if (timerInterval) { clearInterval(timerInterval); setTimerInterval(null); }

            if (youKey === activePlayerKey) {
                if (!hasPlayedThisTurn) {
                    disableActionButtons(false);
                    showMessage("action-msg", "C'est votre tour ! Choisissez une action.");
                    setTimerInterval(setInterval(() => {
                        const currentElapsed = Math.floor((Date.now() - lastTurnProcessedTime) / 1000);
                        const currentRemaining = Math.max(0, timerMax - currentElapsed);
                        updateTimerUI(currentRemaining);
                        if (currentRemaining <= 0) {
                            clearInterval(timerInterval);
                            setTimerInterval(null);
                            submitDefaultAction(youKey, matchRef, data);
                        }
                    }, 1000));
                } else {
                    disableActionButtons(true);
                    showMessage("action-msg", "Action jouée. En attente de l'adversaire...");
                }
            } else {
                disableActionButtons(true);
                showMessage("action-msg", `Tour de ${opponent ? opponent.pseudo : 'l\'adversaire'}. Veuillez patienter...`);

                if (timeRemaining <= 0) {
                    submitDefaultAction(activePlayerKey, matchRef, data);
                }
                if (gameMode === 'PvAI' && activePlayerKey === 'p2' && !activePlayer.action) {
                    setTimeout(() => {
                        get(matchRef).then(latestSnapshot => {
                            const latestData = latestSnapshot.val();
                            if (latestData && latestData.turn === 'p2' && !latestData.players.p2?.action) {
                                aiTurn(latestData.players.p1.pv, latestData.players.p2.pv, matchRef);
                            }
                        }).catch(err => console.error("[AI Logic] Error getting match data for AI turn:", err));
                    }, 1500);
                }
            }
        } else {
            if (timerInterval) { clearInterval(timerInterval); setTimerInterval(null); }
            updateTimerUI(timerMax);

            if (data.players.p1?.action && data.players.p2?.action) {
                 if (youKey === 'p1') {
                    console.log("P1 detected both actions, processing turn.");
                    processTurn(data, matchRef);
                } else {
                    console.log("P2 detected both actions. Waiting for P1 to process.");
                    disableActionButtons(true);
                    showMessage("action-msg", "Actions soumises. En attente du traitement du tour...");
                }
            } else {
                disableActionButtons(true);
                showMessage("action-msg", "Action jouée. En attente de l'adversaire...");
            }
        }

        // Mettre à jour l'historique
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
        showMessage("action-msg", "Erreur de connexion au match. Retour au menu.");
        if (currentMatchUnsubscribe) currentMatchUnsubscribe();
        currentMatchUnsubscribe = null;
        setTimeout(() => backToMenu(true), 3000);
    });
}

async function processTurn(data, matchRef) {
    console.log("processTurn started with data:", JSON.stringify(data));

    if (!data.players.p1?.action || !data.players.p2?.action) {
        console.warn("processTurn called but one or both actions are null (or missing). Exiting (already processed or not ready).");
        return;
    }

    if (timerInterval) { clearInterval(timerInterval); setTimerInterval(null); }
    disableActionButtons(true);
    setHasPlayedThisTurn(false); // Reset for the next turn

    const p1Action = data.players.p1.action;
    const p2Action = data.players.p2.action;

    let p1PV = data.players.p1.pv;
    let p2PV = data.players.p2.pv;
    let historyUpdates = [...(data.history || [])];

    historyUpdates.push(`--- Début du tour ---`);

    // Logique d'application des actions (identique à celle que vous avez)
    if (p1Action === 'attack') {
        historyUpdates.push(`${data.players.p1.pseudo} attaque !`);
        if (p2Action === 'defend') { p2PV -= 5; historyUpdates.push(`${data.players.p2.pseudo} se défend, subit 5 PV de dégâts.`); }
        else { p2PV -= 10; historyUpdates.push(`${data.players.p2.pseudo} subit 10 PV de dégâts.`); }
    }
    if (p2Action === 'attack') {
        historyUpdates.push(`${data.players.p2.pseudo} attaque !`);
        if (p1Action === 'defend') { p1PV -= 5; historyUpdates.push(`${data.players.p1.pseudo} se défend, subit 5 PV de dégâts.`); }
        else { p1PV -= 10; historyUpdates.push(`${data.players.p1.pseudo} subit 10 PV de dégâts.`); }
    }
    if (p1Action === 'heal') { p1PV = Math.min(100, p1PV + 15); historyUpdates.push(`${data.players.p1.pseudo} se soigne et récupère 15 PV.`); }
    if (p2Action === 'heal') { p2PV = Math.min(100, p2PV + 15); historyUpdates.push(`${data.players.p2.pseudo} se soigne et récupère 15 PV.`); }
    if (p1Action === 'defend' && p2Action !== 'attack') { historyUpdates.push(`${data.players.p1.pseudo} se met en position défensive.`); }
    if (p2Action === 'defend' && p1Action !== 'attack') { historyUpdates.push(`${data.players.p2.pseudo} se met en position défensive.`); }

    historyUpdates.push(`--- Fin du tour ---`);

    p1PV = Math.max(0, p1PV);
    p2PV = Math.max(0, p2PV);

    let nextTurn = (data.turn === 'p1') ? 'p2' : 'p1';
    let gameStatus = 'playing';
    let winner = null;
    let loser = null;

    if (p1PV <= 0 && p2PV <= 0) { gameStatus = "finished"; winner = "draw"; historyUpdates.push("Les deux joueurs sont à terre. C'est un match nul !"); }
    else if (p1PV <= 0) { gameStatus = "finished"; winner = "p2"; loser = "p1"; historyUpdates.push(`${data.players.p1.pseudo} est vaincu ! ${data.players.p2.pseudo} gagne le match.`); }
    else if (p2PV <= 0) { gameStatus = "finished"; winner = "p1"; loser = "p2"; historyUpdates.push(`${data.players.p2.pseudo} est vaincu ! ${data.players.p1.pseudo} gagne le match.`); }

    const updates = {
        [`players/p1/pv`]: p1PV,
        [`players/p2/pv`]: p2PV,
        [`players/p1/action`]: null,
        [`players/p2/action`]: null,
        history: historyUpdates,
        turn: nextTurn,
        status: gameStatus,
        lastTurnProcessedAt: serverTimestamp()
    };
    if (winner) { updates.winner = winner; if (loser) updates.loser = loser; }

    try {
        await update(matchRef, updates);
        console.log("DEBUG: Firebase update completed successfully (processTurn).");
    } catch (error) {
        console.error("DEBUG: ERROR during Firebase update in processTurn:", error);
        showMessage("action-msg", "Erreur critique lors du traitement du tour. Veuillez recharger la page.");
    }
}

async function submitDefaultAction(playerKey, matchRef, currentMatchData) {
    if (!playerKey || !matchRef || !currentMatchData) return;
    if (currentMatchData.players[playerKey]?.action) {
        console.log(`Default action for ${playerKey} already submitted by another client.`);
        return;
    }

    const defaultAction = 'defend';
    const updates = {};
    updates[`players/${playerKey}/action`] = defaultAction;

    const newHistory = [...(currentMatchData.history || [])];
    const pseudo = currentMatchData.players[playerKey]?.pseudo || "Un joueur";
    newHistory.push(`${pseudo} n'a pas agi à temps et s'est automatiquement défendu.`);
    updates.history = newHistory;

    try {
        await update(matchRef, updates);
    } catch (error) {
        console.error(`ERROR submitting default action for ${playerKey}:`, error);
    }
}

export async function aiTurn(playerPV, aiPV, matchRef) {
    let aiAction = 'defend';
    if (aiPV < 30 && playerPV > 0) { aiAction = 'heal'; }
    else if (playerPV < 40 && aiPV > 0) { aiAction = 'attack'; }
    else { const actions = ['attack', 'defend']; aiAction = actions[Math.floor(Math.random() * actions.length)]; }

    const updates = {};
    updates[`players/p2/action`] = aiAction;

    const currentMatchSnapshot = await get(matchRef);
    const currentMatchData = currentMatchSnapshot.val();
    const newHistory = [...(currentMatchData.history || [])];
    newHistory.push(`L'IA a choisi : ${aiAction === 'attack' ? 'Attaque' : (aiAction === 'defend' ? 'Défense' : 'Soin')}.`);
    updates.history = newHistory;

    try {
        await update(matchRef, updates);
    } catch (error) {
        console.error("Error submitting AI action:", error);
    }
}

export async function performAction(actionType) {
    if (hasPlayedThisTurn) {
        showMessage("action-msg", "Vous avez déjà soumis une action pour ce tour.");
        return;
    }
    if (!currentMatchId || !currentUser) { return; }

    const matchRef = ref(db, `matches/${currentMatchId}`);
    const matchSnapshot = await get(matchRef);
    const matchData = matchSnapshot.val();

    if (!matchData) { showMessage("action-msg", "Match introuvable ou terminé."); backToMenu(true); return; }
    if (matchData.turn !== youKey) { showMessage("action-msg", "Ce n'est pas votre tour !"); return; }
    if (matchData.players[youKey].action) {
         showMessage("action-msg", "Vous avez déjà soumis une action pour ce tour (vérification Firebase).");
         setHasPlayedThisTurn(true);
         disableActionButtons(true);
         return;
    }

    const updates = {};
    updates[`players/${youKey}/action`] = actionType;

    const actionDisplayName = { 'attack': 'Attaquer', 'defend': 'Défendre', 'heal': 'Soigner' }[actionType];
    showMessage("action-msg", `Vous avez choisi : ${actionDisplayName}. En attente de l'adversaire...`);

    try {
        await update(matchRef, updates);
        setHasPlayedThisTurn(true);
        disableActionButtons(true);
        if (timerInterval) { clearInterval(timerInterval); setTimerInterval(null); }
    } catch (error) {
        console.error("Error performing action:", error);
        showMessage("action-msg", "Erreur lors de l'envoi de votre action.");
    }
}

export async function handleGameEnd(data, finalResult) {
    disableActionButtons(true);
    if (timerInterval) { clearInterval(timerInterval); setTimerInterval(null); }
    if (onDisconnectRef) { onDisconnectRef.cancel().catch(error => console.error("Error cancelling onDisconnect:", error)); setOnDisconnectRef(null); }

    let finalMessage = "";
    let yourResultForStats = finalResult;

    const opponentName = data.players[opponentKey] ? data.players[opponentKey].pseudo : 'l\'adversaire';

    if (finalResult === 'win') { finalMessage = `Victoire ! Vous avez gagné le match contre ${opponentName} !`; }
    else if (finalResult === 'loss') { finalMessage = `Défaite... Vous avez perdu contre ${opponentName}.`; }
    else if (finalResult === 'draw') { finalMessage = "Match Nul ! Personne n'a gagné."; }
    else if (finalResult === 'forfeit_win') { finalMessage = `Victoire par forfait ! L'adversaire (${opponentName}) s'est déconnecté.`; yourResultForStats = 'win'; }
    else if (finalResult === 'forfeit_loss') { finalMessage = "Vous avez perdu par forfait (déconnexion)."; yourResultForStats = 'loss'; }
    else { finalMessage = "Le match est terminé."; }

    showMessage("action-msg", finalMessage);
    updateUserStats(yourResultForStats);

    if (!matchDeletionTimeout) {
        showMessage("action-msg", finalMessage + " Retour au menu dans 10 secondes...");
        setMatchDeletionTimeout(setTimeout(async () => {
            const matchRef = ref(db, `matches/${currentMatchId}`);
            const snapshot = await get(matchRef);
            const currentData = snapshot.val();

            if (currentData && (currentData.status === 'finished' || currentData.status === 'forfeited')) {
                 const shouldDelete = (youKey === 'p1') ||
                                      (currentData.status === 'forfeited' && currentData.winner === youKey);
                 if (shouldDelete) {
                     try { await remove(matchRef); } catch (err) { console.error("Error removing finished match:", err); }
                 }
            }
            backToMenu(true);
            setMatchDeletionTimeout(null);
        }, 10000));
    }
} 

import { db } from "./firebaseConfig.js";
import { ref, get, update, onValue, onDisconnect, remove, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js";
import { showMessage, disableActionButtons, updateHealthBar, updateTimerUI, clearHistory } from "./utils.js";
import { backToMenu, currentUser, currentMatchId, youKey, opponentKey, gameMode, setMatchVariables, timerMax, timerInterval, setTimerInterval, setOnDisconnectRef, onDisconnectRef, matchDeletionTimeout, setMatchDeletionTimeout, hasPlayedThisTurn, setHasPlayedThisTurn, updateUserStats } from "./main.js";

let currentMatchUnsubscribe = null;

export async function startMatchMonitoring(id, user, playerKey, mode) {
    // Nettoyage des listeners et timers précédents
    if (currentMatchUnsubscribe) { currentMatchUnsubscribe(); currentMatchUnsubscribe = null; }
    if (timerInterval) { clearInterval(timerInterval); setTimerInterval(null); }
    if (onDisconnectRef) { onDisconnectRef.cancel().catch(err => console.error("Error canceling old onDisconnect:", err)); setOnDisconnectRef(null); }
    if (matchDeletionTimeout) { clearTimeout(matchDeletionTimeout); setMatchDeletionTimeout(null); }

    setMatchVariables(id, user, playerKey, mode); // Met à jour les variables globales dans main.js

    // Initialisation de l'UI
    document.getElementById("match").style.display = "none";
    document.getElementById("game").style.display = "block";
    document.getElementById("current-match").textContent = id;
    document.getElementById("you-name").textContent = user.pseudo;
    clearHistory();
    document.getElementById("opponent-action-status").textContent = "";

    setHasPlayedThisTurn(false);
    disableActionButtons(true);
    showMessage("action-msg", "Chargement du match...");

    const matchRef = ref(db, `matches/${id}`);

    currentMatchUnsubscribe = onValue(matchRef, async (snapshot) => {
        console.log("onValue triggered (full snapshot):", snapshot.val());
        const data = snapshot.val();

        // --- DÉBUT DES LOGS DE DÉBOGAGE POUR ONVALUE ---
        console.log("DEBUG onValue - Current data.turn:", data?.turn);
        console.log("DEBUG onValue - Current data.players.p1.action:", data?.players?.p1?.action);
        console.log("DEBUG onValue - Current data.players.p2.action:", data?.players?.p2?.action);
        console.log("DEBUG onValue - Current data.players.p2.secondAction:", data?.players?.p2?.secondAction); // Nouveau champ pour la 2ème action de l'IA
        console.log("DEBUG onValue - Current data.status:", data?.status);
        console.log("DEBUG onValue - youKey:", youKey);
        console.log("DEBUG onValue - opponentKey:", opponentKey);
        // --- FIN DES LOGS DE DÉBOGAGE POUR ONVALUE ---

        // 1. Gestion du match supprimé ou inexistant
        if (!data) {
            if (currentMatchId === id) {
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

        // 2. Vérification de la présence du joueur dans le match
        if (!you) {
            showMessage("action-msg", "Vous n'êtes pas un joueur dans ce match.");
            disableActionButtons(true);
            if (timerInterval) { clearInterval(timerInterval); setTimerInterval(null); }
            return;
        }

        // 3. Mise à jour de lastSeen et définition de onDisconnect (PvP seulement)
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

        // 4. Mettre à jour l'interface avec les données des joueurs (PV, noms)
        updateHealthBar(document.getElementById("you-health-bar"), document.getElementById("you-pv-display"), you.pv);
        document.getElementById("you-name").textContent = `${you.pseudo} (Vous)`;
        console.log("Player PV (onValue - UI Update):", you.pv); // Debugging: PV du joueur

        let opponentActionStatus = "";
        if (opponent) {
            updateHealthBar(document.getElementById("opponent-health-bar"), document.getElementById("opponent-pv-display"), opponent.pv, true);
            document.getElementById("opponent-name").textContent = opponent.pseudo;
            console.log("Opponent PV (onValue - UI Update):", opponent.pv); // Debugging: PV de l'adversaire
            
            // Nouveau statut pour gérer les actions de l'IA
            if (gameMode === 'PvAI') {
                if (data.players.p1?.action && !data.players.p2?.action) {
                    opponentActionStatus = "En attente de la première action de l'IA...";
                } else if (data.players.p1?.action && data.players.p2?.action && !data.players.p2?.secondAction) {
                    opponentActionStatus = "En attente de la deuxième action de l'IA...";
                } else if (data.players.p2?.secondAction) {
                    opponentActionStatus = "Action de l'IA soumise !"; // Les deux actions IA sont là
                } else {
                    opponentActionStatus = "En attente de votre action..."; // Normalement, IA attend P1
                }
            } else { // PvP
                if (opponent.action) {
                    opponentActionStatus = "Action soumise !";
                } else if (!opponent.action && data.players[youKey]?.action) {
                    opponentActionStatus = "En attente d'action de l'adversaire...";
                } else {
                    opponentActionStatus = "En attente d'action de l'adversaire...";
                }
            }
            
            // Gérer le forfait de l'adversaire en PvP
            if (gameMode === 'PvP' && (opponent.status === 'forfeited' || opponent.pv <= 0)) {
                showMessage("action-msg", `L'adversaire (${opponent.pseudo}) a quitté le match ou est vaincu.`);
                handleGameEnd(data, 'win');
                return; // Sortir après avoir géré la fin du jeu
            }
        } else {
            // Cas où l'adversaire n'existe pas encore (par exemple, en attente en PvP)
            document.getElementById("opponent-pv-display").textContent = "N/A";
            document.getElementById("opponent-health-bar").style.width = "0%";
            document.getElementById("opponent-health-bar").textContent = "0%";
            document.getElementById("opponent-name").textContent = "En attente...";
            opponentActionStatus = "En attente d'un adversaire...";
        }
        document.getElementById("opponent-action-status").textContent = opponentActionStatus;

        // 5. Conditions de fin de jeu (après mise à jour des PV pour un affichage correct)
        if (data.status === 'finished' || you.pv <= 0 || (opponent && opponent.pv <= 0)) {
            if (onDisconnectRef) { onDisconnectRef.cancel().catch(error => console.error("Error cancelling onDisconnect:", error)); setOnDisconnectRef(null); }
            let finalResult = "draw";
            if (you.pv > 0 && (opponent && opponent.pv <= 0)) {
                finalResult = "win";
            } else if (you.pv <= 0 && (opponent && opponent.pv > 0)) {
                finalResult = "loss";
            }
            handleGameEnd(data, finalResult);
            return; // Sortir si le jeu est terminé
        }

        // 6. Si le match est en attente du P2 (PvP seulement)
        if (gameMode === 'PvP' && (data.status === "waiting" || !opponent)) {
            showMessage("action-msg", "En attente de l'adversaire...");
            disableActionButtons(true);
            if (timerInterval) { clearInterval(timerInterval); setTimerInterval(null); }
            updateTimerUI(timerMax);
            return; // Attendre l'adversaire
        }

        // --- DÉBUT DE LA LOGIQUE CLÉ DU TOUR ---
        const currentTime = Date.now();
        const lastTurnProcessedTime = data.lastTurnProcessedAt && typeof data.lastTurnProcessedAt.toMillis === 'function'
            ? data.lastTurnProcessedAt.toMillis()
            : (data.lastTurnProcessedAt || currentTime); 
        
        if (timerInterval) { clearInterval(timerInterval); setTimerInterval(null); } 

        // LOGIQUE DU JOUEUR HUMAIN (P1)
        // Les boutons sont activés UNIQUEMENT si c'est le tour de P1 (data.turn === youKey)
        // ET si P1 n'a pas encore soumis son action pour ce round.
        if (data.turn === youKey && !data.players[youKey]?.action) {
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
            if (gameMode === 'PvAI') {
                if (data.players[youKey]?.action && !data.players[opponentKey]?.action) {
                    showMessage("action-msg", "Action jouée. L'IA prépare sa première action...");
                } else if (data.players[opponentKey]?.action && !data.players[opponentKey]?.secondAction) {
                     showMessage("action-msg", "L'IA prépare sa deuxième action...");
                } else if (data.players[opponentKey]?.secondAction) {
                    showMessage("action-msg", "Actions soumises. Traitement du tour...");
                } else {
                    showMessage("action-msg", "Veuillez patienter...");
                }
            } else { // PvP
                if (data.players[youKey]?.action && !data.players[opponentKey]?.action) {
                    showMessage("action-msg", "Action jouée. En attente de l'adversaire...");
                } else {
                    showMessage("action-msg", "Veuillez patienter...");
                }
            }
            updateTimerUI(timerMax); 
        }

        // --- LOGIQUE DE DÉCLENCHEMENT DE L'IA (MODE PvAI UNIQUEMENT) ---
        if (gameMode === 'PvAI' && data.status === 'playing') {
            // **Cas 1: L'IA réagit à l'action de P1 (première action de l'IA)**
            // Déclenchée si P1 a joué, mais P2 n'a pas encore réagi.
            if (data.turn === youKey && data.players[youKey]?.action && !data.players[opponentKey]?.action) {
                console.log("Player P1 has submitted action. Triggering AI's FIRST action for this round.");
                showMessage("action-msg", `Votre action est jouée. L'IA réagit...`);
                setTimeout(async () => {
                    const latestSnapshot = await get(matchRef);
                    const latestData = latestSnapshot.val();
                    if (latestData && latestData.status === 'playing' && latestData.turn === youKey && latestData.players[youKey]?.action && !latestData.players[opponentKey]?.action) {
                        aiTurn(latestData.players.p1.pv, latestData.players.p2.pv, matchRef, 'first');
                    } else {
                        console.log("AI first action skipped: State changed, or AI already played.");
                    }
                }, 1000); 
                return; 
            }
            // **Cas 2: L'IA doit jouer sa DEUXIÈME action du cycle.**
            // Déclenchée après que le premier traitement de tour a mis à jour p2.action, mais p2.secondAction est null.
            else if (data.turn === youKey && data.players[youKey]?.action && data.players[opponentKey]?.action && !data.players[opponentKey]?.secondAction) {
                 console.log("AI's first action is done. Triggering AI's SECOND action for its dedicated turn.");
                 showMessage("action-msg", "L'IA réfléchit (sa deuxième action)...");
                 setTimeout(async () => {
                     const latestSnapshot = await get(matchRef);
                     const latestData = latestSnapshot.val();
                     if (latestData && latestData.status === 'playing' && latestData.turn === youKey && latestData.players[youKey]?.action && latestData.players[opponentKey]?.action && !latestData.players[opponentKey]?.secondAction) {
                         aiTurn(latestData.players.p1.pv, latestData.players.p2.pv, matchRef, 'second');
                     } else {
                         console.log("AI second action skipped: State changed, or AI already played its second action.");
                     }
                 }, 1500); 
                 return; 
            }
        }
        // --- FIN DE LA LOGIQUE DE DÉCLENCHEMENT DE L'IA ---


        // LOGIQUE DE TRAITEMENT DU TOUR
        // Le traitement se fait lorsque TOUTES les actions requises pour le round sont soumises.
        // C'est-à-dire : P1.action, P2.action, et P2.secondAction doivent être définis.
        if (data.players.p1?.action && data.players.p2?.action && data.players.p2?.secondAction) {
            console.log("All actions submitted (P1, IA1, IA2). Processing full turn.");
            if (youKey === 'p1' || gameMode === 'PvAI') { 
                disableActionButtons(true);
                showMessage("action-msg", "Actions soumises. Traitement du tour...");
                updateTimerUI(timerMax);
                setTimeout(() => processTurn(data, matchRef), 500);
            } else {
                console.log("Both actions submitted. P2 waiting for P1 to process turn.");
                disableActionButtons(true);
                showMessage("action-msg", "Actions soumises. En attente du traitement du tour...");
                updateTimerUI(timerMax);
            }
        } 
        
        // Mise à jour de l'historique
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

    const latestMatchSnapshot = await get(matchRef);
    const latestMatchData = latestMatchSnapshot.val();

    // S'assurer que toutes les actions nécessaires sont présentes avant de traiter
    if (!latestMatchData || !latestMatchData.players.p1?.action || !latestMatchData.players.p2?.action || !latestMatchData.players.p2?.secondAction) {
        console.warn("processTurn called but not all actions were present in latest data. Exiting.");
        return; 
    }
    data = latestMatchData; // Utiliser les données les plus récentes

    if (timerInterval) { clearInterval(timerInterval); setTimerInterval(null); }
    disableActionButtons(true);
    setHasPlayedThisTurn(false); 

    let p1PV = data.players.p1.pv;
    let p2PV = data.players.p2.pv;
    let historyUpdates = [...(data.history || [])];

    historyUpdates.push(`--- Début du tour ---`);

    const p1Action = data.players.p1.action;
    const p2FirstAction = data.players.p2.action; // Première action de l'IA
    const p2SecondAction = data.players.p2.secondAction; // Deuxième action de l'IA

    // Application de la première série d'actions : P1 vs P2 (première action)
    historyUpdates.push(`--- Actions du joueur et de la première IA ---`);
    if (p1Action === 'attack') {
        historyUpdates.push(`${data.players.p1.pseudo} attaque !`);
        if (p2FirstAction === 'defend') { p2PV -= 5; historyUpdates.push(`${data.players.p2.pseudo} se défend, subit 5 PV de dégâts.`); }
        else { p2PV -= 10; historyUpdates.push(`${data.players.p2.pseudo} subit 10 PV de dégâts.`); }
    }
    if (p2FirstAction === 'attack') {
        historyUpdates.push(`${data.players.p2.pseudo} attaque (première action) !`);
        if (p1Action === 'defend') { p1PV -= 5; historyUpdates.push(`${data.players.p1.pseudo} se défend, subit 5 PV de dégâts.`); }
        else { p1PV -= 10; historyUpdates.push(`${data.players.p1.pseudo} subit 10 PV de dégâts.`); }
    }
    if (p1Action === 'heal') { p1PV = Math.min(100, p1PV + 15); historyUpdates.push(`${data.players.p1.pseudo} se soigne et récupère 15 PV.`); }
    if (p2FirstAction === 'heal') { p2PV = Math.min(100, p2PV + 15); historyUpdates.push(`${data.players.p2.pseudo} se soigne et récupère 15 PV (première action).`); }
    if (p1Action === 'defend' && p2FirstAction !== 'attack') { historyUpdates.push(`${data.players.p1.pseudo} se met en position défensive.`); }
    if (p2FirstAction === 'defend' && p1Action !== 'attack') { historyUpdates.push(`${data.players.p2.pseudo} se met en position défensive (première action).`); }

    // Application de la deuxième action de l'IA (P2-B)
    historyUpdates.push(`--- Deuxième action de l'IA ---`);
    if (p2SecondAction === 'attack') {
        historyUpdates.push(`${data.players.p2.pseudo} attaque (deuxième action) !`);
        // Ici, P1 n'a pas d'action directe pour contrer la deuxième action de l'IA. C'est un tour d'IA "pur".
        // On peut considérer que P1 ne se défend pas s'il n'a pas défendu au premier segment,
        // ou qu'il utilise sa défense du premier segment si elle est encore active.
        // Pour la simplicité, P1 subit plein de dégâts si l'IA attaque sur sa deuxième action.
        p1PV -= 10; 
        historyUpdates.push(`${data.players.p1.pseudo} subit 10 PV de dégâts.`);
    }
    if (p2SecondAction === 'heal') { 
        p2PV = Math.min(100, p2PV + 15); 
        historyUpdates.push(`${data.players.p2.pseudo} se soigne et récupère 15 PV (deuxième action).`); 
    }
    if (p2SecondAction === 'defend') { 
        historyUpdates.push(`${data.players.p2.pseudo} se met en position défensive (deuxième action).`); 
    }


    historyUpdates.push(`--- Fin du tour ---`);

    p1PV = Math.max(0, p1PV);
    p2PV = Math.max(0, p2PV);

    console.log("New P1 PV (before DB update):", p1PV); 
    console.log("New P2 PV (before DB update):", p2PV); 

    // Après le traitement de toutes les actions, on revient au tour de P1
    let nextTurn = 'p1'; 

    let gameStatus = 'playing';
    let winner = null;
    let loser = null;

    if (p1PV <= 0 && p2PV <= 0) { gameStatus = "finished"; winner = "draw"; historyUpdates.push("Les deux joueurs sont à terre. C'est un match nul !"); }
    else if (p1PV <= 0) { gameStatus = "finished"; winner = "p2"; loser = "p1"; historyUpdates.push(`${data.players.p1.pseudo} est vaincu ! ${data.players.p2.pseudo} gagne le match.`); }
    else if (p2PV <= 0) { gameStatus = "finished"; winner = "p1"; loser = "p2"; historyUpdates.push(`${data.players.p2.pseudo} est vaincu ! ${data.players.p1.pseudo} gagne le match.`); }

    const updates = {
        [`players/p1/pv`]: p1PV,
        [`players/p2/pv`]: p2PV,
        [`players/p1/action`]: null, // Réinitialise l'action de P1
        [`players/p2/action`]: null, // Réinitialise la première action de P2
        [`players/p2/secondAction`]: null, // Réinitialise la deuxième action de P2
        history: historyUpdates,
        turn: nextTurn, 
        status: gameStatus,
        lastTurnProcessedAt: serverTimestamp() 
    };
    if (winner) { updates.winner = winner; if (loser) updates.loser = loser; }

    try {
        await update(matchRef, updates);
        console.log("DEBUG: Firebase update completed successfully (processTurn). New turn set to:", nextTurn); 
    } catch (error) {
        console.error("DEBUG: ERROR during Firebase update in processTurn:", error);
        showMessage("action-msg", "Erreur critique lors du traitement du tour. Veuillez recharger la page.");
    }
}

async function submitDefaultAction(playerKey, matchRef, currentMatchData) {
    if (!playerKey || !matchRef || !currentMatchData) return;
    
    const snapshot = await get(matchRef);
    const data = snapshot.val();
    if (!data || data.players[playerKey]?.action) {
        console.log(`Default action for ${playerKey} already submitted or match ended.`);
        return;
    }

    const defaultAction = 'defend';
    const updates = {};
    updates[`players/${playerKey}/action`] = defaultAction;

    const newHistory = [...(data.history || [])]; 
    const pseudo = data.players[playerKey]?.pseudo || "Un joueur";
    newHistory.push(`${pseudo} n'a pas agi à temps et s'est automatiquement défendu.`);
    updates.history = newHistory;

    try {
        await update(matchRef, updates);
    } catch (error) {
        console.error(`ERROR submitting default action for ${playerKey}:`, error);
    }
}

export async function aiTurn(playerPV, aiPV, matchRef, actionTypeToSet) {
    // actionTypeToSet sera 'first' ou 'second'
    const snapshot = await get(matchRef);
    const currentMatchData = snapshot.val();

    if (!currentMatchData || currentMatchData.status !== 'playing') {
        console.log("AI skip: Not correct state for AI to play, or match ended.");
        return;
    }

    let aiAction = 'defend';
    // Logique de décision de l'IA basée sur les PV actuels
    if (aiPV < 30 && playerPV > 0) { aiAction = 'heal'; }
    else if (playerPV < 40 && aiPV > 0) { aiAction = 'attack'; }
    else { const actions = ['attack', 'defend']; aiAction = actions[Math.floor(Math.random() * actions.length)]; }

    const updates = {};
    let historyMessage = "";

    if (actionTypeToSet === 'first') {
        // Vérifier si la première action n'est pas déjà soumise
        if (currentMatchData.players.p2?.action) {
            console.log("AI first action already submitted.");
            return;
        }
        updates[`players/p2/action`] = aiAction;
        historyMessage = `L'IA a choisi : ${aiAction === 'attack' ? 'Attaque' : (aiAction === 'defend' ? 'Défense' : 'Soin')} (première action).`;
    } else if (actionTypeToSet === 'second') {
        // Vérifier si la deuxième action n'est pas déjà soumise
        if (currentMatchData.players.p2?.secondAction) {
            console.log("AI second action already submitted.");
            return;
        }
        updates[`players/p2/secondAction`] = aiAction;
        historyMessage = `L'IA a choisi : ${aiAction === 'attack' ? 'Attaque' : (aiAction === 'defend' ? 'Défense' : 'Soin')} (deuxième action).`;
    } else {
        console.error("Invalid actionTypeToSet for aiTurn:", actionTypeToSet);
        return;
    }
    
    const newHistory = [...(currentMatchData.history || [])];
    newHistory.push(historyMessage);
    updates.history = newHistory;

    try {
        await update(matchRef, updates);
        console.log(`AI ${actionTypeToSet} action submitted:`, aiAction);
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
    
    console.log("Attempting to perform action. Current turn in DB:", matchData.turn, "Your key:", youKey);

    // Vous pouvez agir si c'est votre tour (P1) et que vous n'avez pas encore soumis d'action.
    // Et toutes les actions précédentes de l'IA (si elles existent) doivent être traitées/réinitialisées.
    if (matchData.turn !== youKey || matchData.players[youKey]?.action) { // Normalement, p1.action devrait être null ici
        showMessage("action-msg", "Ce n'est pas votre tour ou vous avez déjà joué !");
        return;
    }
    // Assurez-vous aussi que les actions de l'IA du tour précédent sont bien nulles avant de laisser P1 jouer
    if (matchData.players[opponentKey]?.action || matchData.players[opponentKey]?.secondAction) {
         showMessage("action-msg", "Veuillez patienter, les actions de l'IA sont encore en cours de traitement.");
         return;
    }


    const updates = {};
    updates[`players/${youKey}/action`] = actionType;

    const actionDisplayName = { 'attack': 'Attaquer', 'defend': 'Défendre', 'heal': 'Soigner' }[actionType];
    showMessage("action-msg", `Vous avez choisi : ${actionDisplayName}.`);

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
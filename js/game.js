import { db } from "./firebaseConfig.js";
import { ref, get, update, onValue, onDisconnect, remove, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js";
import { showMessage, disableActionButtons, updateHealthBar, updateTimerUI, clearHistory } from "./utils.js";
import { backToMenu, currentUser, currentMatchId, youKey, opponentKey, gameMode, setMatchVariables, timerMax, timerInterval, setTimerInterval, setOnDisconnectRef, onDisconnectRef, matchDeletionTimeout, setMatchDeletionTimeout, hasPlayedThisTurn, setHasPlayedThisTurn, updateUserStats } from "./main.js";

let currentMatchUnsubscribe = null;
let aiActionSubmittedForThisRound = false; // Drapeau pour l'IA PvAI

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
    aiActionSubmittedForThisRound = false; // Réinitialiser au début du match
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
        console.log("DEBUG onValue - Current data.status:", data?.status);
        console.log("DEBUG onValue - youKey:", youKey);
        console.log("DEBUG onValue - opponentKey:", opponentKey);
        console.log("DEBUG onValue - hasPlayedThisTurn:", hasPlayedThisTurn); 
        console.log("DEBUG onValue - aiActionSubmittedForThisRound:", aiActionSubmittedForThisRound); // Nouveau log
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
        console.log("Player PV (onValue - UI Update):", you.pv);

        let opponentActionStatus = "";
        if (opponent) {
            updateHealthBar(document.getElementById("opponent-health-bar"), document.getElementById("opponent-pv-display"), opponent.pv, true);
            document.getElementById("opponent-name").textContent = opponent.pseudo;
            console.log("Opponent PV (onValue - UI Update):", opponent.pv);
            
            // Statut de l'adversaire (IA ou PvP)
            if (data.players[opponentKey]?.action) {
                opponentActionStatus = "Action soumise !";
            } else { 
                opponentActionStatus = "En attente d'action de l'adversaire...";
            }
            
            // Gérer le forfait de l'adversaire en PvP
            if (gameMode === 'PvP' && (opponent.status === 'forfeited' || opponent.pv <= 0)) {
                showMessage("action-msg", `L'adversaire (${opponent.pseudo}) a quitté le match ou est vaincu.`);
                handleGameEnd(data, 'win');
                return;
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
            return;
        }

        // 6. Si le match est en attente du P2 (PvP seulement)
        if (gameMode === 'PvP' && (data.status === "waiting" || !opponent)) {
            showMessage("action-msg", "En attente de l'adversaire...");
            disableActionButtons(true);
            if (timerInterval) { clearInterval(timerInterval); setTimerInterval(null); }
            updateTimerUI(timerMax);
            return;
        }

        // --- DÉBUT DE LA LOGIQUE CLÉ DU TOUR ---
        const currentTime = Date.now();
        const lastTurnProcessedAtTimestamp = data.lastTurnProcessedAt && typeof data.lastTurnProcessedAt.toMillis === 'function'
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
                const currentElapsed = Math.floor((Date.now() - lastTurnProcessedAtTimestamp) / 1000);
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
            if (data.players[youKey]?.action && !data.players[opponentKey]?.action) {
                showMessage("action-msg", "Action jouée. En attente de l'adversaire...");
            } else if (data.turn === opponentKey && !data.players[opponentKey]?.action) {
                // Si c'est le tour de l'IA et qu'elle n'a pas encore joué
                showMessage("action-msg", "C'est le tour de l'IA. Veuillez patienter...");
            } else {
                showMessage("action-msg", "Veuillez patienter...");
            }
            updateTimerUI(timerMax); 
        }

        // --- LOGIQUE DE DÉCLENCHEMENT DE L'IA (MODE PvAI UNIQUEMENT) ---
        if (gameMode === 'PvAI' && data.status === 'playing') {
            // L'IA doit agir si :
            // C'est le tour du joueur (p1), le joueur a soumis son action, ET l'IA n'a pas encore réagi.
            // ET si l'IA n'a PAS ENCORE soumis son action pour ce round (drapeau local).
            // Le `turn` dans la DB en PvAI doit toujours rester `p1` car c'est le joueur qui initie le round.
            const shouldAiReactThisMoment = 
                !aiActionSubmittedForThisRound && // Vérifier le drapeau local
                data.turn === youKey && // C'est le tour du joueur humain
                data.players[youKey]?.action && // Le joueur humain a joué
                !data.players[opponentKey]?.action; // L'IA n'a pas encore réagi
            
            if (shouldAiReactThisMoment) {
                console.log("Considering AI action based on current turn state.");
                disableActionButtons(true); 
                showMessage("action-msg", `L'IA réfléchit...`);
                
                aiActionSubmittedForThisRound = true; // Empêche les multiples déclenchements
                
                setTimeout(async () => {
                    const latestSnapshot = await get(matchRef);
                    const latestData = latestSnapshot.val();
                    if (latestData) { 
                        aiTurn(latestData.players.p1.pv, latestData.players.p2.pv, matchRef);
                    }
                }, 1000); 
            }
        }
        // --- FIN DE LA LOGIQUE DE DÉCLENCHEMENT DE L'IA ---


        // LOGIQUE DE TRAITEMENT DU TOUR
        // Le traitement se fait lorsque les deux actions du round sont soumises (P1 et P2).
        if (data.players.p1?.action && data.players.p2?.action) {
            // C'est toujours P1 qui traite le tour en PvAI.
            if (youKey === 'p1' || gameMode === 'PvAI') { 
                console.log("Both actions submitted. P1/AI client processing turn.");
                disableActionButtons(true);
                showMessage("action-msg", "Actions soumises. Traitement du tour...");
                updateTimerUI(timerMax);
                setTimeout(() => processTurn(data, matchRef), 700); 
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

    if (!latestMatchData || !latestMatchData.players.p1?.action || !latestMatchData.players.p2?.action || latestMatchData.status !== 'playing') {
        console.warn("processTurn called but state is not ready (actions missing, or status not 'playing'). Exiting.");
        return; 
    }
    data = latestMatchData;

    if (timerInterval) { clearInterval(timerInterval); setTimerInterval(null); }
    disableActionButtons(true);
    setHasPlayedThisTurn(false); 
    aiActionSubmittedForThisRound = false; // Réinitialiser le drapeau de l'IA pour le prochain tour

    const p1Action = data.players.p1.action;
    const p2Action = data.players.p2.action;

    let p1PV = data.players.p1.pv;
    let p2PV = data.players.p2.pv;
    let historyUpdates = [...(data.history || [])];

    historyUpdates.push(`--- Début du tour ---`);

    // Logique d'application des actions
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

    console.log("New P1 PV (before DB update):", p1PV); 
    console.log("New P2 PV (before DB update):", p2PV); 

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
        [`players/p2/action`]: null, // Réinitialise l'action de P2
        history: historyUpdates,
        status: gameStatus,
        lastTurnProcessedAt: serverTimestamp() // Met à jour le timestamp du traitement du tour
    };
    
    // En mode PvAI, le "turn" reste toujours `p1` car c'est le joueur humain qui initie chaque round.
    // L'IA réagit au tour de p1.
    if (gameStatus === 'playing') {
        updates.turn = 'p1'; 
    } else {
        updates.turn = null; 
    }

    if (winner) { updates.winner = winner; if (loser) updates.loser = loser; }

    try {
        await update(matchRef, updates);
        console.log("DEBUG: Firebase update completed successfully (processTurn). New turn set to:", updates.turn); 
    } catch (error) {
        console.error("DEBUG: ERROR during Firebase update in processTurn:", error);
        showMessage("action-msg", "Erreur critique lors du traitement du tour. Veuillez recharger la page.");
    }
}

async function submitDefaultAction(playerKey, matchRef, currentMatchData) {
    if (!playerKey || !matchRef || !currentMatchData) return;
    
    const snapshot = await get(matchRef);
    const data = snapshot.val();
    if (!data || data.players[playerKey]?.action || data.status !== 'playing') { 
        console.log(`Default action for ${playerKey} already submitted, match ended, or not in playing state.`);
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

export async function aiTurn(playerPV, aiPV, matchRef) {
    const snapshot = await get(matchRef);
    const currentMatchData = snapshot.val();

    // L'IA ne joue que si :
    // - Le match est 'playing'
    // - C'est le tour du joueur (P1) pour que l'IA réagisse
    // - Le joueur (P1) a bien soumis son action
    // - L'IA (P2) n'a PAS encore soumis son action pour ce tour
    const isAITurnToAct = 
        currentMatchData && 
        currentMatchData.status === 'playing' && 
        currentMatchData.turn === 'p1' && // L'IA réagit au tour de P1
        currentMatchData.players.p1?.action && // P1 a soumis son action
        !currentMatchData.players.p2?.action; // L'IA n'a pas encore agi ce tour

    if (!isAITurnToAct) {
        console.log("AI skip (aiTurn): Not the correct state for AI to play or AI already played.");
        return;
    }

    let aiAction = 'defend';
    if (aiPV < 30 && playerPV > 0) { aiAction = 'heal'; }
    else if (playerPV < 40 && aiPV > 0) { aiAction = 'attack'; }
    else { const actions = ['attack', 'defend']; aiAction = actions[Math.floor(Math.random() * actions.length)]; }

    const updates = {};
    updates[`players/p2/action`] = aiAction;

    const newHistory = [...(currentMatchData.history || [])];
    newHistory.push(`L'IA a choisi : ${aiAction === 'attack' ? 'Attaque' : (aiAction === 'defend' ? 'Défense' : 'Soin')}.`);
    updates.history = newHistory;

    try {
        await update(matchRef, updates);
        console.log("AI action submitted:", aiAction);
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

    // En mode PvAI, le tour est toujours 'p1' (vous).
    // Vous pouvez agir si c'est votre tour (p1) ET vous n'avez pas encore soumis votre action.
    if (matchData.turn !== youKey || matchData.players[youKey]?.action) {
        showMessage("action-msg", "Ce n'est pas votre tour ou vous avez déjà joué !");
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
                 const shouldDelete = (youKey === 'p1' && currentData.status === 'finished') || 
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
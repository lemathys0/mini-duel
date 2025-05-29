// game.js - Mise à jour de la logique de démarrage du match et du traitement du tour

import { db } from "./firebaseConfig.js";
import { ref, get, update, onValue, onDisconnect, remove, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js";
import { showMessage, disableActionButtons, updateHealthBar, updateTimerUI, clearHistory } from "./utils.js";
import { backToMenu, currentUser, currentMatchId, youKey, opponentKey, gameMode, setMatchVariables, timerMax, timerInterval, setTimerInterval, setOnDisconnectRef, onDisconnectRef, matchDeletionTimeout, setMatchDeletionTimeout, hasPlayedThisTurn, setHasPlayedThisTurn, updateUserStats } from "./main.js";

let currentMatchUnsubscribe = null;
let aiActionSubmittedForThisRound = false; // Drapeau pour l'IA PvAI

// Constante pour le cooldown de soin (déclarée une seule fois ici pour une meilleure gestion)
const HEAL_COOLDOWN_TURNS = 3; 

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
        console.log("DEBUG onValue - aiActionSubmittedForThisRound:", aiActionSubmittedForThisRound); 
        // --- FIN DES LOGS DE DÉBOGAGE POUR ONVALUE ---

        // 1. Gestion du match supprimé ou inexistant
        if (!data) {
            if (currentMatchId === id) { // S'assurer que c'est bien le match en cours qui est supprimé
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
        if (data.mode === 'PvP') { // Utiliser data.mode pour déterminer si c'est PvP
            const yourPlayerRef = ref(db, `matches/${id}/players/${youKey}`);
            if (!onDisconnectRef) {
                const newOnDisconnectRef = onDisconnect(yourPlayerRef);
                newOnDisconnectRef.update({
                    pv: 0, // PV à 0 pour indiquer une défaite par déconnexion
                    status: 'forfeited',
                    lastSeen: serverTimestamp()
                }).catch(error => console.error("Error setting onDisconnect:", error));
                setOnDisconnectRef(newOnDisconnectRef);
            }
            // Mettre à jour le statut du joueur à chaque rafraîchissement
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
            
            if (data.players[opponentKey]?.action) {
                opponentActionStatus = "Action soumise !";
            } else { 
                opponentActionStatus = "En attente d'action de l'adversaire...";
            }
            
            // Gérer le forfait de l'adversaire en mode PvP
            if (data.mode === 'PvP' && (opponent.status === 'forfeited' || opponent.pv <= 0)) {
                showMessage("action-msg", `L'adversaire (${opponent.pseudo}) a quitté le match ou est vaincu.`);
                handleGameEnd(data, 'win'); // Le joueur actuel gagne par forfait
                return;
            }
        } else {
            // Affichage si l'adversaire n'est pas encore connecté (en mode PvP 'waiting')
            document.getElementById("opponent-pv-display").textContent = "N/A";
            document.getElementById("opponent-health-bar").style.width = "0%";
            document.getElementById("opponent-health-bar").textContent = "0%";
            document.getElementById("opponent-name").textContent = "En attente...";
            opponentActionStatus = "En attente d'un adversaire...";
        }
        document.getElementById("opponent-action-status").textContent = opponentActionStatus;

        // Mise à jour visuelle du bouton de soin du joueur
        const healButton = document.getElementById("action-heal");
        updateHealButtonUI(healButton, you.healCooldown, HEAL_COOLDOWN_TURNS);


        // 5. Conditions de fin de jeu
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
        // Cacher la section de matchmaking une fois que le match commence vraiment (status "playing")
        if (data.status === "playing") {
             document.getElementById("matchmaking-status").style.display = "none";
        }

        if (data.mode === 'PvP' && (data.status === "waiting" || !opponent || opponent.status === 'forfeited')) {
            // Si le match est en attente d'un adversaire, afficher le message approprié
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

        // LOGIQUE DU JOUEUR HUMAIN (P1 ou P2)
        // Les boutons sont activés UNIQUEMENT si c'est votre tour (data.turn === youKey)
        // ET si vous n'avez pas encore soumis votre action pour ce round.
        if (data.turn === youKey && !data.players[youKey]?.action) {
            disableActionButtons(false);
            // Gérer l'état du bouton de soin séparément de disableActionButtons
            if (you.healCooldown < HEAL_COOLDOWN_TURNS || you.lastAction === 'heal') {
                document.getElementById("action-heal").disabled = true;
            } else {
                document.getElementById("action-heal").disabled = false;
            }

            showMessage("action-msg", "C'est votre tour ! Choisissez une action.");
            
            setTimerInterval(setInterval(() => {
                const currentElapsed = Math.floor((Date.now() - lastTurnProcessedAtTimestamp) / 1000);
                const currentRemaining = Math.max(0, timerMax - currentElapsed);
                updateTimerUI(currentRemaining);
                if (currentRemaining <= 0) {
                    clearInterval(timerInterval);
                    setTimerInterval(null);
                    // Si le timer est écoulé, le joueur n'a pas agi, et c'est son tour
                    if (data.turn === youKey && !data.players[youKey]?.action) {
                        submitDefaultAction(youKey, matchRef, data);
                    }
                }
            }, 1000));
        } else {
            disableActionButtons(true); // Désactive tous les boutons
            if (data.players[youKey]?.action && !data.players[opponentKey]?.action) {
                showMessage("action-msg", "Action jouée. En attente de l'adversaire...");
            } else if (data.turn === opponentKey && !data.players[opponentKey]?.action) {
                showMessage("action-msg", `C'est le tour de ${opponent.pseudo}. Veuillez patienter...`);
            } else {
                showMessage("action-msg", "Veuillez patienter...");
            }
            updateTimerUI(timerMax); 
        }

        // --- LOGIQUE DE DÉCLENCHEMENT DE L'IA (MODE PvAI UNIQUEMENT) ---
        // L'IA agit seulement après que le joueur humain ait soumis son action (manuellement ou par défaut).
        // NOUVELLE CONDITION : Vérifier que le mode de jeu est bien 'PvAI'
        if (data.mode === 'PvAI' && data.status === 'playing') { 
            const shouldAiReactThisMoment = 
                !aiActionSubmittedForThisRound && // N'a pas encore soumis d'action pour ce round
                data.turn === youKey && // C'est le tour du joueur humain (P1)
                data.players[youKey]?.action && // Le joueur humain (P1) a soumis son action
                !data.players[opponentKey]?.action; // L'IA (P2) n'a pas encore réagi
            
            if (shouldAiReactThisMoment) {
                console.log("Considering AI action based on current turn state.");
                disableActionButtons(true); 
                showMessage("action-msg", `L'IA réfléchit...`);
                
                aiActionSubmittedForThisRound = true; // Empêche les multiples déclenchements

                await new Promise(resolve => setTimeout(resolve, 3000)); // Délai de 3 secondes pour l'IA
                
                const latestSnapshot = await get(matchRef);
                const latestData = latestSnapshot.val();
                if (latestData) { 
                    // Assurez-vous que l'IA joue en tant que p2
                    aiTurn(latestData.players.p1.pv, latestData.players.p2.pv, matchRef);
                }
            }
        }
        // --- FIN DE LA LOGIQUE DE DÉCLENCHEMENT DE L'IA ---


        // LOGIQUE DE TRAITEMENT DU TOUR
        // Le traitement se fait lorsque les deux actions du round sont soumises (P1 et P2).
        if (data.players.p1?.action && data.players.p2?.action) {
            // Le joueur P1 (ou le client en mode PvAI) est responsable du traitement du tour.
            // Cela assure qu'un seul client met à jour la base de données pour éviter les conflits.
            if (youKey === 'p1') { 
                console.log("Both actions submitted. P1 client processing turn.");
                disableActionButtons(true);
                showMessage("action-msg", "Actions soumises. Traitement du tour...");
                updateTimerUI(timerMax);
                setTimeout(() => processTurn(data, matchRef), 700); 
            } else { // Si vous êtes P2 en PvP, vous attendez P1
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
    aiActionSubmittedForThisRound = false; 

    const p1Action = data.players.p1.action;
    const p2Action = data.players.p2.action;

    let p1PV = data.players.p1.pv;
    let p2PV = data.players.p2.pv;
    let historyUpdates = [...(data.history || [])];

    // Récupérer les cooldowns actuels et les incrémenter ou réinitialiser
    let p1HealCooldown = data.players.p1.healCooldown || 0;
    let p2HealCooldown = data.players.p2.healCooldown || 0;

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
    if (p1Action === 'heal') { 
        p1PV = Math.min(100, p1PV + 15); 
        historyUpdates.push(`${data.players.p1.pseudo} se soigne et récupère 15 PV.`); 
        p1HealCooldown = 0; // Réinitialise si le joueur 1 a soigné
    } else {
        p1HealCooldown++; // Incrémente si le joueur 1 n'a PAS soigné
    }
    if (p2Action === 'heal') { 
        p2PV = Math.min(100, p2PV + 15); 
        historyUpdates.push(`${data.players.p2.pseudo} se soigne et récupère 15 PV.`); 
        p2HealCooldown = 0; // Réinitialise si le joueur 2 a soigné
    } else {
        p2HealCooldown++; // Incrémente si le joueur 2 n'a PAS soigné
    }
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
        [`players/p1/action`]: null, 
        [`players/p2/action`]: null, 
        [`players/p1/healCooldown`]: p1HealCooldown, // <-- MISE À JOUR DU COOLDOWN
        [`players/p2/healCooldown`]: p2HealCooldown, // <-- MISE À JOUR DU COOLDOWN
        history: historyUpdates,
        status: gameStatus,
        lastTurnProcessedAt: serverTimestamp() 
    };
    
    // En mode PvAI, le "turn" reste toujours `p1` car c'est le joueur humain qui initie chaque round.
    // En mode PvP, le tour alterne.
    if (gameStatus === 'playing') {
        // En mode PvP, le tour bascule entre p1 et p2
        updates.turn = (data.mode === 'PvP') ? (data.turn === 'p1' ? 'p2' : 'p1') : 'p1'; 
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

// Fonction pour soumettre une action par défaut (quand le temps est écoulé)
async function submitDefaultAction(playerKey, matchRef, currentMatchData) {
    if (!playerKey || !matchRef || !currentMatchData) return;
    
    const snapshot = await get(matchRef);
    const data = snapshot.val();
    // Vérifier à nouveau si une action a déjà été soumise ou si le match est terminé
    if (!data || data.players[playerKey]?.action || data.status !== 'playing') { 
        console.log(`Default action for ${playerKey} already submitted, match ended, or not in playing state.`);
        return;
    }

    const defaultAction = 'defend';
    const updates = {};
    updates[`players/${playerKey}/action`] = defaultAction;
    updates[`players/${playerKey}/lastAction`] = defaultAction; // <-- Mise à jour de lastAction pour l'action par défaut

    const newHistory = [...(data.history || [])]; 
    const pseudo = data.players[playerKey]?.pseudo || "Un joueur";
    newHistory.push(`${pseudo} n'a pas agi à temps et s'est automatiquement défendu.`);
    updates.history = newHistory;

    try {
        await update(matchRef, updates);
        console.log(`Default action '${defaultAction}' submitted for ${playerKey}.`);
    } catch (error) {
        console.error(`ERROR submitting default action for ${playerKey}:`, error);
    }
}

// Fonction de l'IA (peut être appelée directement pour que l'IA joue sa réaction)
export async function aiTurn(playerPV, aiPV, matchRef) {
    const snapshot = await get(matchRef);
    const currentMatchData = snapshot.val();

    // Condition pour que l'IA ne joue que si le mode est PvAI
    if (currentMatchData.mode !== 'PvAI') { 
        console.log("AI skip: Not in PvAI mode.");
        return;
    }

    const isAITurnToAct = 
        currentMatchData && 
        currentMatchData.status === 'playing' && 
        currentMatchData.turn === 'p1' && // L'IA joue toujours quand c'est le tour de P1 (car P1 est l'humain en PvAI)
        currentMatchData.players.p1?.action && 
        !currentMatchData.players.p2?.action;

    if (!isAITurnToAct) {
        console.log("AI skip (aiTurn): Not the correct state for AI to play or AI already played.");
        return;
    }

    const aiLastAction = currentMatchData.players.p2?.lastAction; 
    const aiHealCooldown = currentMatchData.players.p2?.healCooldown || 0; 
    
    let aiAction = 'defend';
    
    // --- NOUVELLE LOGIQUE DE DÉCISION DE L'IA AVEC COOLDOWN ---

    // Priorité 1: Tenter de finir le joueur si ses PV sont très bas, même si l'IA est blessée.
    if (playerPV <= 10 && aiPV > 0) { 
        aiAction = 'attack';
    } 
    // Priorité 2: Se soigner si les PV sont critiques, si cooldown disponible, ET pas de soin au tour précédent
    else if (aiPV <= 25 && aiHealCooldown >= HEAL_COOLDOWN_TURNS && aiLastAction !== 'heal') { 
        aiAction = 'heal';
    }
    // Priorité 3: Si l'IA a des PV "raisonnables" (au-dessus de 50), elle peut être plus agressive.
    else if (aiPV > 50 && playerPV > 20) { 
        const actions = ['attack', 'defend']; 
        aiAction = actions[Math.floor(Math.random() * actions.length)]; 
    }
    // Priorité 4: Comportement par défaut (aléatoire)
    else { 
        const actions = ['attack', 'defend']; 
        if (aiHealCooldown >= HEAL_COOLDOWN_TURNS && aiLastAction !== 'heal') {
            actions.push('heal');
        }
        aiAction = actions[Math.floor(Math.random() * actions.length)];
    }

    // --- FIN DE LA NOUVELLE LOGIQUE DE DÉCISION DE L'IA ---

    const updates = {};
    updates[`players/p2/action`] = aiAction;
    updates[`players/p2/lastAction`] = aiAction; 

    // Réinitialiser le cooldown si l'IA a choisi de se soigner
    if (aiAction === 'heal') {
        updates[`players/p2/healCooldown`] = 0;
    }

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

// Fonction pour que le joueur humain puisse soumettre une action
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

    const you = matchData.players[youKey];
    
    // --- RÈGLES DE SOIN (1 fois tous les 3 tours et pas deux fois d'affilée) ---
    if (actionType === 'heal') {
        if (you.lastAction === 'heal') {
            showMessage("action-msg", "Vous ne pouvez pas vous soigner deux fois d'affilée !");
            return;
        }
        if (you.healCooldown < HEAL_COOLDOWN_TURNS) {
            showMessage("action-msg", `Vous ne pouvez pas vous soigner pour le moment. Attendez ${HEAL_COOLDOWN_TURNS - you.healCooldown} tours.`);
            return;
        }
    }
    // --- FIN DES RÈGLES DE SOIN ---

    if (matchData.turn !== youKey || matchData.players[youKey]?.action) {
        showMessage("action-msg", "Ce n'est pas votre tour ou vous avez déjà joué !");
        return;
    }

    const updates = {};
    updates[`players/${youKey}/action`] = actionType;
    updates[`players/${youKey}/lastAction`] = actionType; 
    
    // Réinitialiser le cooldown si l'action est un soin
    if (actionType === 'heal') {
        updates[`players/${youKey}/healCooldown`] = 0; // Réinitialise le compteur après un soin
    }

    const actionDisplayName = { 'attack': 'Attaquer', 'defend': 'Défendre', 'heal': 'Soigner' }[actionType];
    showMessage("action-msg", `Vous avez choisi : ${actionDisplayName}. En attente de l'adversaire...`);

    try {
        await update(matchRef, updates);
        setHasPlayedThisTurn(true); 
        disableActionButtons(true);
        if (timerInterval) { clearInterval(timerInterval); setTimerInterval(null); }
        
        // Mise à jour visuelle du bouton de soin immédiatement après avoir joué si c'était un soin
        if (actionType === 'heal') {
            const healButton = document.getElementById("action-heal");
            updateHealButtonUI(healButton, 0, HEAL_COOLDOWN_TURNS);
        }
    } catch (error) {
        console.error("Error performing action:", error);
        showMessage("action-msg", "Erreur lors de l'envoi de votre action.");
    }
}

// Nouvelle fonction pour mettre à jour l'état visuel du bouton de soin
function updateHealButtonUI(button, currentCooldown, maxCooldown) {
    if (!button) return;

    if (currentCooldown >= maxCooldown) {
        button.disabled = false;
        button.style.backgroundColor = ''; // Revert to default or blue color
        button.style.color = ''; // Revert to default or white color
        button.textContent = `Soigner (+15 PV)`;
    } else {
        button.disabled = true;
        button.style.backgroundColor = '#cccccc'; // Gris
        button.style.color = '#666666'; // Texte gris foncé
        button.textContent = `Soin (${maxCooldown - currentCooldown} tours)`;
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
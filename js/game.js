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
            if (opponent.action) {
                opponentActionStatus = "Action soumise !";
            } else if (!opponent.action && data.players[youKey]?.action) { // Si vous avez joué et que l'adversaire n'a pas encore
                opponentActionStatus = "En attente d'action de l'adversaire...";
            } else { // Si l'adversaire doit jouer ou si c'est son tour de soumettre
                opponentActionStatus = "En attente d'action de l'adversaire...";
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
        // S'assurer que lastTurnProcessedAt est un nombre (pour le timer)
        const lastTurnProcessedTime = data.lastTurnProcessedAt && typeof data.lastTurnProcessedAt.toMillis === 'function'
            ? data.lastTurnProcessedAt.toMillis()
            : (data.lastTurnProcessedAt || currentTime); 
        
        // Le timer est géré par setInterval, pas directement ici.
        if (timerInterval) { clearInterval(timerInterval); setTimerInterval(null); } // Toujours effacer l'ancien timer

        // Important: `data.turn` indique qui doit commencer le tour.
        // En mode PvAI, nous voulons que P1 commence chaque tour, et P2 (IA) réponde.
        
        // LOGIQUE DU JOUEUR HUMAIN
        // Si c'est votre tour de commencer le round (data.turn === youKey)
        // ET que vous n'avez pas encore soumis votre action pour ce round
        if (data.turn === youKey && !data.players[youKey]?.action) {
            disableActionButtons(false);
            showMessage("action-msg", "C'est votre tour ! Choisissez une action.");
            
            // Démarrer le timer pour le joueur humain
            setTimerInterval(setInterval(() => {
                const currentElapsed = Math.floor((Date.now() - lastTurnProcessedTime) / 1000);
                const currentRemaining = Math.max(0, timerMax - currentElapsed);
                updateTimerUI(currentRemaining);
                if (currentRemaining <= 0) {
                    clearInterval(timerInterval);
                    setTimerInterval(null);
                    // Soumettre une action par défaut si le temps est écoulé
                    submitDefaultAction(youKey, matchRef, data);
                }
            }, 1000));
        } 
        // Si vous avez déjà soumis votre action (ou si ce n'est pas votre tour de commencer le round)
        else {
            disableActionButtons(true);
            // Message différent selon l'état des actions
            if (data.players[youKey]?.action && !data.players[opponentKey]?.action) {
                showMessage("action-msg", "Action jouée. En attente de l'adversaire...");
            } else if (!data.players[youKey]?.action && data.players[opponentKey]?.action) { // Normalement pas possible si youKey === 'p1' et l'IA réagit
                showMessage("action-msg", `En attente de votre action (adversaire a joué).`);
            } else if (!data.players[youKey]?.action && !data.players[opponentKey]?.action && data.turn === opponentKey) {
                // Ce cas arrive si `processTurn` bascule le tour sur l'IA (p2)
                // C'est le moment où l'IA doit agir pour la "deuxième" fois dans le bug que vous décrivez.
                showMessage("action-msg", `C'est le tour de ${opponent ? opponent.pseudo : 'l\'adversaire'}. Veuillez patienter...`);
            } else {
                showMessage("action-msg", "Veuillez patienter...");
            }
            updateTimerUI(timerMax); // Réinitialise le timer visuel
        }

        // --- LOGIQUE DE DÉCLENCHEMENT DE L'IA (MODE PvAI UNIQUEMENT) ---
        if (gameMode === 'PvAI' && data.status === 'playing') {
            // **Cas 1: L'IA réagit à l'action de P1 DANS LE MÊME ROUND.**
            // C'est le flux standard P1 -> P2 -> Process.
            if (data.turn === youKey && data.players[youKey]?.action && !data.players[opponentKey]?.action) {
                console.log("Player P1 has submitted action. Triggering AI's response (P2) for this round.");
                disableActionButtons(true);
                showMessage("action-msg", `Votre action est jouée. L'IA réagit...`);
                setTimeout(async () => {
                    const latestSnapshot = await get(matchRef);
                    const latestData = latestSnapshot.val();
                    // Double vérification avant de déclencher l'IA pour éviter les doublons
                    if (latestData && latestData.status === 'playing' && latestData.turn === youKey && latestData.players[youKey]?.action && !latestData.players[opponentKey]?.action) {
                        aiTurn(latestData.players.p1.pv, latestData.players.p2.pv, matchRef);
                    } else {
                        console.log("AI response skipped: State changed, or AI already played.");
                    }
                }, 1000); // Court délai pour simuler le temps de réaction de l'IA
                return; // L'IA va soumettre une action, ce qui redéclenchera onValue
            }
            // **Cas 2: L'IA doit jouer SON PROPRE TOUR (si processTurn a basculé data.turn sur 'p2')**
            // C'est le comportement indésirable que vous observez après le premier processTurn.
            // Ce bloc va forcer l'IA à rejouer.
            else if (data.turn === opponentKey && !data.players[opponentKey]?.action) {
                 console.log("It's AI's (P2) turn and AI hasn't acted yet. Triggering AI's action for its dedicated turn.");
                 disableActionButtons(true); 
                 showMessage("action-msg", "L'IA réfléchit (son tour)...");
                 setTimeout(async () => {
                     const latestSnapshot = await get(matchRef);
                     const latestData = latestSnapshot.val();
                     if (latestData && latestData.status === 'playing' && latestData.turn === opponentKey && !latestData.players[opponentKey]?.action) {
                         aiTurn(latestData.players.p1.pv, latestData.players.p2.pv, matchRef);
                     } else {
                         console.log("AI action skipped: State changed, or AI already played.");
                     }
                 }, 1500); // Un peu plus de délai pour un effet "réflexion"
                 return; // L'IA va soumettre une action, ce qui redéclenchera onValue
            }
        }
        // --- FIN DE LA LOGIQUE DE DÉCLENCHEMENT DE L'IA ---


        // LOGIQUE DE TRAITEMENT DU TOUR (si les deux actions sont soumises)
        if (data.players.p1?.action && data.players.p2?.action) {
            // C'est le rôle de P1 (ou du client en mode PvAI) de traiter le tour
            // C'est déclenché une fois que les deux actions (P1 et P2) sont présentes.
            if (youKey === 'p1' || gameMode === 'PvAI') { 
                console.log("Both actions submitted. P1/AI client processing turn.");
                disableActionButtons(true);
                showMessage("action-msg", "Actions soumises. Traitement du tour...");
                updateTimerUI(timerMax);

                // Ajoute un petit délai avant de traiter le tour
                setTimeout(() => processTurn(data, matchRef), 500);
            } else {
                // P2 attend que P1 traite le tour (uniquement en PvP si P1 est le leader)
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

    // IMPORTANT: Récupérer les dernières données de la DB juste avant de traiter pour éviter les incohérences.
    const latestMatchSnapshot = await get(matchRef);
    const latestMatchData = latestMatchSnapshot.val();

    if (!latestMatchData || !latestMatchData.players.p1?.action || !latestMatchData.players.p2?.action) {
        console.warn("processTurn called but one or both actions were null (or missing) in latest data. Exiting (possibly already processed or not ready).");
        return; // Ne pas traiter si les actions ne sont pas là ou si le match a changé
    }
    // Utiliser les données les plus récentes pour le calcul
    data = latestMatchData;

    if (timerInterval) { clearInterval(timerInterval); setTimerInterval(null); }
    disableActionButtons(true);
    setHasPlayedThisTurn(false); // Reset pour le prochain tour

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

    console.log("New P1 PV (before DB update):", p1PV); // Debugging: Nouveaux PV P1
    console.log("New P2 PV (before DB update):", p2PV); // Debugging: Nouveaux PV P2

    // Si le comportement est : P1 joue, IA joue, Process, PUIS C'EST LE TOUR DE L'IA,
    // cela signifie que le processTurn bascule le tour sur l'IA (p2).
    // Après que l'IA a joué ce "deuxième" tour, il faut que processTurn ramène le tour à P1.
    let nextTurn;
    if (data.turn === 'p1') {
        nextTurn = 'p2'; // Après un round initié par P1, on passe à un round initié par P2
    } else { // data.turn === 'p2'
        nextTurn = 'p1'; // Après un round initié par P2, on revient à P1
    }

    let gameStatus = 'playing';
    let winner = null;
    let loser = null;

    if (p1PV <= 0 && p2PV <= 0) { gameStatus = "finished"; winner = "draw"; historyUpdates.push("Les deux joueurs sont à terre. C'est un match nul !"); }
    else if (p1PV <= 0) { gameStatus = "finished"; winner = "p2"; loser = "p1"; historyUpdates.push(`${data.players.p1.pseudo} est vaincu ! ${data.players.p2.pseudo} gagne le match.`); }
    else if (p2PV <= 0) { gameStatus = "finished"; winner = "p1"; loser = "p2"; historyUpdates.push(`${data.players.p2.pseudo} est vaincu ! ${data.players.p1.pseudo} gagne le match.`); }

    const updates = {
        [`players/p1/pv`]: p1PV,
        [`players/p2/pv`]: p2PV,
        [`players/p1/action`]: null, // Réinitialise l'action de P1 (sera 'undefined' à la lecture si supprimé)
        [`players/p2/action`]: null, // Réinitialise l'action de P2 (sera 'undefined' à la lecture si supprimé)
        history: historyUpdates,
        turn: nextTurn, // C'est ici que le prochain tour est défini
        status: gameStatus,
        lastTurnProcessedAt: serverTimestamp() // Met à jour le timestamp du traitement du tour
    };
    if (winner) { updates.winner = winner; if (loser) updates.loser = loser; }

    try {
        await update(matchRef, updates);
        console.log("DEBUG: Firebase update completed successfully (processTurn). New turn set to:", nextTurn); // Debugging: Confirme le prochain tour envoyé
    } catch (error) {
        console.error("DEBUG: ERROR during Firebase update in processTurn:", error);
        showMessage("action-msg", "Erreur critique lors du traitement du tour. Veuillez recharger la page.");
    }
}

async function submitDefaultAction(playerKey, matchRef, currentMatchData) {
    if (!playerKey || !matchRef || !currentMatchData) return;
    
    // Obtenir la dernière version du match pour éviter les conflits
    const snapshot = await get(matchRef);
    const data = snapshot.val();
    if (!data || data.players[playerKey]?.action) {
        console.log(`Default action for ${playerKey} already submitted or match ended.`);
        return;
    }

    const defaultAction = 'defend';
    const updates = {};
    updates[`players/${playerKey}/action`] = defaultAction;

    const newHistory = [...(data.history || [])]; // Utilise les dernières données
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
    // Obtenir la dernière version du match pour s'assurer de l'état actuel avant de jouer
    const snapshot = await get(matchRef);
    const currentMatchData = snapshot.val();

    // L'IA ne joue que si le match est "playing" et si elle n'a pas encore soumis d'action.
    // L'IA joue quand on l'appelle spécifiquement dans onValue, et non en fonction de 'turn' ici.
    if (!currentMatchData || currentMatchData.status !== 'playing' || currentMatchData.players.p2?.action) {
        console.log("AI skip: Not correct state for AI to play, AI already played, or match ended.");
        return;
    }

    let aiAction = 'defend';
    // Logique de décision de l'IA basée sur les PV actuels
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
    // Vérification de `hasPlayedThisTurn` avant toute autre chose
    if (hasPlayedThisTurn) {
        showMessage("action-msg", "Vous avez déjà soumis une action pour ce tour.");
        return;
    }
    
    if (!currentMatchId || !currentUser) { return; }

    const matchRef = ref(db, `matches/${currentMatchId}`);
    const matchSnapshot = await get(matchRef);
    const matchData = matchSnapshot.val();

    if (!matchData) { showMessage("action-msg", "Match introuvable ou terminé."); backToMenu(true); return; }
    
    // Ajout d'un log pour vérifier le tour avant de jouer
    console.log("Attempting to perform action. Current turn in DB:", matchData.turn, "Your key:", youKey);

    // Vous pouvez agir si c'est votre tour de commencer ce round (`matchData.turn === youKey`)
    // ET si vous n'avez pas encore soumis votre action (`!matchData.players[youKey].action`).
    if (matchData.turn !== youKey || matchData.players[youKey].action) {
        showMessage("action-msg", "Ce n'est pas votre tour ou vous avez déjà joué !");
        return;
    }

    const updates = {};
    updates[`players/${youKey}/action`] = actionType;

    const actionDisplayName = { 'attack': 'Attaquer', 'defend': 'Défendre', 'heal': 'Soigner' }[actionType];
    showMessage("action-msg", `Vous avez choisi : ${actionDisplayName}. En attente de l'adversaire...`);

    try {
        await update(matchRef, updates);
        setHasPlayedThisTurn(true); // Met à jour l'état local APRES la soumission réussie
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
                 const shouldDelete = (youKey === 'p1') || // P1 est le créateur et donc responsable de la suppression après la fin
                                      (currentData.status === 'forfeited' && currentData.winner === youKey); // Si le match a été "forfait" et que vous êtes le gagnant
                 if (shouldDelete) {
                     try { await remove(matchRef); } catch (err) { console.error("Error removing finished match:", err); }
                 }
            }
            backToMenu(true);
            setMatchDeletionTimeout(null);
        }, 10000));
    }
}
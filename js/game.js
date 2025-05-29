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

        let opponentActionStatus = "";
        if (opponent) {
            updateHealthBar(document.getElementById("opponent-health-bar"), document.getElementById("opponent-pv-display"), opponent.pv, true);
            document.getElementById("opponent-name").textContent = opponent.pseudo;
            if (opponent.action) {
                opponentActionStatus = "Action soumise !";
            } else if (data.turn === opponentKey) {
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
        // S'assurer que lastTurnProcessedAt est un nombre
        const lastTurnProcessedTime = data.lastTurnProcessedAt && typeof data.lastTurnProcessedAt.toMillis === 'function'
            ? data.lastTurnProcessedAt.toMillis()
            : (data.lastTurnProcessedAt || currentTime); // Fallback pour les anciens formats ou si null
        
        // Le timer est géré par setInterval, pas directement ici.
        // La mise à jour de l'UI du timer est gérée par le setInterval en cours
        // ou réinitialisée si le tour change.
        if (timerInterval) { clearInterval(timerInterval); setTimerInterval(null); } // Toujours effacer l'ancien timer

        let activePlayerKey = data.turn;
        let activePlayer = data.players[activePlayerKey];

        // LOGIQUE DE L'IA (prioritaire si c'est son tour et qu'elle n'a pas agi)
        if (gameMode === 'PvAI' && activePlayerKey === 'p2' && !activePlayer.action) {
            console.log("AI's turn detected and no action submitted. Triggering AI turn.");
            disableActionButtons(true);
            showMessage("action-msg", `Tour de l'IA. Veuillez patienter...`);

            // Ajoute un petit délai pour simuler une "réflexion"
            setTimeout(async () => {
                // IMPORTANT: Relire l'état actuel juste avant que l'IA ne joue
                const latestSnapshot = await get(matchRef);
                const latestData = latestSnapshot.val();
                // S'assurer que le match n'est pas terminé, que c'est toujours le tour de l'IA
                // et qu'elle n'a pas été déclenchée par un autre onValue entre-temps
                if (latestData && latestData.status === 'playing' && latestData.turn === 'p2' && !latestData.players.p2?.action) {
                    aiTurn(latestData.players.p1.pv, latestData.players.p2.pv, matchRef);
                } else {
                    console.log("AI skip: Match state changed or AI already played before setTimeout.");
                }
            }, 1500);
            return; // Sortir d'ici car l'IA va modifier la DB et redéclencher onValue
        }

        // LOGIQUE DU JOUEUR HUMAIN
        if (youKey === activePlayerKey) {
            if (!you.action) { // Vérifie directement si l'action du joueur n'est pas encore soumise
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
            } else {
                // Le joueur a déjà soumis son action
                disableActionButtons(true);
                showMessage("action-msg", "Action jouée. En attente de l'adversaire...");
                updateTimerUI(timerMax); // Réinitialise le timer visuel
            }
        } else { // Ce n'est pas le tour du joueur humain (c'est le tour de l'adversaire, ou traitement)
            disableActionButtons(true);
            showMessage("action-msg", `Tour de ${opponent ? opponent.pseudo : 'l\'adversaire'}. Veuillez patienter...`);
            updateTimerUI(timerMax); // Réinitialise le timer visuel
        }

        // LOGIQUE DE TRAITEMENT DU TOUR (si les deux actions sont soumises)
        if (data.players.p1?.action && data.players.p2?.action) {
            // C'est le rôle de P1 (ou du client en mode PvAI) de traiter le tour
            if (youKey === 'p1' || gameMode === 'PvAI') {
                console.log("Both actions submitted. P1/AI client processing turn.");
                disableActionButtons(true); // Assurez-vous que les boutons sont désactivés
                showMessage("action-msg", "Actions soumises. Traitement du tour...");
                updateTimerUI(timerMax); // Réinitialise le timer visuel

                // Ajoute un petit délai avant de traiter le tour pour laisser le temps à l'UI de se mettre à jour
                setTimeout(() => processTurn(data, matchRef), 500);
            } else {
                // P2 attend que P1 traite le tour
                console.log("Both actions submitted. P2 waiting for P1 to process turn.");
                disableActionButtons(true);
                showMessage("action-msg", "Actions soumises. En attente du traitement du tour...");
                updateTimerUI(timerMax); // Réinitialise le timer visuel
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
        [`players/p1/action`]: null, // Réinitialise l'action de P1
        [`players/p2/action`]: null, // Réinitialise l'action de P2
        history: historyUpdates,
        turn: nextTurn,
        status: gameStatus,
        lastTurnProcessedAt: serverTimestamp() // Met à jour le timestamp du traitement du tour
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

    // Vérifications critiques avant que l'IA ne joue
    if (!currentMatchData || currentMatchData.status !== 'playing' || currentMatchData.turn !== 'p2' || currentMatchData.players.p2?.action) {
        console.log("AI skip: Not AI's turn, AI already played, or match ended.");
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
    if (matchData.turn !== youKey) { showMessage("action-msg", "Ce n'est pas votre tour !"); return; }
    if (matchData.players[youKey].action) {
         showMessage("action-msg", "Vous avez déjà soumis une action pour ce tour (vérification Firebase).");
         setHasPlayedThisTurn(true); // Assure que l'état local est à jour
         disableActionButtons(true);
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
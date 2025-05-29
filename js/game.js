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
            } else if (!opponent.action && data.players[youKey]?.action && data.turn === youKey) { 
                opponentActionStatus = "En attente de la première action de l'IA...";
            } else if (!opponent.action && data.turn === opponentKey) {
                opponentActionStatus = "En attente de la deuxième action de l'IA...";
            } else { 
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
            if (data.players[youKey]?.action && !data.players[opponentKey]?.action && data.turn === youKey) {
                showMessage("action-msg", "Action jouée. En attente de la première action de l'IA...");
            } else if (data.turn === opponentKey) {
                showMessage("action-msg", "En attente des actions de l'IA...");
            } else {
                showMessage("action-msg", "Veuillez patienter...");
            }
            updateTimerUI(timerMax); 
        }

        // --- LOGIQUE DE DÉCLENCHEMENT DE L'IA (MODE PvAI UNIQUEMENT) ---
        if (gameMode === 'PvAI' && data.status === 'playing') {
            // **Cas 1: L'IA réagit à l'action de P1 (premier tour de l'IA dans le cycle)**
            // C'est déclenché si P1 a joué, mais P2 n'a pas encore réagi.
            if (data.turn === youKey && data.players[youKey]?.action && !data.players[opponentKey]?.action) {
                console.log("Player P1 has submitted action. Triggering AI's FIRST action for this round.");
                disableActionButtons(true);
                showMessage("action-msg", `Votre action est jouée. L'IA réagit...`);
                setTimeout(async () => {
                    const latestSnapshot = await get(matchRef);
                    const latestData = latestSnapshot.val();
                    if (latestData && latestData.status === 'playing' && latestData.turn === youKey && latestData.players[youKey]?.action && !latestData.players[opponentKey]?.action) {
                        aiTurn(latestData.players.p1.pv, latestData.players.p2.pv, matchRef);
                    } else {
                        console.log("AI first action skipped: State changed, or AI already played.");
                    }
                }, 1000); 
                return; 
            }
            // **Cas 2: C'est le tour de l'IA (P2), et elle doit jouer sa DEUXIÈME action du cycle.**
            // C'est déclenché après que processTurn a mis data.turn sur 'p2'.
            else if (data.turn === opponentKey && !data.players[opponentKey]?.action) {
                 console.log("It's AI's (P2) turn and AI hasn't acted yet. Triggering AI's SECOND action for its dedicated turn.");
                 disableActionButtons(true); 
                 showMessage("action-msg", "L'IA réfléchit (son second tour)...");
                 setTimeout(async () => {
                     const latestSnapshot = await get(matchRef);
                     const latestData = latestSnapshot.val();
                     if (latestData && latestData.status === 'playing' && latestData.turn === opponentKey && !latestData.players[opponentKey]?.action) {
                         aiTurn(latestData.players.p1.pv, latestData.players.p2.pv, matchRef);
                     } else {
                         console.log("AI second action skipped: State changed, or AI already played.");
                     }
                 }, 1500); 
                 return; 
            }
        }
        // --- FIN DE LA LOGIQUE DE DÉCLENCHEMENT DE L'IA ---


        // LOGIQUE DE TRAITEMENT DU TOUR
        // Le traitement se fait lorsque les deux actions du round sont soumises.
        // Cela signifie que si data.turn === 'p1', p1.action et p2.action doivent être là.
        // Si data.turn === 'p2', seule p2.action doit être là (car p1.action sera null).
        // Cela devient plus complexe avec le cycle "Moi -> IA -> IA -> Moi".

        // Premier traitement: P1 et P2 (première action) ont joué, data.turn est p1.
        if (data.turn === youKey && data.players.p1?.action && data.players.p2?.action) {
            console.log("First action set completed (P1 & P2). Processing turn and switching to AI's dedicated turn.");
            if (youKey === 'p1' || gameMode === 'PvAI') { 
                disableActionButtons(true);
                showMessage("action-msg", "Actions soumises. Traitement du tour...");
                updateTimerUI(timerMax);
                setTimeout(() => processTurn(data, matchRef), 500);
            }
        } 
        // Deuxième traitement: P2 (deuxième action) a joué, data.turn est p2. P1.action est null.
        else if (data.turn === opponentKey && !data.players.p1?.action && data.players.p2?.action) {
            console.log("AI's second action completed. Processing turn and switching back to Player 1.");
            if (youKey === 'p1' || gameMode === 'PvAI') { 
                disableActionButtons(true);
                showMessage("action-msg", "Action de l'IA soumise. Traitement du tour...");
                updateTimerUI(timerMax);
                setTimeout(() => processTurn(data, matchRef), 500);
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

    if (!latestMatchData) {
        console.warn("processTurn called but match data is null. Exiting.");
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

    // Logique d'application des actions
    const p1Action = data.players.p1?.action; // Peut être null si IA joue son 2ème tour
    const p2Action = data.players.p2?.action;

    // Si P1 a joué, appliquer son action
    if (p1Action === 'attack') {
        historyUpdates.push(`${data.players.p1.pseudo} attaque !`);
        if (p2Action === 'defend') { p2PV -= 5; historyUpdates.push(`${data.players.p2.pseudo} se défend, subit 5 PV de dégâts.`); }
        else { p2PV -= 10; historyUpdates.push(`${data.players.p2.pseudo} subit 10 PV de dégâts.`); }
    }
    if (p1Action === 'heal') { p1PV = Math.min(100, p1PV + 15); historyUpdates.push(`${data.players.p1.pseudo} se soigne et récupère 15 PV.`); }
    if (p1Action === 'defend' && p2Action !== 'attack') { historyUpdates.push(`${data.players.p1.pseudo} se met en position défensive.`); }

    // Si P2 a joué, appliquer son action
    if (p2Action === 'attack') {
        historyUpdates.push(`${data.players.p2.pseudo} attaque !`);
        if (p1Action === 'defend') { p1PV -= 5; historyUpdates.push(`${data.players.p1.pseudo} se défend, subit 5 PV de dégâts.`); }
        else { p1PV -= 10; historyUpdates.push(`${data.players.p1.pseudo} subit 10 PV de dégâts.`); }
    }
    if (p2Action === 'heal') { p2PV = Math.min(100, p2PV + 15); historyUpdates.push(`${data.players.p2.pseudo} se soigne et récupère 15 PV.`); }
    if (p2Action === 'defend' && p1Action !== 'attack') { historyUpdates.push(`${data.players.p2.pseudo} se met en position défensive.`); }

    historyUpdates.push(`--- Fin du tour ---`);

    p1PV = Math.max(0, p1PV);
    p2PV = Math.max(0, p2PV);

    console.log("New P1 PV (before DB update):", p1PV); 
    console.log("New P2 PV (before DB update):", p2PV); 

    let nextTurn;
    let p1ActionReset = null;
    let p2ActionReset = null;

    if (data.turn === 'p1') {
        // Après le tour P1 + IA (première action), on passe au tour IA (deuxième action)
        nextTurn = 'p2';
        p1ActionReset = null; // Réinitialiser l'action de P1
        p2ActionReset = null; // Réinitialiser l'action de P2 (pour la deuxième action de l'IA)
    } else { // data.turn === 'p2'
        // Après le tour IA (deuxième action), on revient au tour P1
        nextTurn = 'p1';
        p1ActionReset = null; 
        p2ActionReset = null; 
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
        [`players/p1/action`]: p1ActionReset, 
        [`players/p2/action`]: p2ActionReset, 
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

// Les fonctions aiTurn, submitDefaultAction, performAction, et handleGameEnd restent inchangées dans leur logique interne,
// car leurs appels sont gérés par la logique onValue et processTurn.
async function submitDefaultAction(playerKey, matchRef, currentMatchData) { /* ... code inchangé ... */ }
export async function aiTurn(playerPV, aiPV, matchRef) { /* ... code inchangé ... */ }
export async function performAction(actionType) { /* ... code inchangé ... */ }
export async function handleGameEnd(data, finalResult) { /* ... code inchangé ... */ }
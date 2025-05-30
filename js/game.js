// game.js

console.log("game.js chargé."); // DEBUG : Confirme le chargement de game.js

import { db } from "./firebaseConfig.js";
import { ref, onValue, update, remove, serverTimestamp, onDisconnect, get } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js";
import {
    currentUser,
    currentMatchId, // currentMatchId doit rester accessible globalement ou être passé en paramètre
    youKey,
    opponentKey,
    gameMode,
    setMatchVariables,
    timerMax,
    timerInterval,
    setTimerInterval,
    setOnDisconnectRef,
    setMatchDeletionTimeout,
    hasPlayedThisTurn,
    setHasPlayedThisTurn,
    backToMenu,
    updateUserStats
} from "./main.js";
import { showMessage, updateHealthBar, updateTimerUI, clearHistory, disableActionButtons, enableActionButtons } from "./utils.js";
import { processAITurn } from "./aiLogic.js"; // Importe processAITurn

// Variable pour annuler l'écouteur onValue principal du match
let currentMatchUnsubscribe = null;

// Verrou pour empêcher processTurn de se déclencher plusieurs fois pour le même tour
let isProcessingTurnInternally = false;


/**
 * Exécute une action choisie par le joueur.
 * @param {string} actionType - Le type d'action ('attack', 'defend', 'heal').
 */
export async function performAction(actionType) {
    console.log(`Tentative d'action : ${actionType}`); // DEBUG : Confirme que performAction est appelée

    // DEBUG : Log des valeurs des variables clés
    console.log(`performAction - currentMatchId: ${currentMatchId}, currentUser: ${currentUser ? currentUser.uid : 'null'}, youKey: ${youKey}, hasPlayedThisTurn: ${hasPlayedThisTurn}`);

    if (!currentMatchId || !currentUser || !youKey) {
        showMessage("action-msg", "Erreur : Les informations du match ne sont pas disponibles.");
        console.error("performAction : Informations de match manquantes.");
        return;
    }

    if (hasPlayedThisTurn) {
        showMessage("action-msg", "Vous avez déjà joué votre tour.");
        console.warn("performAction : Joueur a déjà joué ce tour.");
        return;
    }
    
    if (isProcessingTurnInternally) {
        showMessage("action-msg", "Le tour est en cours de traitement, veuillez patienter.");
        console.warn("performAction : Traitement de tour en cours, action bloquée.");
        return;
    }

    disableActionButtons();
    showMessage("action-msg", "Traitement de votre action...");

    const matchRef = ref(db, `matches/${currentMatchId}`);
    const playerActionPath = `players/${youKey}/action`;

    try {
        await update(matchRef, { [playerActionPath]: actionType });
        setHasPlayedThisTurn(true);
        showMessage("action-msg", `Vous avez choisi : ${actionType}`);
        console.log(`Action '${actionType}' enregistrée pour ${youKey}.`);

    } catch (error) {
        console.error("Erreur lors de l'envoi de l'action :", error);
        showMessage("action-msg", "Erreur lors de l'envoi de votre action. Réessayez.");
        enableActionButtons();
    }
}

/**
 * Démarre la surveillance de l'état du match en temps réel depuis Firebase.
 * @param {string} matchId - L'ID du match à surveiller.
 * @param {object} user - L'objet utilisateur courant (authentifié).
 * @param {string} playerKey - La clé du joueur dans le match ('p1' ou 'p2').
 * @param {string} mode - Le mode de jeu ('PvAI' ou 'PvP').
 */
export function startMatchMonitoring(matchId, user, playerKey, mode) {
    console.log("startMatchMonitoring lancé.");
    setMatchVariables(matchId, user, playerKey, mode);

    document.getElementById("you-name").textContent = user.pseudo;
    const opponentName = (mode === 'PvAI') ? 'IA' : 'Adversaire en attente...';
    document.getElementById("opponent-name").textContent = opponentName;

    document.getElementById("auth").style.display = "none";
    document.getElementById("main-menu").style.display = "none";
    document.getElementById("matchmaking-status").style.display = "none";
    document.getElementById("game").style.display = "block";

    const matchRef = ref(db, `matches/${currentMatchId}`);

    const playerPresenceRef = ref(db, `matches/${currentMatchId}/players/${youKey}/status`);
    console.log("--- DÉBOGAGE onDisconnect ---");
    console.log("1. Valeur de db :", db);
    console.log("2. Valeur de playerPresenceRef :", playerPresenceRef);

    try {
        const onDisc = onDisconnect(playerPresenceRef);
        setOnDisconnectRef(onDisc);
        onDisc.set('disconnected').then(() => {
            console.log(`Opérations onDisconnect configurées pour ${youKey}`);
            update(matchRef, { [`players/${youKey}/status`]: 'connected', [`players/${youKey}/lastSeen`]: serverTimestamp() });
        }).catch(err => {
            console.error("Erreur lors de la configuration de onDisconnect ou de la mise à jour du statut :", err);
        });
    } catch (e) {
        console.error("Erreur générale lors de la configuration onDisconnect :", e);
    }
    console.log("--- FIN DU DÉBOGAGE onDisconnect ---");

    if (currentMatchUnsubscribe) {
        currentMatchUnsubscribe();
        console.log("Ancien écouteur onValue annulé.");
    }

    currentMatchUnsubscribe = onValue(matchRef, async (snapshot) => {
        const matchData = snapshot.val();
        if (!matchData) {
            console.log("Les données du match sont nulles. Le match a peut-être été supprimé.");
            showMessage("match-msg", "Le match a été terminé ou n'existe plus.");
            backToMenu(true);
            return;
        }

        console.log("Données du match mises à jour :", matchData);

        const you = matchData.players[youKey];
        const opponent = matchData.players[opponentKey];

        updateHealthBar("you-health-bar", you.pv);
        document.getElementById("you-pv-display").textContent = `${you.pv} PV`;
        updateHealthBar("opponent-health-bar", opponent.pv);
        document.getElementById("opponent-pv-display").textContent = `${opponent.pv} PV`;

        clearHistory();
        matchData.history.forEach(entry => showMessage("history", entry, true));

        document.getElementById("current-match").textContent = currentMatchId;
        document.getElementById("you-name").textContent = you.pseudo;
        document.getElementById("opponent-name").textContent = opponent.pseudo;

        if (matchData.status === 'finished') {
            console.log("Match terminé.");
            if (timerInterval) {
                clearInterval(timerInterval);
                setTimerInterval(null);
            }
            disableActionButtons();
            const lastHistoryEntry = matchData.history[matchData.history.length - 1];
            showMessage("match-msg", lastHistoryEntry);

            if (lastHistoryEntry.includes(you.pseudo + " a gagné") || (youKey === 'p1' && lastHistoryEntry.includes("gagné !"))) {
                await updateUserStats('win');
            } else if (lastHistoryEntry.includes(opponent.pseudo + " a gagné") || (opponentKey === 'p2' && lastHistoryEntry.includes("gagné !")) || lastHistoryEntry.includes("L'IA a gagné") || lastHistoryEntry.includes("a remporté la victoire")) {
                await updateUserStats('loss');
            } else if (lastHistoryEntry.includes("égalité")) {
                await updateUserStats('draw');
            }

            if (youKey === 'p1' || gameMode === 'PvAI') {
                setMatchDeletionTimeout(setTimeout(async () => {
                    try {
                        await remove(matchRef);
                        console.log(`Match ${currentMatchId} supprimé.`);
                    } catch (err) {
                        console.error("Erreur lors de la suppression du match :", err);
                    }
                    backToMenu(true);
                }, 5000));
            } else {
                setTimeout(() => backToMenu(true), 5000);
            }
            return;
        }

        const currentTurnStartTime = matchData.turnStartTime;
        let validStartTimeForTimer = null;

        if (typeof currentTurnStartTime === 'number' && !isNaN(currentTurnStartTime)) {
            validStartTimeForTimer = currentTurnStartTime;
        } else {
            console.warn("turnStartTime n'est pas encore un timestamp numérique valide de Firebase. Le timer ne sera pas démarré pour l'instant.", { currentTurnStartTime, type: typeof currentTurnStartTime, isNaN: isNaN(currentTurnStartTime) });
        }

        console.log("Tour actuel selon Firebase :", matchData.turn, " | Votre clé de joueur :", youKey);

        // Cette partie du code gère l'affichage et l'activation/désactivation des boutons.
        // La logique de DECLENCHEMENT de processTurn se fait en dehors de ces if/else.
        if (matchData.turn === youKey) {
            if (!matchData.players[youKey].action) {
                console.log("C'est votre tour. Vous n'avez pas encore soumis d'action.");
                showMessage("action-msg", "C'est votre tour ! Choisissez une action.");
                setHasPlayedThisTurn(false);
                enableActionButtons();
                if (validStartTimeForTimer !== null) {
                    startTimer(validStartTimeForTimer);
                } else {
                    console.log("Timer non démarré car turnStartTime n'est pas encore valide.");
                    updateTimerUI(timerMax);
                }
            } else {
                console.log("C'est votre tour. Votre action a été soumise. En attente de l'adversaire.");
                showMessage("action-msg", "Action soumise. En attente de l'adversaire...");
                disableActionButtons();
                if (timerInterval) {
                    clearInterval(timerInterval);
                    setTimerInterval(null);
                }
                updateTimerUI(timerMax);
            }
        }
        else { // matchData.turn === opponentKey
            console.log("C'est le tour de l'adversaire.");
            showMessage("action-msg", `C'est le tour de ${opponent.pseudo}.`);
            disableActionButtons();
            if (timerInterval) {
                clearInterval(timerInterval);
                setTimerInterval(null);
            }
            updateTimerUI(timerMax);
        }

        // --- DÉCLENCHEMENT DE L'IA SI C'EST SON TOUR OU SI LE JOUEUR A JOUÉ (PvAI UNIQUEMENT) ---
        if (gameMode === 'PvAI') {
            // Si c'est le tour de l'IA ET qu'elle n'a pas encore soumis d'action
            if (matchData.turn === opponentKey && !matchData.players[opponentKey].action) {
                console.log("DEBUG IA (DEBUT TOUR IA): Conditions remplies. Déclenchement de processAITurn après 1s.");
                setTimeout(async () => {
                    await processAITurn(matchData);
                }, 1000); // Délai d'une seconde
            }
            // Si c'est le tour du joueur MAIS que le joueur a déjà soumis son action ET que l'IA n'a PAS encore soumis son action
            else if (matchData.turn === youKey && matchData.players[youKey].action && !matchData.players[opponentKey].action) {
                 console.log("DEBUG IA (APRES JOUEUR): Conditions remplies. Déclenchement de processAITurn après 1s.");
                 setTimeout(async () => {
                    await processAITurn(matchData);
                 }, 1000); // Délai d'une seconde
            }
        }


        // --- DÉCLENCHEMENT CONDITIONNEL DE PROCESS TURN (AMÉLIORÉ) ---
        // Appelez processTurn UNIQUEMENT si les deux actions sont présentes
        // ET qu'aucun traitement n'est en cours.
        if (matchData.status === 'playing' && matchData.players.p1.action && matchData.players.p2.action && !isProcessingTurnInternally) {
            console.log("DEBUG PROCESS TURN: Les deux actions sont soumises. Déclenchement de processTurn.");
            await processTurn(matchData);
        } else if (isProcessingTurnInternally) {
            console.log("DEBUG PROCESS TURN: Un traitement est déjà en cours, pas de nouveau déclenchement.");
        } else {
            console.log("DEBUG PROCESS TURN: Les conditions pour déclencher processTurn ne sont pas encore remplies.");
        }

    }, (error) => {
        console.error("Erreur d'écoute sur le match :", error);
        showMessage("match-msg", "Erreur de connexion au match.");
        backToMenu(true);
    });

    const attackBtn = document.getElementById("action-attack");
    const defendBtn = document.getElementById("action-defend");
    const healBtn = document.getElementById("action-heal");
    const backBtn = document.getElementById("back-to-menu-btn");

    if (attackBtn) {
        attackBtn.onclick = () => performAction('attack');
        console.log("DEBUG: Écouteur 'attack' attaché.");
    } else {
        console.error("ERREUR : Bouton 'action-attack' non trouvé !");
    }
    if (defendBtn) {
        defendBtn.onclick = () => performAction('defend');
        console.log("DEBUG: Écouteur 'defend' attaché.");
    } else {
        console.error("ERREUR : Bouton 'action-defend' non trouvé !");
    }
    if (healBtn) {
        healBtn.onclick = () => performAction('heal');
        console.log("DEBUG: Écouteur 'heal' attaché.");
    } else {
        console.error("ERREUR : Bouton 'heal' non trouvé !");
    }
    if (backBtn) {
        backBtn.onclick = () => handleForfeit();
        console.log("DEBUG: Écouteur 'retour au menu' attaché.");
    } else {
        console.error("ERREUR : Bouton 'back-to-menu-btn' non trouvé !");
    }
}

/**
 * Traite les actions des deux joueurs et met à jour l'état du match.
 * @param {object} matchData - Les données actuelles du match.
 */
export async function processTurn(matchData) { // Exportez processTurn
    console.log("processTurn lancé.");
    
    if (isProcessingTurnInternally) {
        console.warn("processTurn: Déjà en cours de traitement, abandon.");
        return;
    }
    isProcessingTurnInternally = true;

    if (timerInterval) {
        clearInterval(timerInterval);
        setTimerInterval(null);
    }
    disableActionButtons();

    // Cette condition est désormais moins critique ici car le déclencheur dans onValue est plus précis
    if (matchData.status !== 'playing' || !matchData.players.p1.action || !matchData.players.p2.action) {
        console.warn("processTurn : Annulé, les conditions ne sont pas remplies ou déjà traité (peut être un appel redondant).");
        isProcessingTurnInternally = false;
        return;
    }

    const matchRef = ref(db, `matches/${currentMatchId}`);
    const p1 = matchData.players.p1;
    const p2 = matchData.players.p2;

    let p1Action = p1.action;
    let p2Action = p2.action;

    let p1DmgTaken = 0;
    let p2DmgTaken = 0;
    let p1Heal = 0;
    let p2Heal = 0;

    let historyUpdates = [];
    const baseDamage = 10;
    const healAmount = 15;

    let p1HealCooldown = Math.max(0, (p1.healCooldown || 0) - 1);
    let p2HealCooldown = Math.max(0, (p2.healCooldown || 0) - 1);

    if (p1Action === 'defend') {
        historyUpdates.push(`${p1.pseudo} se prépare à défendre.`);
    }
    if (p2Action === 'defend') {
        historyUpdates.push(`${p2.pseudo} se prépare à défendre.`);
    }

    if (p1Action === 'attack') {
        let dmg = baseDamage;
        if (p2Action === 'defend') {
            dmg = Math.max(0, dmg - 5);
            historyUpdates.push(`${p1.pseudo} attaque ${p2.pseudo}, mais les dégâts sont réduits par la défense !`);
        } else {
            historyUpdates.push(`${p1.pseudo} attaque ${p2.pseudo} !`);
        }
        p2DmgTaken = dmg;
    } else if (p1Action === 'heal') {
        if ((p1.healCooldown || 0) === 0) {
            p1Heal = healAmount;
            p1HealCooldown = 3;
            historyUpdates.push(`${p1.pseudo} se soigne pour ${healAmount} PV !`);
        } else {
            historyUpdates.push(`${p1.pseudo} tente de se soigner mais est en cooldown (${(p1.healCooldown || 0)} tours restants).`);
        }
    }

    if (p2Action === 'attack') {
        let dmg = baseDamage;
        if (p1Action === 'defend') {
            dmg = Math.max(0, dmg - 5);
            historyUpdates.push(`${p2.pseudo} attaque ${p1.pseudo}, mais les dégâts sont réduits par la défense !`);
        } else {
            historyUpdates.push(`${p2.pseudo} attaque ${p1.pseudo} !`);
        }
        p1DmgTaken = dmg;
    } else if (p2Action === 'heal') {
        if ((p2.healCooldown || 0) === 0) {
            p2Heal = healAmount;
            p2HealCooldown = 3;
            historyUpdates.push(`${p2.pseudo} se soigne pour ${healAmount} PV !`);
        } else {
            historyUpdates.push(`${p2.pseudo} tente de se soigner mais est en cooldown (${(p2.healCooldown || 0)} tours restants).`);
        }
    }

    let newP1Pv = Math.max(0, Math.min(100, p1.pv - p1DmgTaken + p1Heal));
    let newP2Pv = Math.max(0, Math.min(100, p2.pv - p2DmgTaken + p2Heal));

    let newStatus = 'playing';
    let winner = null;

    if (newP1Pv <= 0 && newP2Pv <= 0) {
        newStatus = 'finished';
        winner = 'draw';
        historyUpdates.push(`Les deux joueurs tombent au combat ! C'est une égalité !`);
    } else if (newP1Pv <= 0) {
        newStatus = 'finished';
        winner = p2.pseudo;
        historyUpdates.push(`${p1.pseudo} est K.O. ! ${p2.pseudo} a gagné !`);
    }
    else if (newP2Pv <= 0) {
        newStatus = 'finished';
        winner = p1.pseudo;
        historyUpdates.push(`${p2.pseudo} est K.O. ! ${p1.pseudo} a gagné !`);
    }

    const updates = {
        [`players/p1/pv`]: newP1Pv,
        [`players/p2/pv`]: newP2Pv,
        [`players/p1/action`]: null,
        [`players/p2/action`]: null,
        [`players/p1/lastAction`]: p1Action,
        [`players/p2/lastAction`]: p2Action,
        [`players/p1/healCooldown`]: p1HealCooldown,
        [`players/p2/healCooldown`]: p2HealCooldown,
        history: [...matchData.history, ...historyUpdates],
        lastTurnProcessedAt: serverTimestamp(),
        turn: (matchData.turn === 'p1' ? 'p2' : 'p1'),
        turnStartTime: serverTimestamp(),
        status: newStatus
    };

    if (newStatus === 'finished') {
        updates.winner = winner;
    }

    try {
        await update(matchRef, updates);
        console.log("Tour traité avec succès. Mise à jour Firebase. Prochain tour pour :", updates.turn);
    } catch (error) {
        console.error("Erreur lors du traitement du tour :", error);
        showMessage("action-msg", "Erreur interne lors du traitement du tour.");
        enableActionButtons();
    } finally {
        isProcessingTurnInternally = false;
        console.log("processTurn: Verrou isProcessingTurnInternally relâché.");
    }
}

/**
 * Gère le décompte du temps pour un tour.
 * @param {number} startTime - Le timestamp de début du tour.
 */
function startTimer(startTime) {
    console.log("Timer démarré avec startTime :", startTime, " (type:", typeof startTime, ")");
    if (timerInterval) {
        clearInterval(timerInterval);
    }

    setTimerInterval(setInterval(() => {
        if (typeof startTime !== 'number' || isNaN(startTime)) {
            console.error("startTimer: startTime est invalide. Arrêt du timer interne.", { startTime, type: typeof startTime, isNaN: isNaN(startTime) });
            if (timerInterval) {
                clearInterval(timerInterval);
                setTimerInterval(null);
            }
            updateTimerUI(timerMax);
            return;
        }

        const currentTime = Date.now();
        const startTimestampMillis = new Date(startTime).getTime();

        if (isNaN(startTimestampMillis)) {
            console.error("startTimer: Conversion de startTime en timestamp a échoué. Arrêt du timer interne.", { startTime, startTimestampMillis });
            if (timerInterval) {
                clearInterval(timerInterval);
                setTimerInterval(null);
            }
            updateTimerUI(timerMax);
            return;
        }

        const elapsedTime = (currentTime - startTimestampMillis) / 1000;
        const timeLeft = Math.max(0, timerMax - Math.floor(elapsedTime));
        updateTimerUI(timeLeft);

        if (timeLeft <= 0) {
            if (timerInterval) {
                clearInterval(timerInterval);
                setTimerInterval(null);
            }
            if (!hasPlayedThisTurn && currentMatchId && currentUser && youKey) {
                console.log("Temps écoulé, le joueur n'a pas joué. Soumission automatique de 'defend'.");
                performAction('defend');
            }
        }
    }, 1000));
}

/**
 * Gère l'abandon du match par le joueur.
 */
async function handleForfeit() {
    console.log("Demande d'abandon du match.");
    if (!currentMatchId || !currentUser || !youKey) {
        showMessage("match-msg", "Impossible d'abandonner : informations de match manquantes.");
        console.error("handleForfeit : Informations de match manquantes.");
        backToMenu(true);
        return;
    }

    if (!confirm("Voulez-vous vraiment abandonner le match ? Cela comptera comme une défaite.")) {
        return;
    }

    const matchRef = ref(db, `matches/${currentMatchId}`);
    const updates = {};
    let forfeitMessage = "";

    updates[`players/${youKey}/status`] = 'forfeit';
    updates[`players/${youKey}/lastSeen`] = serverTimestamp();

    if (gameMode === 'PvAI') {
        updates.status = 'finished';
        updates.winner = opponentKey;
        forfeitMessage = `${currentUser.pseudo} a abandonné le match. L'IA a remporté la victoire !`;
    } else {
        updates.status = 'finished';
        updates.winner = opponentKey;
        forfeitMessage = `${currentUser.pseudo} a abandonné le match. ${document.getElementById("opponent-name").textContent} a remporté la victoire !`;
    }
    
    const currentMatchData = (await get(matchRef)).val();
    const currentHistory = currentMatchData ? currentMatchData.history || [] : [];
    updates.history = [...currentHistory, forfeitMessage];

    try {
        await update(matchRef, updates);
        console.log("Abandon enregistré dans Firebase.");
        await updateUserStats('loss');
        showMessage("match-msg", "Vous avez abandonné le match.");
    } catch (error) {
        console.error("Erreur lors de l'abandon du match :", error);
        showMessage("match-msg", "Erreur lors de l'abandon du match. Réessayez.");
    }
}
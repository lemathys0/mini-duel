// js/game.js

console.log("game.js: Début du chargement.");

import { db, ref, onValue, update, remove, serverTimestamp, onDisconnect, off, runTransaction } from "./firebaseConfig.js";
import { showMessage, enableActionButtons, disableActionButtons, updateHealthBar, updateTimerUI, clearHistory, appendToHistory, showGameScreen, showMainMenu } from "./utils.js";
import { processAITurn, isAITurnCurrentlyProcessing, lastAITurnProcessed } from "./aiLogic.js";

// Variables globales pour le match en cours
export let currentMatchId = null;
export let youKey = null; // 'p1' ou 'p2'
export let opponentKey = null; // 'p1' ou 'p2'
export let gameMode = null; // 'PvAI' ou 'PvP'

// Variables d'état interne au module game.js
let hasPlayedThisTurn = false;
let isProcessingTurnInternally = false;
let timerInterval = null;
let onDisconnectRef = null; // Référence pour l'opération onDisconnect

// Éléments du DOM (mis en cache pour la performance)
const player1PvDisplay = document.getElementById('player1-pv');
const player2PvDisplay = document.getElementById('player2-pv');
const player1PseudoDisplay = document.getElementById('player1-pseudo');
const player2PseudoDisplay = document.getElementById('player2-pseudo');
const youHealthBar = document.getElementById('you-health-bar');
const opponentHealthBar = document.getElementById('opponent-health-bar');
const actionMsgDisplay = document.getElementById('action-msg');
const opponentActionStatusDisplay = document.getElementById('opponent-action-status');
const gameHistoryDiv = document.getElementById('history');
const actionAttackBtn = document.getElementById('action-attack');
const actionDefendBtn = document.getElementById('action-defend');
const actionHealBtn = document.getElementById('action-heal');
const returnToMenuBtn = document.getElementById('return-to-menu');
const timerDisplay = document.getElementById('timer-display');


/**
 * Fonction pour démarrer la surveillance d'un match Firebase.
 * @param {string} matchId L'ID du match à surveiller.
 * @param {string} playerKey La clé du joueur actuel ('p1' ou 'p2').
 * @param {string} mode Le mode de jeu ('PvP' ou 'PvAI').
 */
export function startMatchMonitoring(matchId, playerKey, mode) {
    console.log("startMatchMonitoring lancé.");

    // Réinitialiser les variables globales du match
    currentMatchId = matchId;
    youKey = playerKey;
    opponentKey = (playerKey === 'p1' ? 'p2' : 'p1');
    gameMode = mode;
    hasPlayedThisTurn = false;
    isProcessingTurnInternally = false;
    lastAITurnProcessed = -1; // Réinitialise le compteur de l'IA pour le nouveau match

    showGameScreen(); // Affiche l'écran de jeu

    const matchRef = ref(db, `matches/${currentMatchId}`);

    // Annuler toute écoute précédente pour éviter les fuites de mémoire
    off(matchRef);

    // Configurer l'opération onDisconnect pour le joueur actuel
    const playerPresenceRef = ref(db, `matches/${currentMatchId}/players/${youKey}/disconnected`);
    if (onDisconnectRef) {
        onDisconnectRef.cancel(); // Annuler l'ancienne si elle existe
    }
    onDisconnectRef = onDisconnect(playerPresenceRef);
    onDisconnectRef.set(true)
        .then(() => console.log(`Opérations onDisconnect configurées pour ${youKey}`))
        .catch(error => console.error("Erreur lors de la configuration de onDisconnect:", error));

    // Écoute des changements dans le match
    onValue(matchRef, async (snapshot) => {
        const matchData = snapshot.val();
        if (!matchData) {
            console.log("Match terminé ou non trouvé (snapshot vide).");
            showMessage("action-msg", "Le match a été annulé ou est terminé.");
            returnToMainMenu(true);
            return;
        }
        // Ajouter l'ID du match aux données pour faciliter l'accès dans processAITurn
        matchData.id = currentMatchId;

        console.log("Données du match mises à jour :", matchData);
        console.log(`Current hasPlayedThisTurn (game.js): ${hasPlayedThisTurn}`);

        // Mise à jour de l'affichage de l'état des joueurs
        updateGameUI(matchData);

        // Logique principale de gestion du tour
        const yourPlayerState = matchData.players[youKey];
        const opponentPlayerState = matchData.players[opponentKey];

        if (matchData.status === 'playing') {
            const currentTurnPlayerKey = matchData.turn;
            const isYourTurn = (currentTurnPlayerKey === youKey);

            // Gérer le timer
            startOrUpdateTurnTimer(matchData);

            // Gérer l'état des boutons et les messages
            if (isYourTurn) {
                if (!yourPlayerState.action) {
                    // C'est votre tour et vous n'avez pas encore agi
                    console.log("C'est votre tour. Vous n'avez pas encore soumis d'action. Réactivation des boutons.");
                    hasPlayedThisTurn = false; // Assurer que le flag est false
                    enableActionButtons();
                    checkHealButtonAvailability(yourPlayerState.healCooldown || 0); // Vérifie le cooldown du soin
                    showMessage(actionMsgDisplay.id, "C'est votre tour ! Choisissez votre action.");
                    opponentActionStatusDisplay.textContent = ''; // Effacer le statut de l'adversaire
                } else {
                    // C'est votre tour, vous avez agi, attendez l'adversaire
                    console.log("C'est votre tour. Votre action a été soumise. En attente de l'adversaire. Désactivation des boutons.");
                    disableActionButtons();
                    showMessage(actionMsgDisplay.id, "Action soumise, en attente de l'adversaire...");
                    if (gameMode === 'PvP') {
                        opponentActionStatusDisplay.textContent = 'En attente de l\'adversaire...';
                    }
                }
            } else {
                // C'est le tour de l'adversaire
                console.log("C'est le tour de l'adversaire. Désactivation des boutons.");
                disableActionButtons();
                showMessage(actionMsgDisplay.id, `C'est le tour de ${matchData.players[currentTurnPlayerKey].pseudo}.`);
                opponentActionStatusDisplay.textContent = `Au tour de ${matchData.players[currentTurnPlayerKey].pseudo}...`;
            }

            // --- DÉCLENCHEMENT DE L'IA SI NÉCESSAIRE (PvAI UNIQUEMENT) ---
            if (gameMode === 'PvAI') {
                const currentMatchTurnCounter = matchData.turnCounter || 0;
                // L'IA joue si c'est son tour OU si le joueur a joué et que l'IA n'a pas encore répondu pour ce tour logique.
                const shouldAIPlay =
                    (matchData.turn === opponentKey && !opponentPlayerState.action) || // C'est le tour de l'IA et elle n'a pas joué
                    (matchData.turn === youKey && yourPlayerState.action && !opponentPlayerState.action); // C'est ton tour, tu as joué, et l'IA n'a pas répondu

                if (shouldAIPlay && !isAITurnCurrentlyProcessing && lastAITurnProcessed !== currentMatchTurnCounter) {
                    console.log(`DEBUG AI: Conditions remplies. Appel de processAITurn (turnCounter: ${currentMatchTurnCounter}).`);
                    await processAITurn(matchData);
                } else if (isAITurnCurrentlyProcessing) {
                    console.log("DEBUG AI: Traitement de l'IA déjà en cours, pas de nouveau déclenchement.");
                } else if (lastAITurnProcessed === currentMatchTurnCounter) {
                    console.log(`DEBUG AI: L'IA a déjà agi pour le tour ${currentMatchTurnCounter}.`);
                } else {
                    console.log("DEBUG AI: Les conditions pour déclencher processAITurn ne sont pas encore remplies.");
                }
            }

            // --- DÉCLENCHEMENT CONDITIONNEL DE PROCESS TURN ---
            // Appelez processTurn UNIQUEMENT si les deux actions sont présentes
            // ET qu'aucun traitement n'est en cours.
            if (yourPlayerState.action && opponentPlayerState.action && !isProcessingTurnInternally) {
                console.log("DEBUG PROCESS TURN: Les deux actions sont soumises. Déclenchement de processTurn.");
                await processTurn(matchData);
            } else if (isProcessingTurnInternally) {
                console.log("DEBUG PROCESS TURN: Un traitement est déjà en cours, pas de nouveau déclenchement.");
            } else {
                console.log("DEBUG PROCESS TURN: Les conditions pour déclencher processTurn ne sont pas encore remplies.");
            }

        } else if (matchData.status === 'finished') {
            console.log("Match terminé. Désactivation des boutons.");
            stopTurnTimer();
            disableActionButtons();
            const winnerPseudo = (matchData.winner === youKey) ? yourPlayerState.pseudo : opponentPlayerState.pseudo;
            showMessage(actionMsgDisplay.id, `Match terminé ! Vainqueur : ${winnerPseudo}`, matchData.winner === youKey);
            // Afficher le bouton de retour au menu
            returnToMenuBtn.style.display = 'block';
        } else if (matchData.status === 'waiting') {
            showMessage(actionMsgDisplay.id, 'En attente d\'un adversaire...');
            disableActionButtons();
        }
    });

    // Attachement des écouteurs d'événements pour les boutons d'action (une seule fois)
    if (!actionAttackBtn._hasEventListener) {
        actionAttackBtn.addEventListener('click', () => performAction('attack'));
        actionAttackBtn._hasEventListener = true;
    }
    if (!actionDefendBtn._hasEventListener) {
        actionDefendBtn.addEventListener('click', () => performAction('defend'));
        actionDefendBtn._hasEventListener = true;
    }
    if (!actionHealBtn._hasEventListener) {
        actionHealBtn.addEventListener('click', () => performAction('heal'));
        actionHealBtn._hasEventListener = true;
    }
    if (!returnToMenuBtn._hasEventListener) {
        returnToMenuBtn.addEventListener('click', returnToMainMenu);
        returnToMenuBtn._hasEventListener = true;
    }

    disableActionButtons(); // Désactiver au début
    console.log("startMatchMonitoring terminé.");
}

/**
 * Met à jour l'interface utilisateur du jeu avec les données du match.
 * @param {object} matchData Les données du match Firebase.
 */
function updateGameUI(matchData) {
    const p1 = matchData.players.p1;
    const p2 = matchData.players.p2;

    const you = (youKey === 'p1') ? p1 : p2;
    const opponent = (youKey === 'p1') ? p2 : p1;

    player1PseudoDisplay.textContent = you.pseudo;
    player2PseudoDisplay.textContent = opponent.pseudo;

    player1PvDisplay.textContent = `${you.pv} PV`;
    player2PvDisplay.textContent = `${opponent.pv} PV`;

    updateHealthBar(youHealthBar.id, you.pv);
    updateHealthBar(opponentHealthBar.id, opponent.pv);

    // Mettre à jour l'historique
    if (matchData.history && Array.isArray(matchData.history)) {
        gameHistoryDiv.innerHTML = matchData.history.map(entry => `<p>${entry}</p>`).join('');
        gameHistoryDiv.scrollTop = gameHistoryDiv.scrollHeight; // Scroll vers le bas
    }

    // Afficher le statut de l'adversaire (si PvP)
    if (gameMode === 'PvP') {
        if (opponent.action && matchData.turnCounter === (matchData.turnCounter || 0)) { // Vérifier si l'action est pour le tour actuel
            opponentActionStatusDisplay.textContent = 'Adversaire a joué !';
        } else if (matchData.status === 'playing') {
            opponentActionStatusDisplay.textContent = 'En attente de l\'adversaire...';
        }
    }
}

/**
 * Gère l'action du joueur (attaque, défense, soin).
 * @param {string} actionType L'action choisie.
 */
async function performAction(actionType) {
    console.log(`DEBUG ACTION: Bouton '${actionType}' cliqué. hasPlayedThisTurn avant performAction: ${hasPlayedThisTurn}`);

    if (hasPlayedThisTurn) {
        showMessage(actionMsgDisplay.id, "Vous avez déjà soumis votre action pour ce tour.");
        return;
    }

    // Désactiver les boutons immédiatement pour éviter les double-clics
    disableActionButtons();

    const matchRef = ref(db, `matches/${currentMatchId}`);
    try {
        const snapshot = await runTransaction(matchRef, (currentMatch) => {
            if (currentMatch && currentMatch.status === 'playing') {
                const playerState = currentMatch.players[youKey];

                // Vérifier le cooldown du soin
                if (actionType === 'heal') {
                    if ((playerState.healCooldown || 0) > 0) {
                        // Le soin est en cooldown, annuler l'action côté client et réactiver les boutons
                        return; // Abort the transaction
                    }
                }

                // S'assurer que le joueur n'a pas déjà soumis d'action pour ce tour logique
                if (!playerState.action) {
                    playerState.action = actionType;
                    // Le healCooldown est mis à jour dans processTurn
                    return currentMatch;
                }
            }
            return undefined; // Abort the transaction
        });

        if (snapshot.committed) {
            hasPlayedThisTurn = true; // Met à jour l'état local après un commit réussi
            showMessage(actionMsgDisplay.id, `Action '${actionType}' enregistrée.`);
            console.log(`Action '${actionType}' enregistrée pour ${youKey}. hasPlayedThisTurn: ${hasPlayedThisTurn}`);
        } else {
            // La transaction a été annulée (par exemple, cooldown du soin actif)
            const matchData = await get(matchRef).then(s => s.val()); // Récupère les données à jour
            const playerState = matchData.players[youKey];
            if (actionType === 'heal' && (playerState.healCooldown || 0) > 0) {
                showMessage(actionMsgDisplay.id, `Le soin sera disponible dans ${playerState.healCooldown} tour(s).`, false);
            } else {
                showMessage(actionMsgDisplay.id, "Vous avez déjà soumis votre action pour ce tour.", false);
            }
            enableActionButtons(); // Réactiver les boutons si l'action a été annulée
            checkHealButtonAvailability(playerState.healCooldown || 0); // Réactiver/désactiver le soin
        }
    } catch (error) {
        console.error("Erreur lors de l'enregistrement de l'action :", error);
        showMessage(actionMsgDisplay.id, "Erreur lors de l'enregistrement de l'action.", false);
        enableActionButtons(); // Réactiver si erreur pour permettre de réessayer
    }
}

/**
 * Vérifie et met à jour l'état du bouton de soin.
 * @param {number} healCooldown Le cooldown actuel du soin pour le joueur.
 */
function checkHealButtonAvailability(healCooldown) {
    if (actionHealBtn) {
        actionHealBtn.disabled = (healCooldown > 0);
        if (actionHealBtn.disabled) {
            actionHealBtn.textContent = `Soigner (${healCooldown} tours)`;
        } else {
            actionHealBtn.textContent = 'Soigner (+15 PV)';
        }
    }
}


/**
 * Traite les actions des deux joueurs et met à jour l'état du match.
 * Appelé une fois que les deux joueurs ont soumis leur action pour le tour.
 * @param {object} matchData - Les données actuelles du match.
 */
async function processTurn(matchData) {
    console.log("processTurn lancé.");

    if (isProcessingTurnInternally) {
        console.warn("processTurn: Déjà en cours de traitement, abandon.");
        return;
    }
    isProcessingTurnInternally = true;
    stopTurnTimer(); // Arrête le timer pendant le traitement du tour

    disableActionButtons(); // S'assurer que les boutons sont désactivés

    const matchRef = ref(db, `matches/${currentMatchId}`);
    const p1 = matchData.players.p1;
    const p2 = matchData.players.p2;

    let p1Action = p1.action;
    let p2Action = p2.action;

    let p1HealCooldown = Math.max(0, (p1.healCooldown || 0) - 1);
    let p2HealCooldown = Math.max(0, (p2.healCooldown || 0) - 1);

    let newP1Pv = p1.pv;
    let newP2Pv = p2.pv;

    let historyMessages = [];
    const baseDamage = 10;
    const healAmount = 15;
    const defenseReduction = 5;

    // --- Phase 1: Gestion des actions de défense ---
    if (p1Action === 'defend') {
        historyMessages.push(`${p1.pseudo} se prépare à défendre.`);
    }
    if (p2Action === 'defend') {
        historyMessages.push(`${p2.pseudo} se prépare à défendre.`);
    }

    // --- Phase 2: Gestion des actions de soin ---
    if (p1Action === 'heal') {
        if ((p1.healCooldown || 0) === 0) { // Vérifie le cooldown avant d'appliquer
            newP1Pv = Math.min(100, newP1Pv + healAmount);
            p1HealCooldown = 3; // Réinitialise le cooldown après utilisation
            historyMessages.push(`${p1.pseudo} se soigne pour ${healAmount} PV !`);
        } else {
            // Si le soin a été tenté alors qu'il était en cooldown, il n'est pas appliqué.
            // Le message d'erreur est déjà géré par performAction.
            // Ici, on incrémente juste son cooldown s'il était déjà en cours.
            historyMessages.push(`${p1.pseudo} tente de se soigner mais est en cooldown.`);
        }
    }
    if (p2Action === 'heal') {
        if ((p2.healCooldown || 0) === 0) { // Vérifie le cooldown avant d'appliquer
            newP2Pv = Math.min(100, newP2Pv + healAmount);
            p2HealCooldown = 3; // Réinitialise le cooldown après utilisation
            historyMessages.push(`${p2.pseudo} se soigne pour ${healAmount} PV !`);
        } else {
            historyMessages.push(`${p2.pseudo} tente de se soigner mais est en cooldown.`);
        }
    }

    // --- Phase 3: Gestion des attaques ---
    let p1DamageToP2 = 0;
    let p2DamageToP1 = 0;

    if (p1Action === 'attack') {
        p1DamageToP2 = baseDamage;
        if (p2Action === 'defend') {
            p1DamageToP2 = Math.max(0, p1DamageToP2 - defenseReduction);
            historyMessages.push(`${p1.pseudo} attaque ${p2.pseudo}, mais la défense réduit les dégâts à ${p1DamageToP2} !`);
        } else {
            historyMessages.push(`${p1.pseudo} attaque ${p2.pseudo} pour ${p1DamageToP2} dégâts !`);
        }
    }
    if (p2Action === 'attack') {
        p2DamageToP1 = baseDamage;
        if (p1Action === 'defend') {
            p2DamageToP1 = Math.max(0, p2DamageToP1 - defenseReduction);
            historyMessages.push(`${p2.pseudo} attaque ${p1.pseudo}, mais la défense réduit les dégâts à ${p2DamageToP1} !`);
        } else {
            historyMessages.push(`${p2.pseudo} attaque ${p1.pseudo} pour ${p2DamageToP1} dégâts !`);
        }
    }

    newP1Pv = Math.max(0, newP1Pv - p2DamageToP1); // Dégâts de P2 à P1
    newP2Pv = Math.max(0, newP2Pv - p1DamageToP2); // Dégâts de P1 à P2

    // --- Phase 4: Gestion des actions 'pass' ---
    if (p1Action === 'pass') {
        historyMessages.push(`${p1.pseudo} passe son tour.`);
    }
    if (p2Action === 'pass') {
        historyMessages.push(`${p2.pseudo} passe son tour.`);
    }

    // --- Phase 5: Vérification de fin de match et mise à jour ---
    let newStatus = 'playing';
    let winnerKey = null; // Stocke la clé du joueur gagnant ('p1' ou 'p2')
    let winnerPseudo = null;

    if (newP1Pv <= 0 && newP2Pv <= 0) {
        newStatus = 'finished';
        winnerKey = 'draw';
        winnerPseudo = 'Égalité';
        historyMessages.push(`Les deux joueurs tombent au combat ! C'est une égalité !`);
    } else if (newP1Pv <= 0) {
        newStatus = 'finished';
        winnerKey = 'p2';
        winnerPseudo = p2.pseudo;
        historyMessages.push(`${p1.pseudo} est K.O. ! ${p2.pseudo} a gagné !`);
    } else if (newP2Pv <= 0) {
        newStatus = 'finished';
        winnerKey = 'p1';
        winnerPseudo = p1.pseudo;
        historyMessages.push(`${p2.pseudo} est K.O. ! ${p1.pseudo} a gagné !`);
    }

    // Déterminer le prochain joueur
    let nextTurnPlayerKey;
    if (newStatus === 'finished') {
        nextTurnPlayerKey = null; // Plus de tour si le match est terminé
    } else if (gameMode === 'PvAI') {
        nextTurnPlayerKey = youKey; // En PvAI, c'est toujours le joueur humain qui initie le tour
    } else { // PvP
        nextTurnPlayerKey = (matchData.turn === 'p1' ? 'p2' : 'p1'); // Alternance des tours
    }

    const updates = {
        [`players/p1/pv`]: newP1Pv,
        [`players/p2/pv`]: newP2Pv,
        [`players/p1/action`]: null, // Réinitialise l'action pour le prochain tour
        [`players/p2/action`]: null,
        [`players/p1/lastAction`]: p1Action, // Stocke la dernière action pour l'IA ou l'historique
        [`players/p2/lastAction`]: p2Action,
        [`players/p1/healCooldown`]: p1HealCooldown, // Met à jour le cooldown du soin
        [`players/p2/healCooldown`]: p2HealCooldown, // Met à jour le cooldown du soin
        history: [...(matchData.history || []), ...historyMessages], // Concatène les messages
        lastTurnProcessedAt: serverTimestamp(),
        turn: nextTurnPlayerKey, // Le joueur qui commence le prochain tour
        turnStartTime: (newStatus === 'finished' ? null : serverTimestamp()), // Réinitialise le timer ou le met à null
        status: newStatus,
        turnCounter: (matchData.turnCounter || 0) + 1, // Incrémente le compteur de tour logique
    };

    if (newStatus === 'finished') {
        updates.winner = winnerKey;
    }

    try {
        await update(matchRef, updates);
        console.log("Tour traité avec succès. Mise à jour Firebase. Prochain tour pour :", updates.turn);
        hasPlayedThisTurn = false; // Réinitialise le drapeau local pour le nouveau tour
        console.log(`DEBUG game.js: hasPlayedThisTurn réinitialisé à ${hasPlayedThisTurn} après traitement du tour.`);

    } catch (error) {
        console.error("Erreur lors du traitement du tour :", error);
        showMessage(actionMsgDisplay.id, "Erreur interne lors du traitement du tour.", false);
        enableActionButtons(); // Réactiver les boutons en cas d'erreur
    } finally {
        isProcessingTurnInternally = false;
        console.log("processTurn: Verrou isProcessingTurnInternally relâché.");
    }
}

/**
 * Démarre ou met à jour le compte à rebours pour un tour.
 * @param {object} matchData Les données actuelles du match.
 */
function startOrUpdateTurnTimer(matchData) {
    if (timerInterval) {
        clearInterval(timerInterval);
    }

    const timerDuration = 30; // 30 secondes par tour
    const currentTurnPlayerKey = matchData.turn;
    const startTimeMillis = matchData.turnStartTime;

    if (!startTimeMillis) {
        updateTimerUI(timerDuration, timerDuration); // Affiche le temps max si pas de start time
        return;
    }

    timerInterval = setInterval(async () => {
        const now = new Date().getTime();
        const elapsed = (now - startTimeMillis) / 1000;
        const timeLeft = Math.max(0, timerDuration - elapsed);

        updateTimerUI(timeLeft, timerDuration);

        if (timeLeft <= 0) {
            stopTurnTimer();
            console.log("Temps écoulé pour le tour !");

            // Si le temps est écoulé et c'est votre tour et que vous n'avez pas joué,
            // soumettez une action par défaut (ex: défendre)
            // Assurez-vous que le match est toujours en cours et que c'est bien votre tour logique
            if (matchData.status === 'playing' && currentTurnPlayerKey === youKey && !hasPlayedThisTurn) {
                console.log("Le temps est écoulé, soumission automatique de 'defend'.");
                await performAction('defend'); // Soumet une action 'defend' par défaut
            }
        }
    }, 1000);
}

/**
 * Arrête le timer du tour.
 */
function stopTurnTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
        console.log("Timer de tour arrêté.");
    }
}

/**
 * Gère le retour au menu principal, annulant les opérations de match.
 * @param {boolean} fromMatchEnd Indique si le retour vient de la fin d'un match.
 */
async function returnToMainMenu(fromMatchEnd = false) {
    console.log("Retour au menu demandé.");

    // Annuler tous les écouteurs Firebase liés au match
    if (currentMatchId) {
        const matchRef = ref(db, `matches/${currentMatchId}`);
        off(matchRef); // Désinscrit tous les listeners pour ce chemin
        console.log(`Écouteurs Firebase pour le match ${currentMatchId} désactivés.`);
    }

    // Annuler l'opération onDisconnect si elle existe
    if (onDisconnectRef) {
        try {
            await onDisconnectRef.cancel();
            console.log("Opération onDisconnect annulée.");
        } catch (error) {
            console.warn("Erreur lors de l'annulation de onDisconnect :", error);
        } finally {
            onDisconnectRef = null;
        }
    }

    // Arrêter le timer de tour
    stopTurnTimer();

    // Réinitialiser les variables de match globales
    currentMatchId = null;
    youKey = null;
    opponentKey = null;
    gameMode = null;
    hasPlayedThisTurn = false; // Réinitialiser le drapeau pour le prochain match
    isProcessingTurnInternally = false;
    lastAITurnProcessed = -1; // Réinitialise pour le prochain match

    // Réinitialiser l'interface utilisateur du match
    clearHistory();
    updateHealthBar(youHealthBar.id, 100);
    player1PvDisplay.textContent = "100 PV";
    updateHealthBar(opponentHealthBar.id, 100);
    player2PvDisplay.textContent = "100 PV";
    updateTimerUI(30, 30); // Réinitialise l'affichage du timer à 30s
    player2PseudoDisplay.textContent = "Adversaire";
    // Le pseudo du joueur 1 sera mis à jour par main.js lors du retour au menu
    actionMsgDisplay.textContent = "";
    opponentActionStatusDisplay.textContent = "";
    returnToMenuBtn.style.display = 'none'; // Cacher le bouton

    // Cacher l'écran de jeu et montrer le menu principal
    showMainMenu();

    if (fromMatchEnd) {
        showMessage('main-menu-msg', "Le match est terminé. Bienvenue au menu principal.");
    } else {
        showMessage('main-menu-msg', "Vous avez quitté le match. Bienvenue au menu principal.");
    }
}

console.log("game.js: Fichier entièrement chargé.");
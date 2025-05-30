// Imports
import { db } from "./firebaseConfig.js";
import { ref, onValue, update, remove, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js";
import { showMessage, enableActionButtons, disableActionButtons } from "./utils.js";
import { processAITurn, isAITurnCurrentlyProcessing, lastAITurnProcessed } from "./aiLogic.js"; // Importez les variables de aiLogic

// Variables de match (assurez-vous qu'elles sont initialisées via main.js ou un état global)
export let currentMatchId = null;
export let youKey = null; // 'p1' ou 'p2'
export let opponentKey = null; // 'p1' ou 'p2'
export let gameMode = null; // 'PvAI' ou 'PvP'

let hasPlayedThisTurn = false;
let isProcessingTurnInternally = false;
let timerInterval = null; // Pour gérer le timer de tour

// Fonction pour mettre à jour hasPlayedThisTurn (utilisée par main.js)
export function setHasPlayedThisTurn(value) {
    hasPlayedThisTurn = value;
    console.log(`DEBUG main.js: hasPlayedThisTurn mis à jour vers ${hasPlayedThisTurn}`);
}

// Fonction pour démarrer la surveillance d'un match
export function startMatchMonitoring(matchId, playerKey, mode) {
    console.log("startMatchMonitoring lancé.");
    currentMatchId = matchId;
    youKey = playerKey;
    opponentKey = (playerKey === 'p1' ? 'p2' : 'p1');
    gameMode = mode;

    const matchRef = ref(db, `matches/${currentMatchId}`);

    // Gestion de la déconnexion
    const playerPresenceRef = ref(db, `matches/${currentMatchId}/players/${youKey}/disconnected`);
    console.log("--- DÉBOGAGE onDisconnect ---");
    console.log("1. Valeur de db :", db);
    console.log("2. Valeur de playerPresenceRef :", playerPresenceRef);
    onDisconnect(playerPresenceRef).set(true)
        .then(() => {
            console.log(`Opérations onDisconnect configurées pour ${youKey}`);
        })
        .catch(error => {
            console.error("Erreur lors de la configuration de onDisconnect:", error);
        });
    console.log("--- FIN DU DÉBOGAGE onDisconnect ---");


    // Écoute des changements dans le match
    onValue(matchRef, async (snapshot) => {
        const matchData = snapshot.val();
        if (!matchData) {
            console.log("Match terminé ou non trouvé.");
            // Gérer la fin du match, retour au menu, etc.
            showMessage("match-info", "Le match a été annulé ou est terminé.");
            returnToMenu(); // Fonction à implémenter pour revenir au menu
            return;
        }

        console.log("Données du match mises à jour :", matchData);
        console.log("onValue: Current hasPlayedThisTurn:", hasPlayedThisTurn);


        // Mise à jour de l'affichage de l'état des joueurs
        document.getElementById('player1-pv').textContent = matchData.players.p1.pv;
        document.getElementById('player2-pv').textContent = matchData.players.p2.pv;
        document.getElementById('player1-pseudo').textContent = matchData.players.p1.pseudo;
        document.getElementById('player2-pseudo').textContent = matchData.players.p2.pseudo;


        // Debugging des actions et du tour
        console.log(`Tour actuel selon Firebase : ${matchData.turn} | Votre clé de joueur : ${youKey}`);
        console.log(`Statut action joueur (${youKey}): ${matchData.players[youKey].action}`);
        console.log(`Statut action adversaire (${opponentKey}): ${matchData.players[opponentKey].action}`);


        // Logique de gestion du tour
        const yourActionExists = matchData.players[youKey].action;
        const opponentActionExists = matchData.players[opponentKey].action;

        // Mise à jour de l'état des boutons et des messages
        if (matchData.status === 'playing') {
            if (matchData.turn === youKey) { // C'est votre tour
                if (!yourActionExists) {
                    console.log("C'est votre tour. Vous n'avez pas encore soumis d'action. Réactivation des boutons.");
                    setHasPlayedThisTurn(false); // Réinitialiser pour le nouveau tour
                    console.log("onValue: hasPlayedThisTurn réinitialisé à false.");
                    enableActionButtons();
                    console.log("onValue: Appel de enableActionButtons.");
                } else {
                    console.log("C'est votre tour. Votre action a été soumise. En attente de l'adversaire. Désactivation des boutons.");
                    console.log("onValue: Appel de disableActionButtons car action soumise.");
                    disableActionButtons(); // Votre action a été soumise, on attend l'adversaire
                }
            } else { // C'est le tour de l'adversaire
                console.log("C'est le tour de l'adversaire. Désactivation des boutons.");
                console.log("onValue: Appel de disableActionButtons car tour de l'adversaire.");
                disableActionButtons(); // C'est le tour de l'adversaire, vos boutons sont désactivés
            }
        } else if (matchData.status === 'finished') {
            console.log("Match terminé. Désactivation des boutons.");
            disableActionButtons();
            showMessage("match-info", `Match terminé ! Vainqueur : ${matchData.winner}`);
            // Afficher un bouton pour rejouer ou revenir au menu
        }

        // --- DÉCLENCHEMENT DU TIMER ---
        if (matchData.status === 'playing' && matchData.turnStartTime) {
            const now = new Date().getTime();
            const elapsed = (now - matchData.turnStartTime) / 1000; // secondes
            const timeLeft = Math.max(0, 30 - elapsed); // 30 secondes par tour

            // Démarrer ou réinitialiser le timer si nécessaire
            if (!timerInterval) {
                console.log(`Timer démarré avec startTime : ${matchData.turnStartTime} (type: ${typeof matchData.turnStartTime})`);
                startTurnTimer(matchData.turnStartTime, matchData.turn, youKey, currentMatchId);
            }
            // Mettre à jour l'affichage du timer
            const timerDisplay = document.getElementById('timer-display');
            if (timerDisplay) {
                timerDisplay.textContent = `Temps restant : ${Math.floor(timeLeft)}s`;
            }
        }


        // --- DÉCLENCHEMENT DE L'IA SI NÉCESSAIRE (PvAI UNIQUEMENT) ---
        if (gameMode === 'PvAI' && matchData.status === 'playing') {
            const currentMatchTurnCounter = matchData.turnCounter || 0;

            // Condition d'appel pour l'IA :
            // 1. C'est le tour de l'IA ET elle n'a pas encore agi.
            // OU
            // 2. C'est le tour du joueur ET le joueur a déjà agi ET l'IA n'a pas encore agi.
            const shouldAIPlay =
                (matchData.turn === opponentKey && !opponentActionExists) ||
                (matchData.turn === youKey && matchData.players[youKey].action && !opponentActionExists);

            if (shouldAIPlay && !isAITurnCurrentlyProcessing && lastAITurnProcessed !== currentMatchTurnCounter) {
                console.log("DEBUG IA: Conditions remplies. Appel de processAITurn (gestion du délai interne à aiLogic).");
                await processAITurn(matchData);
            } else if (isAITurnCurrentlyProcessing) {
                console.log("DEBUG IA: Traitement de l'IA déjà en cours, pas de nouveau déclenchement.");
            } else if (lastAITurnProcessed === currentMatchTurnCounter) {
                console.log(`DEBUG IA: L'IA a déjà agi pour le tour ${currentMatchTurnCounter}.`);
            } else {
                console.log("DEBUG IA: Les conditions pour déclencher processAITurn ne sont pas encore remplies.");
            }
        }

        // --- DÉCLENCHEMENT CONDITIONNEL DE PROCESS TURN ---
        // Appelez processTurn UNIQUEMENT si les deux actions sont présentes
        // ET qu'aucun traitement n'est en cours.
        if (matchData.status === 'playing' && yourActionExists && opponentActionExists && !isProcessingTurnInternally) {
            console.log("DEBUG PROCESS TURN: Les deux actions sont soumises. Déclenchement de processTurn.");
            await processTurn(matchData);
        } else if (isProcessingTurnInternally) {
            console.log("DEBUG PROCESS TURN: Un traitement est déjà en cours, pas de nouveau déclenchement.");
        } else {
            console.log("DEBUG PROCESS TURN: Les conditions pour déclencher processTurn ne sont pas encore remplies.");
        }
    });

    // Attachement des écouteurs d'événements pour les boutons d'action
    document.getElementById('action-attack').addEventListener('click', () => performAction('attack'));
    console.log("DEBUG: Écouteur 'attack' attaché.");
    document.getElementById('action-defend').addEventListener('click', () => performAction('defend'));
    console.log("DEBUG: Écouteur 'defend' attaché.");
    document.getElementById('action-heal').addEventListener('click', () => performAction('heal'));
    console.log("DEBUG: Écouteur 'heal' attaché.");
    document.getElementById('return-to-menu').addEventListener('click', returnToMenu);
    console.log("DEBUG: Écouteur 'retour au menu' attaché.");

    // Initial disable to prevent premature clicks
    disableActionButtons();
}

/**
 * Exécute une action pour le joueur actuel.
 * @param {string} actionType - Le type d'action ('attack', 'defend', 'heal').
 */
async function performAction(actionType) {
    console.log(`DEBUG CLICK: Bouton '${actionType}' cliqué. hasPlayedThisTurn avant appel performAction: ${hasPlayedThisTurn}`);

    if (hasPlayedThisTurn) {
        showMessage("action-msg", "Vous avez déjà soumis votre action pour ce tour.");
        return;
    }

    console.log("Tentative d'action :", actionType);
    console.log(`performAction - currentMatchId: ${currentMatchId}, currentUser: ${sessionStorage.getItem('username')}, youKey: ${youKey}, hasPlayedThisTurn: ${hasPlayedThisTurn}`);


    if (!currentMatchId || !youKey) {
        showMessage("action-msg", "Erreur: Match non défini ou joueur non identifié.");
        return;
    }

    // Désactiver les boutons immédiatement après l'action
    console.log("performAction: Appel de disableActionButtons.");
    disableActionButtons();


    const matchRef = ref(db, `matches/${currentMatchId}`);
    try {
        // Enregistrer l'action du joueur dans Firebase
        await update(matchRef, {
            [`players/${youKey}/action`]: actionType,
            [`players/${youKey}/lastActionTimestamp`]: serverTimestamp() // Marqueur temporel de l'action
        });
        setHasPlayedThisTurn(true);
        console.log("performAction: hasPlayedThisTurn défini à true.");
        showMessage("action-msg", `Action '${actionType}' enregistrée.`);
        console.log(`Action '${actionType}' enregistrée pour ${youKey}.`);
    } catch (error) {
        console.error("Erreur lors de l'enregistrement de l'action :", error);
        showMessage("action-msg", "Erreur lors de l'enregistrement de l'action.");
        enableActionButtons(); // Réactiver si erreur pour permettre de réessayer
    }
}


/**
 * Traite les actions des deux joueurs et met à jour l'état du match.
 * @param {object} matchData - Les données actuelles du match.
 */
export async function processTurn(matchData) {
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
    console.log("processTurn: Appel de disableActionButtons au début du traitement du tour.");
    disableActionButtons();

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

    const newTurnCounter = (matchData.turnCounter || 0) + 1;

    // Logique pour déterminer le prochain joueur
    let nextTurnPlayer;
    if (gameMode === 'PvAI') {
        // En mode PvAI, après que les deux actions aient été traitées,
        // c'est toujours au joueur humain (p1) de recommencer le tour.
        nextTurnPlayer = youKey; // youKey est 'p1' pour le joueur humain
    } else { // Mode PvP ou autres modes
        // En mode PvP, les tours alternent.
        // matchData.turn représente le joueur dont c'était le tour quand processTurn a été appelé.
        nextTurnPlayer = (matchData.turn === 'p1' ? 'p2' : 'p1'); // Alterne le tour
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
        turn: nextTurnPlayer, // Utilisez le joueur déterminé pour le prochain tour
        turnStartTime: serverTimestamp(), // Réinitialiser le timer pour le nouveau tour
        status: newStatus,
        turnCounter: newTurnCounter
    };

    if (newStatus === 'finished') {
        updates.winner = winner;
    }

    try {
        await update(matchRef, updates);
        console.log("Tour traité avec succès. Mise à jour Firebase. Prochain tour pour :", updates.turn);
        setHasPlayedThisTurn(false);
        console.log(`DEBUG main.js: hasPlayedThisTurn réinitialisé à ${hasPlayedThisTurn} après traitement du tour.`);

    } catch (error) {
        console.error("Erreur lors du traitement du tour :", error);
        showMessage("action-msg", "Erreur interne lors du traitement du tour.");
        enableActionButtons(); // Réactiver les boutons en cas d'erreur
    } finally {
        isProcessingTurnInternally = false;
        console.log("processTurn: Verrou isProcessingTurnInternally relâché.");
    }
}

// Fonction pour gérer le timer du tour
function startTurnTimer(startTime, currentTurnPlayerKey, currentPlayerKey, matchId) {
    if (timerInterval) {
        clearInterval(timerInterval);
    }

    const timerDuration = 30; // 30 secondes par tour

    timerInterval = setInterval(async () => {
        const now = new Date().getTime();
        const elapsed = (now - startTime) / 1000;
        const timeLeft = Math.max(0, timerDuration - elapsed);

        const timerDisplay = document.getElementById('timer-display');
        if (timerDisplay) {
            timerDisplay.textContent = `Temps restant : ${Math.floor(timeLeft)}s`;
        }

        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            timerInterval = null;
            console.log("Temps écoulé pour le tour !");

            // Si le temps est écoulé et c'est votre tour et que vous n'avez pas joué,
            // soumettez une action par défaut (ex: défendre)
            if (currentTurnPlayerKey === currentPlayerKey && !hasPlayedThisTurn) {
                console.log("Le temps est écoulé, soumission automatique de 'defend'.");
                await performAction('defend');
            }
        }
    }, 1000); // Mettre à jour chaque seconde
}


// Fonction de retour au menu
function returnToMenu() {
    console.log("Retour au menu demandé.");
    // Logique pour nettoyer le match dans Firebase (si nécessaire)
    if (currentMatchId) {
        // En mode PvAI, on peut supprimer le match si le joueur quitte.
        // En PvP, il faudrait gérer ça plus finement (ex: laisser l'adversaire gagner).
        if (gameMode === 'PvAI') {
            const matchRef = ref(db, `matches/${currentMatchId}`);
            remove(matchRef)
                .then(() => console.log("Match IA supprimé de Firebase."))
                .catch(error => console.error("Erreur lors de la suppression du match IA:", error));
        }
    }
    // Réinitialiser les variables globales du match
    currentMatchId = null;
    youKey = null;
    opponentKey = null;
    gameMode = null;
    hasPlayedThisTurn = false;
    isProcessingTurnInternally = false;
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }

    // Afficher l'écran de menu et masquer l'écran de jeu
    document.getElementById('game-screen').classList.add('hidden');
    document.getElementById('menu-screen').classList.remove('hidden');
    showMessage("match-info", ""); // Effacer les messages d'info match
}
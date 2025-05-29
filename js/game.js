// game.js

import { db } from "./firebaseConfig.js"; // Importe l'instance 'db' depuis firebaseConfig.js

// TRÈS IMPORTANT : Utilisez les URLs CDN complètes pour TOUS les imports Firebase,
// et listez explicitement TOUTES les fonctions nécessaires.
import {
    ref,
    update,
    serverTimestamp,
    onValue,
    off,
    remove,
    onDisconnect, // <-- Assure que onDisconnect est importé
    set,           // <-- Assure que set est importé (pour performAction)
    get             // <-- Assure que get est importé (pour handleForfeit)
} from "https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js";

// Autres imports de votre projet
import { currentUser, currentMatchId, youKey, opponentKey, gameMode,
         timerMax, timerInterval, setTimerInterval,
         onDisconnectRef, setOnDisconnectRef,
         matchDeletionTimeout, setMatchDeletionTimeout,
         hasPlayedThisTurn, setHasPlayedThisTurn, setMatchVariables, backToMenu, updateUserStats } from "./main.js";
import { showMessage, updateHealthBar, updateTimerUI, clearHistory, appendToHistory, enableActionButtons, disableActionButtons } from "./utils.js";


let currentMatchUnsubscribe = null; // Pour stocker la fonction d'unsubscribe du listener de match
let playerTurnTimerId = null; // Chronomètre spécifique pour le compte à rebours du tour du joueur
let aiTurnTimeoutId = null;   // Timeout spécifique pour le délai d'action de l'IA

export function startMatchMonitoring(matchId, user, playerKey, mode) {
    // Met à jour les variables globales du match dans main.js
    setMatchVariables(matchId, user, playerKey, mode);

    // Affiche l'interface de jeu et masque les autres
    document.getElementById("main-menu").style.display = "none";
    document.getElementById("matchmaking-status").style.display = "none";
    document.getElementById("auth").style.display = "none";
    document.getElementById("game").style.display = "block";

    // Initialise l'interface utilisateur pour le nouveau jeu
    document.getElementById("current-match").textContent = matchId;
    document.getElementById("you-name").textContent = currentUser.pseudo;
    document.getElementById("opponent-name").textContent = (gameMode === 'PvAI' ? 'IA' : 'Adversaire'); // Nom correct pour l'adversaire
    updateHealthBar('you', 100);
    updateHealthBar('opponent', 100);
    clearHistory();
    appendToHistory(`Début du match ${matchId} en mode ${gameMode}.`);
    showMessage("action-msg", "C'est votre tour ! Choisissez une action.");
    enableActionButtons();
    setHasPlayedThisTurn(false); // Réinitialise l'état au début du match

    // Efface tous les chronomètres précédents d'éventuels matchs abandonnés
    if (playerTurnTimerId) clearInterval(playerTurnTimerId);
    if (aiTurnTimeoutId) clearTimeout(aiTurnTimeoutId);


    const matchRef = ref(db, `matches/${currentMatchId}`);

    // Configure les opérations onDisconnect pour gérer la déconnexion du joueur
    // Ceci doit être fait une seule fois lors de la connexion du joueur à un match
    if (!onDisconnectRef) { // S'assure que ce n'est pas configuré plusieurs fois
        console.log("--- DEBUGGING onDisconnect ---");
        console.log("1. Valeur de db:", db);

        // Obtient une référence à la présence du joueur actuel
        const playerPresenceRef = ref(db, `matches/${currentMatchId}/players/${youKey}`);
        console.log("2. Valeur de playerPresenceRef:", playerPresenceRef);

        // C'est ICI que l'erreur se produit si playerPresenceRef n'est pas un objet Reference valide
        // Utilisons la fonction onDisconnect() importée directement
        console.log("Tentative d'utilisation de onDisconnect comme appel de fonction direct.");
        try {
            const currentOnDisconnect = onDisconnect(playerPresenceRef); // <--- MODIFICATION CRUCIALE ICI
            setOnDisconnectRef(currentOnDisconnect);

            // Définit les mises à jour à effectuer en cas de déconnexion
            currentOnDisconnect.update({
                status: 'forfeited',
                lastSeen: serverTimestamp(),
                action: null
            }).then(() => {
                console.log(`Opérations onDisconnect configurées pour ${youKey}`);
            }).catch(error => {
                console.error("Échec de la configuration des opérations onDisconnect (après update):", error);
                showMessage("action-msg", "Erreur: Échec de la configuration de la déconnexion.");
            });
        } catch (error) {
            console.error("3. ERREUR CRITIQUE: Échec de l'appel de la fonction onDisconnect.", error, playerPresenceRef);
            showMessage("action-msg", "Erreur critique: La fonction de déconnexion n'a pas pu être configurée. Le jeu pourrait être instable.");
        }
        console.log("--- FIN DU DEBUGGING onDisconnect ---");
    }

    // Listener principal du match
    // Désabonne-toi du listener précédent s'il y en avait un
    if (currentMatchUnsubscribe) {
        currentMatchUnsubscribe();
        currentMatchUnsubscribe = null;
    }

    currentMatchUnsubscribe = onValue(matchRef, (snapshot) => {
        const matchData = snapshot.val();
        if (!matchData) {
            console.log("Données de match introuvables ou match supprimé. Retour au menu.");
            if (currentMatchUnsubscribe) {
                currentMatchUnsubscribe();
                currentMatchUnsubscribe = null;
            }
            if (matchDeletionTimeout) {
                clearTimeout(matchDeletionTimeout);
                setMatchDeletionTimeout(null);
            }
            backToMenu(true);
            return;
        }

        const youData = matchData.players[youKey];
        const opponentData = matchData.players[opponentKey];

        // Met à jour les PV et les noms dans l'interface utilisateur
        document.getElementById("you-name").textContent = youData.pseudo;
        document.getElementById("opponent-name").textContent = opponentData.pseudo;
        updateHealthBar('you', youData.pv);
        updateHealthBar('opponent', opponentData.pv);

        // Met à jour l'historique
        clearHistory();
        if (matchData.history) {
            matchData.history.forEach(entry => appendToHistory(entry));
        }

        // Vérifie les conditions de fin de jeu
        if (matchData.status === 'finished') {
            handleGameEnd(matchData);
            return;
        }

        // Vérifie la déconnexion/abandon de l'adversaire en PvP
        if (gameMode === 'PvP' && opponentData.status === 'forfeited') {
            handleGameEnd(matchData, `${opponentData.pseudo} a abandonné le match. Vous avez gagné !`);
            return;
        }

        // --- Gestion des Tours ---
        const currentTurnPlayerKey = matchData.turn;
        const turnCount = matchData.turnCount || 1;

        const timeElapsed = Math.floor((Date.now() - new Date(matchData.lastTurnProcessedAt).getTime()) / 1000);
        const timeLeft = Math.max(0, timerMax - timeElapsed);
        updateTimerUI(timeLeft, timerMax);


        if (currentTurnPlayerKey === youKey) {
            // C'est votre tour
            enableActionButtons();
            showMessage("action-msg", `Tour ${turnCount} : C'est votre tour ! Choisissez une action.`);
            document.getElementById("opponent-action-status").textContent = "";

            // Important: Réinitialise hasPlayedThisTurn uniquement si aucune action n'est en attente
            if (!youData.action) {
                setHasPlayedThisTurn(false);
            }

            // Arrête le timer AI s'il était actif
            if (aiTurnTimeoutId) {
                clearTimeout(aiTurnTimeoutId);
                aiTurnTimeoutId = null;
            }

            // Démarre ou réinitialise le chronomètre pour votre tour
            if (playerTurnTimerId) clearInterval(playerTurnTimerId);
            let countdown = timeLeft;
            updateTimerUI(countdown, timerMax);
            playerTurnTimerId = setInterval(() => {
                countdown--;
                updateTimerUI(countdown, timerMax);
                if (countdown <= 0) {
                    clearInterval(playerTurnTimerId);
                    playerTurnTimerId = null;
                    if (!hasPlayedThisTurn) { // Si le joueur n'a pas agi
                        appendToHistory(`${currentUser.pseudo} n'a pas agi à temps. Action par défaut: Défense.`);
                        performAction('defend'); // Utilise la fonction performAction pour mettre à jour Firebase
                    }
                }
            }, 1000);

        } else {
            // Tour de l'adversaire (ou de l'IA)
            disableActionButtons();
            showMessage("action-msg", `Tour ${turnCount} : C'est le tour de ${opponentData.pseudo}...`);

            // Efface votre chronomètre s'il est actif
            if (playerTurnTimerId) {
                clearInterval(playerTurnTimerId);
                playerTurnTimerId = null;
                updateTimerUI(timerMax, timerMax); // Réinitialise l'interface du chronomètre
            }

            if (opponentData.action) {
                // Si l'adversaire a déjà soumis une action, traite le tour
                document.getElementById("opponent-action-status").textContent = "Action choisie.";
                processTurn(matchData);
            } else {
                // Si l'adversaire n'a pas encore agi (PvP) ou si c'est le tour de l'IA
                document.getElementById("opponent-action-status").textContent = "En attente de l'action...";
                if (gameMode === 'PvAI' && opponentData.pseudo === 'IA') {
                    // C'est le tour de l'IA et elle n'a pas encore agi
                    // Ajoute un léger délai pour le réalisme
                    // Empêche les actions multiples de l'IA pour le même tour
                    if (!aiTurnTimeoutId) {
                           console.log("Tour de l'IA. En attente de l'action de l'IA.");
                           aiTurnTimeoutId = setTimeout(() => {
                               performAIAction(matchId, matchData);
                               aiTurnTimeoutId = null; // Efface ce timeout après l'action de l'IA
                           }, 1500); // Délai de 1.5 seconde pour l'IA
                    }
                }
            }
        }
    });

    // Écouteurs d'événements pour les boutons d'action
    // Ces gestionnaires sont attachés ici pour s'assurer qu'ils sont mis en place au début du match
    document.getElementById("action-attack").onclick = () => performAction('attack');
    document.getElementById("action-defend").onclick = () => performAction('defend');
    document.getElementById("action-heal").onclick = () => performAction('heal');
    document.getElementById("back-to-menu-btn").onclick = () => handleForfeit();
}

// Rendre performAction exportable pour qu'elle puisse être appelée par les écouteurs d'événements
export async function performAction(actionType) {
    if (!currentMatchId || !currentUser || !youKey || hasPlayedThisTurn) {
        if (!hasPlayedThisTurn) {
            showMessage("action-msg", "Ce n'est pas votre tour ou le match n'est pas prêt.");
        }
        return;
    }

    // Arrête le chronomètre du joueur immédiatement lorsqu'une action est effectuée
    if (playerTurnTimerId) {
        clearInterval(playerTurnTimerId);
        playerTurnTimerId = null;
    }

    try {
        const playerActionRef = ref(db, `matches/${currentMatchId}/players/${youKey}/action`);
        await set(playerActionRef, actionType);
        showMessage("action-msg", `Vous avez choisi : ${actionType}`);
        disableActionButtons();
        setHasPlayedThisTurn(true); // Marque que le joueur a joué ce tour
    } catch (error) {
        console.error("Erreur lors de l'envoi de l'action du joueur:", error);
        showMessage("action-msg", "Erreur lors de l'envoi de l'action.");
    }
}

// Fonction clé pour la logique de l'IA
async function performAIAction(matchId, matchData) {
    if (!matchId || !matchData || matchData.players[opponentKey].action) {
        return;
    }

    const aiPlayer = matchData.players[opponentKey];
    const player1 = matchData.players[youKey];

    let aiAction = 'attack'; // Action par défaut de l'IA

    // Logique simple de l'IA
    if (aiPlayer.pv < 30 && aiPlayer.healCooldown === 0) {
        aiAction = 'heal'; // Soigne si la vie est basse et que le soin n'est pas en cooldown
    } else if (player1.pv > 50 && Math.random() < 0.7) {
        aiAction = 'attack'; // Plus de chances d'attaquer si le joueur a beaucoup de vie
    } else {
        aiAction = 'defend'; // Sinon, défend
    }

    try {
        // Envoie l'action de l'IA à Firebase
        const aiActionRef = ref(db, `matches/${matchId}/players/${opponentKey}/action`);
        await set(aiActionRef, aiAction);
        console.log(`L'IA a choisi : ${aiAction}`);
    } catch (error) {
        console.error("Erreur lors de l'envoi de l'action de l'IA:", error);
    }
}


async function processTurn(matchData) {
    // Traite le tour uniquement si les deux joueurs (ou joueur et IA) ont choisi une action
    if (!matchData.players.p1.action || !matchData.players.p2.action) {
        console.log("En attente de l'action des deux joueurs.");
        return;
    }

    // Efface tous les chronomètres actifs pour le joueur et l'IA avant de traiter le tour
    if (playerTurnTimerId) {
        clearInterval(playerTurnTimerId);
        playerTurnTimerId = null;
    }
    if (aiTurnTimeoutId) {
        clearTimeout(aiTurnTimeoutId);
        aiTurnTimeoutId = null;
    }


    disableActionButtons();

    const p1 = matchData.players.p1;
    const p2 = matchData.players.p2;
    const p1Action = p1.action;
    const p2Action = p2.action;

    let p1Damage = 10;
    let p2Damage = 10;
    const p1HealValue = 15;
    const p2HealValue = 15;

    let historyUpdates = [];
    historyUpdates.push(`--- Tour ${matchData.turnCount || 1} ---`);

    // Applique les cooldowns de soin
    // Crée des copies pour ne pas modifier l'objet d'origine avant la mise à jour Firebase
    let nextP1HealCooldown = p1.healCooldown > 0 ? p1.healCooldown - 1 : 0;
    let nextP2HealCooldown = p2.healCooldown > 0 ? p2.healCooldown - 1 : 0;

    let newP1Pv = p1.pv;
    let newP2Pv = p2.pv;


    // Logique des actions
    // P1
    if (p1Action === 'defend') {
        p2Damage -= 5;
        historyUpdates.push(`${p1.pseudo} se défend.`);
    } else if (p1Action === 'heal') {
        if (p1.healCooldown === 0) {
            newP1Pv = Math.min(100, p1.pv + p1HealValue);
            nextP1HealCooldown = 2; // 2 tours de cooldown
            historyUpdates.push(`${p1.pseudo} se soigne et récupère ${p1HealValue} PV. PV: ${newP1Pv}`);
        } else {
            historyUpdates.push(`${p1.pseudo} tente de se soigner mais c'est en CD (${p1.healCooldown} tours restants).`);
            // Défaut à la défense si le soin est en cooldown
            p2Damage -= 5;
            historyUpdates.push(`${p1.pseudo} se défend par défaut.`);
        }
    } else if (p1Action === 'attack') {
        historyUpdates.push(`${p1.pseudo} attaque.`);
    }

    // P2
    if (p2Action === 'defend') {
        p1Damage -= 5;
        historyUpdates.push(`${p2.pseudo} se défend.`);
    } else if (p2Action === 'heal') {
        if (p2.healCooldown === 0) {
            newP2Pv = Math.min(100, p2.pv + p2HealValue);
            nextP2HealCooldown = 2; // 2 tours de cooldown
            historyUpdates.push(`${p2.pseudo} se soigne et récupère ${p2HealValue} PV. PV: ${newP2Pv}`);
        } else {
            historyUpdates.push(`${p2.pseudo} tente de se soigner mais c'est en CD (${p2.healCooldown} tours restants).`);
            // Défaut à la défense si le soin est en cooldown
            p1Damage -= 5;
            historyUpdates.push(`${p2.pseudo} se défend par défaut.`);
        }
    } else if (p2Action === 'attack') {
        historyUpdates.push(`${p2.pseudo} attaque.`);
    }

    // Applique les dégâts (seulement si l'action n'était pas un soin réussi)
    if (!(p1Action === 'heal' && p1.healCooldown === 0)) {
        newP1Pv = Math.max(0, newP1Pv - Math.max(0, p2Damage));
        historyUpdates.push(`${p1.pseudo} a reçu ${Math.max(0, p2Damage)} dégâts. PV restants: ${newP1Pv}`);
    }
    if (!(p2Action === 'heal' && p2.healCooldown === 0)) {
        newP2Pv = Math.max(0, newP2Pv - Math.max(0, p1Damage));
        historyUpdates.push(`${p2.pseudo} a reçu ${Math.max(0, p1Damage)} dégâts. PV restants: ${newP2Pv}`);
    }

    // Met à jour Firebase avec les nouveaux PV et efface les actions
    const updates = {};
    updates[`matches/${currentMatchId}/players/p1/pv`] = newP1Pv;
    updates[`matches/${currentMatchId}/players/p1/action`] = null;
    updates[`matches/${currentMatchId}/players/p1/lastAction`] = p1Action;
    updates[`matches/${currentMatchId}/players/p1/healCooldown`] = nextP1HealCooldown;

    updates[`matches/${currentMatchId}/players/p2/pv`] = newP2Pv;
    updates[`matches/${currentMatchId}/players/p2/action`] = null;
    updates[`matches/${currentMatchId}/players/p2/lastAction`] = p2Action;
    updates[`matches/${currentMatchId}/players/p2/healCooldown`] = nextP2HealCooldown;

    // Avance le tour et met à jour le compteur de tours
    updates[`matches/${currentMatchId}/turn`] = (matchData.turn === 'p1') ? 'p2' : 'p1';
    updates[`matches/${currentMatchId}/turnCount`] = (matchData.turnCount || 0) + 1;
    updates[`matches/${currentMatchId}/lastTurnProcessedAt`] = serverTimestamp();

    // Ajoute l'historique du tour actuel à l'historique du match
    const newHistory = (matchData.history || []).concat(historyUpdates);
    updates[`matches/${currentMatchId}/history`] = newHistory;

    // Vérifie les conditions de fin de jeu après avoir appliqué les dégâts
    let gameEnded = false;
    let winnerResult = null;

    if (newP1Pv <= 0 && newP2Pv <= 0) {
        updates[`matches/${currentMatchId}/status`] = 'finished';
        winnerResult = 'draw';
        newHistory.push("Match nul ! Les deux joueurs sont à terre.");
        gameEnded = true;
    } else if (newP1Pv <= 0) {
        updates[`matches/${currentMatchId}/status`] = 'finished';
        winnerResult = (youKey === 'p2') ? 'win' : 'loss'; // Si vous êtes p2 et p1 est à 0, vous gagnez
        newHistory.push(`${p2.pseudo} gagne !`);
        gameEnded = true;
    } else if (newP2Pv <= 0) {
        updates[`matches/${currentMatchId}/status`] = 'finished';
        winnerResult = (youKey === 'p1') ? 'win' : 'loss'; // Si vous êtes p1 et p2 est à 0, vous gagnez
        newHistory.push(`${p1.pseudo} gagne !`);
        gameEnded = true;
    }

    // Met à jour le résultat final dans Firebase
    if (winnerResult) {
        updates[`matches/${currentMatchId}/result`] = winnerResult;
    }

    try {
        await update(ref(db), updates);
        console.log("Tour traité et Firebase mis à jour.");

        if (gameEnded) {
            updateUserStats(winnerResult); // Met à jour les stats du joueur
            // handleGameEnd sera déclenché par le listener onValue quand le statut sera 'finished'
        }

    } catch (error) {
        console.error("Erreur lors du traitement du tour:", error);
    }
}


function handleGameEnd(matchData, customMessage = null) {
    if (currentMatchUnsubscribe) {
        currentMatchUnsubscribe(); // Arrête d'écouter ce match
        currentMatchUnsubscribe = null;
    }
    // Efface tous les chronomètres à la fin du jeu
    if (playerTurnTimerId) {
        clearInterval(playerTurnTimerId);
        playerTurnTimerId = null;
    }
    if (aiTurnTimeoutId) {
        clearTimeout(aiTurnTimeoutId);
        aiTurnTimeoutId = null;
    }

    disableActionButtons();

    let resultMessage = customMessage;
    if (!resultMessage) {
        const youPv = matchData.players[youKey].pv;
        const opponentPv = matchData.players[opponentKey].pv;
        const result = matchData.result;

        if (result === 'win') {
            resultMessage = "Vous avez gagné le match !";
        } else if (result === 'loss') {
            resultMessage = "Vous avez perdu le match...";
        } else if (result === 'draw') {
            resultMessage = "Le match est un match nul !";
        } else {
            resultMessage = "Le match est terminé.";
        }
    }

    showMessage("action-msg", resultMessage);
    appendToHistory(resultMessage);

    // Planifie la suppression du match après un délai
    if (gameMode === 'PvP') {
        appendToHistory("Ce match sera supprimé dans 5 minutes.");
        if (matchDeletionTimeout) clearTimeout(matchDeletionTimeout);
        setMatchDeletionTimeout(setTimeout(async () => {
            try {
                await remove(ref(db, `matches/${currentMatchId}`));
                console.log(`Match PvP ${currentMatchId} supprimé.`);
                backToMenu(true);
            } catch (error) {
                console.error("Erreur lors de la suppression du match PvP:", error);
            }
        }, 5 * 60 * 1000)); // 5 minutes
    } else { // Mode PvAI
        appendToHistory("Match IA terminé. Retour au menu après 5 secondes.");
        if (matchDeletionTimeout) clearTimeout(matchDeletionTimeout);
        setMatchDeletionTimeout(setTimeout(async () => {
            try {
                await remove(ref(db, `matches/${currentMatchId}`));
                console.log(`Match IA ${currentMatchId} supprimé.`);
                backToMenu(true);
            } catch (error) {
                console.error("Erreur lors de la suppression du match IA:", error);
            }
        }, 5000)); // 5 secondes pour un match IA
    }
}


async function handleForfeit() {
    if (!currentMatchId || !currentUser || !youKey) {
        backToMenu(true);
        return;
    }

    // Demande confirmation à l'utilisateur
    const confirmForfeit = confirm("Êtes-vous sûr de vouloir abandonner le match ? Cela comptera comme une défaite.");
    if (!confirmForfeit) {
        return;
    }

    try {
        // Met à jour le statut du joueur à 'forfeited' (abandonné)
        const playerStatusRef = ref(db, `matches/${currentMatchId}/players/${youKey}/status`);
        await set(playerStatusRef, 'forfeited');

        // Ajoute l'événement à l'historique du match
        const matchHistoryRef = ref(db, `matches/${currentMatchId}/history`);
        const historyEntry = `${currentUser.pseudo} a abandonné le match.`;
        const snapshot = await get(matchHistoryRef);
        const currentHistory = snapshot.val() || [];
        const newHistory = [...currentHistory, historyEntry];
        await set(matchHistoryRef, newHistory); // Utilise set pour remplacer l'historique


        updateUserStats('loss'); // Enregistre une défaite pour le joueur qui abandonne
        showMessage("action-msg", "Vous avez abandonné le match.");
        backToMenu(true); // Retourne au menu immédiatement
    } catch (error) {
        console.error("Erreur lors de l'abandon du match:", error);
        showMessage("action-msg", "Erreur lors de l'abandon du match.");
    }
}
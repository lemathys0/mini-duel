// game.js

console.log("game.js chargé."); // DEBUG : Confirme le chargement de game.js

import { db } from "./firebaseConfig.js";
// Importation de onDisconnect pour gérer les déconnexions des joueurs
import { ref, onValue, update, remove, serverTimestamp, onDisconnect, get } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js";
import {
    currentUser,
    currentMatchId,
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

// Variable pour annuler l'écouteur onValue principal du match
let currentMatchUnsubscribe = null;

// Variable de verrouillage pour empêcher l'IA de jouer plusieurs fois d'affilée sur le même tour
// et aussi pour empêcher processTurn de se déclencher pendant que l'IA agit.
let isAIProcessingTurn = false;

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

    // Vérifie si les informations du match sont disponibles
    if (!currentMatchId || !currentUser || !youKey) {
        showMessage("action-msg", "Erreur : Les informations du match ne sont pas disponibles.");
        console.error("performAction : Informations de match manquantes.");
        return;
    }

    // Vérifie si le joueur a déjà joué son tour
    if (hasPlayedThisTurn) {
        showMessage("action-msg", "Vous avez déjà joué votre tour.");
        console.warn("performAction : Joueur a déjà joué ce tour.");
        return;
    }
    
    // Empêcher l'action si processTurn est déjà en cours
    if (isProcessingTurnInternally) {
        showMessage("action-msg", "Le tour est en cours de traitement, veuillez patienter.");
        console.warn("performAction : Traitement de tour en cours, action bloquée.");
        return;
    }

    // Désactive les boutons d'action pendant le traitement
    disableActionButtons();
    showMessage("action-msg", "Traitement de votre action...");

    const matchRef = ref(db, `matches/${currentMatchId}`);
    const playerActionPath = `players/${youKey}/action`;

    try {
        // Enregistre l'action du joueur dans la base de données
        await update(matchRef, { [playerActionPath]: actionType });
        setHasPlayedThisTurn(true); // Marque que le joueur a joué ce tour
        showMessage("action-msg", `Vous avez choisi : ${actionType}`);
        console.log(`Action '${actionType}' enregistrée pour ${youKey}.`); // DEBUG

        // Les boutons seront réactivés par la fonction de surveillance après le traitement du tour
    } catch (error) {
        console.error("Erreur lors de l'envoi de l'action :", error);
        showMessage("action-msg", "Erreur lors de l'envoi de votre action. Réessayez.");
        enableActionButtons(); // Réactive les boutons en cas d'erreur
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
    console.log("startMatchMonitoring lancé."); // DEBUG
    setMatchVariables(matchId, user, playerKey, mode); // Met à jour les variables globales de main.js

    // Initialise les noms des joueurs dans l'interface utilisateur
    document.getElementById("you-name").textContent = user.pseudo;
    const opponentName = (mode === 'PvAI') ? 'IA' : 'Adversaire en attente...';
    document.getElementById("opponent-name").textContent = opponentName;

    // Affiche la section de jeu et cache les autres menus
    document.getElementById("auth").style.display = "none";
    document.getElementById("main-menu").style.display = "none";
    document.getElementById("matchmaking-status").style.display = "none";
    document.getElementById("game").style.display = "block"; // Affiche la section de jeu

    const matchRef = ref(db, `matches/${currentMatchId}`);

    // Configuration de l'opération onDisconnect (pour marquer le joueur comme déconnecté)
    const playerPresenceRef = ref(db, `matches/${currentMatchId}/players/${youKey}/status`);
    console.log("--- DÉBOGAGE onDisconnect ---"); // DEBUG
    console.log("1. Valeur de db :", db); // DEBUG
    console.log("2. Valeur de playerPresenceRef :", playerPresenceRef); // DEBUG

    try {
        const onDisc = onDisconnect(playerPresenceRef);
        setOnDisconnectRef(onDisc); // Stocke la référence pour pouvoir l'annuler plus tard
        onDisc.set('disconnected').then(() => {
            console.log(`Opérations onDisconnect configurées pour ${youKey}`); // DEBUG
            // Marque le joueur comme connecté
            update(matchRef, { [`players/${youKey}/status`]: 'connected', [`players/${youKey}/lastSeen`]: serverTimestamp() });
        }).catch(err => {
            console.error("Erreur lors de la configuration de onDisconnect ou de la mise à jour du statut :", err);
        });
    } catch (e) {
        console.error("Erreur générale lors de la configuration onDisconnect :", e); // DEBUG
    }
    console.log("--- FIN DU DÉBOGAGE onDisconnect ---"); // DEBUG


    // Annule l'ancien écouteur si existant pour éviter les doublons
    if (currentMatchUnsubscribe) {
        currentMatchUnsubscribe();
        console.log("Ancien écouteur onValue annulé."); // DEBUG
    }

    // Écouteur principal pour les changements dans les données du match
    currentMatchUnsubscribe = onValue(matchRef, async (snapshot) => {
        const matchData = snapshot.val();
        if (!matchData) {
            console.log("Les données du match sont nulles. Le match a peut-être été supprimé."); // DEBUG
            showMessage("match-msg", "Le match a été terminé ou n'existe plus.");
            backToMenu(true);
            return;
        }

        console.log("Données du match mises à jour :", matchData); // DEBUG

        const you = matchData.players[youKey];
        const opponent = matchData.players[opponentKey];

        // Met à jour les barres de vie et l'affichage des PV
        updateHealthBar("you-health-bar", you.pv);
        document.getElementById("you-pv-display").textContent = `${you.pv} PV`;
        updateHealthBar("opponent-health-bar", opponent.pv);
        document.getElementById("opponent-pv-display").textContent = `${opponent.pv} PV`;

        // Met à jour l'historique du match
        clearHistory();
        matchData.history.forEach(entry => showMessage("history", entry, true));

        // Met à jour l'affichage de l'ID du match et les noms des joueurs
        document.getElementById("current-match").textContent = currentMatchId;
        document.getElementById("you-name").textContent = you.pseudo;
        document.getElementById("opponent-name").textContent = opponent.pseudo; // Met à jour le nom de l'adversaire (utile pour PvP)

        // Gestion de la fin du match
        if (matchData.status === 'finished') {
            console.log("Match terminé."); // DEBUG
            // FIX: Arrête l'intervalle correctement
            if (timerInterval) {
                clearInterval(timerInterval);
                setTimerInterval(null); // Réinitialise dans main.js
            }
            disableActionButtons();
            const lastHistoryEntry = matchData.history[matchData.history.length - 1];
            showMessage("match-msg", lastHistoryEntry);

            // Met à jour les statistiques de l'utilisateur en fonction du résultat
            if (lastHistoryEntry.includes(you.pseudo + " a gagné") || (youKey === 'p1' && lastHistoryEntry.includes("gagné !"))) {
                await updateUserStats('win');
            } else if (lastHistoryEntry.includes(opponent.pseudo + " a gagné") || (opponentKey === 'p2' && lastHistoryEntry.includes("gagné !")) || lastHistoryEntry.includes("L'IA a gagné") || lastHistoryEntry.includes("a remporté la victoire")) {
                await updateUserStats('loss');
            } else if (lastHistoryEntry.includes("égalité")) {
                await updateUserStats('draw');
            }

            // Supprime le match après un délai pour que les deux joueurs voient le résultat
            // Seul le joueur 1 ou le mode IA gère la suppression pour éviter les conflits
            if (youKey === 'p1' || gameMode === 'PvAI') {
                setMatchDeletionTimeout(setTimeout(async () => {
                    try {
                        await remove(matchRef);
                        console.log(`Match ${currentMatchId} supprimé.`);
                    } catch (err) {
                        console.error("Erreur lors de la suppression du match :", err);
                    }
                    backToMenu(true);
                }, 5000)); // Supprime le match après 5 secondes
            } else {
                setTimeout(() => backToMenu(true), 5000); // Pour le joueur 2 en PvP, attend la suppression par p1
            }
            return;
        }

        // --- Logique de gestion du flux du tour et du chrono ---

        // Récupérer le timestamp du début du tour de manière sécurisée
        const currentTurnStartTime = matchData.turnStartTime;
        let validStartTimeForTimer = null;

        // VÉRIFICATION TRÈS ROBUSTE : S'assurer que c'est un nombre et qu'il n'est pas NaN
        if (typeof currentTurnStartTime === 'number' && !isNaN(currentTurnStartTime)) {
            validStartTimeForTimer = currentTurnStartTime;
        } else {
            // Si ce n'est pas un nombre, ou si c'est NaN (par ex. pour le placeholder serverTimestamp())
            console.warn("turnStartTime n'est pas encore un timestamp numérique valide de Firebase. Le timer ne sera pas démarré pour l'instant.", { currentTurnStartTime, type: typeof currentTurnStartTime, isNaN: isNaN(currentTurnStartTime) });
        }

        console.log("Tour actuel selon Firebase :", matchData.turn, " | Votre clé de joueur :", youKey); // DEBUG CLÉ

        // Si c'est le tour de votre joueur
        if (matchData.turn === youKey) {
            if (!matchData.players[youKey].action) {
                console.log("C'est votre tour. Vous n'avez pas encore soumis d'action.");
                showMessage("action-msg", "C'est votre tour ! Choisissez une action.");
                setHasPlayedThisTurn(false);
                enableActionButtons();
                // Démarrer le timer SEULEMENT si nous avons un timestamp valide de Firebase
                if (validStartTimeForTimer !== null) {
                    startTimer(validStartTimeForTimer);
                } else {
                    console.log("Timer non démarré car turnStartTime n'est pas encore valide.");
                    updateTimerUI(timerMax); // Assure que l'affichage reste à son maximum
                }
            } else {
                // C'est votre tour, mais votre action a été soumise. En attente de l'adversaire.
                console.log("C'est votre tour. Votre action a été soumise. En attente de l'adversaire.");
                showMessage("action-msg", "Action soumise. En attente de l'adversaire...");
                disableActionButtons();
                // FIX: Arrête l'intervalle correctement
                if (timerInterval) {
                    clearInterval(timerInterval);
                    setTimerInterval(null); // Réinitialise dans main.js
                }
                updateTimerUI(timerMax); // Remet le timer à zéro pour l'affichage

                // --- DÉCLENCHEMENT DE L'IA QUAND LE JOUEUR A JOUÉ (PvAI UNIQUEMENT) ---
                // L'IA devrait jouer si c'est un match PvAI, c'est le tour du joueur,
                // l'action du joueur est soumise, et l'action de l'IA est toujours null.
                if (gameMode === 'PvAI' && matchData.players[youKey].action && !matchData.players[opponentKey].action) {
                    console.log("DEBUG IA (APRES JOUEUR): Conditions remplies. Déclenchement de processAITurn.");
                    await processAITurn(matchData); // Cette fonction déclenchera processTurn après que l'IA ait agi
                } else if (gameMode === 'PvAI') {
                    console.log("DEBUG IA (APRES JOUEUR): Conditions NON remplies pour déclencher l'IA après action du joueur.");
                    if (!matchData.players[youKey].action) console.log("DEBUG IA (APRES JOUEUR): -> L'action du joueur n'est pas soumise.");
                    if (matchData.players[opponentKey].action) console.log("DEBUG IA (APRES JOUEUR): -> L'IA a déjà une action.");
                }
            }
        }
        // Si c'est le tour de l'adversaire (et potentiellement l'IA)
        else { // matchData.turn === opponentKey
            console.log("C'est le tour de l'adversaire.");
            showMessage("action-msg", `C'est le tour de ${opponent.pseudo}.`);
            disableActionButtons();
            // FIX: Arrête l'intervalle correctement
            if (timerInterval) {
                clearInterval(timerInterval);
                setTimerInterval(null); // Réinitialise dans main.js
            }
            updateTimerUI(timerMax); // Remet le timer à zéro pour l'affichage

            // --- DÉCLENCHEMENT DE L'IA AU DÉBUT DE SON TOUR (PvAI UNIQUEMENT) ---
            // L'IA joue si c'est un match PvAI, c'est son tour, et son action est null.
            if (gameMode === 'PvAI' && matchData.turn === opponentKey && !matchData.players[opponentKey].action) {
                console.log("DEBUG IA (DEBUT TOUR IA): Conditions remplies. Déclenchement de processAITurn.");
                await processAITurn(matchData); // Cette fonction déclenchera processTurn après que l'IA ait agi
            } else if (gameMode === 'PvAI') {
                console.log("DEBUG IA (DEBUT TOUR IA): Conditions NON remplies pour déclencher l'IA.");
                if (matchData.players[opponentKey].action) console.log("DEBUG IA (DEBUT TOUR IA): -> L'IA a déjà une action en attente.");
            }
        }

        // --- Ancienne condition pour déclencher processTurn ---
        // Cette section a été retirée pour un déclenchement plus contrôlé.
        // La logique de déclenchement de processTurn sera maintenant dans processAITurn ou après une action PvP confirmée.
        console.log("DEBUG PROCESS TURN: Vérification pour déclencher processTurn. (Passée par l'écouteur onValue)");
        // L'appel à processTurn ne se fera plus ici directement via onValue pour éviter les races conditions.
        // Il sera déclenché de manière plus contrôlée depuis les fonctions qui garantissent les deux actions sont là.

    }, (error) => { // Fin de onValue
        console.error("Erreur d'écoute sur le match :", error);
        showMessage("match-msg", "Erreur de connexion au match.");
        backToMenu(true);
    });

    // Attache les écouteurs d'événements aux boutons d'action
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
 * Traite le tour de l'IA dans un match PvAI.
 * @param {object} matchData - Les données actuelles du match.
 */
async function processAITurn(matchData) {
    console.log("processAITurn lancé."); // DEBUG
    const matchRef = ref(db, `matches/${currentMatchId}`);
    const aiPlayerKey = opponentKey; // L'IA est toujours l'adversaire

    // Vérification de verrouillage pour empêcher le déclenchement multiple.
    if (isAIProcessingTurn) {
        console.log("processAITurn: Un traitement de l'IA est déjà en cours. Abandon.");
        return;
    }
    isAIProcessingTurn = true; // Déclenche le verrouillage
    console.log("processAITurn: Verrou isAIProcessingTurn activé."); // NOUVEAU LOG À DÉBOGUER

    // Double vérification pour le cas où l'action serait déjà là (suite à une race condition très rapide)
    // Vérifie avant le délai de l'IA pour s'assurer qu'aucune autre instance n'a déjà écrit
    const initialAiActionSnapshot = await get(ref(db, `matches/${currentMatchId}/players/${aiPlayerKey}/action`));
    if (initialAiActionSnapshot.exists() && initialAiActionSnapshot.val() !== null) {
        console.warn("processAITurn: L'IA a déjà une action soumise (d'après matchData). Relâche le verrou et abandonne.");
        isAIProcessingTurn = false; // Relâche le verrou si cette condition est vraie
        console.log("processAITurn: Verrou isAIProcessingTurn relâché suite à action existante (avant délai)."); // NOUVEAU LOG À DÉBOGUER
        return;
    }

    // Logique de décision simple pour l'IA
    let aiAction = 'attack'; // Action par défaut
    const aiCurrentPv = matchData.players[aiPlayerKey].pv;
    const playerCurrentPv = matchData.players[youKey].pv;
    const aiHealCooldown = matchData.players[aiPlayerKey].healCooldown || 0;

    console.log(`processAITurn: Début de la décision de l'IA pour ${aiPlayerKey}. PV IA: ${aiCurrentPv}, PV Joueur: ${playerCurrentPv}, Cooldown Soin IA: ${aiHealCooldown}`);

    if (aiHealCooldown > 0) {
        console.log("processAITurn: IA en cooldown de soin.");
        if (aiCurrentPv < 30 && playerCurrentPv > 50) {
            aiAction = Math.random() < 0.5 ? 'defend' : 'attack'; // 50/50 défense ou attaque
            console.log("processAITurn: IA PV faibles et joueur fort, choisit aléatoirement 'defend' ou 'attack'.");
        } else {
            aiAction = 'attack';
            console.log("processAITurn: IA pas en danger critique, choisit 'attack'.");
        }
    } else {
        // L'IA peut soigner
        if (aiCurrentPv < 40 && Math.random() < 0.7) { // 70% de chance de soigner si PV faibles
            aiAction = 'heal';
            console.log("processAITurn: IA PV faibles et peut soigner, choisit 'heal'.");
        } else if (playerCurrentPv > aiCurrentPv && Math.random() < 0.3) { // 30% de chance de défendre si le joueur est plus fort
            aiAction = 'defend';
            console.log("processAITurn: Joueur plus fort, IA a une chance de choisir 'defend'.");
        } else {
            aiAction = 'attack'; // Sinon, attaque
            console.log("processAITurn: Conditions par défaut, IA choisit 'attack'.");
        }
    }

    console.log(`processAITurn: L'IA a déterminé son action potentielle : ${aiAction}`);

    // Simule un délai pour le "temps de réflexion" de l'IA (4 secondes)
    await new Promise(resolve => setTimeout(resolve, 4000));
    console.log("processAITurn: Délai de réflexion de l'IA terminé."); // NOUVEAU LOG

    try {
        // Nouvelle vérification de l'action de l'IA juste avant la mise à jour pour éviter une race condition
        // Récupère l'état le plus récent de l'action de l'IA directement de Firebase pour éviter les caches locaux
        const currentAiActionAfterDelaySnapshot = await get(ref(db, `matches/${currentMatchId}/players/${aiPlayerKey}/action`));
        console.log("processAITurn: Vérification de l'action de l'IA après délai. Valeur actuelle:", currentAiActionAfterDelaySnapshot.val()); // NOUVEAU LOG À DÉBOGUER
        if (currentAiActionAfterDelaySnapshot.exists() && currentAiActionAfterDelaySnapshot.val() !== null) {
            console.warn("processAITurn: Action de l'IA déjà définie dans Firebase juste avant la mise à jour après le délai. Annulation pour éviter un écrasement.");
            isAIProcessingTurn = false; // Important de relâcher le verrou ici aussi
            console.log("processAITurn: Verrou isAIProcessingTurn relâché suite à action existante (après délai)."); // NOUVEAU LOG À DÉBOGUER
            return; // Sortir si l'action est déjà là
        }

        await update(matchRef, { [`players/${aiPlayerKey}/action`]: aiAction });
        console.log(`IA a choisi et enregistré l'action : ${aiAction} dans Firebase.`);
        showMessage("history", `L'IA a choisi son action.`);

        // --- DÉCLENCHEMENT EXPLICITE DE PROCESS TURN APRÈS L'ACTION DE L'IA ---
        // Après que l'IA ait soumis son action, nous devons vérifier si le joueur a également soumis la sienne
        // et déclencher le traitement du tour si c'est le cas.
        const latestMatchDataSnapshot = await get(matchRef); // Récupère les données les plus récentes
        const latestMatchData = latestMatchDataSnapshot.val();

        console.log("DEBUG IA (processAITurn FINI - Conditions finales avant processTurn):"); // NOUVEAU LOG À DÉBOGUER
        console.log("  - action p1:", latestMatchData?.players?.p1?.action);
        console.log("  - action p2 (IA):", latestMatchData?.players?.p2?.action);
        console.log("  - statut du match:", latestMatchData?.status);
        console.log("  - isProcessingTurnInternally (verrou):", isProcessingTurnInternally);


        if (latestMatchData && latestMatchData.players.p1.action && latestMatchData.players.p2.action && latestMatchData.status === 'playing' && !isProcessingTurnInternally) {
            console.log("DEBUG IA (processAITurn FINI): Les deux joueurs ont leurs actions, déclenchement de processTurn.");
            await processTurn(latestMatchData);
        } else {
            console.log("DEBUG IA (processAITurn FINI): Conditions NON remplies pour déclencher processTurn après action IA.");
            if (isProcessingTurnInternally) console.log("DEBUG IA (processAITurn FINI): -> Un traitement de tour est déjà en cours.");
            if (!latestMatchData) console.log("DEBUG IA (processAITurn FINI): -> latestMatchData est null.");
            if (latestMatchData && !latestMatchData.players.p1.action) console.log("DEBUG IA (processAITurn FINI): -> p1.action est null.");
            if (latestMatchData && !latestMatchData.players.p2.action) console.log("DEBUG IA (processAITurn FINI): -> p2.action est null.");
            if (latestMatchData && latestMatchData.status !== 'playing') console.log("DEBUG IA (processAITurn FINI): -> Le statut du match n'est pas 'playing'.");
        }

    } catch (error) {
        console.error("Erreur LORS DE L'ENREGISTREMENT OU DU TRAITEMENT DANS processAITurn :", error); // LOG D'ERREUR SPÉCIFIQUE
    } finally {
        isAIProcessingTurn = false; // Always release the lock
        console.log("processAITurn: Verrou isAIProcessingTurn relâché.");
    }
}

/**
 * Traite les actions des deux joueurs et met à jour l'état du match.
 * @param {object} matchData - Les données actuelles du match.
 */
async function processTurn(matchData) {
    console.log("processTurn lancé."); // DEBUG
    
    // Verrou interne pour éviter le double traitement
    if (isProcessingTurnInternally) {
        console.warn("processTurn: Déjà en cours de traitement, abandon.");
        return;
    }
    isProcessingTurnInternally = true; // Active le verrou

    // FIX: Arrête l'intervalle correctement
    if (timerInterval) {
        clearInterval(timerInterval);
        setTimerInterval(null); // Réinitialise dans main.js
    }
    disableActionButtons(); // S'assure que les boutons sont désactivés

    // Empêche le double traitement si le match n'est plus en état 'playing' ou si les actions sont déjà null
    // Cette condition est très importante pour éviter de traiter deux fois le même tour
    if (matchData.status !== 'playing' || !matchData.players.p1.action || !matchData.players.p2.action) {
        console.warn("processTurn : Annulé, les conditions ne sont pas remplies ou déjà traité.");
        isProcessingTurnInternally = false; // Relâche le verrou
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

    // Décrémente les cooldowns de soin
    let p1HealCooldown = Math.max(0, (p1.healCooldown || 0) - 1);
    let p2HealCooldown = Math.max(0, (p2.healCooldown || 0) - 1);

    // Étape 1 : Appliquer les effets de défense
    if (p1Action === 'defend') {
        historyUpdates.push(`${p1.pseudo} se prépare à défendre.`);
    }
    if (p2Action === 'defend') {
        historyUpdates.push(`${p2.pseudo} se prépare à défendre.`);
    }

    // Étape 2 : Calculer les dégâts et soins en fonction des actions
    if (p1Action === 'attack') {
        let dmg = baseDamage;
        if (p2Action === 'defend') {
            dmg = Math.max(0, dmg - 5); // Défense réduit les dégâts reçus de 5
            historyUpdates.push(`${p1.pseudo} attaque ${p2.pseudo}, mais les dégâts sont réduits par la défense !`);
        } else {
            historyUpdates.push(`${p1.pseudo} attaque ${p2.pseudo} !`);
        }
        p2DmgTaken = dmg;
    } else if (p1Action === 'heal') {
        if ((p1.healCooldown || 0) === 0) { // Vérifie le cooldown actuel du joueur 1
            p1Heal = healAmount;
            p1HealCooldown = 3; // Cooldown de 3 tours après un soin réussi
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
        if ((p2.healCooldown || 0) === 0) { // Vérifie le cooldown actuel du joueur 2
            p2Heal = healAmount;
            p2HealCooldown = 3; // Cooldown de 3 tours après un soin réussi
            historyUpdates.push(`${p2.pseudo} se soigne pour ${healAmount} PV !`);
        } else {
            historyUpdates.push(`${p2.pseudo} tente de se soigner mais est en cooldown (${(p2.healCooldown || 0)} tours restants).`);
        }
    }

    // Appliquer les changements de PV, en s'assurant qu'ils restent entre 0 et 100
    let newP1Pv = Math.max(0, Math.min(100, p1.pv - p1DmgTaken + p1Heal));
    let newP2Pv = Math.max(0, Math.min(100, p2.pv - p2DmgTaken + p2Heal));

    let newStatus = 'playing';
    let winner = null;

    // Déterminer la fin du match
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

    // Préparer les mises à jour pour Firebase
    const updates = {
        [`players/p1/pv`]: newP1Pv,
        [`players/p2/pv`]: newP2Pv,
        [`players/p1/action`]: null, // Réinitialise l'action pour le prochain tour
        [`players/p2/action`]: null,
        [`players/p1/lastAction`]: p1Action, // Enregistre la dernière action pour référence
        [`players/p2/lastAction`]: p2Action,
        [`players/p1/healCooldown`]: p1HealCooldown,
        [`players/p2/healCooldown`]: p2HealCooldown,
        history: [...matchData.history, ...historyUpdates], // Ajoute les nouvelles entrées à l'historique
        lastTurnProcessedAt: serverTimestamp(),
        turn: (matchData.turn === 'p1' ? 'p2' : 'p1'), // Passe le tour à l'autre joueur
        turnStartTime: serverTimestamp(), // <-- Met à jour le timestamp du début du nouveau tour
        status: newStatus
    };

    if (newStatus === 'finished') {
        updates.winner = winner;
    }

    try {
        await update(matchRef, updates);
        console.log("Tour traité avec succès. Mise à jour Firebase. Prochain tour pour :", updates.turn); // DEBUG: Ajout de log pour le prochain tour
        // hasPlayedThisTurn et l'activation des boutons sont gérés par l'écouteur onValue
        // lorsque c'est le tour du joueur et qu'il n'a pas encore soumis d'action.
    } catch (error) {
        console.error("Erreur lors du traitement du tour :", error);
        showMessage("action-msg", "Erreur interne lors du traitement du tour.");
        enableActionButtons(); // Réactive les boutons en cas d'erreur grave
    } finally {
        isProcessingTurnInternally = false; // Relâche le verrou à la fin du traitement
        console.log("processTurn: Verrou isProcessingTurnInternally relâché.");
    }
}

/**
 * Gère le décompte du temps pour un tour.
 * @param {number} startTime - Le timestamp de début du tour.
 */
function startTimer(startTime) {
    console.log("Timer démarré avec startTime :", startTime, " (type:", typeof startTime, ")"); // DEBUG TRÈS IMPORTANT
    // IMPORTANT : Arrêter TOUS les intervalles précédents pour éviter des timers multiples
    // FIX: Arrête l'intervalle correctement
    if (timerInterval) {
        clearInterval(timerInterval);
    }

    // Ensuite, affecte le nouvel intervalle via setTimerInterval
    setTimerInterval(setInterval(() => {
        // Ces vérifications sont très importantes. Elles arrêtent le timer si la valeur est corrompue en cours de route.
        if (typeof startTime !== 'number' || isNaN(startTime)) {
            console.error("startTimer: startTime est invalide. Arrêt du timer interne.", { startTime, type: typeof startTime, isNaN: isNaN(startTime) });
            // FIX: Arrête l'intervalle correctement
            if (timerInterval) { // Vérifie à nouveau car il pourrait avoir été nettoyé par une autre condition
                clearInterval(timerInterval);
                setTimerInterval(null);
            }
            updateTimerUI(timerMax); // Réinitialise l'affichage
            return; // Sort de cette itération de setInterval pour éviter d'autres erreurs
        }

        const currentTime = Date.now();
        const startTimestampMillis = new Date(startTime).getTime(); // Convertit en millisecondes

        // Vérifie si la conversion Date().getTime() a échoué (cela peut arriver si startTime était juste un objet ou null)
        if (isNaN(startTimestampMillis)) {
            console.error("startTimer: Conversion de startTime en timestamp a échoué. Arrêt du timer interne.", { startTime, startTimestampMillis });
            // FIX: Arrête l'intervalle correctement
            if (timerInterval) {
                clearInterval(timerInterval);
                setTimerInterval(null);
            }
            updateTimerUI(timerMax); // Réinitialise l'affichage
            return; // Sort de cette itération de setInterval
        }

        const elapsedTime = (currentTime - startTimestampMillis) / 1000;
        const timeLeft = Math.max(0, timerMax - Math.floor(elapsedTime));
        updateTimerUI(timeLeft);

        if (timeLeft <= 0) {
            // FIX: Arrête l'intervalle correctement
            if (timerInterval) {
                clearInterval(timerInterval);
                setTimerInterval(null);
            }
            // Si le temps est écoulé et que le joueur n'a pas encore joué, soumet une action par défaut
            if (!hasPlayedThisTurn && currentMatchId && currentUser && youKey) {
                console.log("Temps écoulé, le joueur n'a pas joué. Soumission automatique de 'defend'."); // DEBUG
                performAction('defend'); // Soumet "Défendre" par défaut
            }
        }
    }, 1000));
}

/**
 * Gère l'abandon du match par le joueur.
 */
async function handleForfeit() {
    console.log("Demande d'abandon du match."); // DEBUG
    if (!currentMatchId || !currentUser || !youKey) {
        showMessage("match-msg", "Impossible d'abandonner : informations de match manquantes.");
        console.error("handleForfeit : Informations de match manquantes.");
        backToMenu(true); // Retourne au menu si les infos sont absentes
        return;
    }

    if (!confirm("Voulez-vous vraiment abandonner le match ? Cela comptera comme une défaite.")) {
        return; // Annule l'abandon si l'utilisateur ne confirme pas
    }

    const matchRef = ref(db, `matches/${currentMatchId}`);
    const updates = {};
    let forfeitMessage = "";

    // Mettre à jour le statut du joueur à 'disconnected' ou 'forfeit'
    updates[`players/${youKey}/status`] = 'forfeit';
    updates[`players/${youKey}/lastSeen`] = serverTimestamp();

    if (gameMode === 'PvAI') {
        // En mode PvAI, l'abandon du joueur est une défaite directe et termine le match
        updates.status = 'finished';
        updates.winner = opponentKey; // L'IA gagne
        forfeitMessage = `${currentUser.pseudo} a abandonné le match. L'IA a remporté la victoire !`;
    } else { // PvP
        // En mode PvP, le joueur qui abandonne perd, l'adversaire gagne.
        // On marque son statut et l'adversaire sera informé via onValue.
        updates.status = 'finished'; // Le match se termine
        updates.winner = opponentKey; // L'adversaire gagne
        forfeitMessage = `${currentUser.pseudo} a abandonné le match. ${document.getElementById("opponent-name").textContent} a remporté la victoire !`;
    }
    
    // Ajoutez le message d'abandon à l'historique
    const currentMatchData = (await get(matchRef)).val();
    const currentHistory = currentMatchData ? currentMatchData.history || [] : [];
    updates.history = [...currentHistory, forfeitMessage];

    try {
        await update(matchRef, updates);
        console.log("Abandon enregistré dans Firebase."); // DEBUG
        // Mettre à jour les statistiques de l'utilisateur pour une défaite
        await updateUserStats('loss');
        showMessage("match-msg", "Vous avez abandonné le match.");
        // Le retour au menu sera géré par l'écouteur onValue qui détectera le statut 'finished'
    } catch (error) {
        console.error("Erreur lors de l'abandon du match :", error);
        showMessage("match-msg", "Erreur lors de l'abandon du match. Réessayez.");
    }
    // Une fois que l'état 'finished' est propagé par Firebase, l'écouteur onValue s'occupera du backToMenu
}
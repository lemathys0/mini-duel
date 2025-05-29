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
    setTimerInterval, // Assurez-vous que c'est bien la fonction qui met à jour la variable globale dans main.js
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

/**
 * Exécute une action choisie par le joueur.
 * @param {string} actionType - Le type d'action ('attack', 'defend', 'heal').
 */
export async function performAction(actionType) {
    console.log(`Tentative d'action: ${actionType}`); // DEBUG : Confirme que performAction est appelée

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
    console.log("--- DEBUGGING onDisconnect ---"); // DEBUG
    console.log("1. Valeur de db:", db); // DEBUG
    console.log("2. Valeur de playerPresenceRef:", playerPresenceRef); // DEBUG

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
    console.log("--- FIN DU DEBUGGING onDisconnect ---"); // DEBUG


    // Annule l'ancien écouteur si existant pour éviter les doublons
    if (currentMatchUnsubscribe) {
        currentMatchUnsubscribe();
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

        // Ajout de log complet pour inspecter matchData
        // console.log("Données du match mises à jour :", JSON.stringify(matchData, null, 2)); 
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
            setTimerInterval(clearInterval(setTimerInterval)); // Arrête le timer
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

        // --- Logique de gestion du flux du tour et du chrono (correction NaN) ---

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

        // Cas général: Si c'est le tour de votre joueur
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
                console.log("C'est votre tour. Votre action a été soumise. En attente de l'adversaire.");
                showMessage("action-msg", "Action soumise. En attente de l'adversaire...");
                disableActionButtons();
                setTimerInterval(clearInterval(setTimerInterval)); // Arrête votre timer
                updateTimerUI(timerMax); // Remet le timer à zéro pour l'affichage
            }
        }
        // Cas général: Si c'est le tour de l'adversaire (ou si le tour est déjà passé à l'IA)
        else { // matchData.turn === opponentKey
            console.log("C'est le tour de l'adversaire.");
            showMessage("action-msg", `C'est le tour de ${opponent.pseudo}.`);
            disableActionButtons();
            setTimerInterval(clearInterval(setTimerInterval)); // Arrête votre timer
            updateTimerUI(timerMax); // Remet le timer à zéro pour l'affichage

            // Si c'est un match PvAI et l'IA n'a pas encore soumis son action (et c'est SON tour)
            // Note: Cette condition sera VRAIE une fois que processTurn aura basculé le tour vers l'IA
            // et qu'elle n'aura pas encore eu le temps de jouer (par ex. si on charge le match en cours de route)
            if (gameMode === 'PvAI' && !matchData.players[opponentKey].action) {
                console.log("C'est le tour de l'IA et elle n'a pas encore choisi d'action (tour IA actuel), appel de processAITurn.");
                await processAITurn(matchData);
            }
        }
        
        // **Déclenchement immédiat de l'IA après l'action du joueur en mode PvAI**
        // Ceci est crucial : Si le joueur vient de soumettre son action (son action est présente)
        // ET que l'IA n'a pas encore joué (son action est null), alors on déclenche l'IA IMMÉDIATEMENT.
        // Cela gère le cas où P1 a joué, et P2 (l'IA) doit réagir AVANT que le tour ne soit traité et basculé.
        if (gameMode === 'PvAI' && matchData.players[youKey].action && !matchData.players[opponentKey].action) {
            console.log("Détection : Joueur a joué en PvAI et IA n'a pas encore joué. Déclenchement IMMÉDIAT de processAITurn.");
            await processAITurn(matchData);
        }

        // --- Condition pour déclencher processTurn ---
        // Cette condition se déclenchera une fois que les actions de P1 et P2 (IA) sont présentes.
        if (matchData.players.p1.action && matchData.players.p2.action && matchData.status === 'playing') {
            console.log("Les deux joueurs ont soumis leurs actions. Traitement du tour.");
            await processTurn(matchData);
        }
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

    // Logique de décision simple pour l'IA
    let aiAction = 'attack'; // Action par défaut
    const aiCurrentPv = matchData.players[aiPlayerKey].pv;
    const playerCurrentPv = matchData.players[youKey].pv;
    const aiHealCooldown = matchData.players[aiPlayerKey].healCooldown || 0;

    if (aiHealCooldown > 0) {
        // Si l'IA est en cooldown de soin
        if (aiCurrentPv < 30 && playerCurrentPv > 50) {
            aiAction = Math.random() < 0.5 ? 'defend' : 'attack'; // 50/50 défense ou attaque
        } else {
            aiAction = 'attack';
        }
    } else {
        // L'IA peut soigner
        if (aiCurrentPv < 40 && Math.random() < 0.7) { // 70% de chance de soigner si PV faibles
            aiAction = 'heal';
        } else if (playerCurrentPv > aiCurrentPv && Math.random() < 0.3) { // 30% de chance de défendre si le joueur est plus fort
            aiAction = 'defend';
        } else {
            aiAction = 'attack'; // Sinon, attaque
        }
    }

    // Simule un petit délai pour le "temps de réflexion" de l'IA
    await new Promise(resolve => setTimeout(resolve, 1500));

    try {
        await update(matchRef, { [`players/${aiPlayerKey}/action`]: aiAction });
        console.log(`IA a choisi l'action : ${aiAction}`); // DEBUG
        showMessage("history", `L'IA a choisi son action.`); // Ajoute un message générique à l'historique
    } catch (error) {
        console.error("Erreur lors de l'enregistrement de l'action de l'IA :", error);
    }
}

/**
 * Traite les actions des deux joueurs et met à jour l'état du match.
 * @param {object} matchData - Les données actuelles du match.
 */
async function processTurn(matchData) {
    console.log("processTurn lancé."); // DEBUG
    setTimerInterval(clearInterval(setTimerInterval)); // Arrête le timer pendant le traitement du tour
    disableActionButtons(); // S'assure que les boutons sont désactivés

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
    } else if (newP2Pv <= 0) {
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
        console.log("Tour traité avec succès. Mise à jour Firebase."); // DEBUG
        // hasPlayedThisTurn et l'activation des boutons sont gérés par l'écouteur onValue
        // lorsque c'est le tour du joueur et qu'il n'a pas encore soumis d'action.
    } catch (error) {
        console.error("Erreur lors du traitement du tour :", error);
        showMessage("action-msg", "Erreur interne lors du traitement du tour.");
        enableActionButtons(); // Réactive les boutons en cas d'erreur grave
    }
}

/**
 * Gère le décompte du temps pour un tour.
 * @param {number} startTime - Le timestamp de début du tour.
 */
function startTimer(startTime) {
    console.log("Timer démarré avec startTime :", startTime, " (type:", typeof startTime, ")"); // DEBUG TRÈS IMPORTANT
    // IMPORTANT : Arrêter TOUS les intervalles précédents pour éviter des timers multiples
    setTimerInterval(clearInterval(setTimerInterval)); // Assurez-vous que setTimerInterval est bien une fonction qui gère l'ID global

    setTimerInterval(setInterval(() => {
        // Ces vérifications sont très importantes. Elles arrêtent le timer si la valeur est corrompue en cours de route.
        if (typeof startTime !== 'number' || isNaN(startTime)) {
            console.error("startTimer: startTime est invalide. Arrêt du timer interne.", { startTime, type: typeof startTime, isNaN: isNaN(startTime) });
            setTimerInterval(clearInterval(setTimerInterval));
            updateTimerUI(timerMax); // Réinitialise l'affichage
            return; // Sort de cette itération de setInterval pour éviter d'autres erreurs
        }

        const currentTime = Date.now();
        const startTimestampMillis = new Date(startTime).getTime(); // Convertit en millisecondes
        
        // Vérifie si la conversion Date().getTime() a échoué (cela peut arriver si startTime était juste un objet ou null)
        if (isNaN(startTimestampMillis)) {
            console.error("startTimer: Conversion de startTime en timestamp a échoué. Arrêt du timer interne.", { startTime, startTimestampMillis });
            setTimerInterval(clearInterval(setTimerInterval));
            updateTimerUI(timerMax); // Réinitialise l'affichage
            return; // Sort de cette itération de setInterval
        }

        const elapsedTime = (currentTime - startTimestampMillis) / 1000;
        const timeLeft = Math.max(0, timerMax - Math.floor(elapsedTime));
        updateTimerUI(timeLeft);

        if (timeLeft <= 0) {
            setTimerInterval(clearInterval(setTimerInterval));
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
    if (!currentMatchId || !youKey) {
        showMessage("match-msg", "Aucun match actif à abandonner.");
        backToMenu(true);
        return;
    }

    const matchRef = ref(db, `matches/${currentMatchId}`);
    const opponentRef = ref(db, `matches/${currentMatchId}/players/${opponentKey}`);

    try {
        // Marque votre joueur comme ayant abandonné dans la base de données
        await update(ref(db, `matches/${currentMatchId}/players/${youKey}`), { status: 'forfeited', lastSeen: serverTimestamp() });

        if (gameMode === 'PvP') {
            const opponentSnapshot = await get(opponentRef); // Récupère les données de l'adversaire une fois
            const opponentStatus = opponentSnapshot.val()?.status;
            const opponentPseudo = opponentSnapshot.val()?.pseudo;

            if (opponentStatus === 'connected') {
                // Si l'adversaire est toujours connecté, il gagne
                await update(matchRef, {
                    status: 'finished',
                    winner: opponentKey,
                    history: [...(await get(ref(db, `matches/${currentMatchId}/history`))).val(), `${currentUser.pseudo} a abandonné. ${opponentPseudo} remporte la victoire !`]
                });
                console.log("Match PvP abandonné, adversaire déclaré vainqueur."); // DEBUG
            } else {
                console.log("Match PvP abandonné, mais l'adversaire n'était pas connecté."); // DEBUG
            }
        } else if (gameMode === 'PvAI') {
            // Pour l'IA, on déclare que le joueur a perdu et met fin au match
            await update(matchRef, {
                status: 'finished',
                winner: opponentKey, // L'IA gagne
                history: [...(await get(ref(db, `matches/${currentMatchId}/history`))).val(), `${currentUser.pseudo} a abandonné. L'IA remporte la victoire !`]
            });
            console.log("Match PvAI abandonné."); // DEBUG
        }

        // Nettoie les écouteurs et revient au menu principal
        if (currentMatchUnsubscribe) {
            currentMatchUnsubscribe();
            currentMatchUnsubscribe = null;
        }
        setTimerInterval(clearInterval(setTimerInterval)); // Arrête le timer
        if (onDisconnectRef) { // Annule l'opération onDisconnect si elle a été configurée
            onDisconnectRef.cancel().catch(err => console.error("Erreur lors de l'annulation de onDisconnect :", err));
        }
        setOnDisconnectRef(null);
        backToMenu(true);

    } catch (error) {
        console.error("Erreur lors de l'abandon du match :", error);
        showMessage("match-msg", "Erreur lors de l'abandon du match. Réessayez.");
    }
}
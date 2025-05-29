// game.js

console.log("game.js chargé."); // DEBUG : Confirme le chargement de game.js

import { db } from "./firebaseConfig.js";
// NOUVELLE IMPORTATION : onDisconnect
import { ref, onValue, update, remove, serverTimestamp, onDisconnect } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js";
import {
    currentUser,
    currentMatchId,
    youKey,
    opponentKey,
    gameMode,
    setMatchVariables,
    timerMax,
    setTimerInterval, // Importez la fonction de setting
    setOnDisconnectRef,
    setMatchDeletionTimeout,
    hasPlayedThisTurn,
    setHasPlayedThisTurn,
    backToMenu,
    updateUserStats
} from "./main.js";
import { showMessage, updateHealthBar, updateTimerUI, clearHistory, disableActionButtons, enableActionButtons } from "./utils.js";

// Variables locales à game.js si nécessaire
let currentMatchUnsubscribe = null; // Pour annuler l'écouteur onValue

// --- Fonctions de logique de jeu ---

export async function performAction(actionType) {
    console.log(`Tentative d'action: ${actionType}`); // DEBUG : Confirme que performAction est appelée

    // DEBUG : Log des valeurs des variables clés
    console.log(`performAction - currentMatchId: ${currentMatchId}, currentUser: ${currentUser ? currentUser.uid : 'null'}, youKey: ${youKey}, hasPlayedThisTurn: ${hasPlayedThisTurn}`);

    if (!currentMatchId || !currentUser || !youKey) {
        showMessage("action-msg", "Erreur: Les informations du match ne sont pas disponibles.");
        console.error("performAction: Informations de match manquantes.");
        return;
    }

    if (hasPlayedThisTurn) {
        showMessage("action-msg", "Vous avez déjà joué votre tour.");
        console.warn("performAction: Joueur a déjà joué ce tour.");
        return;
    }

    // Désactiver les boutons pendant que l'action est traitée
    disableActionButtons();
    showMessage("action-msg", "Traitement de votre action...");

    const matchRef = ref(db, `matches/${currentMatchId}`);
    const playerActionPath = `players/${youKey}/action`;

    try {
        // Enregistrer l'action du joueur
        await update(matchRef, { [playerActionPath]: actionType });
        setHasPlayedThisTurn(true); // Marquez que le joueur a joué ce tour
        showMessage("action-msg", `Vous avez choisi : ${actionType}`);
        console.log(`Action '${actionType}' enregistrée pour ${youKey}.`); // DEBUG
        
        // Les boutons seront réactivés par la fonction de surveillance après le traitement du tour
    } catch (error) {
        console.error("Erreur lors de l'envoi de l'action:", error);
        showMessage("action-msg", "Erreur lors de l'envoi de votre action. Réessayez.");
        enableActionButtons(); // Réactiver les boutons en cas d'erreur pour que le joueur puisse réessayer
    }
}


// Cette fonction surveille l'état du match en temps réel
export function startMatchMonitoring(matchId, user, playerKey, mode) {
    console.log("startMatchMonitoring lancé."); // DEBUG
    setMatchVariables(matchId, user, playerKey, mode); // Met à jour les variables globales de main.js

    // Initialise les noms des joueurs dans l'UI
    document.getElementById("you-name").textContent = user.pseudo;
    // Vérifie si l'adversaire est IA ou autre pour l'affichage initial
    const opponentName = (mode === 'PvAI') ? 'IA' : 'Adversaire en attente...'; 
    document.getElementById("opponent-name").textContent = opponentName;

    // Affiche la section de jeu et cache les autres SEULEMENT APRÈS l'initialisation des noms
    document.getElementById("auth").style.display = "none";
    document.getElementById("main-menu").style.display = "none";
    document.getElementById("matchmaking-status").style.display = "none";
    document.getElementById("game").style.display = "block"; // Affiche la section de jeu

    const matchRef = ref(db, `matches/${currentMatchId}`);

    // Configuration de l'opération onDisconnect
    const playerPresenceRef = ref(db, `matches/${currentMatchId}/players/${youKey}/status`);
    console.log("--- DEBUGGING onDisconnect ---"); // DEBUG
    console.log("1. Valeur de db:", db); // DEBUG
    console.log("2. Valeur de playerPresenceRef:", playerPresenceRef); // DEBUG

    try {
        const onDisc = onDisconnect(playerPresenceRef);
        setOnDisconnectRef(onDisc); // Stocke la référence pour pouvoir l'annuler plus tard
        onDisc.set('disconnected').then(() => {
            console.log(`Opérations onDisconnect configurées pour ${youKey}`); // DEBUG
            // Marquez le joueur comme connecté
            update(matchRef, { [`players/${youKey}/status`]: 'connected', [`players/${youKey}/lastSeen`]: serverTimestamp() });
        }).catch(err => {
            console.error("Erreur lors de la configuration de onDisconnect ou de la mise à jour du statut:", err);
        });
    } catch (e) {
        console.error("Erreur générale lors de la configuration onDisconnect:", e); // DEBUG
    }
    console.log("--- FIN DU DEBUGGING onDisconnect ---"); // DEBUG


    // Nettoyer l'ancien listener si existant
    if (currentMatchUnsubscribe) {
        currentMatchUnsubscribe();
    }

    // Écouteur principal du match
    currentMatchUnsubscribe = onValue(matchRef, async (snapshot) => {
        const matchData = snapshot.val();
        if (!matchData) {
            console.log("Match data est null. Le match a peut-être été supprimé."); // DEBUG
            showMessage("match-msg", "Le match a été terminé ou n'existe plus.");
            backToMenu(true);
            return;
        }

        console.log("Données du match mises à jour:", matchData); // DEBUG

        const you = matchData.players[youKey];
        const opponent = matchData.players[opponentKey];

        // Mettre à jour l'UI avec les PV
        updateHealthBar("you-health-bar", you.pv);
        document.getElementById("you-pv-display").textContent = `${you.pv} PV`;
        updateHealthBar("opponent-health-bar", opponent.pv);
        document.getElementById("opponent-pv-display").textContent = `${opponent.pv} PV`;

        // Mise à jour de l'historique
        clearHistory();
        matchData.history.forEach(entry => showMessage("history", entry, true));

        // Afficher l'ID du match
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

            if (lastHistoryEntry.includes(you.pseudo + " a gagné") || (youKey === 'p1' && lastHistoryEntry.includes("gagné !"))) {
                await updateUserStats('win');
            } else if (lastHistoryEntry.includes(opponent.pseudo + " a gagné") || (opponentKey === 'p2' && lastHistoryEntry.includes("gagné !")) || lastHistoryEntry.includes("L'IA a gagné") || lastHistoryEntry.includes("a remporté la victoire")) {
                await updateUserStats('loss');
            } else if (lastHistoryEntry.includes("égalité")) {
                await updateUserStats('draw');
            }

            // Supprimer le match après un délai pour que les deux joueurs voient le résultat
            if (youKey === 'p1' || gameMode === 'PvAI') { // Seul p1 ou l'IA gère la suppression
                 setMatchDeletionTimeout(setTimeout(async () => {
                    try {
                        await remove(matchRef);
                        console.log(`Match ${currentMatchId} supprimé.`);
                    } catch (err) {
                        console.error("Erreur lors de la suppression du match:", err);
                    }
                    backToMenu(true);
                }, 5000)); // Supprime le match après 5 secondes
            } else {
                setTimeout(() => backToMenu(true), 5000);
            }
            return;
        }

        // Gestion du tour
        if (matchData.turn === youKey) {
            console.log("C'est votre tour."); // DEBUG
            showMessage("action-msg", "C'est votre tour ! Choisissez une action.");
            //setHasPlayedThisTurn(false); // DEBUG: La réinitialisation est gérée après traitement du tour complet pour éviter les bugs
            enableActionButtons();
            startTimer(matchData.turnStartTime || serverTimestamp()); // Redémarre le timer
        } else {
            console.log("C'est le tour de l'adversaire."); // DEBUG
            showMessage("action-msg", `C'est le tour de ${opponent.pseudo}.`);
            disableActionButtons();
            setTimerInterval(clearInterval(setTimerInterval)); // Arrête votre timer
            //setHasPlayedThisTurn(false); // Au cas où
            updateTimerUI(timerMax); // Remet le timer à zéro pour l'affichage

            // Si c'est le tour de l'adversaire et que c'est l'IA
            if (gameMode === 'PvAI' && matchData.turn === opponentKey) {
                if (!opponent.action) { // Si l'IA n'a pas encore choisi d'action
                    console.log("IA n'a pas encore choisi d'action, appel de processAITurn."); // DEBUG
                    await processAITurn(matchData);
                } else {
                    console.log("L'IA a déjà choisi son action, en attente de la résolution du tour."); // DEBUG
                }
            }
        }

        // Si les deux joueurs ont soumis leur action, traiter le tour
        if (matchData.players.p1.action && matchData.players.p2.action && matchData.status === 'playing') {
            console.log("Les deux joueurs ont soumis leurs actions. Traitement du tour."); // DEBUG
            await processTurn(matchData);
        }
    }, (error) => {
        console.error("Erreur d'écoute sur le match:", error);
        showMessage("match-msg", "Erreur de connexion au match.");
        backToMenu(true);
    });

    // Écouteurs d'événements pour les boutons d'action
    const attackBtn = document.getElementById("action-attack");
    const defendBtn = document.getElementById("action-defend");
    const healBtn = document.getElementById("action-heal");
    const backBtn = document.getElementById("back-to-menu-btn");

    if (attackBtn) {
        attackBtn.onclick = () => performAction('attack');
        console.log("DEBUG: Ecouteur 'attack' attaché.");
    } else {
        console.error("ERREUR: Bouton 'action-attack' non trouvé !");
    }
    if (defendBtn) {
        defendBtn.onclick = () => performAction('defend');
        console.log("DEBUG: Ecouteur 'defend' attaché.");
    } else {
        console.error("ERREUR: Bouton 'action-defend' non trouvé !");
    }
    if (healBtn) {
        healBtn.onclick = () => performAction('heal');
        console.log("DEBUG: Ecouteur 'heal' attaché.");
    } else {
        console.error("ERREUR: Bouton 'action-heal' non trouvé !");
    }
    if (backBtn) {
        backBtn.onclick = () => handleForfeit();
        console.log("DEBUG: Ecouteur 'retour au menu' attaché.");
    } else {
        console.error("ERREUR: Bouton 'back-to-menu-btn' non trouvé !");
    }
}


// --- Fonctions de logique IA ---

async function processAITurn(matchData) {
    console.log("processAITurn lancé."); // DEBUG
    const matchRef = ref(db, `matches/${currentMatchId}`);
    const aiPlayerKey = opponentKey;

    let aiAction = 'attack';
    const aiCurrentPv = matchData.players[aiPlayerKey].pv;
    const playerCurrentPv = matchData.players[youKey].pv;
    const aiHealCooldown = matchData.players[aiPlayerKey].healCooldown || 0;

    if (aiHealCooldown > 0) {
        if (aiCurrentPv < 30 && playerCurrentPv > 50) {
            aiAction = Math.random() < 0.5 ? 'defend' : 'attack';
        } else {
            aiAction = 'attack';
        }
    } else {
        if (aiCurrentPv < 40 && Math.random() < 0.7) {
            aiAction = 'heal';
        } else if (playerCurrentPv > aiCurrentPv && Math.random() < 0.3) {
            aiAction = 'defend';
        } else {
            aiAction = 'attack';
        }
    }

    await new Promise(resolve => setTimeout(resolve, 1500));

    try {
        await update(matchRef, { [`players/${aiPlayerKey}/action`]: aiAction });
        console.log(`IA a choisi l'action: ${aiAction}`); // DEBUG
        showMessage("history", `L'IA a choisi son action.`);
    } catch (error) {
        console.error("Erreur lors de l'enregistrement de l'action de l'IA:", error);
    }
}

// --- Fonctions de traitement du tour ---

async function processTurn(matchData) {
    console.log("processTurn lancé."); // DEBUG
    setTimerInterval(clearInterval(setTimerInterval)); // Arrête le timer pendant le traitement
    disableActionButtons(); // S'assurer que les boutons sont désactivés

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

    // Réinitialiser les cooldowns de soin
    let p1HealCooldown = Math.max(0, (p1.healCooldown || 0) - 1);
    let p2HealCooldown = Math.max(0, (p2.healCooldown || 0) - 1);

    // Appliquer les effets de défense
    if (p1Action === 'defend') {
        historyUpdates.push(`${p1.pseudo} se prépare à défendre.`);
    }
    if (p2Action === 'defend') {
        historyUpdates.push(`${p2.pseudo} se prépare à défendre.`);
    }

    // Calculer les dégâts et soins
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
        if ((p1.healCooldown || 0) === 0) { // Utilise la valeur du matchData pour le cooldown actuel
            p1Heal = healAmount;
            p1HealCooldown = 3; // 3 tours de cooldown
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
        if ((p2.healCooldown || 0) === 0) { // Utilise la valeur du matchData pour le cooldown actuel
            p2Heal = healAmount;
            p2HealCooldown = 3;
            historyUpdates.push(`${p2.pseudo} se soigne pour ${healAmount} PV !`);
        } else {
            historyUpdates.push(`${p2.pseudo} tente de se soigner mais est en cooldown (${(p2.healCooldown || 0)} tours restants).`);
        }
    }

    // Appliquer les changements de PV
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
    } else if (newP2Pv <= 0) {
        newStatus = 'finished';
        winner = p1.pseudo;
        historyUpdates.push(`${p2.pseudo} est K.O. ! ${p1.pseudo} a gagné !`);
    }

    // Préparer les mises à jour Firebase
    const updates = {
        [`players/p1/pv`]: newP1Pv,
        [`players/p2/pv`]: newP2Pv,
        [`players/p1/action`]: null, // Réinitialiser l'action pour le prochain tour
        [`players/p2/action`]: null,
        [`players/p1/lastAction`]: p1Action, // Enregistrer la dernière action
        [`players/p2/lastAction`]: p2Action,
        [`players/p1/healCooldown`]: p1HealCooldown,
        [`players/p2/healCooldown`]: p2HealCooldown,
        history: [...matchData.history, ...historyUpdates],
        lastTurnProcessedAt: serverTimestamp(),
        turn: (matchData.turn === 'p1' ? 'p2' : 'p1'), // Passer le tour
        status: newStatus
    };

    if (newStatus === 'finished') {
        updates.winner = winner;
    }

    try {
        await update(matchRef, updates);
        console.log("Tour traité avec succès. Mise à jour Firebase."); // DEBUG
        setHasPlayedThisTurn(false); // Réinitialiser ici après que le tour est traité
        // Les boutons seront réactivés par l'écouteur onValue dans le prochain tour du joueur
    } catch (error) {
        console.error("Erreur lors du traitement du tour:", error);
        showMessage("action-msg", "Erreur interne lors du traitement du tour.");
        enableActionButtons(); // Réactiver les boutons en cas d'erreur
    }
}

// Fonction de gestion du temps de tour
function startTimer(startTime) {
    console.log("Timer démarré."); // DEBUG
    // Utiliser setTimerInterval pour gérer l'intervalle importé de main.js
    setTimerInterval(clearInterval(setTimerInterval)); // Arrête l'intervalle précédent avant d'en démarrer un nouveau

    setTimerInterval(setInterval(() => {
        const elapsedTime = (Date.now() - new Date(startTime).getTime()) / 1000;
        const timeLeft = Math.max(0, timerMax - Math.floor(elapsedTime));
        updateTimerUI(timeLeft);

        if (timeLeft <= 0) {
            setTimerInterval(clearInterval(setTimerInterval)); // Arrête le timer
            if (!hasPlayedThisTurn && currentMatchId && currentUser && youKey) {
                console.log("Temps écoulé, le joueur n'a pas joué. Soumission automatique de 'defend'."); // DEBUG
                performAction('defend');
            }
        }
    }, 1000));
}

// Gérer l'abandon du match
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
        await update(ref(db, `matches/${currentMatchId}/players/${youKey}`), { status: 'forfeited', lastSeen: serverTimestamp() });

        if (gameMode === 'PvP') {
            const opponentSnapshot = await get(opponentRef); // Utilisez get ici pour lire une fois
            const opponentStatus = opponentSnapshot.val()?.status;
            const opponentPseudo = opponentSnapshot.val()?.pseudo;

            if (opponentStatus === 'connected') {
                await update(matchRef, {
                    status: 'finished',
                    winner: opponentKey,
                    history: [...(await get(ref(db, `matches/${currentMatchId}/history`))).val(), `${currentUser.pseudo} a abandonné. ${opponentPseudo} remporte la victoire !`]
                });
                console.log("Match PvP abandonné, adversaire déclaré vainqueur."); // DEBUG
            } else {
                console.log("Match PvP abandonné, mais l'adversaire n'était pas connecté."); // DEBUG
                // Si l'adversaire n'est pas connecté, le match pourrait être marqué comme terminé sans vainqueur explicite ici,
                // ou la suppression dépendra de la logique de nettoyage côté serveur/onDisconnect de l'autre joueur.
                // Pour l'instant, on laisse le statut du match tel quel et on revient au menu.
            }
        } else if (gameMode === 'PvAI') {
            await update(matchRef, {
                status: 'finished',
                winner: opponentKey, // L'IA gagne
                history: [...(await get(ref(db, `matches/${currentMatchId}/history`))).val(), `${currentUser.pseudo} a abandonné. L'IA remporte la victoire !`]
            });
            console.log("Match PvAI abandonné."); // DEBUG
        }

        if (currentMatchUnsubscribe) {
            currentMatchUnsubscribe();
            currentMatchUnsubscribe = null;
        }
        setTimerInterval(clearInterval(setTimerInterval)); // Arrête le timer
        if (setOnDisconnectRef) { // Vérifiez si la fonction est définie
            setOnDisconnectRef.cancel().catch(err => console.error("Erreur lors de l'annulation de onDisconnect:", err));
        }
        setOnDisconnectRef(null);
        backToMenu(true);

    } catch (error) {
        console.error("Erreur lors de l'abandon du match:", error);
        showMessage("match-msg", "Erreur lors de l'abandon du match. Réessayez.");
    }
}
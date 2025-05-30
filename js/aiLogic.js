// aiLogic.js

import { db } from "./firebaseConfig.js";
import { ref, update, get, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js";
import { showMessage } from "./utils.js";
import { opponentKey, youKey, gameMode } from "./main.js"; // Importez les variables nécessaires de main.js
import { processTurn } from "./game.js"; // Importez processTurn depuis game.js

// Variable de verrouillage pour empêcher l'IA de jouer plusieurs fois d'affilée sur le même tour
export let isAIProcessingTurn = false; // Exportez cette variable pour la lire depuis game.js si nécessaire

/**
 * Traite le tour de l'IA dans un match PvAI.
 * @param {object} matchData - Les données actuelles du match.
 */
export async function processAITurn(matchData) {
    console.log("processAITurn lancé."); // DEBUG
    const matchRef = ref(db, `matches/${currentMatchId}`); // currentMatchId doit être accessible
    const aiPlayerKey = opponentKey; // L'IA est toujours l'adversaire

    // Vérification de verrouillage pour empêcher le déclenchement multiple.
    if (isAIProcessingTurn) {
        console.log("processAITurn: Un traitement de l'IA est déjà en cours. Abandon.");
        return;
    }
    isAIProcessingTurn = true; // Déclenche le verrouillage
    console.log("processAITurn: Verrou isAIProcessingTurn activé."); // NOUVEAU LOG À DÉBOGUER

    // Double vérification pour le cas où l'action serait déjà là (suite à une race condition très rapide)
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
    const playerCurrentPv = matchData.players[youKey].pv; // youKey doit être accessible
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
        const latestMatchDataSnapshot = await get(matchRef);
        const latestMatchData = latestMatchDataSnapshot.val();

        console.log("DEBUG IA (processAITurn FINI - Conditions finales avant processTurn):"); // NOUVEAU LOG À DÉBOGUER
        console.log("  - action p1:", latestMatchData?.players?.p1?.action);
        console.log("  - action p2 (IA):", latestMatchData?.players?.p2?.action);
        console.log("  - statut du match:", latestMatchData?.status);
        console.log("  - isProcessingTurnInternally (verrou):", isProcessingTurnInternally); // isProcessingTurnInternally doit être importé si vous voulez le log ici

        // Pour éviter une dépendance circulaire et des problèmes de verrou,
        // vous pouvez soit passer isProcessingTurnInternally en paramètre,
        // soit re-déclencher processTurn via un événement ou une vérification dans game.js
        // La solution la plus simple est d'importer processTurn et de le laisser gérer son propre verrou.
        if (latestMatchData && latestMatchData.players.p1.action && latestMatchData.players.p2.action && latestMatchData.status === 'playing') {
            // N'importez PAS isProcessingTurnInternally ici si vous voulez éviter la dépendance circulaire.
            // Laissez processTurn gérer son propre verrou interne.
            console.log("DEBUG IA (processAITurn FINI): Les deux joueurs ont leurs actions, déclenchement de processTurn.");
            // Assurez-vous que processTurn ne peut pas être appelé en double par l'écouteur onValue principal.
            await processTurn(latestMatchData);
        } else {
            console.log("DEBUG IA (processAITurn FINI): Conditions NON remplies pour déclencher processTurn après action IA.");
            // if (isProcessingTurnInternally) console.log("DEBUG IA (processAITurn FINI): -> Un traitement de tour est déjà en cours."); // Si vous ne l'importez pas, supprimez cette ligne
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
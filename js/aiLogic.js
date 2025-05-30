// aiLogic.js

import { db } from "./firebaseConfig.js";
import { ref, update, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js";
import { currentMatchId, opponentKey, gameMode, youKey } from "./main.js"; // Importez youKey aussi

// Variable pour éviter de déclencher l'IA plusieurs fois pour le même tour
export let isAITurnCurrentlyProcessing = false;
export let lastAITurnProcessed = null; // Ajout pour stocker le dernier tour où l'IA a joué

/**
 * Traite le tour de l'IA pour un match PvAI.
 * @param {object} matchData - Les données actuelles du match.
 */
export async function processAITurn(matchData) {
    console.log("processAITurn lancé."); // DEBUG
    console.log(`IA - currentMatchId: ${currentMatchId}`);
    console.log(`IA - opponentKey: ${opponentKey}`);
    console.log(`IA - gameMode: ${gameMode}`);

    if (gameMode !== 'PvAI') {
        console.log("processAITurn : Le mode de jeu n'est pas PvAI, annulation.");
        return;
    }

    // Si un tour de l'IA est déjà en cours de traitement, ne faites rien
    if (isAITurnCurrentlyProcessing) {
        console.warn("processAITurn : Le tour de l'IA est déjà en cours de traitement, annulation d'un appel redondant.");
        return;
    }

    // Si l'IA a déjà enregistré une action pour ce tour, ne faites rien
    if (matchData.players[opponentKey].action) {
        console.log("processAITurn : L'IA a déjà enregistré une action pour ce tour, annulation.");
        return;
    }

    // Vérifier si c'est le tour de l'adversaire ou si le joueur vient de jouer et que l'IA n'a pas encore agi
    const isOpponentTurn = matchData.turn === opponentKey;
    const playerJustActed = matchData.turn === youKey && matchData.players[youKey].action;

    if (!isOpponentTurn && !playerJustActed) {
        console.log("processAITurn : Ce n'est pas le tour de l'IA et le joueur n'a pas encore agi. Annulation.");
        return;
    }

    // Marquer que le traitement de l'IA est en cours
    isAITurnCurrentlyProcessing = true;
    lastAITurnProcessed = matchData.turnCounter || 0; // Capture le tour actuel pour éviter le re-déclenchement

    console.log("processAITurn : Début du traitement de l'action de l'IA...");

    const aiPlayer = matchData.players[opponentKey];
    const humanPlayer = matchData.players[youKey];

    let aiAction = '';

    // Logique de décision simplifiée pour l'IA
    if (aiPlayer.pv < 30 && (aiPlayer.healCooldown || 0) === 0) {
        aiAction = 'heal';
        console.log("IA : Santé basse, choisit de se soigner.");
    } else if (humanPlayer.pv < 20) {
        aiAction = 'attack';
        console.log("IA : Santé de l'adversaire très basse, choisit d'attaquer pour achever.");
    } else {
        // Aléatoire entre attaque et défense si santé correcte
        const random = Math.random();
        if (random < 0.6) { // 60% chance to attack
            aiAction = 'attack';
            console.log("IA : Bonne santé, choisit d'attaquer.");
        } else { // 40% chance to defend
            aiAction = 'defend';
            console.log("IA : Bonne santé, choisit de défendre occasionnellement.");
        }
    }

    const matchRef = ref(db, `matches/${currentMatchId}`);

    // Délai pour simuler le "réflexion" de l'IA
    await new Promise(resolve => setTimeout(resolve, 1500)); // Délai de 1.5 secondes

    try {
        await update(matchRef, { [`players/${opponentKey}/action`]: aiAction });
        console.log(`Action de l'IA enregistrée pour ${opponentKey}: ${aiAction}`);
    } catch (error) {
        console.error("Erreur lors de l'enregistrement de l'action de l'IA :", error);
    } finally {
        isAITurnCurrentlyProcessing = false; // Relâcher le verrou
        console.log("processAITurn : Verrou isAITurnCurrentlyProcessing relâché.");
    }
}
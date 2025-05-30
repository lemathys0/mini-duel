// aiLogic.js

import { db } from "./firebaseConfig.js";
import { ref, update, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js";
import { currentMatchId, opponentKey, gameMode, youKey } from "./main.js"; // Importez les variables de main.js

export let isAITurnCurrentlyProcessing = false;
export let lastAITurnProcessed = null; // Stocke le turnCounter du dernier tour où l'IA a joué

/**
 * Traite le tour de l'IA pour un match PvAI.
 * @param {object} matchData - Les données actuelles du match.
 */
export async function processAITurn(matchData) {
    console.log("processAITurn lancé.");
    console.log(`IA - currentMatchId: ${currentMatchId}`);
    console.log(`IA - opponentKey: ${opponentKey}`);
    console.log(`IA - gameMode: ${gameMode}`);

    if (gameMode !== 'PvAI') {
        console.log("processAITurn : Le mode de jeu n'est pas PvAI, annulation.");
        return;
    }

    const currentMatchTurnCounter = matchData.turnCounter || 0;

    if (isAITurnCurrentlyProcessing) {
        console.warn("processAITurn : Le tour de l'IA est déjà en cours de traitement, annulation d'un appel redondant.");
        return;
    }

    // Vérifier si l'IA a déjà enregistré une action pour CE tour précis
    if (matchData.players[opponentKey].action) {
        console.log("processAITurn : L'IA a déjà enregistré une action pour ce tour, annulation.");
        return;
    }

    // Si l'IA a déjà été traitée pour ce turnCounter, on ne la traite pas à nouveau.
    if (lastAITurnProcessed === currentMatchTurnCounter) {
        console.log(`processAITurn : L'IA a déjà agi pour le tour ${currentMatchTurnCounter}. Annulation d'un appel redondant.`);
        return;
    }

    // Mettre à jour lastAITurnProcessed *avant* le délai et l'action
    // Ceci marque le tour comme "en cours de traitement par l'IA" pour éviter les doubles déclenchements.
    isAITurnCurrentlyProcessing = true;
    lastAITurnProcessed = currentMatchTurnCounter;

    console.log("processAITurn : Début du traitement de l'action de l'IA...");

    const aiPlayer = matchData.players[opponentKey];
    const humanPlayer = matchData.players[youKey];

    let aiAction = '';

    // Logique de décision de l'IA
    if (aiPlayer.pv < 30 && (aiPlayer.healCooldown || 0) === 0) {
        aiAction = 'heal';
        console.log("IA : Santé basse, choisit de se soigner.");
    } else if (humanPlayer.pv < 20) {
        aiAction = 'attack';
        console.log("IA : Santé de l'adversaire très basse, choisit d'attaquer pour achever.");
    } else {
        const random = Math.random();
        if (random < 0.6) { // 60% chance d'attaquer
            aiAction = 'attack';
            console.log("IA : Bonne santé, choisit d'attaquer.");
        } else { // 40% chance de défendre
            aiAction = 'defend';
            console.log("IA : Bonne santé, choisit de défendre occasionnellement.");
        }
    }

    const matchRef = ref(db, `matches/${currentMatchId}`);

    // Simule un temps de réflexion de l'IA
    await new Promise(resolve => setTimeout(resolve, 1500));

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
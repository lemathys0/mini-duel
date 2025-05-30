// aiLogic.js

import { db } from "./firebaseConfig.js";
import { ref, update, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js";
import { currentMatchId, opponentKey, youKey, gameMode } from "./main.js"; // Assurez-vous que ces imports sont corrects
import { showMessage } from "./utils.js"; // Pour les messages visuels

// Nouveau verrou interne à aiLogic pour empêcher des traitements multiples pour le même tour de l'IA
let isAITurnCurrentlyProcessing = false;

/**
 * Traite le tour de l'IA.
 * @param {object} matchData - Les données actuelles du match.
 */
export async function processAITurn(matchData) {
    console.log("processAITurn lancé.");
    console.log("IA - currentMatchId:", currentMatchId);
    console.log("IA - opponentKey:", opponentKey);
    console.log("IA - gameMode:", gameMode);

    const aiPlayer = matchData.players[opponentKey];
    const humanPlayer = matchData.players[youKey]; // Pour l'IA, "youKey" est le joueur humain

    // Combiner les conditions d'entrée pour la clarté et l'efficacité
    // L'IA ne doit pas jouer si elle n'existe pas, si elle a déjà une action pour ce tour,
    // ou si un traitement de l'IA est déjà en cours.
    if (!aiPlayer || aiPlayer.action || isAITurnCurrentlyProcessing) {
        if (!aiPlayer) {
            console.warn("processAITurn : Données de l'IA manquantes. Annulation.");
        } else if (aiPlayer.action) {
            console.warn("processAITurn : L'IA a déjà une action soumise pour ce tour. Annulation.");
        } else if (isAITurnCurrentlyProcessing) {
            console.warn("processAITurn : Le tour de l'IA est déjà en cours de traitement, annulation d'un appel redondant.");
        }
        return;
    }

    isAITurnCurrentlyProcessing = true; // Définir le verrou

    showMessage("action-msg", "L'IA réfléchit à son tour...");

    // Ajoute un délai d'une seconde avant que l'IA ne choisisse et soumette son action
    await new Promise(resolve => setTimeout(resolve, 1000));

    let aiAction = 'attack'; // Action par défaut de l'IA

    // Logique simple de l'IA
    if (aiPlayer.pv < 30 && aiPlayer.pv < humanPlayer.pv) {
        aiAction = 'heal';
        // Vérifier si le cooldown de heal est actif
        if (aiPlayer.healCooldown > 0) {
            console.log("IA : Veut se soigner mais le cooldown est actif, attaque à la place.");
            aiAction = 'attack'; // Si cooldown, attaque
        } else {
            console.log("IA : Santé basse, tente de se soigner.");
        }
    } else if (humanPlayer.pv < 20) {
        aiAction = 'attack'; // Finir l'adversaire
        console.log("IA : Santé de l'adversaire très basse, tente de l'achever.");
    } else if (aiPlayer.pv > 70 && Math.random() < 0.3) {
        aiAction = 'defend'; // Défense occasionnelle si bonne santé
        console.log("IA : Bonne santé, choisit de défendre occasionnellement.");
    }

    const matchRef = ref(db, `matches/${currentMatchId}`);
    const updates = {
        [`players/${opponentKey}/action`]: aiAction
    };

    try {
        await update(matchRef, updates);
        console.log(`Action de l'IA enregistrée pour ${opponentKey}: ${aiAction}`);
        showMessage("action-msg", `L'IA a choisi : ${aiAction}`);
    } catch (error) {
        console.error("Erreur lors de l'enregistrement de l'action de l'IA :", error);
        showMessage("action-msg", "Erreur de l'IA. Réessayez.");
    } finally {
        isAITurnCurrentlyProcessing = false; // Relâcher le verrou APRES que l'action soit soumise à Firebase
        console.log("processAITurn : Verrou isAITurnCurrentlyProcessing relâché.");
    }
}
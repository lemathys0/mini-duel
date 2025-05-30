// aiLogic.js

import { db } from './firebaseConfig.js';
import { ref, update, get } from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js';
import { currentMatchId, opponentKey, gameMode } from './main.js'; // <-- Ajout de cette ligne pour importer les variables globales

// Fonction pour que l'IA joue son tour
export async function processAITurn(matchData) {
    console.log("processAITurn lancé.");
    // Log des variables importées pour le débogage
    console.log(`IA - currentMatchId: ${currentMatchId}`);
    console.log(`IA - opponentKey: ${opponentKey}`);
    console.log(`IA - gameMode: ${gameMode}`);

    if (!currentMatchId || gameMode !== 'PvAI') {
        console.warn("processAITurn appelé mais ce n'est pas un match IA ou matchId non défini.");
        return;
    }

    const aiPlayerRef = ref(db, `matches/${currentMatchId}/players/${opponentKey}`);
    const aiPlayerSnapshot = await get(aiPlayerRef);
    const aiPlayer = aiPlayerSnapshot.val();

    if (!aiPlayer) {
        console.error("Données de l'IA introuvables pour le match :", currentMatchId);
        return;
    }

    // Logique de décision de l'IA (simple pour l'instant)
    let aiAction = 'attack'; // L'IA attaque par défaut

    // Si PV de l'IA sont bas et que le cooldown de soin est terminé, l'IA se soigne
    if (aiPlayer.pv <= 30 && aiPlayer.healCooldown === 0) {
        aiAction = 'heal';
    } else if (aiPlayer.healCooldown > 0) {
        // Si en cooldown, l'IA attaque ou défend
        const playerKey = (opponentKey === 'p1') ? 'p2' : 'p1'; // Clé de l'adversaire de l'IA
        const humanPlayerRef = ref(db, `matches/${currentMatchId}/players/${playerKey}`);
        const humanPlayerSnapshot = await get(humanPlayerRef);
        const humanPlayer = humanPlayerSnapshot.val();

        if (humanPlayer && humanPlayer.lastAction === 'attack') {
            aiAction = 'defend'; // Défense si l'adversaire a attaqué au dernier tour
        } else {
            aiAction = 'attack'; // Sinon, attaque
        }
    }


    try {
        const updates = {};
        updates[`action`] = aiAction;
        updates[`lastAction`] = aiAction; // Enregistre aussi la dernière action
        // Réduit le cooldown de soin si l'IA ne soigne pas ce tour-ci
        if (aiAction !== 'heal' && aiPlayer.healCooldown > 0) {
            updates[`healCooldown`] = aiPlayer.healCooldown - 1;
        } else if (aiAction === 'heal') {
            updates[`healCooldown`] = 3; // Cooldown de 3 tours après un soin
        }
        await update(aiPlayerRef, updates);
        console.log(`Action de l'IA enregistrée pour ${opponentKey}: ${aiAction}`);

    } catch (error) {
        console.error("Erreur lors de l'enregistrement de l'action de l'IA :", error);
    }
}
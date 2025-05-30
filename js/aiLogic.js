// js/aiLogic.js

import { db, ref, runTransaction, serverTimestamp } from './firebaseConfig.js';

// Variable pour éviter que l'IA ne joue plusieurs fois le même tour
export let isAITurnCurrentlyProcessing = false;
export let lastAITurnProcessed = -1; // Pour s'assurer que l'IA ne joue qu'une fois par tour Firebase

/**
 * L'IA fait son mouvement pour le tour actuel.
 * @param {object} matchData Les données actuelles du match.
 */
export async function processAITurn(matchData) {
    const matchId = matchData.id; // L'ID du match est maintenant dans matchData.id
    const matchRef = ref(db, `matches/${matchId}`);
    const aiPlayerKey = 'p2'; // L'IA est toujours P2 dans ce setup
    const humanPlayerKey = 'p1';

    const aiPv = matchData.players[aiPlayerKey].pv;
    const humanPv = matchData.players[humanPlayerKey].pv;
    const currentTurnCounter = matchData.turnCounter; // Utilise turnCounter pour la synchronisation
    const difficulty = matchData.difficulty || 'easy'; // Récupère la difficulté, par défaut 'easy'
    const aiHealCooldown = matchData.players[aiPlayerKey].healCooldown || 0;
    const humanLastAction = matchData.players[humanPlayerKey].action; // Action du joueur humain

    // Vérifier si l'IA a déjà joué pour ce tour ou si un traitement est déjà en cours
    if (isAITurnCurrentlyProcessing || lastAITurnProcessed === currentTurnCounter) {
        console.log("AI Logic: IA déjà en cours de traitement ou a déjà joué pour ce tour.");
        return;
    }

    // Vérifier si c'est bien le tour de l'IA (ou si le joueur a déjà joué et l'IA doit répondre)
    // Cette vérification est cruciale pour que l'IA ne joue qu'une fois par tour
    const isOurTurn = (matchData.turn === aiPlayerKey);
    const playerHasPlayedAndItsOurResponseTurn = (matchData.turn === humanPlayerKey && matchData.players[humanPlayerKey].action !== null && matchData.players[aiPlayerKey].action === null);

    if (!isOurTurn && !playerHasPlayedAndItsOurResponseTurn) {
        console.log("AI Logic: Ce n'est pas encore le tour de l'IA ou le joueur n'a pas encore joué. Attente.");
        return;
    }

    isAITurnCurrentlyProcessing = true; // Verrouille le traitement de l'IA
    console.log(`AI Logic: Début du traitement de l'IA (${difficulty}) pour le tour ${currentTurnCounter}.`);
    // Afficher un message à l'utilisateur
    document.getElementById('opponent-action-status').textContent = "L'IA réfléchit...";


    let aiAction = 'attack'; // Action par défaut

    // Stratégies de l'IA
    switch (difficulty) {
        case 'easy':
            // L'IA Facile attaque la plupart du temps, défend parfois, soigne rarement.
            const easyRand = Math.random();
            if (aiPv < 40 && aiHealCooldown === 0 && easyRand < 0.3) { // 30% de chance de soigner si PV bas et cooldown dispo
                aiAction = 'heal';
            } else if (easyRand < 0.8) { // 80% attaque (après vérif soin)
                aiAction = 'attack';
            } else { // 20% défense
                aiAction = 'defend';
            }
            break;

        case 'normal':
            // L'IA Normale est plus stratégique : elle attaque, défend plus si les PV sont bas, et soigne si vraiment nécessaire.
            if (aiPv < 30 && aiHealCooldown === 0) { // Priorise le soin si PV très bas et cooldown dispo
                aiAction = 'heal';
            } else if (aiPv < 60 && Math.random() < 0.4) { // Si PV moyens, 40% de défendre
                aiAction = 'defend';
            } else if (humanLastAction === 'attack' && Math.random() < 0.5) { // Tente de contrer l'attaque du joueur
                aiAction = 'defend';
            } else {
                aiAction = 'attack'; // Attaque par défaut
            }
            break;

        case 'hard':
            // L'IA Difficile est la plus optimisée : elle tente de prédire et de contrer, gère les PV agressivement.
            if (aiPv < 25 && aiHealCooldown === 0) { // Priorise fortement le soin si PV critiques
                aiAction = 'heal';
            } else if (aiPv < 50 && humanPv > aiPv && Math.random() < 0.6) { // Si l'IA a moins de PV que l'humain et PV bas, 60% de défendre
                aiAction = 'defend';
            } else if (humanLastAction === 'attack') { // Si le joueur a attaqué au dernier tour, l'IA contre-attaque ou défend
                aiAction = Math.random() < 0.7 ? 'defend' : 'attack'; // 70% de défense, 30% d'attaque
            } else {
                aiAction = 'attack';
            }
            // Ajoutez ici des logiques plus complexes si vous voulez (ex: anticiper l'action du joueur)
            // Pour l'instant, on se base sur les PV et la chance.
            break;

        default:
            aiAction = 'attack'; // Par défaut, attaque
            break;
    }

    console.log(`AI Logic: L'IA (${difficulty}) choisit l'action: ${aiAction}`);

    // Délai pour simuler la "réflexion" de l'IA
    await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500)); // entre 0.5s et 1.5s

    // Met à jour l'action de l'IA dans la base de données via une transaction
    try {
        await runTransaction(matchRef, (currentMatch) => {
            if (currentMatch && currentMatch.status === 'playing') {
                // Double vérification pour éviter les actions multiples pour le même tour
                if (currentMatch.players[aiPlayerKey].action === null && currentMatch.turnCounter === currentTurnCounter) {
                    currentMatch.players[aiPlayerKey].action = aiAction;
                    // L'IA n'a pas besoin de healCooldown ici car il est géré dans processTurn
                    return currentMatch;
                }
            }
            return undefined; // Abort the transaction
        });
        lastAITurnProcessed = currentTurnCounter; // Marque le tour comme traité par l'IA
        document.getElementById('opponent-action-status').textContent = "L'IA a joué !";
        console.log("AI Logic: Action de l'IA mise à jour dans Firebase.");
    } catch (error) {
        console.error("AI Logic: Erreur lors de la mise à jour de l'action de l'IA:", error);
    } finally {
        isAITurnCurrentlyProcessing = false; // Relâche le verrou
        console.log("AI Logic: Fin du traitement de l'IA. Verrou relâché.");
    }
}
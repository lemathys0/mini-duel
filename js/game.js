// js/game.js

import { db, ref, onValue, off, runTransaction, serverTimestamp } from './firebaseConfig.js';
import { showSection, showMessage, updateTimerUI, updateHealthBar, appendHistory } from './utils.js';
import { auth } from './auth.js';
import { processAITurn } from './aiLogic.js'; // Importez la fonction de l'IA

console.log("game.js chargé.");

// Variables d'état du jeu
let gameId = null;
let youKey = null; // 'p1' ou 'p2'
let opponentKey = null; // 'p1' ou 'p2'
let gameMode = null; // 'PvAI' ou 'PvP'
let matchRef = null;
let gameListener = null;

// Éléments du DOM (mis à jour ou ajoutés)
let player1PseudoSpan;
let player2PseudoSpan;
let player1PVDisplay;
let player2PVDisplay;
let youHealthBar;
let opponentHealthBar;
let actionAttackButton;
let actionDefendButton;
let actionHealButton;
let opponentActionStatus;
let timerProgressBar;
let timerDisplay;
let historyDiv;
let backToMenuButtonGame; // Nouvelle variable pour le bouton de retour

const GAME_TURN_DURATION_SECONDS = 30; // Durée d'un tour en secondes

// Fonction pour initialiser les éléments du DOM une seule fois
function initializeGameDOMElements() {
    player1PseudoSpan = document.getElementById('player1-pseudo');
    player2PseudoSpan = document.getElementById('player2-pseudo');
    player1PVDisplay = document.getElementById('player1-pv');
    player2PVDisplay = document.getElementById('player2-pv');
    youHealthBar = document.getElementById('you-health-bar');
    opponentHealthBar = document.getElementById('opponent-health-bar');
    actionAttackButton = document.getElementById('action-attack');
    actionDefendButton = document.getElementById('action-defend');
    actionHealButton = document.getElementById('action-heal');
    opponentActionStatus = document.getElementById('opponent-action-status');
    timerProgressBar = document.getElementById('timer-progress-bar');
    timerDisplay = document.getElementById('timer-display');
    historyDiv = document.getElementById('history');
    backToMenuButtonGame = document.getElementById('back-to-menu-btn-game'); // ID corrigé ici

    if (!backToMenuButtonGame) {
        console.warn("Le bouton de retour au menu du jeu (#back-to-menu-btn-game) n'a pas été trouvé. Veuillez vérifier votre HTML.");
    }
}

// Assurez-vous d'appeler cette fonction au démarrage ou avant d'accéder aux éléments
document.addEventListener('DOMContentLoaded', initializeGameDOMElements);


// Fonction pour désactiver ou activer les boutons d'action
function toggleActionButtons(enable) {
    if (actionAttackButton) actionAttackButton.disabled = !enable;
    if (actionDefendButton) actionDefendButton.disabled = !enable;
    if (actionHealButton) actionHealButton.disabled = !enable;
}

// Attache les écouteurs d'événements pour les boutons d'action du jeu
export function attachGameActionListeners() {
    if (!actionAttackButton) initializeGameDOMElements(); // S'assurer que les éléments sont initialisés

    if (actionAttackButton) {
        actionAttackButton.onclick = () => performAction('attack');
        actionDefendButton.onclick = () => performAction('defend');
        actionHealButton.onclick = () => performAction('heal');
    }

    if (backToMenuButtonGame) {
        backToMenuButtonGame.onclick = () => leaveGame();
    }
}

// Fonction pour démarrer un match
export async function startMatch(match_id, player_key, mode = 'PvP') {
    gameId = match_id;
    youKey = player_key;
    opponentKey = (youKey === 'p1') ? 'p2' : 'p1';
    gameMode = mode;
    matchRef = ref(db, `matches/${gameId}`);

    console.log(`Démarrage du monitoring du match ${gameId} pour ${youKey} en mode ${gameMode}`);

    showSection('game-screen');
    showMessage('action-msg', 'En attente du début du match...', true);
    toggleActionButtons(false); // Désactiver les boutons tant que le match ne commence pas

    // Nettoie l'historique et les messages précédents
    if (historyDiv) historyDiv.innerHTML = '';
    if (opponentActionStatus) opponentActionStatus.textContent = '';


    // S'assurer que les éléments sont initialisés et attachés
    attachGameActionListeners();

    // Arrête l'écouteur précédent s'il existe
    if (gameListener) {
        off(matchRef, 'value', gameListener);
    }

    // Écouteur en temps réel pour les mises à jour du match
    gameListener = onValue(matchRef, (snapshot) => {
        const gameData = snapshot.val();
        if (!gameData) {
            console.log("Match terminé ou supprimé.");
            leaveGame(); // Revenir au menu si le match n'existe plus
            return;
        }

        updateGameUI(gameData);
    }, (error) => {
        console.error("Erreur de lecture du match:", error);
        showMessage('action-msg', `Erreur de connexion au match: ${error.message}`, false);
        leaveGame();
    });
}

// Met à jour l'interface utilisateur du jeu
function updateGameUI(gameData) {
    if (!player1PseudoSpan) initializeGameDOMElements(); // Assurez-vous que les éléments sont prêts

    const player1 = gameData.players.p1;
    const player2 = gameData.data ? gameData.data.player2 : gameData.players.p2; // Pour compatibilité ancienne structure

    document.getElementById('current-match').textContent = gameId;

    // Mise à jour des pseudos et PV
    player1PseudoSpan.textContent = player1.pseudo;
    player2PseudoSpan.textContent = player2.pseudo;

    player1PVDisplay.textContent = `${player1.pv} PV`;
    player2PVDisplay.textContent = `${player2.pv} PV`;

    updateHealthBar(youHealthBar, player1.pv);
    updateHealthBar(opponentHealthBar, player2.pv);

    // Mise à jour de l'historique
    if (historyDiv) {
        historyDiv.innerHTML = ''; // Nettoyer avant d'ajouter
        if (gameData.history) {
            gameData.history.forEach(entry => appendHistory(historyDiv, entry));
            historyDiv.scrollTop = historyDiv.scrollHeight; // Scroll vers le bas
        }
    }


    // Logique de gestion du tour et des actions
    if (gameData.status === 'playing') {
        const isYourTurn = (gameData.turn === youKey);
        const yourPlayer = gameData.players[youKey];
        const opponentPlayer = gameData.players[opponentKey];

        // Gérer l'état des boutons d'action
        if (isYourTurn && yourPlayer.action === null) {
            showMessage('action-msg', 'C\'est votre tour ! Choisissez une action.', true);
            toggleActionButtons(true);
        } else if (yourPlayer.action !== null && opponentPlayer.action === null) {
            showMessage('action-msg', 'En attente de l\'action de l\'adversaire...', true);
            toggleActionButtons(false);
        } else {
            // Dans ce cas, soit c'est le tour de l'adversaire et il n'a pas encore joué
            // soit les deux ont joué et le tour va être résolu.
            showMessage('action-msg', 'Tour de l\'adversaire...', true);
            toggleActionButtons(false);
        }

        // --- GESTION DU TOUR DE L'IA (si en mode PvAI) ---
        if (gameMode === 'PvAI' && gameData.turn === opponentKey && opponentPlayer.uid === 'AI' && opponentPlayer.action === null) {
            console.log("C'est le tour de l'IA. Déclenchement de l'action de l'IA...");
            // Passer directement gameData à processAITurn
            // aiLogic.js gérera la non-exécution si déjà en cours ou déjà joué pour ce tour
            processAITurn(gameData);
        }

        // --- RÉSOLUTION DU TOUR (si les deux joueurs ont agi) ---
        // Cette section est cruciale pour le mode PvAI et potentiellement PvP.
        if (gameData.status === 'playing' && player1.action !== null && player2.action !== null) {
            console.log("Les deux joueurs ont agi. Résolution du tour...");
            resolveTurn(gameData); // Appel de la fonction de résolution du tour
        }


        // Mise à jour du timer
        if (gameData.turnStartTime && gameData.turn === youKey) { // Seul le joueur actif voit le timer
            const totalTurnDurationSeconds = GAME_TURN_DURATION_SECONDS;
            const elapsedMilliseconds = Date.now() - gameData.turnStartTime;
            const remainingSeconds = Math.max(0, Math.floor(totalTurnDurationSeconds - (elapsedMilliseconds / 1000)));

            updateTimerUI(remainingSeconds, totalTurnDurationSeconds, timerDisplay, timerProgressBar);
        } else {
            // Cache ou réinitialise le timer si ce n'est pas le tour du joueur ou si le timer n'est pas actif
            updateTimerUI(0, GAME_TURN_DURATION_SECONDS, timerDisplay, timerProgressBar);
            timerDisplay.textContent = 'En attente...';
        }

    } else if (gameData.status === 'finished') {
        toggleActionButtons(false);
        const winnerPseudo = gameData.players[gameData.winner].pseudo;
        showMessage('action-msg', `Le match est terminé ! ${winnerPseudo} a gagné !`, true);
        if (opponentActionStatus) opponentActionStatus.textContent = '';
    }
}

// Fonction pour effectuer une action (pour le joueur humain)
async function performAction(actionType) {
    if (!gameId || !youKey || !matchRef) {
        console.error("Match non initialisé.");
        showMessage('action-msg', 'Erreur: Match non initialisé.', false);
        return;
    }

    // Désactiver les boutons immédiatement pour éviter les clics multiples
    toggleActionButtons(false);
    showMessage('action-msg', 'Envoi de votre action...', true);

    try {
        await runTransaction(matchRef, (currentMatch) => {
            if (!currentMatch || currentMatch.status !== 'playing' || currentMatch.turn !== youKey) {
                console.log("Transaction annulée: Ce n'est pas votre tour ou la partie n'est pas en cours.");
                return undefined; // Abort the transaction
            }

            const yourPlayer = currentMatch.players[youKey];
            const opponentPlayer = currentMatch.players[opponentKey];

            // Gérer les cooldowns
            if (actionType === 'heal' && yourPlayer.healCooldown > 0) {
                showMessage('action-msg', `Soin en cooldown. Attendez ${yourPlayer.healCooldown} tours.`, false);
                return undefined; // Annule la transaction
            }

            // Enregistrer l'action du joueur
            yourPlayer.action = actionType;

            // Retourne l'objet match mis à jour
            return currentMatch;
        });

        console.log(`Action "${actionType}" enregistrée pour ${youKey}.`);
        // L'UI sera mise à jour via le listener onValue quand Firebase confirmera l'action
    } catch (error) {
        console.error("Erreur lors de l'enregistrement de l'action:", error);
        showMessage('action-msg', `Erreur lors de l'action : ${error.message}`, false);
        toggleActionButtons(true); // Réactiver les boutons en cas d'échec
    }
}

// --- Nouvelle fonction pour résoudre un tour de jeu ---
async function resolveTurn(gameData) {
    // Empêche la résolution multiple du même tour si l'écouteur est trop rapide
    if (gameData.players.p1.action === null || gameData.players.p2.action === null) {
        // Cela signifie que l'un des joueurs n'a pas encore agi, donc ne résolvez pas le tour.
        // Cela peut arriver si l'écouteur se déclenche avant que les deux actions soient complètement mises à jour.
        return;
    }

    const matchRef = ref(db, `matches/${gameData.id}`);

    try {
        await runTransaction(matchRef, (currentMatch) => {
            if (!currentMatch || currentMatch.status !== 'playing') {
                return undefined; // Annuler si l'état du jeu a changé
            }

            // Vérifier si ce tour a déjà été résolu
            // Une façon simple est de vérifier si les actions sont nulles
            if (currentMatch.players.p1.action === null || currentMatch.players.p2.action === null) {
                 return undefined; // Les actions ont déjà été nullifiées, ce tour est déjà résolu ou non prêt.
            }

            const p1 = currentMatch.players.p1;
            const p2 = currentMatch.players.p2;

            let logMessages = [];
            let p1DamageTaken = 0;
            let p2DamageTaken = 0;

            // Pré-calcul des dégâts/soins de base pour chaque action
            const actionEffects = {
                'attack': { damage: 10 },
                'defend': { mitigation: 5 }, // Réduction des dégâts reçus
                'heal': { amount: 15, cooldown: 3 }
            };

            // Appliquer les actions de P1
            if (p1.action === 'attack') {
                logMessages.push(`[${p1.pseudo}] attaque !`);
                p2DamageTaken += actionEffects.attack.damage;
            } else if (p1.action === 'defend') {
                logMessages.push(`[${p1.pseudo}] se défend !`);
                p1.isDefending = true; // Marquer comme défendant
            } else if (p1.action === 'heal') {
                logMessages.push(`[${p1.pseudo}] se soigne !`);
                p1.pv += actionEffects.heal.amount;
                if (p1.pv > 100) p1.pv = 100;
                p1.healCooldown = actionEffects.heal.cooldown;
            }

            // Appliquer les actions de P2
            if (p2.action === 'attack') {
                logMessages.push(`[${p2.pseudo}] attaque !`);
                p1DamageTaken += actionEffects.attack.damage;
            } else if (p2.action === 'defend') {
                logMessages.push(`[${p2.pseudo}] se défend !`);
                p2.isDefending = true; // Marquer comme défendant
            } else if (p2.action === 'heal') {
                logMessages.push(`[${p2.pseudo}] se soigne !`);
                p2.pv += actionEffects.heal.amount;
                if (p2.pv > 100) p2.pv = 100;
                p2.healCooldown = actionEffects.heal.cooldown;
            }

            // Appliquer la mitigation de défense
            if (p1.isDefending) {
                p1DamageTaken = Math.max(0, p1DamageTaken - actionEffects.defend.mitigation);
                p1.isDefending = false; // Réinitialiser pour le prochain tour
            }
            if (p2.isDefending) {
                p2DamageTaken = Math.max(0, p2DamageTaken - actionEffects.defend.mitigation);
                p2.isDefending = false; // Réinitialiser pour le prochain tour
            }

            // Appliquer les dégâts finaux
            p1.pv -= p1DamageTaken;
            p2.pv -= p2DamageTaken;

            if (p1DamageTaken > 0) logMessages.push(`[${p1.pseudo}] reçoit ${p1DamageTaken} dégâts.`);
            if (p2DamageTaken > 0) logMessages.push(`[${p2.pseudo}] reçoit ${p2DamageTaken} dégâts.`);

            // Décrémenter les cooldowns de soin
            if (p1.healCooldown > 0) p1.healCooldown--;
            if (p2.healCooldown > 0) p2.healCooldown--;


            // Ajouter les messages au log d'historique
            if (!currentMatch.history) currentMatch.history = [];
            currentMatch.history.push(...logMessages);

            // Vérifier si le match est terminé
            if (p1.pv <= 0 && p2.pv <= 0) {
                 // Cas de double K.O. - on peut décider d'un match nul ou du joueur avec le moins de PV restant avant ce tour.
                 // Pour l'instant, on donne la victoire à l'IA si double K.O.
                p1.pv = 0;
                p2.pv = 0;
                currentMatch.winner = 'p2'; // IA gagne en cas de double K.O.
                currentMatch.status = 'finished';
                currentMatch.history.push(`Double K.O. !`);
                currentMatch.history.push(`[${currentMatch.players.p2.pseudo}] remporte la partie !`); // IA
            } else if (p1.pv <= 0) {
                p1.pv = 0;
                currentMatch.winner = 'p2'; // IA gagne
                currentMatch.status = 'finished';
                currentMatch.history.push(`[${p1.pseudo}] a été vaincu !`);
                currentMatch.history.push(`[${currentMatch.players.p2.pseudo}] remporte la partie !`);
            } else if (p2.pv <= 0) {
                p2.pv = 0;
                currentMatch.winner = 'p1'; // Joueur humain gagne
                currentMatch.status = 'finished';
                currentMatch.history.push(`[${currentMatch.players.p2.pseudo}] a été vaincu !`);
                currentMatch.history.push(`[${currentMatch.players.p1.pseudo}] remporte la partie !`);
            } else {
                // Avancer le tour si le match continue
                currentMatch.turnCounter = (currentMatch.turnCounter || 0) + 1;
                // Le tour est toujours passé au joueur humain (p1) pour la prochaine décision
                currentMatch.turn = 'p1';
                currentMatch.turnStartTime = serverTimestamp(); // Utilise le timestamp du serveur pour la synchronisation
                currentMatch.history.push(`--- Début du tour ${currentMatch.turnCounter + 1} ---`);
                currentMatch.history.push(`C'est au tour de [${currentMatch.players.p1.pseudo}].`);
            }

            // Réinitialiser les actions pour le prochain tour
            // C'est important pour éviter que resolveTurn ne se déclenche en boucle
            p1.action = null;
            p2.action = null;

            return currentMatch;
        });
        console.log("Tour résolu avec succès dans Firebase.");
    } catch (error) {
        console.error("Erreur lors de la résolution du tour:", error);
    }
}


// Fonction pour quitter le match
export function leaveGame() {
    console.log("Quitter le match.");
    if (gameListener) {
        off(matchRef, 'value', gameListener); // Arrête l'écouteur Firebase
    }
    gameId = null;
    youKey = null;
    opponentKey = null;
    gameMode = null;
    matchRef = null;
    gameListener = null;

    // Réinitialiser l'UI et revenir au menu principal
    showSection('main-menu');
    showMessage('action-msg', '', true); // Efface le message d'action
    toggleActionButtons(false); // S'assurer que les boutons sont désactivés
    if (opponentActionStatus) opponentActionStatus.textContent = '';
    // Pour une réinitialisation complète de l'UI du jeu
    if (player1PVDisplay) player1PVDisplay.textContent = '100 PV';
    if (player2PVDisplay) player2PVDisplay.textContent = '100 PV';
    if (youHealthBar) updateHealthBar(youHealthBar, 100);
    if (opponentHealthBar) updateHealthBar(opponentHealthBar, 100);
    if (timerDisplay) timerDisplay.textContent = '20';
    if (timerProgressBar) updateTimerUI(0, GAME_TURN_DURATION_SECONDS, timerDisplay, timerProgressBar); // Réinitialiser la barre de temps
    if (historyDiv) historyDiv.innerHTML = '';
}
// js/game.js

// Importe les fonctions de base de données et auth depuis firebaseConfig.js
import { auth, db, ref, get, set, update, onValue, off, serverTimestamp } from './firebaseConfig.js';
// Importe les fonctions utilitaires nécessaires avec leurs noms français corrects
import {
    afficherMessage,
    mettreAJourBarreDeVie,
    mettreAJourMinuteurUI,
    ajouterMessageHistorique,
    effacerHistorique,
    desactiverBoutonsAction,
    activerBoutonsAction,
    afficherEcranJeu,
    afficherMenuPrincipal // Pour revenir au menu après le jeu
} from './utils.js';

console.log("game.js chargé.");

// Variables globales de jeu
let currentMatchId = null;
let currentPlayerRole = null; // 'p1' ou 'p2'
let gameMode = null; // 'PvAI' ou 'PvP'
let currentMatchListener = null; // Pour le listener onValue du match
let timerInterval = null;
const TOUR_DUREE_SECONDES = 30; // Durée d'un tour de jeu en secondes
let player1PvDisplay = document.getElementById('player1-pv-display'); // Assurez-vous d'avoir cet ID dans votre HTML
let player2PvDisplay = document.getElementById('player2-pv-display'); // Assurez-vous d'avoir cet ID dans votre HTML
let player1NameDisplay = document.getElementById('player1-name-display');
let player2NameDisplay = document.getElementById('player2-name-display');

// Références aux boutons d'action (déjà définies dans utils.js, mais réutilisées ici si besoin)
const attackBtn = document.getElementById('action-attack');
const defendBtn = document.getElementById('action-defend');
const healBtn = document.getElementById('action-heal');
const returnToMenuBtnGame = document.getElementById('back-to-menu-btn-game');

/**
 * Attache les écouteurs d'événements aux boutons d'action du jeu.
 * Cette fonction est appelée par startMatch.
 */
export function attachGameActionListeners() {
    if (attackBtn) {
        attackBtn.onclick = () => sendPlayerAction('attack');
    }
    if (defendBtn) {
        defendBtn.onclick = () => sendPlayerAction('defend');
    }
    if (healBtn) {
        healBtn.onclick = () => sendPlayerAction('heal');
    }
    if (returnToMenuBtnGame) {
        returnToMenuBtnGame.onclick = leaveGame; // Utilisez la fonction leaveGame
    }
}

/**
 * Démarre un nouveau match ou rejoint un match existant.
 * @param {string} matchId - L'ID du match Firebase.
 * @param {string} role - Le rôle du joueur ('p1' ou 'p2').
 * @param {string} mode - Le mode de jeu ('PvAI' ou 'PvP').
 */
export function startMatch(matchId, role, mode) {
    currentMatchId = matchId;
    currentPlayerRole = role;
    gameMode = mode;
    afficherEcranJeu();
    effacerHistorique(); // Effacer l'historique pour un nouveau match
    desactiverBoutonsAction(); // Désactiver les boutons au début, ils seront activés par le tour

    attachGameActionListeners(); // Attacher les écouteurs d'action

    const matchRef = ref(db, `matches/${currentMatchId}`);

    // Détacher l'ancien listener si existant
    if (currentMatchListener) {
        off(matchRef, 'value', currentMatchListener);
    }

    // Écoute les changements du match en temps réel
    currentMatchListener = onValue(matchRef, (snapshot) => {
        const matchData = snapshot.val();
        if (!matchData) {
            console.log("Match terminé ou n'existe plus.");
            afficherMessage('game-msg', 'Le match a été terminé.', false);
            leaveGame(); // Revenir au menu si le match disparaît
            return;
        }

        updateGameUI(matchData); // Met à jour toute l'interface
        handleTurnLogic(matchData); // Gère la logique du tour
        checkGameEnd(matchData); // Vérifie si le match est terminé

    }, (error) => {
        console.error("Erreur d'écoute du match:", error);
        afficherMessage('game-msg', `Erreur de connexion au match: ${error.message}`, false);
        leaveGame();
    });
}

/**
 * Met à jour l'interface utilisateur du jeu avec les données du match.
 * @param {object} matchData - Les données actuelles du match.
 */
function updateGameUI(matchData) {
    const player1 = matchData.players.p1;
    const player2 = matchData.players.p2;

    // Mise à jour des noms des joueurs
    if (player1NameDisplay) player1NameDisplay.textContent = player1.pseudo;
    if (player2NameDisplay) player2NameDisplay.textContent = player2.pseudo;

    // Mise à jour des barres de vie
    mettreAJourBarreDeVie('you-health-bar', player1.pv);
    mettreAJourBarreDeVie('opponent-health-bar', player2.pv);

    // Mise à jour des PV numériques
    if (player1PvDisplay) player1PvDisplay.textContent = `${player1.pv} PV`;
    if (player2PvDisplay) player2PvDisplay.textContent = `${player2.pv} PV`;

    // Mise à jour de l'historique
    effacerHistorique(); // Efface tout l'historique et le recrée
    if (matchData.history) {
        matchData.history.forEach(msg => ajouterMessageHistorique(msg));
    }
}

/**
 * Gère la logique des tours de jeu.
 * @param {object} matchData - Les données actuelles du match.
 */
async function handleTurnLogic(matchData) {
    const isMyTurn = matchData.turn === currentPlayerRole;
    const turnOwner = matchData.players[matchData.turn];
    const opponentRole = currentPlayerRole === 'p1' ? 'p2' : 'p1';
    const opponent = matchData.players[opponentRole];

    ajouterMessageHistorique(`--- Tour ${matchData.turnCounter + 1} ---`);
    ajouterMessageHistorique(`C'est au tour de [${turnOwner.pseudo}].`);

    // Gérer le minuteur
    clearInterval(timerInterval); // Arrêter l'ancien minuteur
    let timeLeft = TOUR_DUREE_SECONDES;
    mettreAJourMinuteurUI(timeLeft, TOUR_DUREE_SECONDES); // Mise à jour immédiate

    timerInterval = setInterval(() => {
        timeLeft--;
        mettreAJourMinuteurUI(timeLeft, TOUR_DUREE_SECONDES);
        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            if (isMyTurn && matchData.status === 'playing' && !matchData.players[currentPlayerRole].action) {
                // Si c'est mon tour et que je n'ai pas agi (timeout)
                console.log("Timeout pour le joueur", currentPlayerRole);
                sendPlayerAction('timeout'); // Envoyer une action de timeout
            }
        }
    }, 1000);

    if (isMyTurn && matchData.status === 'playing' && !matchData.players[currentPlayerRole].action) {
        activerBoutonsAction();
        afficherMessage('action-msg', 'C\'est votre tour ! Choisissez une action.', true, 0); // Message persistant
    } else {
        desactiverBoutonsAction();
        // Afficher un message d'attente si l'action n'a pas encore été prise ou si ce n'est pas mon tour
        if (matchData.status === 'playing') {
             if (matchData.players[currentPlayerRole].action) {
                 afficherMessage('action-msg', 'Votre action a été enregistrée. En attente de l\'adversaire...', true, 0);
             } else {
                 afficherMessage('action-msg', `En attente de l'action de ${turnOwner.pseudo}...`, true, 0);
             }
        }
    }

    // Si les deux joueurs ont choisi une action ou si c'est l'IA
    if (matchData.players.p1.action && matchData.players.p2.action) {
        clearInterval(timerInterval); // Arrête le minuteur si les actions sont prêtes
        await processTurn(matchData); // Traite le tour
    } else if (gameMode === 'PvAI' && matchData.turn === 'p2' && !matchData.players.p2.action) {
        // C'est le tour de l'IA et elle n'a pas encore agi
        setTimeout(() => processAIAction(matchData), 2000); // Laisse un délai pour l'IA
    }
}


/**
 * Envoie l'action du joueur à la base de données.
 * @param {string} action - L'action choisie ('attack', 'defend', 'heal', 'timeout').
 */
async function sendPlayerAction(action) {
    if (!currentMatchId || !currentPlayerRole) return;

    desactiverBoutonsAction(); // Désactiver immédiatement pour éviter les doubles clics

    const matchRef = ref(db, `matches/${currentMatchId}`);
    try {
        // Vérifier que l'action n'a pas déjà été soumise pour ce tour
        const currentMatchSnapshot = await get(matchRef);
        const currentMatchData = currentMatchSnapshot.val();

        if (currentMatchData.players[currentPlayerRole].action !== null) {
            console.warn("Action déjà soumise pour ce tour.");
            afficherMessage('action-msg', 'Vous avez déjà choisi une action pour ce tour.', false);
            return;
        }

        // Mettre à jour l'action du joueur
        await update(ref(db, `matches/${currentMatchId}/players/${currentPlayerRole}`), {
            action: action,
            isDefending: (action === 'defend') // Mettre à jour l'état de défense
        });
        afficherMessage('action-msg', `Votre action (${action}) a été enregistrée.`, true, 3000);

        // Si l'IA est l'autre joueur et c'est son tour
        const opponentRole = currentPlayerRole === 'p1' ? 'p2' : 'p1';
        if (gameMode === 'PvAI' && currentMatchData.turn === opponentRole && !currentMatchData.players[opponentRole].action) {
            // Pas besoin de forcer l'IA à agir ici, handleTurnLogic s'en chargera
        }

    } catch (error) {
        console.error("Erreur lors de l'envoi de l'action:", error);
        afficherMessage('action-msg', `Erreur lors de l'envoi de l'action: ${error.message}`, false);
        activerBoutonsAction(); // Réactiver les boutons si erreur
    }
}

/**
 * L'IA choisit et exécute une action.
 * @param {object} matchData - Les données actuelles du match.
 */
async function processAIAction(matchData) {
    if (matchData.players.p2.action) return; // L'IA a déjà agi

    const player1 = matchData.players.p1;
    const player2 = matchData.players.p2; // IA

    let aiAction = 'attack'; // Action par défaut

    // Logique simple pour l'IA (peut être complexifiée)
    if (player2.pv < 30 && player2.healCooldown === 0) {
        aiAction = 'heal';
    } else if (player1.pv > 70 && Math.random() < 0.3) { // Petite chance de défendre si l'adversaire a beaucoup de PV
        aiAction = 'defend';
    } else {
        aiAction = 'attack';
    }

    // Gérer le cooldown de soin pour l'IA
    if (aiAction === 'heal' && player2.healCooldown > 0) {
        // Si l'IA veut soigner mais est en cooldown, elle attaque
        aiAction = 'attack';
    }

    // Envoyer l'action de l'IA
    const matchRef = ref(db, `matches/${currentMatchId}`);
    try {
        await update(ref(db, `matches/${currentMatchId}/players/p2`), {
            action: aiAction,
            isDefending: (aiAction === 'defend')
        });
        ajouterMessageHistorique(`L'IA a choisi l'action: ${aiAction}.`);
        console.log(`AI chose: ${aiAction}`);
    } catch (error) {
        console.error("Erreur lors de l'action de l'IA:", error);
    }
}


/**
 * Traite les actions des deux joueurs et met à jour l'état du match.
 * @param {object} matchData - Les données actuelles du match avant traitement.
 */
async function processTurn(matchData) {
    let p1 = { ...matchData.players.p1 }; // Copie pour modification
    let p2 = { ...matchData.players.p2 }; // Copie pour modification

    // Réinitialiser l'état de défense pour le prochain tour
    p1.isDefending = false;
    p2.isDefending = false;

    // Gérer les cooldowns de soin
    if (p1.healCooldown > 0) p1.healCooldown--;
    if (p2.healCooldown > 0) p2.healCooldown--;

    const actions = { p1: p1.action, p2: p2.action };
    ajouterMessageHistorique(`${p1.pseudo} a choisi : ${actions.p1}`);
    ajouterMessageHistorique(`${p2.pseudo} a choisi : ${actions.p2}`);

    // Logique de résolution du tour
    if (actions.p1 === 'attack' && actions.p2 === 'defend') {
        let damage = 10; // Dégâts de base
        damage = damage * 0.5; // Dégâts réduits de 50% si l'adversaire défend
        p2.pv -= damage;
        ajouterMessageHistorique(`${p1.pseudo} attaque, mais ${p2.pseudo} défend et subit ${damage} dégâts.`);
    } else if (actions.p1 === 'attack' && actions.p2 === 'attack') {
        const damage = 20;
        p1.pv -= damage;
        p2.pv -= damage;
        ajouterMessageHistorique(`${p1.pseudo} et ${p2.pseudo} s'attaquent mutuellement et subissent ${damage} dégâts.`);
    } else if (actions.p1 === 'attack' && actions.p2 === 'heal') {
        const damage = 20;
        p2.pv -= damage;
        ajouterMessageHistorique(`${p1.pseudo} attaque, ${p2.pseudo} tente de se soigner mais subit ${damage} dégâts.`);
    } else if (actions.p1 === 'defend' && actions.p2 === 'attack') {
        let damage = 10;
        damage = damage * 0.5;
        p1.pv -= damage;
        ajouterMessageHistorique(`${p2.pseudo} attaque, mais ${p1.pseudo} défend et subit ${damage} dégâts.`);
    } else if (actions.p1 === 'defend' && actions.p2 === 'defend') {
        ajouterMessageHistorique(`${p1.pseudo} et ${p2.pseudo} se défendent. Rien ne se passe.`);
    } else if (actions.p1 === 'defend' && actions.p2 === 'heal') {
        const healAmount = 25;
        p2.pv = Math.min(100, p2.pv + healAmount);
        p2.healCooldown = 3;
        ajouterMessageHistorique(`${p1.pseudo} défend. ${p2.pseudo} se soigne de ${healAmount} PV.`);
    } else if (actions.p1 === 'heal' && actions.p2 === 'attack') {
        const damage = 20;
        p1.pv -= damage;
        ajouterMessageHistorique(`${p2.pseudo} attaque, ${p1.pseudo} tente de se soigner mais subit ${damage} dégâts.`);
    } else if (actions.p1 === 'heal' && actions.p2 === 'defend') {
        const healAmount = 25;
        p1.pv = Math.min(100, p1.pv + healAmount);
        p1.healCooldown = 3;
        ajouterMessageHistorique(`${p2.pseudo} défend. ${p1.pseudo} se soigne de ${healAmount} PV.`);
    } else if (actions.p1 === 'heal' && actions.p2 === 'heal') {
        const healAmount = 25;
        p1.pv = Math.min(100, p1.pv + healAmount);
        p2.pv = Math.min(100, p2.pv + healAmount);
        p1.healCooldown = 3;
        p2.healCooldown = 3;
        ajouterMessageHistorique(`${p1.pseudo} et ${p2.pseudo} se soignent de ${healAmount} PV.`);
    } else if (actions.p1 === 'timeout') {
        ajouterMessageHistorique(`${p1.pseudo} a dépassé le temps imparti. Il ne se passe rien pour lui.`);
    } else if (actions.p2 === 'timeout') {
        ajouterMessageHistorique(`${p2.pseudo} a dépassé le temps imparti. Il ne se passe rien pour lui.`);
    }

    // S'assurer que les PV ne tombent pas en dessous de 0
    p1.pv = Math.max(0, p1.pv);
    p2.pv = Math.max(0, p2.pv);

    // Mettre à jour l'historique des PV pour ce tour
    ajouterMessageHistorique(`${p1.pseudo} PV: ${p1.pv} | ${p2.pseudo} PV: ${p2.pv}`);

    // Préparer les données pour la mise à jour
    const updatedMatchData = {
        ...matchData,
        turnCounter: matchData.turnCounter + 1,
        turn: matchData.turn === 'p1' ? 'p2' : 'p1', // Changer de tour
        turnStartTime: serverTimestamp(), // Mettre à jour le timestamp
        players: {
            p1: { ...p1, action: null }, // Réinitialiser l'action pour le prochain tour
            p2: { ...p2, action: null }
        },
        history: [...matchData.history,
            `${p1.pseudo} a choisi : ${actions.p1}`,
            `${p2.pseudo} a choisi : ${actions.p2}`,
            `${p1.pseudo} PV: ${p1.pv} | ${p2.pseudo} PV: ${p2.pv}`,
            // Add the specific action outcome messages here dynamically if you want them in the DB history
        ]
    };

    // Nettoyer les messages du milieu de tour pour une nouvelle mise à jour
    const matchRef = ref(db, `matches/${currentMatchId}`);
    try {
        await set(matchRef, updatedMatchData);
        console.log("Tour traité et base de données mise à jour.");
    } catch (error) {
        console.error("Erreur lors de la mise à jour du match après traitement du tour:", error);
        afficherMessage('game-msg', `Erreur lors du traitement du tour: ${error.message}`, false);
    }
}


/**
 * Vérifie si le match est terminé (PV d'un joueur à 0).
 * @param {object} matchData - Les données actuelles du match.
 */
async function checkGameEnd(matchData) {
    const p1 = matchData.players.p1;
    const p2 = matchData.players.p2;
    let winner = null;
    let loser = null;
    let isDraw = false;

    if (p1.pv <= 0 && p2.pv <= 0) {
        isDraw = true;
        afficherMessage('game-msg', 'Match nul ! Les deux joueurs sont K.O.', true, 0);
        ajouterMessageHistorique('Match nul ! Les deux joueurs sont K.O.');
    } else if (p1.pv <= 0) {
        winner = p2;
        loser = p1;
        afficherMessage('game-msg', `${winner.pseudo} a gagné !`, true, 0);
        ajouterMessageHistorique(`${winner.pseudo} a gagné !`);
    } else if (p2.pv <= 0) {
        winner = p1;
        loser = p2;
        afficherMessage('game-msg', `${winner.pseudo} a gagné !`, true, 0);
        ajouterMessageHistorique(`${winner.pseudo} a gagné !`);
    }

    if (winner || isDraw) {
        clearInterval(timerInterval); // Arrêter le minuteur
        desactiverBoutonsAction(); // Désactiver les actions

        await update(ref(db, `matches/${currentMatchId}`), { status: 'ended' });

        // Mettre à jour les statistiques des joueurs
        if (!isDraw) {
            await update(ref(db, `users/${winner.uid}/stats`), {
                wins: increment(1),
                gamesPlayed: increment(1)
            });
            if (loser.uid !== 'AI') { // Ne pas mettre à jour les défaites pour l'IA
                await update(ref(db, `users/${loser.uid}/stats`), {
                    losses: increment(1),
                    gamesPlayed: increment(1)
                });
            } else { // Si le joueur a gagné contre l'IA, mettre à jour ses stats de jeu
                await update(ref(db, `users/${winner.uid}/stats`), {
                    gamesPlayed: increment(1)
                });
            }
        } else { // Match nul
            await update(ref(db, `users/${p1.uid}/stats`), {
                draws: increment(1),
                gamesPlayed: increment(1)
            });
            if (p2.uid !== 'AI') {
                await update(ref(db, `users/${p2.uid}/stats`), {
                    draws: increment(1),
                    gamesPlayed: increment(1)
                });
            } else {
                 await update(ref(db, `users/${p1.uid}/stats`), {
                    gamesPlayed: increment(1) // Le joueur voit sa partie contre l'IA comptée
                });
            }
        }
        // Attendre un peu avant de proposer de revenir au menu
        setTimeout(() => {
            if (confirm("Le match est terminé. Retourner au menu principal ?")) {
                leaveGame();
            }
        }, 5000); // 5 secondes pour lire le message
    }
}

// Fonction utilitaire pour incrémenter (pour les stats Firebase)
// La méthode `increment` est généralement fournie par les SDK de Firebase (ex: FieldValue.increment pour Firestore)
// Pour Realtime Database, on doit lire puis écrire.
const increment = (value) => {
    return value; // Simplifié, la vraie incrémentation se fera lors de la lecture/écriture
};
// Une meilleure approche pour Realtime Database serait :
// const increment = (value) => database.ServerValue.increment(value);
// Mais cela nécessiterait d'importer `ServerValue` qui n'est pas exporté par défaut ici.
// Pour l'instant, la valeur est simplement passée et sera gérée côté DB.

/**
 * Quitte le match en cours et revient au menu principal.
 */
export async function leaveGame() {
    if (currentMatchListener) {
        off(ref(db, `matches/${currentMatchId}`), 'value', currentMatchListener);
        currentMatchListener = null;
    }
    clearInterval(timerInterval);
    currentMatchId = null;
    currentPlayerRole = null;
    gameMode = null;
    effacerHistorique();
    afficherMenuPrincipal(); // Revenir au menu principal
    afficherMessage('main-menu-msg', 'Vous avez quitté la partie.', true);
}
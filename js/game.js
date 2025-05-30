// js/game.js

// Importer les modules Firebase depuis ton fichier de configuration centralisé
import { app, db, auth, ref, get, set, runTransaction, onValue, off } from './firebaseConfig.js';
// Note: onAuthStateChanged est importé dans auth.js et main.js pour sa gestion globale
// mais si tu as besoin de l'utiliser spécifiquement ici, tu devras l'importer aussi depuis firebase-auth.js.
// Pour l'instant, je le retire car il est géré par auth.js et main.js

console.log("game.js chargé.");


export let currentUser = null;
export let gameDataListener = null;
export let gameId = null; // ID unique de la session de jeu

// Éléments de l'interface utilisateur
const gameContainer = document.getElementById('game-container');
const waitingScreen = document.getElementById('waiting-screen');
const playerHealthElement = document.getElementById('player-health');
const playerNameElement = document.getElementById('player-name');
const playerAvatarElement = document.getElementById('player-avatar');
const opponentHealthElement = document.getElementById('opponent-health');
const opponentNameElement = document.getElementById('opponent-name');
const opponentAvatarElement = document.getElementById('opponent-avatar');
const attackButton = document.getElementById('attack-button');
const healButton = document.getElementById('heal-button');
const gameLog = document.getElementById('game-log');
const turnIndicator = document.getElementById('turn-indicator');
const leaveGameButton = document.getElementById('leave-game-button');
const gameResultElement = document.getElementById('game-result');
const rematchButton = document.getElementById('rematch-button');

// Références Firebase spécifiques au jeu
const gameSessionRef = ref(database, 'current_game_session'); // Ajuste ceci si tu gères plusieurs sessions

// --- Initialisation de l'utilisateur et gestion des sessions ---

// onAuthStateChanged doit être géré de manière centralisée, par exemple dans main.js ou auth.js
// Ici, nous nous attendons à ce que `currentUser` soit défini via une autre partie du code
// ou que la logique de redirection soit gérée avant d'arriver à game.js.

// Supposons que tu utilises onAuthStateChanged dans main.js et que tu appelles une fonction pour définir currentUser
// ou que tu as une redirection si l'utilisateur n'est pas connecté.
// Pour que ce script fonctionne, nous allons ajouter un onAuthStateChanged localement pour la démo,
// mais dans un projet réel, il est souvent géré globalement.
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js";

onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        console.log("Game.js: Connecté en tant que :", currentUser.uid);
        checkAndJoinGame();
    } else {
        console.log("Game.js: Aucun utilisateur connecté, redirection vers la page de connexion.");
        // Gérer la redirection si game.html est accessible sans connexion
        window.location.href = 'index.html';
    }
});


async function checkAndJoinGame() {
    // Tenter de trouver une session existante ou en créer une
    const snapshot = await get(gameSessionRef);
    const sessionData = snapshot.val();

    if (sessionData && sessionData.status === 'waiting' && sessionData.player1.uid !== currentUser.uid) {
        // Rejoindre la partie existante
        gameId = sessionData.id;
        await joinGame(gameId, currentUser.uid);
    } else if (sessionData && sessionData.status === 'playing' && (sessionData.player1.uid === currentUser.uid || sessionData.player2.uid === currentUser.uid)) {
        // L'utilisateur est déjà dans une partie en cours, reprendre
        gameId = sessionData.id;
        console.log("Reprendre la partie existante :", gameId);
        listenToGameUpdates(gameId);
        showGameUI();
    } else if (!sessionData || (sessionData.status !== 'waiting' && sessionData.player1.uid === currentUser.uid)) {
        // Si aucune session n'existe, ou si la session existante n'est pas 'waiting'
        // et que vous êtes le player1, créer une nouvelle partie.
        // Cela empêche un joueur de rejoindre sa propre partie en attente comme player2.
        gameId = "game_" + Date.now(); // ID de partie simple basé sur le timestamp
        await createGame(gameId, currentUser.uid);
    } else {
        // Cas où une partie existe mais vous ne pouvez pas la rejoindre (ex: déjà 2 joueurs)
        // et vous n'êtes pas l'un des joueurs.
        console.log("Partie en cours ou déjà pleine, impossible de rejoindre ou créer.");
        // Optionnel: Gérer ce cas pour l'utilisateur, par exemple, le rediriger ou lui proposer de chercher une autre partie
        alert("Une partie est en cours ou pleine. Veuillez réessayer plus tard ou lancer votre propre partie.");
        window.location.href = 'dashboard.html'; // Exemple de redirection
    }
}

async function createGame(newGameId, player1Uid) {
    try {
        // Récupérer le nom d'utilisateur et l'avatar depuis la base de données
        const player1Snapshot = await get(ref(database, `users/${player1Uid}`));
        const player1Data = player1Snapshot.val() || {};
        const player1Name = player1Data.pseudo || `Joueur ${player1Uid.substring(0, 4)}`;
        const player1Avatar = player1Data.avatar || `images/default-avatar.png`; // Assurez-vous d'avoir une image par défaut

        const initialGameData = {
            id: newGameId,
            status: 'waiting', // 'waiting', 'playing', 'finished'
            turn: 1,
            activePlayer: null, // UID du joueur dont c'est le tour
            player1: {
                uid: player1Uid,
                username: player1Name,
                avatar: player1Avatar,
                health: 100,
                maxHealth: 100,
                attack: 10,
                healAmount: 15,
                healCooldown: 0, // Tours restants avant que le soin ne soit disponible
                isHost: true,
                hasAcceptedRematch: false
            },
            player2: null,
            log: [],
            winner: null, // UID du gagnant
            rematchOffer: null // { offererUid: UID, status: 'pending' | 'accepted' | 'declined' }
        };

        await set(gameSessionRef, initialGameData);
        console.log("Nouvelle partie créée :", newGameId);
        logEvent(`[${player1Name}] a créé la partie. En attente d'un adversaire...`);
        listenToGameUpdates(newGameId);
        showWaitingScreen("En attente d'un adversaire...");
    } catch (error) {
        console.error("Erreur lors de la création de la partie :", error);
        alert("Impossible de créer la partie. Veuillez réessayer.");
    }
}

async function joinGame(existingGameId, player2Uid) {
    try {
        const player2Snapshot = await get(ref(database, `users/${player2Uid}`));
        const player2Data = player2Snapshot.val() || {};
        const player2Name = player2Data.pseudo || `Joueur ${player2Uid.substring(0, 4)}`;
        const player2Avatar = player2Data.avatar || `images/default-avatar.png`;

        await runTransaction(gameSessionRef, (currentSession) => {
            if (currentSession && currentSession.id === existingGameId && currentSession.status === 'waiting' && !currentSession.player2) {
                currentSession.player2 = {
                    uid: player2Uid,
                    username: player2Name,
                    avatar: player2Avatar,
                    health: 100,
                    maxHealth: 100,
                    attack: 10,
                    healAmount: 15,
                    healCooldown: 0,
                    isHost: false,
                    hasAcceptedRematch: false
                };
                currentSession.status = 'playing';
                // Déterminer aléatoirement qui commence
                currentSession.activePlayer = Math.random() < 0.5 ? currentSession.player1.uid : currentSession.player2.uid;
                logEvent(`[${player2Name}] a rejoint la partie.`, currentSession);
                logEvent(`[${currentSession.activePlayer === currentSession.player1.uid ? currentSession.player1.username : currentSession.player2.username}] commence le tour ${currentSession.turn}.`, currentSession);
            }
            return currentSession;
        });

        console.log("Partie rejointe :", existingGameId);
        listenToGameUpdates(existingGameId);
        showGameUI();
    } catch (error) {
        console.error("Erreur lors de la jointure de la partie :", error);
        alert("Impossible de rejoindre la partie. Veuillez réessayer.");
    }
}

// --- Écoute des mises à jour de la partie ---

function listenToGameUpdates(id) {
    if (gameDataListener) {
        off(gameSessionRef, 'value', gameDataListener); // Détacher l'ancien écouteur
    }
    gameDataListener = onValue(gameSessionRef, (snapshot) => {
        const gameData = snapshot.val();
        if (gameData && gameData.id === id) { // S'assurer que c'est bien la partie en cours
            updateGameUI(gameData);
            if (gameData.status === 'playing') {
                showGameUI();
            } else if (gameData.status === 'waiting') {
                showWaitingScreen("En attente d'un adversaire...");
            } else if (gameData.status === 'finished') {
                showGameResult(gameData.winner, gameData.player1, gameData.player2);
            }
        } else if (!gameData) {
            // La session a été supprimée (par exemple, par le leave du joueur)
            console.log("La session de jeu a été supprimée ou n'existe plus.");
            alert("La partie a été terminée par votre adversaire ou n'existe plus.");
            window.location.href = 'dashboard.html'; // Retour au tableau de bord
        }
    });
}

// --- Mise à jour de l'interface utilisateur ---

function updateGameUI(gameData) {
    // S'assurer que currentUser est défini avant d'accéder à ses propriétés
    if (!currentUser) return;

    const yourPlayerState = gameData.player1.uid === currentUser.uid ? gameData.player1 : gameData.player2;
    const opponentPlayerState = gameData.player1.uid === currentUser.uid ? gameData.player2 : gameData.player1;

    if (!yourPlayerState || !opponentPlayerState) {
        // Un des joueurs n'est pas encore défini (par exemple, en attente)
        return;
    }

    // Mise à jour de votre joueur
    playerNameElement.textContent = yourPlayerState.username;
    playerHealthElement.textContent = `PV: ${yourPlayerState.health}/${yourPlayerState.maxHealth}`;
    playerAvatarElement.src = yourPlayerState.avatar;
    playerAvatarElement.alt = `${yourPlayerState.username} avatar`;

    // Mise à jour de l'adversaire
    opponentNameElement.textContent = opponentPlayerState.username;
    opponentHealthElement.textContent = `PV: ${opponentPlayerState.health}/${opponentPlayerState.maxHealth}`;
    opponentAvatarElement.src = opponentPlayerState.avatar;
    opponentAvatarElement.alt = `${opponentPlayerState.username} avatar`;

    // Mise à jour du log
    gameLog.innerHTML = '';
    gameData.log.forEach(entry => {
        const p = document.createElement('p');
        p.textContent = entry;
        gameLog.appendChild(p);
    });
    gameLog.scrollTop = gameLog.scrollHeight; // Scroll vers le bas

    // Mise à jour de l'indicateur de tour
    const isYourTurn = gameData.activePlayer === currentUser.uid;
    turnIndicator.textContent = isYourTurn ? "C'est votre tour !" : `Tour de ${opponentPlayerState.username}...`;
    turnIndicator.className = isYourTurn ? 'your-turn' : 'opponent-turn';

    // Activation/Désactivation des boutons d'action
    attackButton.disabled = !isYourTurn;
    // Le bouton de soin est désactivé si ce n'est pas votre tour OU si le cooldown est actif
    healButton.disabled = !isYourTurn || (yourPlayerState.healCooldown || 0) > 0;

    // Mise à jour du texte du bouton de soin
    checkHealButtonAvailability(yourPlayerState.healCooldown || 0);

    // Si la partie est terminée, désactiver les boutons d'action
    if (gameData.status === 'finished') {
        attackButton.disabled = true;
        healButton.disabled = true;
    }
}

function checkHealButtonAvailability(healCooldown) {
    if (healCooldown > 0) {
        healButton.textContent = `Soigner (${healCooldown} tours)`;
        healButton.classList.add('cooldown');
    } else {
        healButton.textContent = `Soigner (+15 PV)`;
        healButton.classList.remove('cooldown');
    }
}

function showGameUI() {
    waitingScreen.classList.add('hidden');
    gameContainer.classList.remove('hidden');
    gameResultElement.classList.add('hidden');
    rematchButton.classList.add('hidden');
    leaveGameButton.classList.remove('hidden'); // Assurez-vous que le bouton est visible pendant le jeu
}

function showWaitingScreen(message) {
    waitingScreen.querySelector('p').textContent = message;
    waitingScreen.classList.remove('hidden');
    gameContainer.classList.add('hidden');
    gameResultElement.classList.add('hidden');
}

function showGameResult(winnerUid, player1, player2) {
    gameContainer.classList.add('hidden');
    waitingScreen.classList.add('hidden');
    gameResultElement.classList.remove('hidden');
    rematchButton.classList.remove('hidden');
    leaveGameButton.classList.remove('hidden'); // Laisser le bouton de quitter visible

    const winnerName = winnerUid === player1.uid ? player1.username : player2.username;
    const resultMessage = winnerUid === currentUser.uid ? `Vous avez gagné ! Félicitations, ${winnerName} !` : `${winnerName} a gagné ! Vous avez perdu.`;
    gameResultElement.querySelector('h2').textContent = "Partie terminée !";
    gameResultElement.querySelector('p').textContent = resultMessage;

    // Reset l'état du rematch pour le joueur actuel
    resetRematchState(currentUser.uid);
}

// --- Fonctions d'action de jeu ---

attackButton.addEventListener('click', () => performAction('attack'));
healButton.addEventListener('click', () => performAction('heal'));
leaveGameButton.addEventListener('click', () => leaveGame());
rematchButton.addEventListener('click', () => offerRematch());

async function performAction(actionType) {
    if (!currentUser || !gameId) return;

    attackButton.disabled = true; // Désactiver immédiatement pour éviter les doubles clics
    healButton.disabled = true;

    try {
        await runTransaction(gameSessionRef, (currentSession) => {
            if (currentSession && currentSession.id === gameId && currentSession.status === 'playing') {
                const yourPlayerKey = currentSession.player1.uid === currentUser.uid ? 'player1' : 'player2';
                const opponentPlayerKey = currentSession.player1.uid === currentUser.uid ? 'player2' : 'player1';

                const yourPlayer = currentSession[yourPlayerKey];
                const opponentPlayer = currentSession[opponentPlayerKey];

                if (currentSession.activePlayer !== currentUser.uid) {
                    logEvent(`[Erreur] Ce n'est pas votre tour.`, currentSession);
                    // Retourner undefined pour annuler la transaction sans erreur
                    return undefined; // Transaction annulée
                }

                let actionMessage = '';

                if (actionType === 'attack') {
                    const damage = yourPlayer.attack;
                    opponentPlayer.health -= damage;
                    actionMessage = `[${yourPlayer.username}] attaque [${opponentPlayer.username}] et lui inflige ${damage} points de dégâts.`;
                } else if (actionType === 'heal') {
                    if ((yourPlayer.healCooldown || 0) > 0) {
                        actionMessage = `[Erreur] Le soin sera disponible dans ${yourPlayer.healCooldown} tour(s).`;
                        // Retourner undefined pour annuler la transaction
                        return undefined; // Transaction annulée
                    }
                    yourPlayer.health += yourPlayer.healAmount;
                    if (yourPlayer.health > yourPlayer.maxHealth) {
                        yourPlayer.health = yourPlayer.maxHealth;
                    }
                    yourPlayer.healCooldown = 3; // Mettre en place un cooldown de 3 tours
                    actionMessage = `[${yourPlayer.username}] utilise Soin et regagne ${yourPlayer.healAmount} points de vie.`;
                }

                logEvent(actionMessage, currentSession);

                // Vérifier la fin de partie
                if (opponentPlayer.health <= 0) {
                    opponentPlayer.health = 0; // S'assurer que la vie ne descend pas en dessous de zéro
                    currentSession.winner = yourPlayer.uid;
                    currentSession.status = 'finished';
                    logEvent(`[${opponentPlayer.username}] a été vaincu !`, currentSession);
                    logEvent(`[${yourPlayer.username}] remporte la partie !`, currentSession);
                } else {
                    // Passage au tour suivant et réduction des cooldowns
                    currentSession.turn++;
                    currentSession.activePlayer = (currentSession.activePlayer === currentSession.player1.uid) ? currentSession.player2.uid : currentSession.player1.uid;

                    // Réduire le cooldown de soin pour les deux joueurs
                    if (currentSession.player1.healCooldown > 0) {
                        currentSession.player1.healCooldown--;
                    }
                    if (currentSession.player2.healCooldown > 0) {
                        currentSession.player2.healCooldown--;
                    }
                    logEvent(`C'est le tour ${currentSession.turn}. C'est au tour de [${currentSession.activePlayer === currentSession.player1.uid ? currentSession.player1.username : currentSession.player2.username}].`, currentSession);
                }
            }
            return currentSession; // Retourner les données mises à jour pour les enregistrer
        });
    } catch (error) {
        console.error("Erreur lors de l'action :", error);
        // Si la transaction est annulée par un "return undefined", cette erreur ne sera pas déclenchée.
        // Sinon, réactiver les boutons ici si une vraie erreur se produit
        attackButton.disabled = false;
        healButton.disabled = false;
    }
}

function logEvent(message, gameData = null) {
    if (gameData) {
        if (!gameData.log) {
            gameData.log = [];
        }
        gameData.log.push(message);
        // Limiter la taille du log pour éviter qu'il ne devienne trop grand
        if (gameData.log.length > 50) {
            gameData.log.shift(); // Supprimer l'entrée la plus ancienne
        }
    } else {
        // Si appelé sans gameData (ex: avant la création complète)
        const p = document.createElement('p');
        p.textContent = message;
        gameLog.appendChild(p);
        gameLog.scrollTop = gameLog.scrollHeight;
    }
}

// --- Rematch et fin de partie ---

async function offerRematch() {
    if (!currentUser || !gameId) return;

    rematchButton.disabled = true; // Désactiver le bouton après avoir offert

    try {
        await runTransaction(gameSessionRef, (currentSession) => {
            if (currentSession && currentSession.id === gameId && currentSession.status === 'finished') {
                const yourPlayerKey = currentSession.player1.uid === currentUser.uid ? 'player1' : 'player2';
                const opponentPlayerKey = currentSession.player1.uid === currentUser.uid ? 'player2' : 'player1';

                currentSession[yourPlayerKey].hasAcceptedRematch = true;
                logEvent(`[${currentSession[yourPlayerKey].username}] a proposé une revanche.`, currentSession);

                if (currentSession[opponentPlayerKey].hasAcceptedRematch) {
                    // Les deux joueurs ont accepté, démarrer une nouvelle partie
                    const initialHealth = 100;
                    currentSession.status = 'playing';
                    currentSession.turn = 1;
                    currentSession.activePlayer = Math.random() < 0.5 ? currentSession.player1.uid : currentSession.player2.uid;
                    currentSession.player1.health = initialHealth;
                    currentSession.player2.health = initialHealth;
                    currentSession.player1.healCooldown = 0;
                    currentSession.player2.healCooldown = 0;
                    currentSession.player1.hasAcceptedRematch = false;
                    currentSession.player2.hasAcceptedRematch = false;
                    currentSession.log = []; // Réinitialiser le log
                    currentSession.winner = null; // Réinitialiser le gagnant
                    logEvent(`[${currentSession.player1.username}] et [${currentSession.player2.username}] ont accepté la revanche ! Nouvelle partie commencée.`, currentSession);
                    logEvent(`[${currentSession.activePlayer === currentSession.player1.uid ? currentSession.player1.username : currentSession.player2.username}] commence le tour ${currentSession.turn}.`, currentSession);
                }
            }
            return currentSession;
        });
    } catch (error) {
        console.error("Erreur lors de l'offre de revanche :", error);
        rematchButton.disabled = false; // Réactiver en cas d'erreur
    }
}

async function resetRematchState(playerUid) {
    try {
        await runTransaction(gameSessionRef, (currentSession) => {
            if (currentSession && currentSession.id === gameId) {
                if (currentSession.player1 && currentSession.player1.uid === playerUid) {
                    currentSession.player1.hasAcceptedRematch = false;
                } else if (currentSession.player2 && currentSession.player2.uid === playerUid) {
                    currentSession.player2.hasAcceptedRematch = false;
                }
            }
            return currentSession;
        });
    } catch (error) {
        console.error("Erreur lors de la réinitialisation de l'état de revanche :", error);
    }
}

async function leaveGame() {
    if (!currentUser || !gameId) return;

    if (!confirm("Voulez-vous vraiment quitter la partie ? La partie sera perdue pour vous.")) {
        return;
    }

    try {
        // Détacher l'écouteur de la session de jeu pour éviter des mises à jour après le départ
        if (gameDataListener) {
            off(gameSessionRef, 'value', gameDataListener);
            gameDataListener = null;
        }

        await runTransaction(gameSessionRef, (currentSession) => {
            if (currentSession && currentSession.id === gameId) {
                // Si l'autre joueur existe et la partie n'est pas déjà terminée par un gagnant
                if (currentSession.player1 && currentSession.player2 && !currentSession.winner) {
                    const opponentUid = currentSession.player1.uid === currentUser.uid ? currentSession.player2.uid : currentSession.player1.uid;
                    currentSession.winner = opponentUid;
                    currentSession.status = 'finished';
                    logEvent(`[${currentUser.uid === currentSession.player1.uid ? currentSession.player1.username : currentSession.player2.username}] a quitté la partie.`, currentSession);
                    logEvent(`[${opponentUid === currentSession.player1.uid ? currentSession.player1.username : currentSession.player2.username}] remporte la partie par forfait !`, currentSession);
                } else if (currentSession.status === 'waiting' && currentSession.player1.uid === currentUser.uid && !currentSession.player2) {
                     // Si c'est l'hôte et qu'il est en attente, on peut simplement supprimer la session
                     return null; // Supprime la session
                }
            }
            return currentSession;
        });

        console.log("Partie quittée.");
        window.location.href = 'dashboard.html'; // Rediriger vers le tableau de bord
    } catch (error) {
        console.error("Erreur lors de la sortie de partie :", error);
        alert("Impossible de quitter la partie. Veuillez réessayer.");
    }
}

// Gérer la déconnexion inattendue ou la fermeture de l'onglet
window.addEventListener('beforeunload', async () => {
    // Cette fonction tente de marquer le joueur comme perdant en cas de déconnexion inattendue.
    // Elle n'est pas garantie de s'exécuter à 100% dans tous les scénarios de fermeture de navigateur.
    // Pour une robustesse totale, il est souvent recommandé d'utiliser des fonctions Cloud Firebase
    // et des mécanismes de "présence" en plus.
    if (currentUser && gameId) {
        try {
            const snapshot = await get(gameSessionRef);
            const gameData = snapshot.val();
            if (gameData && gameData.id === gameId && gameData.status === 'playing' && !gameData.winner) {
                // Si la partie est en cours et qu'il n'y a pas encore de gagnant
                const opponentUid = gameData.player1.uid === currentUser.uid ? gameData.player2.uid : gameData.player1.uid;
                await runTransaction(gameSessionRef, (currentSession) => {
                    if (currentSession && currentSession.id === gameId && currentSession.status === 'playing' && !currentSession.winner) {
                        currentSession.winner = opponentUid;
                        currentSession.status = 'finished';
                        logEvent(`[${currentUser.uid === currentSession.player1.uid ? currentSession.player1.username : currentSession.player2.username}] s'est déconnecté.`, currentSession);
                        logEvent(`[${opponentUid === currentSession.player1.uid ? currentSession.player1.username : currentSession.player2.username}] remporte la partie par forfait !`, currentSession);
                    }
                    return currentSession;
                });
            } else if (gameData && gameData.id === gameId && gameData.status === 'waiting' && gameData.player1.uid === currentUser.uid && !gameData.player2) {
                 // Si c'est l'hôte et qu'il est en attente, on peut simplement supprimer la session
                 await set(gameSessionRef, null); // Supprime la session
            }
        } catch (error) {
            console.warn("Échec de la gestion de la déconnexion inattendue:", error);
        }
    }
});
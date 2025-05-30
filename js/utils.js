// js/utils.js

console.log("utils.js chargé.");

// --- Références aux éléments du DOM pour une meilleure performance ---
// Ces constantes sont définies ici car elles sont utilisées par plusieurs fonctions de utils.js
const authSection = document.getElementById('auth');
const mainMenuSection = document.getElementById('main-menu');
const matchmakingStatusSection = document.getElementById('matchmaking-status');
const gameScreenSection = document.getElementById('game-screen');
const leaderboardScreen = document.getElementById('leaderboard-screen');
const howToPlayScreen = document.getElementById('how-to-play-screen');

// Références spécifiques pour les messages et barres de vie
const messageContainer = document.getElementById('message-container'); // Conteneur générique pour les messages
const player1HealthBar = document.getElementById('you-health-bar');
const player2HealthBar = document.getElementById('opponent-health-bar');
const player1PVDisplay = document.getElementById('player1-pv');
const player2PVDisplay = document.getElementById('player2-pv');
const timerDisplay = document.getElementById('timer-display');
const gameHistoryList = document.getElementById('game-history-list');

const attackBtn = document.getElementById('attack-btn');
const defendBtn = document.getElementById('defend-btn');
const healBtn = document.getElementById('heal-btn');
const specialAttackBtn = document.getElementById('special-attack-btn');
const returnToMenuBtnGame = document.getElementById('back-to-menu-btn-game');


// Cache des messages affichés pour pouvoir les supprimer par ID
const activeMessages = {};

/**
 * Affiche un message à l'utilisateur dans un conteneur spécifique.
 * Gère la suppression des messages précédents pour le même ID.
 * @param {string} messageId - Un ID unique pour ce type de message (ex: 'auth-msg-email', 'global-message').
 * @param {string} text - Le texte du message à afficher.
 * @param {boolean} isSuccess - Vrai pour un message de succès (vert), Faux pour une erreur (rouge).
 * @param {number} duration - Durée d'affichage du message en ms. 0 pour un message persistant.
 */
export function showMessage(messageId, text, isSuccess = false, duration = 5000) {
    let targetElement = document.getElementById(messageId);

    // Si le targetElement n'existe pas, on cherche un conteneur générique
    if (!targetElement && messageContainer) {
        // Crée un conteneur spécifique si on n'en trouve pas, pour y attacher le message
        targetElement = document.createElement('div');
        targetElement.id = messageId;
        messageContainer.appendChild(targetElement);
    } else if (!targetElement) {
        console.warn(`showMessage: Element with ID '${messageId}' not found and no generic message-container. Message not displayed.`);
        return;
    }

    // Supprime le message précédent s'il existe
    if (activeMessages[messageId]) {
        clearTimeout(activeMessages[messageId].timeout);
        // Supprime l'élément s'il a été créé dynamiquement ou si c'est un message temporaire
        if (activeMessages[messageId].element && activeMessages[messageId].element.parentNode) {
            activeMessages[messageId].element.remove();
        }
        delete activeMessages[messageId];
    }

    // Crée le nouvel élément de message
    const messageElement = document.createElement('p');
    messageElement.textContent = text;
    messageElement.className = isSuccess ? 'message-success' : 'message-error';
    targetElement.appendChild(messageElement);

    if (duration > 0) {
        const timeout = setTimeout(() => {
            if (messageElement.parentNode) {
                messageElement.remove();
            }
            delete activeMessages[messageId];
        }, duration);
        activeMessages[messageId] = { element: messageElement, timeout: timeout };
    } else {
        // Stocke le message sans timeout s'il est persistant
        activeMessages[messageId] = { element: messageElement, timeout: null };
    }
}


/**
 * Met à jour la barre de vie et l'affichage des PV.
 * @param {string} barId - L'ID de la barre de vie ('you-health-bar' ou 'opponent-health-bar').
 * @param {number} percentage - Le pourcentage de vie (0-100).
 */
export function updateHealthBar(barId, percentage) {
    const healthBar = document.getElementById(barId);
    if (healthBar) {
        const clampedPercentage = Math.max(0, Math.min(100, percentage));
        healthBar.style.width = `${clampedPercentage}%`;
        healthBar.style.backgroundColor = `hsl(${clampedPercentage * 1.2}, 70%, 50%)`; // Vert à Rouge
    }

    // Met à jour l'affichage numérique des PV
    if (barId === 'you-health-bar' && player1PVDisplay) {
        player1PVDisplay.textContent = `${percentage} PV`;
    } else if (barId === 'opponent-health-bar' && player2PVDisplay) {
        player2PVDisplay.textContent = `${percentage} PV`;
    }
}

/**
 * Met à jour l'interface utilisateur du minuteur.
 * @param {number} timeLeft - Le temps restant en secondes.
 * @param {number} totalTime - Le temps total du tour en secondes pour le calcul de la couleur.
 */
export function updateTimerUI(timeLeft, totalTime) {
    if (timerDisplay) {
        timerDisplay.textContent = `Temps restant: ${timeLeft}s`;
        const percentage = (timeLeft / totalTime) * 100;

        if (percentage <= 20) {
            timerDisplay.style.color = 'red';
        } else if (percentage <= 50) {
            timerDisplay.style.color = 'orange';
        } else {
            timerDisplay.style.color = '#ecf0f1'; // Couleur par défaut (blanc/gris clair)
        }
    }
}

/**
 * Ajoute un message à l'historique du match.
 * @param {string} message - Le message à ajouter.
 */
export function addHistoryMessage(message) {
    if (gameHistoryList) {
        const listItem = document.createElement('li');
        listItem.textContent = message;
        gameHistoryList.prepend(listItem); // Ajoute au début pour voir les derniers messages en premier
        // Limite l'historique pour ne pas surcharger le DOM
        while (gameHistoryList.children.length > 20) {
            gameHistoryList.lastChild.remove();
        }
    }
}

/**
 * Efface tout l'historique du match.
 */
export function clearHistory() {
    if (gameHistoryList) {
        gameHistoryList.innerHTML = '';
    }
}

/**
 * Désactive tous les boutons d'action du joueur.
 */
export function disableActionButtons() {
    if (attackBtn) attackBtn.disabled = true;
    if (defendBtn) defendBtn.disabled = true;
    if (healBtn) healBtn.disabled = true;
    if (specialAttackBtn) specialAttackBtn.disabled = true;
}

/**
 * Active tous les boutons d'action du joueur.
 */
export function enableActionButtons() {
    if (attackBtn) attackBtn.disabled = false;
    if (defendBtn) defendBtn.disabled = false;
    if (healBtn) healBtn.disabled = false;
    if (specialAttackBtn) specialAttackBtn.disabled = false;
}

// --- Fonctions de gestion des écrans ---

/**
 * Cache tous les écrans.
 */
function hideAllScreens() {
    if (authSection) authSection.style.display = 'none';
    if (mainMenuSection) mainMenuSection.style.display = 'none';
    if (matchmakingStatusSection) matchmakingStatusSection.style.display = 'none';
    if (gameScreenSection) gameScreenSection.style.display = 'none';
    if (leaderboardScreen) leaderboardScreen.style.display = 'none';
    if (howToPlayScreen) howToPlayScreen.style.display = 'none';
}

/**
 * Affiche l'écran d'authentification et cache les autres.
 */
export function showAuthScreen() {
    hideAllScreens();
    if (authSection) authSection.style.display = 'block';
    // Potential place to trigger reCAPTCHA initialization if needed,
    // but auth.js already handles this based on element presence.
    // If initializeRecaptcha was exported from auth.js, you could call it here:
    // if (typeof initializeRecaptcha === 'function') { initializeRecaptcha(); }
}

/**
 * Affiche l'écran du menu principal et cache les autres.
 */
export function showMainMenu() {
    hideAllScreens();
    if (mainMenuSection) mainMenuSection.style.display = 'block';
}

/**
 * Affiche l'écran de matchmaking et cache les autres.
 */
export function showMatchmakingScreen() {
    hideAllScreens();
    if (matchmakingStatusSection) matchmakingStatusSection.style.display = 'block';
}

/**
 * Affiche l'écran de jeu et cache les autres.
 */
export function showGameScreen() {
    hideAllScreens();
    if (gameScreenSection) gameScreenSection.style.display = 'block';
    if (returnToMenuBtnGame) {
        returnToMenuBtnGame.style.display = 'block'; // S'assurer que le bouton est visible en jeu
    }
}

/**
 * Affiche l'écran du classement et cache les autres.
 */
export function showLeaderboardScreen() {
    hideAllScreens();
    if (leaderboardScreen) leaderboardScreen.style.display = 'block';
}

/**
 * Affiche l'écran "Comment Jouer" et cache les autres.
 */
export function showHowToPlayScreen() {
    hideAllScreens();
    if (howToPlayScreen) howToPlayScreen.style.display = 'block';
}

// Note: Le bouton de retour au menu depuis l'écran de jeu est géré dans main.js
// via `backToMenu` qui appelle `returnToMainMenu` de game.js et enfin `showMainMenu` d'ici.
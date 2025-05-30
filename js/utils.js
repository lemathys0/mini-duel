// js/utils.js

console.log("utils.js chargé.");

// --- Références aux éléments du DOM pour une meilleure performance ---
const authSection = document.getElementById('auth');
const mainMenuSection = document.getElementById('main-menu');
const matchmakingStatusSection = document.getElementById('matchmaking-status');
const gameScreenSection = document.getElementById('game-screen');
const leaderboardScreen = document.getElementById('leaderboard-screen');
const howToPlayScreen = document.getElementById('how-to-play-screen');

// Références spécifiques pour les messages et barres de vie
const player1PVDisplay = document.getElementById('player1-pv');
const player2PVDisplay = document.getElementById('player2-pv');
const timerDisplay = document.getElementById('timer-display');
const gameHistoryList = document.getElementById('history'); // L'ID du HTML est 'history'
const timerProgressBar = document.getElementById('timer-progress-bar');

const attackBtn = document.getElementById('action-attack');
const defendBtn = document.getElementById('action-defend');
const healBtn = document.getElementById('action-heal');
const specialAttackBtn = document.getElementById('special-attack-btn'); // Gardez si vous l'avez dans votre HTML
const returnToMenuBtnGame = document.getElementById('back-to-menu-btn-game');

// Cache des messages affichés pour pouvoir les supprimer par ID
const activeMessages = {};

/**
 * Affiche un message à l'utilisateur dans un élément ciblé.
 * @param {string} messageId - L'ID de l'élément où afficher le message (ex: 'action-msg', 'auth-msg-email').
 * @param {string} text - Le texte du message à afficher.
 * @param {boolean} isSuccess - Vrai pour un message de succès (vert), Faux pour une erreur (rouge).
 * @param {number} duration - Durée d'affichage du message en ms. 0 pour un message persistant.
 */
export function afficherMessage(messageId, text, isSuccess = false, duration = 5000) {
    let targetElement = document.getElementById(messageId);

    if (!targetElement) {
        console.warn(`afficherMessage: L'élément avec l'ID '${messageId}' n'a pas été trouvé. Le message ne sera pas affiché.`);
        return;
    }

    targetElement.innerHTML = ''; // Efface le contenu précédent
    targetElement.textContent = text;
    targetElement.className = isSuccess ? 'message success' : 'message error';
    targetElement.style.display = 'block';

    if (duration > 0) {
        if (activeMessages[messageId]) {
            clearTimeout(activeMessages[messageId]);
        }
        activeMessages[messageId] = setTimeout(() => {
            if (targetElement) {
                targetElement.textContent = '';
                targetElement.style.display = 'none';
            }
            delete activeMessages[messageId];
        }, duration);
    } else {
        if (activeMessages[messageId]) {
            clearTimeout(activeMessages[messageId]);
            delete activeMessages[messageId];
        }
    }
}

/**
 * Met à jour la barre de vie et l'affichage des PV.
 * @param {string} barId - L'ID de la barre de vie ('you-health-bar' ou 'opponent-health-bar').
 * @param {number} currentPv - Le nombre de points de vie actuels.
 */
export function mettreAJourBarreDeVie(barId, currentPv) {
    const healthBar = document.getElementById(barId);
    if (healthBar) {
        const percentage = Math.max(0, Math.min(100, currentPv));
        healthBar.style.width = `${percentage}%`;
        if (percentage > 50) {
            healthBar.style.backgroundColor = '#2ecc71';
        } else if (percentage > 20) {
            healthBar.style.backgroundColor = '#f39c12';
        } else {
            healthBar.style.backgroundColor = '#e74c3c';
        }
    }

    if (barId === 'you-health-bar' && player1PVDisplay) {
        player1PVDisplay.textContent = `${currentPv} PV`;
    } else if (barId === 'opponent-health-bar' && player2PVDisplay) {
        player2PVDisplay.textContent = `${currentPv} PV`;
    }
}

/**
 * Met à jour l'interface utilisateur du minuteur.
 * @param {number} timeLeftSeconds - Le temps restant en secondes.
 * @param {number} totalTimeSeconds - Le temps total du tour en secondes pour le calcul de la barre de progression.
 */
export function mettreAJourMinuteurUI(timeLeftSeconds, totalTimeSeconds) {
    if (timerDisplay) {
        timerDisplay.textContent = `${timeLeftSeconds}s`;
        const percentage = (timeLeftSeconds / totalTimeSeconds) * 100;
        if (timerProgressBar) {
            timerProgressBar.style.width = `${percentage}%`;
            if (percentage > 50) {
                timerProgressBar.style.backgroundColor = '#2ecc71';
            } else if (percentage > 20) {
                timerProgressBar.style.backgroundColor = '#f39c12';
            } else {
                timerProgressBar.style.backgroundColor = '#e74c3c';
            }
        }
    }
}

/**
 * Ajoute un message à l'historique du match.
 * @param {string} message - Le message à ajouter.
 */
export function ajouterMessageHistorique(message) {
    if (gameHistoryList) {
        const listItem = document.createElement('p');
        listItem.textContent = message;
        gameHistoryList.appendChild(listItem);
        gameHistoryList.scrollTop = gameHistoryList.scrollHeight;
    }
}

/**
 * Efface tout l'historique du match.
 */
export function effacerHistorique() {
    if (gameHistoryList) {
        gameHistoryList.innerHTML = '';
    }
}

/**
 * Désactive tous les boutons d'action du joueur.
 */
export function desactiverBoutonsAction() {
    if (attackBtn) attackBtn.disabled = true;
    if (defendBtn) defendBtn.disabled = true;
    if (healBtn) healBtn.disabled = true;
    if (specialAttackBtn) specialAttackBtn.disabled = true; // Si présent
}

/**
 * Active tous les boutons d'action du joueur.
 */
export function activerBoutonsAction() {
    if (attackBtn) attackBtn.disabled = false;
    if (defendBtn) defendBtn.disabled = false;
    if (healBtn) healBtn.disabled = false;
    if (specialAttackBtn) specialAttackBtn.disabled = false; // Si présent
}

// --- Fonctions de gestion des écrans ---

/**
 * Cache tous les écrans.
 */
function masquerTousLesEcrans() {
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
export function afficherEcranAuth() {
    masquerTousLesEcrans();
    if (authSection) authSection.style.display = 'block';
}

/**
 * Affiche l'écran du menu principal et cache les autres.
 */
export function afficherMenuPrincipal() {
    masquerTousLesEcrans();
    if (mainMenuSection) mainMenuSection.style.display = 'block';
}

/**
 * Affiche l'écran de matchmaking et cache les autres.
 */
export function afficherEcranMatchmaking() {
    masquerTousLesEcrans();
    if (matchmakingStatusSection) matchmakingStatusSection.style.display = 'block';
}

/**
 * Affiche l'écran de jeu et cache les autres.
 */
export function afficherEcranJeu() {
    masquerTousLesEcrans();
    if (gameScreenSection) gameScreenSection.style.display = 'block';
    if (returnToMenuBtnGame) {
        returnToMenuBtnGame.style.display = 'block';
    }
}

/**
 * Affiche l'écran du classement et cache les autres.
 */
export function afficherEcranClassement() {
    masquerTousLesEcrans();
    if (leaderboardScreen) leaderboardScreen.style.display = 'block';
}

/**
 * Affiche l'écran "Comment Jouer" et cache les autres.
 */
export function afficherEcranCommentJouer() {
    masquerTousLesEcrans();
    if (howToPlayScreen) howToPlayScreen.style.display = 'block';
}
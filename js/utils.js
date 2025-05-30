// js/utils.js

console.log("utils.js chargé.");

// --- Références aux éléments du DOM pour une meilleure performance ---
// Ces constantes sont définies ici car elles sont utilisées par plusieurs fonctions de utils.js
const authSection = document.getElementById('auth');
const mainMenuSection = document.getElementById('main-menu');
const matchmakingStatusSection = document.getElementById('matchmaking-status');
const gameScreenSection = document.getElementById('game-screen');
const leaderboardScreen = document.getElementById('leaderboard-screen'); // Si vous l'ajoutez plus tard
const howToPlayScreen = document.getElementById('how-to-play-screen');

// Références spécifiques pour les messages et barres de vie
const messageContainer = document.getElementById('message-container'); // Conteneur générique pour les messages
// Note: player1HealthBar et player2HealthBar ne sont plus utilisées directement ici
// car updateHealthBar prend l'ID en paramètre.
const player1PVDisplay = document.getElementById('player1-pv');
const player2PVDisplay = document.getElementById('player2-pv');
const timerDisplay = document.getElementById('timer-display');
const gameHistoryList = document.getElementById('history'); // L'ID du HTML est 'history'
const timerProgressBar = document.getElementById('timer-progress-bar'); // Ajouté pour la barre de progression

const attackBtn = document.getElementById('action-attack'); // IDs réels de vos boutons
const defendBtn = document.getElementById('action-defend');
const healBtn = document.getElementById('action-heal');
// const specialAttackBtn = document.getElementById('special-attack-btn'); // Si vous avez un bouton d'attaque spéciale
const returnToMenuBtnGame = document.getElementById('back-to-menu-btn-game');


// Cache des messages affichés pour pouvoir les supprimer par ID
const activeMessages = {};

/**
 * Affiche un message à l'utilisateur dans un conteneur spécifique ou un élément ciblé.
 * Gère la suppression des messages précédents pour le même ID.
 * @param {string} messageId - Un ID unique pour ce type de message (ex: 'auth-msg-email', 'action-msg').
 * @param {string} text - Le texte du message à afficher.
 * @param {boolean} isSuccess - Vrai pour un message de succès (vert), Faux pour une erreur (rouge).
 * @param {number} duration - Durée d'affichage du message en ms. 0 pour un message persistant.
 */
export function afficherMessage(messageId, text, isSuccess = false, duration = 5000) {
    let targetElement = document.getElementById(messageId);

    // Si le targetElement n'existe pas, on cherche un conteneur générique ou on le crée dynamiquement.
    // Cette logique dépend de comment vous voulez gérer les messages.
    // Pour l'instant, on assume que messageId pointe vers un élément existant comme 'action-msg'.
    if (!targetElement) {
        console.warn(`afficherMessage: L'élément avec l'ID '${messageId}' n'a pas été trouvé. Le message ne sera pas affiché.`);
        return;
    }

    // Efface le contenu de l'élément cible pour le nouveau message
    targetElement.innerHTML = '';
    targetElement.textContent = text;
    targetElement.className = isSuccess ? 'message success' : 'message error'; // Assurez-vous d'avoir ces classes CSS
    targetElement.style.display = 'block';

    // Si une durée est spécifiée, masquer le message après cette durée
    if (duration > 0) {
        // Efface le timeout précédent pour cet ID si un nouveau message arrive avant la fin du précédent
        if (activeMessages[messageId]) {
            clearTimeout(activeMessages[messageId]);
        }
        activeMessages[messageId] = setTimeout(() => {
            if (targetElement) {
                targetElement.textContent = ''; // Effacer le texte
                targetElement.style.display = 'none'; // Masquer l'élément
            }
            delete activeMessages[messageId];
        }, duration);
    } else {
        // Pour les messages persistants, s'assurer qu'il n'y a pas de timeout actif
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
        const percentage = Math.max(0, Math.min(100, currentPv)); // S'assurer que le pourcentage est entre 0 et 100
        healthBar.style.width = `${percentage}%`;
        // Changer la couleur en fonction du pourcentage
        if (percentage > 50) {
            healthBar.style.backgroundColor = '#2ecc71'; // Vert
        } else if (percentage > 20) {
            healthBar.style.backgroundColor = '#f39c12'; // Orange
        } else {
            healthBar.style.backgroundColor = '#e74c3c'; // Rouge
        }
    }

    // Met à jour l'affichage numérique des PV
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
        timerDisplay.textContent = `${timeLeftSeconds}s`; // Affiche le temps restant en secondes
        const percentage = (timeLeftSeconds / totalTimeSeconds) * 100;
        if (timerProgressBar) {
            timerProgressBar.style.width = `${percentage}%`;
            if (percentage > 50) {
                timerProgressBar.style.backgroundColor = '#2ecc71'; // Vert
            } else if (percentage > 20) {
                timerProgressBar.style.backgroundColor = '#f39c12'; // Orange
            } else {
                timerProgressBar.style.backgroundColor = '#e74c3c'; // Rouge
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
        const listItem = document.createElement('p'); // Utiliser un paragraphe pour un affichage plus simple
        listItem.textContent = message;
        gameHistoryList.appendChild(listItem); // Ajoute à la fin pour un ordre chronologique
        gameHistoryList.scrollTop = gameHistoryList.scrollHeight; // Scroll vers le bas
        // Optionnel: Limiter l'historique pour ne pas surcharger le DOM
        // while (gameHistoryList.children.length > 30) { // Exemple: Garder les 30 derniers messages
        //     gameHistoryList.firstChild.remove();
        // }
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
    // if (specialAttackBtn) specialAttackBtn.disabled = true;
}

/**
 * Active tous les boutons d'action du joueur.
 */
export function activerBoutonsAction() {
    if (attackBtn) attackBtn.disabled = false;
    if (defendBtn) defendBtn.disabled = false;
    if (healBtn) healBtn.disabled = false;
    // if (specialAttackBtn) specialAttackBtn.disabled = false;
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
        returnToMenuBtnGame.style.display = 'block'; // S'assurer que le bouton est visible en jeu
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
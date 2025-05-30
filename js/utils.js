// js/utils.js

console.log("utils.js chargé.");

/**
 * Affiche un message dans une balise spécifiée.
 * @param {string} elementId L'ID de l'élément HTML où afficher le message.
 * @param {string} message Le message à afficher.
 * @param {boolean} isSuccess Si vrai, ajoute une classe 'success', sinon 'error'.
 * @param {boolean} appendToHistory Si vrai, le message est ajouté à l'historique et ne disparaît pas.
 */
export function showMessage(elementId, message, isSuccess = true, appendToHistory = false) {
    const element = document.getElementById(elementId);
    if (element) {
        if (appendToHistory) {
            // Pour l'historique, nous créons un nouveau paragraphe et l'ajoutons
            const p = document.createElement('p');
            p.textContent = message;
            // Ajoute la classe basée sur isSuccess pour la coloration des messages d'historique
            p.classList.add(isSuccess ? 'history-success' : 'history-error');
            element.prepend(p); // Ajoute au début pour avoir le plus récent en haut

            // Optionnel: limiter le nombre de messages pour éviter un défilement trop long
            while (element.children.length > 10) { // Par exemple, garder les 10 derniers messages
                element.removeChild(element.lastChild);
            }
        } else {
            // Pour les messages standards (non historiques)
            element.textContent = message;
            element.className = isSuccess ? 'message success' : 'message error';
            // Supprime le message après 5 secondes si ce n'est pas un message persistant (comme action-msg pendant le tour)
            if (elementId !== 'action-msg' && elementId !== 'matchmaking-message') { // matchmaking-message peut aussi être persistant
                setTimeout(() => {
                    element.textContent = '';
                    element.className = 'message';
                }, 5000);
            }
        }
    } else {
        console.warn(`Element with ID '${elementId}' not found for message display.`);
    }
}

/**
 * Active les boutons d'action.
 */
export function enableActionButtons() {
    // Correction des ID des boutons pour correspondre à game.js et au HTML supposé
    const attackButton = document.getElementById('attack-btn');
    const healButton = document.getElementById('heal-btn'); // Le soin est géré par game.js, mais on l'active par défaut ici.

    if (attackButton) attackButton.disabled = false;
    if (healButton) healButton.disabled = false;
    // Supposons qu'il n'y ait pas de bouton "défendre" distinct dans ton HTML,
    // ou qu'il soit géré différemment. Si tu as un tel bouton, ajoute son ID ici.
    // Par exemple: document.getElementById('defend-btn').disabled = false;
}

/**
 * Désactive tous les boutons d'action.
 */
export function disableActionButtons() {
    // Correction des ID des boutons pour correspondre à game.js et au HTML supposé
    const attackButton = document.getElementById('attack-btn');
    const healButton = document.getElementById('heal-btn');

    if (attackButton) attackButton.disabled = true;
    if (healButton) healButton.disabled = true;
    // Si tu as un bouton "défendre":
    // const defendButton = document.getElementById('defend-btn');
    // if (defendButton) defendButton.disabled = true;
}

/**
 * Met à jour la barre de vie et l'affichage des PV.
 * @param {string} barId L'ID de la barre de vie (e.g., 'player1-health-bar', 'player2-health-bar').
 * @param {number} currentPv Les PV actuels.
 */
export function updateHealthBar(barId, currentPv) {
    const healthBar = document.getElementById(barId);
    if (healthBar) {
        const percentage = Math.max(0, Math.min(100, currentPv)); // Assure que le % est entre 0 et 100
        healthBar.style.width = `${percentage}%`;
        // Retire le texte direct de la barre si ton HTML affiche les PV à côté (player1-pv, player2-pv)
        // healthBar.textContent = `${percentage} PV`;
        healthBar.style.backgroundColor = getHealthColor(percentage);
    }
}

/**
 * Détermine la couleur de la barre de vie en fonction du pourcentage.
 * @param {number} percentage Le pourcentage de PV.
 * @returns {string} La couleur CSS.
 */
function getHealthColor(percentage) {
    if (percentage > 70) {
        return '#2ecc71'; // Vert
    } else if (percentage > 30) {
        return '#f39c12'; // Orange
    } else {
        return '#e74c3c'; // Rouge
    }
}

// Variable pour stocker l'ID du timer
let timerIntervalId = null;

/**
 * Met à jour l'affichage du timer.
 * @param {number} totalTime Le temps total du tour en secondes (ex: 30).
 * @param {number} turnStartTime Le timestamp de début du tour (du serveur ou Date.now()).
 */
export function updateTimerUI(totalTime, turnStartTime) {
    const timerDisplay = document.getElementById('timer-display');
    if (!timerDisplay) return;

    // Arrête tout timer précédent pour éviter les chevauchements
    if (timerIntervalId) {
        clearInterval(timerIntervalId);
    }

    const calculateTimeLeft = () => {
        const elapsedTime = (Date.now() - turnStartTime) / 1000; // Temps écoulé en secondes
        let timeLeft = totalTime - elapsedTime;

        if (timeLeft <= 0) {
            timeLeft = 0;
            clearInterval(timerIntervalId); // Arrête le timer
            timerDisplay.textContent = `Temps écoulé !`;
            timerDisplay.style.color = 'red';
            timerDisplay.style.fontWeight = 'bold';
            // Potentiellement déclencher une action de fin de tour ici si nécessaire,
            // mais c'est généralement géré par la logique du jeu côté Firebase/backend
            return;
        }

        timerDisplay.textContent = `Temps restant: ${Math.floor(timeLeft)}s`;
        if (timeLeft <= 5) {
            timerDisplay.style.color = 'red';
            timerDisplay.style.fontWeight = 'bold';
        } else {
            timerDisplay.style.color = '#ecf0f1'; // Couleur par défaut
            timerDisplay.style.fontWeight = 'normal';
        }
    };

    // Appelle la fonction une fois immédiatement, puis à chaque seconde
    calculateTimeLeft();
    timerIntervalId = setInterval(calculateTimeLeft, 1000);
}


/**
 * Efface l'historique du jeu.
 */
export function clearHistory() {
    const gameHistoryDiv = document.getElementById('game-history'); // Correction de l'ID ici
    if (gameHistoryDiv) {
        gameHistoryDiv.innerHTML = '';
    }
}

/**
 * Fonctions pour afficher/cacher les écrans en utilisant la classe 'hidden'.
 * Assurez-vous que tous les éléments 'section' ont l'ID correspondant et
 * la classe 'hidden' par défaut dans ton CSS pour un bon fonctionnement.
 *
 * Exemple CSS:
 * .hidden { display: none; }
 */
function hideAllScreens() {
    const screens = [
        document.getElementById('auth'),
        document.getElementById('main-menu'),
        document.getElementById('matchmaking-status'),
        document.getElementById('game-screen'),
        document.getElementById('leaderboard-screen'), // Ajout de l'écran de classement
        document.getElementById('how-to-play-screen') // Ajout de l'écran "Comment jouer"
    ];
    screens.forEach(screen => {
        if (screen) screen.classList.add('hidden');
    });
}

export function showAuthScreen() {
    hideAllScreens();
    const authScreen = document.getElementById('auth');
    if (authScreen) authScreen.classList.remove('hidden');
}

export function showMainMenu() {
    hideAllScreens();
    const mainMenu = document.getElementById('main-menu');
    if (mainMenu) mainMenu.classList.remove('hidden');
}

export function showMatchmakingScreen() {
    hideAllScreens();
    const matchmakingScreen = document.getElementById('matchmaking-status');
    if (matchmakingScreen) matchmakingScreen.classList.remove('hidden');
}

export function showGameScreen() {
    hideAllScreens();
    const gameScreen = document.getElementById('game-screen');
    if (gameScreen) gameScreen.classList.remove('hidden');
    clearHistory(); // Nettoie l'historique à chaque début de partie
}

export function showLeaderboardScreen() {
    hideAllScreens();
    const leaderboardScreen = document.getElementById('leaderboard-screen');
    if (leaderboardScreen) leaderboardScreen.classList.remove('hidden');
}

export function showHowToPlayScreen() {
    hideAllScreens();
    const howToPlayScreen = document.getElementById('how-to-play-screen');
    if (howToPlayScreen) howToPlayScreen.classList.remove('hidden');
}
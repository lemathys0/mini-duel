// js/utils.js

/**
 * Affiche un message dans une balise spécifiée.
 * @param {string} elementId L'ID de l'élément HTML où afficher le message.
 * @param {string} message Le message à afficher.
 * @param {boolean} isSuccess Si vrai, ajoute une classe 'success', sinon 'error'.
 */
export function showMessage(elementId, message, isSuccess = true) {
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = message;
        element.className = isSuccess ? 'message success' : 'message error';
        // Supprime le message après 5 secondes si ce n'est pas un message persistant (comme action-msg pendant le tour)
        if (elementId !== 'action-msg') {
            setTimeout(() => {
                element.textContent = '';
                element.className = 'message';
            }, 5000);
        }
    } else {
        console.warn(`Element with ID '${elementId}' not found for message display.`);
    }
}

/**
 * Active les boutons d'action.
 */
export function enableActionButtons() {
    document.getElementById('action-attack').disabled = false;
    document.getElementById('action-defend').disabled = false;
    // Le bouton de soin est géré par checkHealButtonAvailability() dans game.js
    // document.getElementById('action-heal').disabled = false;
    // Appeler la fonction spécifique pour le soin après avoir enabled les autres
    // Cela sera géré par le onValue dans game.js après la mise à jour des données du match.
}

/**
 * Désactive tous les boutons d'action.
 */
export function disableActionButtons() {
    document.getElementById('action-attack').disabled = true;
    document.getElementById('action-defend').disabled = true;
    document.getElementById('action-heal').disabled = true;
}

/**
 * Met à jour la barre de vie et l'affichage des PV.
 * @param {string} barId L'ID de la barre de vie (e.g., 'you-health-bar', 'opponent-health-bar').
 * @param {number} currentPv Les PV actuels.
 */
export function updateHealthBar(barId, currentPv) {
    const healthBar = document.getElementById(barId);
    if (healthBar) {
        const percentage = Math.max(0, Math.min(100, currentPv)); // Assure que le % est entre 0 et 100
        healthBar.style.width = `${percentage}%`;
        healthBar.textContent = `${percentage} PV`; // Affiche le % sur la barre si désiré, ou juste les PV
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

/**
 * Met à jour l'affichage du timer.
 * @param {number} timeLeft Le temps restant en secondes.
 * @param {number} totalTime Le temps total du tour en secondes.
 */
export function updateTimerUI(timeLeft, totalTime) {
    const timerDisplay = document.getElementById('timer-display');
    if (timerDisplay) {
        timerDisplay.textContent = `Temps restant: ${Math.floor(timeLeft)}s`;
        // Optionnel: changer la couleur ou la taille du texte du timer
        if (timeLeft <= 5) {
            timerDisplay.style.color = 'red';
            timerDisplay.style.fontWeight = 'bold';
        } else {
            timerDisplay.style.color = '#ecf0f1';
            timerDisplay.style.fontWeight = 'normal';
        }
    }
}

/**
 * Efface l'historique du jeu.
 */
export function clearHistory() {
    const historyDiv = document.getElementById('history');
    if (historyDiv) {
        historyDiv.innerHTML = '';
    }
}

/**
 * Ajoute un message à l'historique du match.
 * @param {string} message Le message à ajouter.
 */
export function appendToHistory(message) {
    const gameHistoryDiv = document.getElementById('history');
    if (gameHistoryDiv) {
        const p = document.createElement('p');
        p.textContent = message;
        gameHistoryDiv.prepend(p); // Ajoute au début pour avoir le plus récent en haut
        // Optionnel: limiter le nombre de messages pour éviter un défilement trop long
        while (gameHistoryDiv.children.length > 10) {
            gameHistoryDiv.removeChild(gameHistoryDiv.lastChild);
        }
    }
}

// Fonctions pour afficher/cacher les écrans
export function showAuthScreen() {
    document.getElementById('auth').style.display = 'flex';
    document.getElementById('main-menu').style.display = 'none';
    document.getElementById('matchmaking-status').style.display = 'none';
    document.getElementById('game-screen').style.display = 'none';
}

export function showMainMenu() {
    document.getElementById('auth').style.display = 'none';
    document.getElementById('main-menu').style.display = 'block';
    document.getElementById('matchmaking-status').style.display = 'none';
    document.getElementById('game-screen').style.display = 'none';
}

export function showMatchmakingScreen() {
    document.getElementById('auth').style.display = 'none';
    document.getElementById('main-menu').style.display = 'none';
    document.getElementById('matchmaking-status').style.display = 'block';
    document.getElementById('game-screen').style.display = 'none';
}

export function showGameScreen() {
    document.getElementById('auth').style.display = 'none';
    document.getElementById('main-menu').style.display = 'none';
    document.getElementById('matchmaking-status').style.display = 'none';
    document.getElementById('game-screen').style.display = 'block';
    clearHistory(); // Nettoie l'historique à chaque début de partie
}
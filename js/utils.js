// js/utils.js

/**
 * Affiche un message dans un élément HTML spécifié.
 * @param {string} elementId - L'ID de l'élément HTML où afficher le message.
 * @param {string} message - Le message à afficher.
 * @param {boolean} isSuccess - Si le message est un succès (vert) ou une erreur (rouge).
 */
export function showMessage(elementId, message, isSuccess = false) {
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = message;
        element.style.color = isSuccess ? '#00ff88' : '#ff4d6d'; // Vert pour succès, rouge pour erreur
        // Ajout/suppression de classes pour les nouveaux styles CSS de #auth-msg
        if (elementId === 'auth-msg') {
            element.classList.remove('success', 'error'); // Nettoie les anciennes classes
            if (isSuccess) {
                element.classList.add('success');
            } else {
                element.classList.add('error');
            }
        }
    } else {
        console.warn(`Element with ID ${elementId} not found.`);
    }
}


/**
 * Active tous les boutons d'action du jeu.
 */
export function enableActionButtons() {
    document.getElementById('action-attack').disabled = false;
    document.getElementById('action-defend').disabled = false;
    document.getElementById('action-heal').disabled = false;
}

/**
 * Désactive tous les boutons d'action du jeu.
 */
export function disableActionButtons() {
    document.getElementById('action-attack').disabled = true;
    document.getElementById('action-defend').disabled = true;
    document.getElementById('action-heal').disabled = true;
}

/**
 * Met à jour la barre de vie visuellement.
 * @param {string} barId - L'ID de la barre de vie (ex: 'you-health-bar', 'opponent-health-bar').
 * @param {number} currentPv - Les points de vie actuels.
 */
export function updateHealthBar(barId, currentPv) {
    const healthBar = document.getElementById(barId);
    if (healthBar) {
        const percentage = Math.max(0, Math.min(100, currentPv)); // Assure que le % est entre 0 et 100
        healthBar.style.width = `${percentage}%`;

        // Supprime les anciennes classes de couleur
        healthBar.classList.remove('low', 'critical', 'damage-effect', 'heal-effect');

        // Ajoute les nouvelles classes de couleur
        if (percentage <= 20) {
            healthBar.classList.add('critical');
        } else if (percentage <= 50) {
            healthBar.classList.add('low');
        }

        // Ajoute un effet visuel si la PV a changé (dépendra de la détection de changement dans game.js)
        // Pour un effet flash, on peut ajouter une classe temporaire
        // Exemple (à déclencher dans game.js après la mise à jour des PV) :
        // if (oldPv > currentPv) healthBar.classList.add('damage-effect');
        // else if (oldPv < currentPv) healthBar.classList.add('heal-effect');
        // setTimeout(() => healthBar.classList.remove('damage-effect', 'heal-effect'), 500);
    }
}


/**
 * Met à jour l'interface utilisateur du timer.
 * @param {number} timeLeft - Le temps restant en secondes.
 * @param {number} totalDuration - La durée totale du tour.
 */
export function updateTimerUI(timeLeft, totalDuration) {
    const timerDisplay = document.getElementById('timer-display');
    const timerProgressBar = document.getElementById('timer-progress-bar');

    if (!timerDisplay || !timerProgressBar) {
        console.warn("Éléments du timer non trouvés dans le DOM.");
        return;
    }

    // Arrondir le temps restant à l'entier le plus proche
    const displayTime = Math.ceil(timeLeft); // MODIFICATION CLÉ ICI

    timerDisplay.textContent = displayTime;

    const percentage = (timeLeft / totalDuration) * 100;
    timerProgressBar.style.width = `${percentage}%`;

    // Changer la couleur de la barre de progression en fonction du temps restant
    if (percentage > 50) {
        timerProgressBar.style.backgroundColor = '#2ecc71'; // Vert
    } else if (percentage > 20) {
        timerProgressBar.style.backgroundColor = '#f1c40f'; // Jaune
    } else {
        timerProgressBar.style.backgroundColor = '#e74c3c'; // Rouge
    }
}

/**
 * Vide l'historique du match affiché.
 */
export function clearHistory() {
    const historyDiv = document.getElementById('history');
    if (historyDiv) {
        historyDiv.innerHTML = '';
    }
}
// utils.js (aucune modification majeure nécessaire, car la correction est dans game.js)
// utils.js

export function showMessage(elementId, message, append = false) {
    const element = document.getElementById(elementId);
    if (element) {
        if (append) {
            const p = document.createElement('p');
            p.textContent = message;
            element.appendChild(p);
            element.scrollTop = element.scrollHeight; // Scroll to bottom
        } else {
            element.textContent = message;
        }
    } else {
        console.warn(`Element with ID '${elementId}' not found for message: ${message}`);
    }
}

export function updateHealthBar(barId, health) {
    const healthBar = document.getElementById(barId);
    const pvDisplay = document.getElementById(barId.replace('health-bar', 'pv-display'));

    if (healthBar) {
        healthBar.style.width = `${health}%`;
        if (health <= 25) {
            healthBar.style.backgroundColor = '#e74c3c'; // Rouge
        } else if (health <= 50) {
            healthBar.style.backgroundColor = '#f1c40f'; // Jaune
        } else {
            healthBar.style.backgroundColor = '#2ecc71'; // Vert
        }
    } else {
        console.error(`Elements for ${barId} health bar not found.`);
    }

    if (pvDisplay) {
        pvDisplay.textContent = `${health} PV`;
    }
}

export function updateTimerUI(timeLeft) {
    const timerValueElement = document.getElementById("timer-value");
    const timerProgressBarElement = document.getElementById("timer-progress-bar");
    
    if (timerValueElement) {
        timerValueElement.textContent = timeLeft;
    }
    
    if (timerProgressBarElement) {
        // Supposons que timerMax est disponible via import ou est une valeur constante dans utils.js
        // Si timerMax n'est pas importé, vous devrez l'importer de main.js ou le définir ici
        // Pour l'instant, je le suppose disponible (il l'est via main.js)
        const timerMax = 30; // Remplacez par votre valeur réelle si non importée
        const percentage = (timeLeft / timerMax) * 100;
        timerProgressBarElement.style.width = `${percentage}%`;

        if (timeLeft <= 5) { // 5 dernières secondes en rouge
            timerProgressBarElement.style.backgroundColor = '#e74c3c';
        } else if (timeLeft <= 15) { // 15 secondes en orange
            timerProgressBarElement.style.backgroundColor = '#e67e22';
        } else {
            timerProgressBarElement.style.backgroundColor = '#3498db'; // Bleu
        }
    }
}

export function clearHistory() {
    const historyElement = document.getElementById("history");
    if (historyElement) {
        historyElement.innerHTML = ''; // Vide l'historique
    }
}

export function disableActionButtons() {
    document.getElementById("action-attack").disabled = true;
    document.getElementById("action-defend").disabled = true;
    document.getElementById("action-heal").disabled = true;
}

export function enableActionButtons() {
    document.getElementById("action-attack").disabled = false;
    document.getElementById("action-defend").disabled = false;
    document.getElementById("action-heal").disabled = false;
}
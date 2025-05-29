// Dans utils.js

// Affiche un message temporaire dans un élément spécifié
export function showMessage(elementId, message, duration = 3000) {
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = message;
        element.style.display = 'block'; // Assurez-vous qu'il est visible
        setTimeout(() => {
            element.textContent = '';
            element.style.display = 'none'; // Le masque après la durée
        }, duration);
    }
}

// Active ou désactive les boutons d'action
export function disableActionButtons(disabled) {
    document.querySelectorAll('.action-button').forEach(button => {
        button.disabled = disabled;
    });
}

// Met à jour la barre de vie et l'affichage numérique des PV
export function updateHealthBar(barElement, textElement, currentPV) {
    // S'assurer que les PV sont entre 0 et 100
    const clampedPV = Math.max(0, Math.min(100, currentPV)); 
    
    // Mettre à jour la largeur de la barre de vie
    barElement.style.width = `${clampedPV}%`;
    
    // Mettre à jour le texte affichant les PV numériques
    textElement.textContent = `${clampedPV} PV`;

    // Optionnel : Changer la couleur de la barre en fonction des PV
    if (clampedPV < 25) {
        barElement.style.backgroundColor = 'red';
    } else if (clampedPV < 50) {
        barElement.style.backgroundColor = 'orange';
    } else {
        barElement.style.backgroundColor = '#4CAF50'; // Vert par défaut
    }
}

// Met à jour l'affichage du timer
export function updateTimerUI(remainingTime) {
    const timerElement = document.getElementById("turn-timer");
    if (timerElement) {
        timerElement.textContent = `Temps restant : ${remainingTime}s`;
        if (remainingTime <= 5) {
            timerElement.style.color = 'red';
        } else {
            timerElement.style.color = 'white'; // Ou la couleur par défaut
        }
    }
}

// Vide l'historique du match
export function clearHistory() {
    const histEl = document.getElementById("history");
    if (histEl) {
        histEl.innerHTML = "";
    }
}
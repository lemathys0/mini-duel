export function showMessage(elementId, message, isSuccess = false) {
    const el = document.getElementById(elementId);
    if (el) {
        el.style.color = isSuccess ? "#00ff88" : "#ff4d6d";
        el.textContent = message;
        if (!isSuccess) {
            setTimeout(() => {
                if (el.textContent === message) el.textContent = "";
            }, 5000);
        }
    }
}

export function disableActionButtons(disabled) {
    document.getElementById("attack-btn").disabled = disabled;
    document.getElementById("defend-btn").disabled = disabled;
    document.getElementById("heal-btn").disabled = disabled;
}

export function updateHealthBar(healthBarElement, pvDisplayElement, currentPV, isOpponent = false) {
    // Votre logique existante pour les barres de vie
}

export function updateTimerUI(value) {
    // Votre logique existante pour le timer
}

export function clearHistory() {
    document.getElementById("history").innerHTML = "";
}

// ... autres fonctions utilitaires 

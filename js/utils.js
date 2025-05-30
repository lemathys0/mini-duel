// utils.js

// Fonction pour afficher des messages dans la zone de message
export function showMessage(targetId, message, isHistory = false) {
    const targetElement = document.getElementById(targetId);
    if (targetElement) {
        const p = document.createElement("p");
        p.textContent = message;
        if (isHistory) {
            targetElement.prepend(p); // Ajoute les messages d'historique en haut
        } else {
            targetElement.innerHTML = ''; // Efface le message précédent
            targetElement.appendChild(p); // Ajoute le nouveau message
        }
    } else {
        console.warn(`Élément avec l'ID '${targetId}' non trouvé pour afficher le message.`);
    }
}

// Fonction pour mettre à jour la barre de vie
export function updateHealthBar(barId, health) {
    const healthBar = document.getElementById(barId);
    if (healthBar) {
        healthBar.style.width = `${health}%`;
        healthBar.textContent = `${health} PV`;
        // Ajouter des classes pour la couleur en fonction de la santé
        healthBar.classList.remove('bg-danger', 'bg-warning', 'bg-success');
        if (health < 25) {
            healthBar.classList.add('bg-danger');
        } else if (health < 50) {
            healthBar.classList.add('bg-warning');
        } else {
            healthBar.classList.add('bg-success');
        }
    } else {
        console.warn(`Barre de vie avec l'ID '${barId}' non trouvée.`);
    }
}

// Fonction pour mettre à jour l'affichage du timer
export function updateTimerUI(timeLeft) {
    const timerDisplay = document.getElementById("timer-display");
    if (timerDisplay) {
        timerDisplay.textContent = `Temps restant : ${timeLeft}s`;
    } else {
        console.warn("Élément 'timer-display' non trouvé.");
    }
}

// Fonction pour désactiver les boutons d'action
export function disableActionButtons() {
    const buttons = document.querySelectorAll(".action-btn");
    console.log("disableActionButtons: Désactivation des boutons d'action."); // Log pour suivre l'appel
    buttons.forEach(button => {
        button.disabled = true;
        button.classList.add('disabled'); // Ajoute une classe pour le style visuel
        console.log(`disableActionButtons: Bouton '${button.id}' désactivé.`); // Log détaillé
    });
}

// Fonction pour activer les boutons d'action
export function enableActionButtons() {
    const buttons = document.querySelectorAll(".action-btn");
    console.log("enableActionButtons: Activation des boutons d'action."); // Log pour suivre l'appel
    buttons.forEach(button => {
        button.disabled = false;
        button.classList.remove('disabled'); // Supprime la classe de style visuel
        console.log(`enableActionButtons: Bouton '${button.id}' activé.`); // Log détaillé
    });
}

// Fonction pour vider l'historique des messages
export function clearHistory() {
    const historyElement = document.getElementById("history");
    if (historyElement) {
        historyElement.innerHTML = '';
    }
}
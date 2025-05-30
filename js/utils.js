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
    // Cibler l'élément qui affiche la valeur du timer, qui a l'ID "timer-value" dans votre HTML
    const timerValueDisplay = document.getElementById("timer-value");
    // Cibler la barre de progression du timer, qui a l'ID "timer-progress-bar"
    const timerProgressBar = document.getElementById("timer-progress-bar");

    if (timerValueDisplay) {
        timerValueDisplay.textContent = `${timeLeft}`; // Affiche seulement le nombre de secondes
    } else {
        console.warn("Élément 'timer-value' non trouvé."); // Avertissement si 'timer-value' est manquant
    }

    if (timerProgressBar) {
        // NOTE : Assurez-vous que timerMax est accessible ici, par exemple en l'important ou en le passant en paramètre si nécessaire
        // Pour l'instant, je le mets en dur à 30 comme votre log l'indique.
        const percentage = (timeLeft / 30) * 100;
        timerProgressBar.style.width = `${percentage}%`;
        // Changez la couleur en fonction du temps restant
        if (percentage < 25) {
            timerProgressBar.style.backgroundColor = '#e74c3c'; // Rouge
        } else if (percentage < 50) {
            timerProgressBar.style.backgroundColor = '#f39c12'; // Orange
        } else {
            timerProgressBar.style.backgroundColor = '#2ecc71'; // Vert
        }
    } else {
        console.warn("Élément 'timer-progress-bar' non trouvé."); // Avertissement si 'timer-progress-bar' est manquant
    }
}

// Fonction pour désactiver les boutons d'action
export function disableActionButtons() {
    // Cibler les boutons par leur ID si vous avez une liste explicite, ou par une classe
    // Pour l'instant, je cible les boutons d'action par leur classe commune 'action-buttons button' si vous avez défini un style spécifique.
    // Ou si vous avez ajouté une classe '.action-btn' à chacun.
    const buttons = document.querySelectorAll("#action-attack, #action-defend, #action-heal");
    console.log("disableActionButtons: Désactivation des boutons d'action."); // Log pour suivre l'appel
    buttons.forEach(button => {
        button.disabled = true;
        button.classList.add('disabled'); // Ajoute une classe pour le style visuel
        console.log(`disableActionButtons: Bouton '${button.id}' désactivé.`); // Log détaillé
    });
}

// Fonction pour activer les boutons d'action
export function enableActionButtons() {
    const buttons = document.querySelectorAll("#action-attack, #action-defend, #action-heal");
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
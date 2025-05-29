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
// Les boutons d'action ont la classe 'action-buttons' dans index.html,
// mais les boutons eux-mêmes n'ont pas de classe spécifique dans le HTML fourni.
// Il est préférable de cibler les IDs ou les enfants d'une div parent.
// Dans l'index.html fourni, les boutons sont directement dans <div class="game-controls action-buttons">
// On peut les cibler par leur ID ou par leur parent.
export function enableActionButtons() {
    // Les IDs de vos boutons sont action-attack, action-defend, action-heal
    document.getElementById("action-attack").disabled = false;
    document.getElementById("action-defend").disabled = false;
    document.getElementById("action-heal").disabled = false;
}

export function disableActionButtons() {
    document.getElementById("action-attack").disabled = true;
    document.getElementById("action-defend").disabled = true;
    document.getElementById("action-heal").disabled = true;
}


// Met à jour la barre de vie et l'affichage numérique des PV
// Note: Cette fonction a été ajustée pour prendre les IDs des éléments HTML directement
// Plutôt que les éléments JS pour une meilleure réutilisabilité et clarté avec les IDs existants.
export function updateHealthBar(playerType, currentPV) {
    const barElementId = `${playerType}-health-bar`; // 'you-health-bar' ou 'opponent-health-bar'
    const textElementId = `${playerType}-pv-display`; // 'you-pv-display' ou 'opponent-pv-display'

    const barElement = document.getElementById(barElementId);
    const textElement = document.getElementById(textElementId);

    if (!barElement || !textElement) {
        console.error(`Elements for ${playerType} health bar not found.`);
        return;
    }

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
        barElement.style.backgroundColor = '#2ecc71'; // Vert par défaut, j'ai mis un vert plus clair que #4CAF50
    }
}

// Met à jour l'affichage du timer
// J'ai ajusté cette fonction pour correspondre aux IDs de votre index.html
export function updateTimerUI(remainingTime, maxTime) {
    const timerValueElement = document.getElementById("timer-value"); // Élément pour le compte à rebours numérique
    const timerProgressBar = document.getElementById("timer-progress-bar"); // Élément pour la barre de progression

    if (timerValueElement) {
        timerValueElement.textContent = remainingTime;
        if (remainingTime <= 5) {
            timerValueElement.style.color = 'red';
        } else {
            timerValueElement.style.color = '#f1c40f'; // Couleur par défaut pour le texte du timer
        }
    }

    if (timerProgressBar) {
        const percentage = (remainingTime / maxTime) * 100;
        timerProgressBar.style.width = `${percentage}%`;
        
        // Changer la couleur de la barre de progression du timer
        if (percentage < 25) {
            timerProgressBar.style.backgroundColor = 'red';
        } else if (percentage < 50) {
            timerProgressBar.style.backgroundColor = 'orange';
        } else {
            timerProgressBar.style.backgroundColor = '#3498db'; // Bleu par défaut
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

// AJOUTÉ: Ajoute un message à l'historique du match
export function appendToHistory(message) {
    const historyDiv = document.getElementById("history");
    if (historyDiv) {
        const p = document.createElement("p");
        p.textContent = message;
        historyDiv.appendChild(p);
        // Fait défiler vers le bas pour toujours voir le dernier message
        historyDiv.scrollTop = historyDiv.scrollHeight;
    }
}
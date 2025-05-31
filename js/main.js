// js/main.js

// Importe 'auth' et 'onAuthStateChanged' directement de firebaseConfig.js
import { auth, onAuthStateChanged, db, ref, onValue, set, push, serverTimestamp, off } from './firebaseConfig.js';
import { setupAuthListeners } from './auth.js'; // Importe la fonction qui configure les écouteurs d'auth
import { signOut } from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js'; // Importe signOut

import {
    afficherMessage,
    mettreAJourBarreDeVie,
    afficherEcranAuth,
    afficherMenuPrincipal,
    afficherEcranMatchmaking,
    afficherEcranJeu,
    afficherEcranClassement,
    afficherEcranCommentJouer
} from './utils.js';
import { startMatch, leaveGame } from './game.js'; // 'attachGameActionListeners' est appelé dans startMatch

console.log("main.js chargé.");

// Variables globales pour l'état de l'utilisateur
let currentUserId = null;
let currentUserName = "Joueur";
let playerStatsListener = null;

// Références aux éléments du DOM
const playerNameDisplay = document.getElementById('player-name');
const pseudoInput = document.getElementById('pseudo-input'); // Utilisé pour définir le pseudo (si c'est dans main.js)
const pseudoDisplay = document.getElementById('pseudo-display');
const playerStatsDiv = document.getElementById('player-stats');

const loginEmailBtn = document.getElementById('login-email-btn'); // Ces boutons sont gérés par auth.js maintenant
const signupEmailBtn = document.getElementById('signup-email-btn'); // Ces boutons sont gérés par auth.js maintenant
const logoutBtn = document.getElementById('logout-btn'); // Bouton de déconnexion sur l'écran d'auth
const logoutBtnMenu = document.getElementById('logout-btn-menu'); // Bouton de déconnexion sur le menu principal

const playIaBtn = document.getElementById('play-ia-btn');
const playPlayerBtn = document.getElementById('play-player-btn');
const howToPlayBtn = document.getElementById('how-to-play-btn');
const cancelMatchmakingBtn = document.getElementById('cancel-matchmaking-btn');


// --- Fonctions de gestion de l'interface utilisateur (exportées pour auth.js si nécessaire, mais l'approche est de les appeler via onAuthStateChanged) ---

// Cette fonction est appelée par l'onAuthStateChanged pour mettre à jour l'UI globale
function mettreAJourUIUtilisateur(user) {
    if (user) {
        currentUserId = user.uid;
        // On récupère le pseudo depuis la DB, pas directement de user.displayName pour la persistance
        const userRef = ref(db, `users/${currentUserId}`);
        onValue(userRef, (snapshot) => {
            const userData = snapshot.val();
            if (userData && userData.pseudo) {
                currentUserName = userData.pseudo;
                if (playerNameDisplay) playerNameDisplay.textContent = `Bienvenue, ${currentUserName} !`;
                if (pseudoDisplay) pseudoDisplay.textContent = `Pseudo: ${currentUserName}`;
                afficherMenuPrincipal(); // Afficher le menu principal une fois les infos chargées
            } else {
                // Pseudo non trouvé, potentiellement nouvelle inscription via Google ou Tel sans pseudo initial
                currentUserName = user.displayName || user.email || "Nouvel Utilisateur";
                if (playerNameDisplay) playerNameDisplay.textContent = `Bienvenue, ${currentUserName} !`;
                if (pseudoDisplay) pseudoDisplay.textContent = `Pseudo non défini.`;
                afficherMessage('main-menu-msg', 'Veuillez définir votre pseudo pour jouer.', false, 0); // Message persistant
                // Optionnellement: force l'utilisateur à définir un pseudo ici si ce n'est pas déjà fait via prompt dans auth.js
                // L'idée est que auth.js s'assure d'avoir un pseudo valide AVANT d'appeler main.js via l'état d'auth.
                afficherMenuPrincipal(); // Afficher le menu même si le pseudo est manquant
            }
        }, {
            onlyOnce: true // Écoute une seule fois pour la mise à jour initiale de l'UI
        });

        // Écoute les statistiques du joueur en temps réel
        if (playerStatsListener) {
            off(ref(db, `user_stats/${currentUserId}`), 'value', playerStatsListener); // Annuler l'ancien listener
        }
        playerStatsListener = onValue(ref(db, `users/${currentUserId}/stats`), (snapshot) => {
            const stats = snapshot.val() || { wins: 0, losses: 0, gamesPlayed: 0, draws: 0 };
            if (playerStatsDiv) {
                playerStatsDiv.innerHTML = `
                    <p>Parties jouées : ${stats.gamesPlayed}</p>
                    <p>Victoires : ${stats.wins}</p>
                    <p>Défaites : ${stats.losses}</p>
                    <p>Matchs nuls : ${stats.draws}</p>
                `;
            }
        });

    } else {
        // Utilisateur déconnecté
        currentUserId = null;
        currentUserName = "Joueur";
        if (playerNameDisplay) playerNameDisplay.textContent = "Bienvenue, Joueur !";
        if (pseudoDisplay) pseudoDisplay.textContent = '';
        if (playerStatsDiv) playerStatsDiv.innerHTML = '';
        if (playerStatsListener) {
            off(ref(db, `users/${currentUserId}/stats`), 'value', playerStatsListener);
            playerStatsListener = null;
        }
        afficherEcranAuth(); // Revenir à l'écran d'authentification
    }
}

// L'écouteur global d'état d'authentification
onAuthStateChanged(auth, (user) => {
    mettreAJourUIUtilisateur(user); // Cette fonction gère toute la logique de l'UI en fonction de l'état de l'utilisateur
});


// --- Fonctions de gestion du jeu ---
async function demarrerMatchPvAI() {
    if (!currentUserId) {
        afficherMessage('main-menu-msg', 'Veuillez vous connecter pour jouer contre l\'IA.', false);
        return;
    }
    if (currentUserName === "Joueur" || !currentUserName) { // Vérifier si le pseudo est le défaut ou vide
        afficherMessage('main-menu-msg', 'Veuillez définir votre pseudo pour pouvoir jouer !', false);
        return;
    }

    afficherEcranJeu();
    afficherMessage('action-msg', 'Démarrage du match contre l\'IA...', true, 3000);

    try {
        const newMatchRef = push(ref(db, 'matches'));
        const matchId = newMatchRef.key;

        const initialMatchData = {
            id: matchId,
            status: 'playing',
            turn: 'p1',
            turnCounter: 0,
            turnStartTime: serverTimestamp(),
            players: {
                p1: { uid: currentUserId, pseudo: currentUserName, pv: 100, action: null, healCooldown: 0, isDefending: false },
                p2: { uid: 'AI', pseudo: 'IA redoutable', pv: 100, action: null, healCooldown: 0, isDefending: false }
            },
            history: [`--- Début du match ${matchId} (PvAI) ---`, `C'est au tour de [${currentUserName}].`],
            gameMode: 'PvAI'
        };

        await set(newMatchRef, initialMatchData);
        console.log(`Match PvAI démarré avec l'ID: ${matchId}`);
        startMatch(matchId, 'p1', 'PvAI'); // 'p1' car le joueur humain est toujours p1 contre l'IA

    } catch (error) {
        console.error("Erreur lors du démarrage du match PvAI:", error);
        afficherMessage('main-menu-msg', `Échec du démarrage du match : ${error.message}`, false);
        afficherMenuPrincipal();
    }
}

async function demarrerMatchPvP() {
    afficherMessage('main-menu-msg', 'Le mode PvP est en cours de développement. Veuillez jouer contre l\'IA pour le moment.', false, 5000);
}

function afficherReglesDuJeu() {
    afficherEcranCommentJouer();
}

// --- Écouteurs d'événements pour les boutons ---
document.addEventListener('DOMContentLoaded', () => {
    // Initialise les écouteurs d'authentification une fois le DOM chargé
    setupAuthListeners();

    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            await signOut(auth); // Déconnexion via Firebase Auth
            // L'écouteur onAuthStateChanged gérera la mise à jour de l'UI
            afficherMessage('auth-msg-email', 'Déconnecté avec succès !', true); // Message sur l'écran d'auth
        });
    }
    if (logoutBtnMenu) {
        logoutBtnMenu.addEventListener('click', async () => {
            await signOut(auth);
            // L'écouteur onAuthStateChanged gérera la mise à jour de l'UI
            afficherMessage('main-menu-msg', 'Déconnecté avec succès !', true); // Message sur le menu principal
        });
    }

    if (playIaBtn) {
        playIaBtn.addEventListener('click', demarrerMatchPvAI);
    }
    if (playPlayerBtn) {
        playPlayerBtn.addEventListener('click', demarrerMatchPvP);
    }
    if (howToPlayBtn) {
        howToPlayBtn.addEventListener('click', afficherReglesDuJeu);
    }

    // NOUVEAU : Écouteur pour le bouton de retour de la section "Comment jouer ?"
    const backFromHowToPlayBtn = document.getElementById('back-from-how-to-play-btn');
    if (backFromHowToPlayBtn) {
        backFromHowToPlayBtn.addEventListener('click', afficherMenuPrincipal);
    }
    // FIN NOUVEAU

    if (cancelMatchmakingBtn) {
        cancelMatchmakingBtn.addEventListener('click', () => {
            afficherMessage('matchmaking-message', 'Recherche de match annulée.', true);
            afficherMenuPrincipal();
        });
    }
});
// js/main.js

import { initializeFirebaseAndAuth, auth, onAuthStateChanged } from './auth.js'; // 'auth' est maintenant exporté
// Importe les fonctions utilitaires nécessaires, avec les nouveaux noms français
import {
    afficherMessage,
    mettreAJourBarreDeVie, // Gardé si vous l'utilisez directement ici pour les PV par ex.
    afficherEcranAuth,
    afficherMenuPrincipal,
    afficherEcranMatchmaking,
    afficherEcranJeu,
    afficherEcranClassement,
    afficherEcranCommentJouer
} from './utils.js';
import { attachGameActionListeners, startMatch, leaveGame } from './game.js';
import { db, ref, get, set, update, push, remove, onValue, serverTimestamp } from './firebaseConfig.js';


console.log("main.js chargé.");

// Variables globales pour l'état de l'utilisateur
let currentUserId = null;
let currentUserName = "Joueur"; // Pseudo par défaut si non authentifié ou pas encore défini
let playerStatsListener = null; // Pour écouter les stats du joueur
let selectedAIDifficulty = 'normal'; // Difficulté par défaut pour l'IA

// Références aux éléments du DOM
const playerNameDisplay = document.getElementById('player-name');
const pseudoInput = document.getElementById('pseudo-input'); // Utilisé pour définir le pseudo
const pseudoDisplay = document.getElementById('pseudo-display');
const playerStatsDiv = document.getElementById('player-stats');

const loginEmailBtn = document.getElementById('login-email-btn');
const signupEmailBtn = document.getElementById('signup-email-btn');
const logoutBtn = document.getElementById('logout-btn'); // Bouton de déconnexion sur l'écran d'auth
const logoutBtnMenu = document.getElementById('logout-btn-menu'); // Bouton de déconnexion sur le menu principal

const playIaBtn = document.getElementById('play-ia-btn');
const playPlayerBtn = document.getElementById('play-player-btn');
const howToPlayBtn = document.getElementById('how-to-play-btn');
const cancelMatchmakingBtn = document.getElementById('cancel-matchmaking-btn');


// --- Fonctions de gestion de l'interface utilisateur ---

// Met à jour l'affichage des informations du joueur
function mettreAJourUIUtilisateur(user) {
    if (user) {
        currentUserId = user.uid;
        currentUserName = user.displayName || user.email || "Utilisateur";

        // Récupérer le pseudo depuis Firebase Realtime Database
        const userRef = ref(db, `users/${currentUserId}`);
        onValue(userRef, (snapshot) => {
            const userData = snapshot.val();
            if (userData && userData.pseudo) {
                currentUserName = userData.pseudo;
                if (playerNameDisplay) playerNameDisplay.textContent = currentUserName;
                if (pseudoDisplay) pseudoDisplay.textContent = `Pseudo: ${currentUserName}`;
            } else {
                // Si pas de pseudo enregistré, utiliser le displayName/email et proposer de définir un pseudo
                if (playerNameDisplay) playerNameDisplay.textContent = currentUserName;
                if (pseudoDisplay) pseudoDisplay.textContent = `Veuillez définir un pseudo.`;
                // Vous pouvez ajouter ici une logique pour forcer la saisie du pseudo
                // Par exemple, en affichant un champ de saisie directement.
            }
        }, {
            onlyOnce: true // Écoute une seule fois pour le pseudo initial
        });


        // Écoute les statistiques du joueur en temps réel
        if (playerStatsListener) {
            off(ref(db, `user_stats/${currentUserId}`), 'value', playerStatsListener); // Annuler l'ancien listener
        }
        playerStatsListener = onValue(ref(db, `user_stats/${currentUserId}`), (snapshot) => {
            const stats = snapshot.val() || { wins: 0, losses: 0, gamesPlayed: 0 };
            if (playerStatsDiv) {
                playerStatsDiv.innerHTML = `
                    <p>Parties jouées : ${stats.gamesPlayed}</p>
                    <p>Victoires : ${stats.wins}</p>
                    <p>Défaites : ${stats.losses}</p>
                `;
            }
        });

        // Afficher le menu principal après connexion
        afficherMenuPrincipal();
        if (logoutBtn) logoutBtn.style.display = 'none'; // Masquer le bouton déconnexion de l'écran d'auth
    } else {
        // Utilisateur déconnecté
        currentUserId = null;
        currentUserName = "Joueur";
        if (playerNameDisplay) playerNameDisplay.textContent = currentUserName;
        if (pseudoDisplay) pseudoDisplay.textContent = '';
        if (playerStatsDiv) playerStatsDiv.innerHTML = '';
        if (playerStatsListener) {
            off(ref(db, `user_stats/${currentUserId}`), 'value', playerStatsListener);
            playerStatsListener = null;
        }

        // Afficher l'écran d'authentification
        afficherEcranAuth();
        if (logoutBtn) logoutBtn.style.display = 'block'; // Afficher le bouton déconnexion de l'écran d'auth
    }
}

// Initialise Firebase Auth et configure l'écouteur d'état de l'authentification
initializeFirebaseAndAuth(); // Cette fonction devrait être dans auth.js et exporter `auth`
onAuthStateChanged(auth, (user) => {
    mettreAJourUIUtilisateur(user); // Cette fonction est appelée chaque fois que l'état d'auth change
});

// --- Fonctions de gestion du jeu ---

async function demarrerMatchPvAI() {
    if (!currentUserId) {
        afficherMessage('main-menu-msg', 'Veuillez vous connecter pour jouer contre l\'IA.', false);
        return;
    }

    if (!currentUserName || currentUserName === "Joueur") {
        afficherMessage('main-menu-msg', 'Veuillez définir votre pseudo avant de jouer.', false);
        return;
    }

    afficherEcranJeu(); // Afficher l'écran de jeu immédiatement
    afficherMessage('action-msg', 'Démarrage du match contre l\'IA...', true, 3000); // Message temporaire

    try {
        // Créer un nouveau match dans la base de données
        const newMatchRef = push(ref(db, 'matches'));
        const matchId = newMatchRef.key;

        const initialMatchData = {
            id: matchId,
            status: 'playing',
            turn: 'p1', // Joueur humain commence
            turnCounter: 0,
            turnStartTime: serverTimestamp(),
            players: {
                p1: {
                    uid: currentUserId,
                    pseudo: currentUserName,
                    pv: 100,
                    action: null,
                    healCooldown: 0,
                    isDefending: false
                },
                p2: { // IA
                    uid: 'AI',
                    pseudo: 'IA redoutable', // Nom de l'IA
                    pv: 100,
                    action: null,
                    healCooldown: 0,
                    isDefending: false
                }
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
        afficherMenuPrincipal(); // Retour au menu en cas d'erreur
    }
}


// --- Fonctions pour le matchmaking PvP (à implémenter plus tard) ---
async function demarrerMatchPvP() {
    afficherMessage('main-menu-msg', 'Le mode PvP est en cours de développement. Veuillez jouer contre l\'IA pour le moment.', false, 5000);
}

// Fonction pour afficher l'écran "Comment Jouer"
function afficherReglesDuJeu() {
    afficherEcranCommentJouer();
    // Vous pouvez charger le contenu des règles ici ou directement dans le HTML
}


// --- Écouteurs d'événements pour les boutons ---

// Les boutons d'authentification sont gérés dans auth.js qui appelle cette fonction pour mettre à jour l'UI
// Ici, on gère les déconnexions
if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
        await auth.signOut(); // Déconnexion via Firebase Auth
        afficherMessage('global-auth-message', 'Déconnecté avec succès !', true);
        // L'écouteur onAuthStateChanged s'occupera d'appeler mettreAJourUIUtilisateur(null)
    });
}
if (logoutBtnMenu) {
    logoutBtnMenu.addEventListener('click', async () => {
        await auth.signOut();
        afficherMessage('global-auth-message', 'Déconnecté avec succès !', true);
        // L'écouteur onAuthStateChanged s'occupera d'appeler mettreAJourUIUtilisateur(null)
    });
}

// Boutons du menu principal
if (playIaBtn) {
    playIaBtn.addEventListener('click', demarrerMatchPvAI);
}
if (playPlayerBtn) {
    playPlayerBtn.addEventListener('click', demarrerMatchPvP);
}
if (howToPlayBtn) {
    howToPlayBtn.addEventListener('click', afficherReglesDuJeu);
}

// Bouton d'annulation du matchmaking (si implémenté)
if (cancelMatchmakingBtn) {
    cancelMatchmakingBtn.addEventListener('click', () => {
        afficherMessage('matchmaking-message', 'Recherche de match annulée.', true);
        afficherMenuPrincipal();
        // Logique pour annuler la recherche de match dans Firebase si elle était active
    });
}

// Note: `attachGameActionListeners()` est appelée dans `game.js` quand un match démarre.
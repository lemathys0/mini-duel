// js/main.js

console.log("main.js chargé."); // DEBUG : Confirme le chargement de main.js

// Importez 'app' et 'db' directement depuis firebaseConfig.js
import { app, db } from "./firebaseConfig.js";
// NOUVEAU : Import de la fonction setupAuthListeners depuis auth.js
import { setupAuthListeners } from "./auth.js";
import { ref, set, get, update, remove, onValue, off, serverTimestamp, runTransaction, push } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js";
import { startMatchMonitoring } from "./game.js"; // Importe la fonction de démarrage du monitoring du match
import { showMessage, updateHealthBar, updateTimerUI, clearHistory, disableActionButtons, enableActionButtons } from "./utils.js"; // Importe les fonctions utilitaires

// Variables globales pour le match en cours
export let currentUser = null; // currentUser sera maintenant l'objet utilisateur de notre base de données { pseudo, code, uid }
export let currentMatchId = null;
export let youKey = null;
export let opponentKey = null;
export let gameMode = null; // 'PvAI' ou 'PvP'

export let timerMax = 30; // Temps max pour un tour en secondes
export let timerInterval = null; // Variable pour stocker l'intervalle du timer
export let onDisconnectRef = null; // Référence pour l'opération onDisconnect
export let matchDeletionTimeout = null; // Timeout pour la suppression du match

export let hasPlayedThisTurn = false; // Initialisation
export function setHasPlayedThisTurn(value) {
    hasPlayedThisTurn = value;
    console.log(`DEBUG main.js: hasPlayedThisTurn mis à jour vers ${hasPlayedThisTurn}`); // NOUVEAU LOG
}

// Fonction pour mettre à jour les variables de match depuis game.js
export function setMatchVariables(matchId, user, playerKey, mode) {
    currentMatchId = matchId;
    currentUser = user; // user sera notre objet utilisateur { pseudo, code, uid }
    youKey = playerKey;
    opponentKey = (playerKey === 'p1') ? 'p2' : 'p1';
    gameMode = mode;
    console.log(`Variables de match définies : ID=${currentMatchId}, YouKey=${youKey}, OpponentKey=${opponentKey}, Mode=${gameMode}`);
}

export function setTimerInterval(_timerInterval) {
    timerInterval = _timerInterval;
}

export function setOnDisconnectRef(_onDisconnectRef) {
    onDisconnectRef = _onDisconnectRef;
}

export function setMatchDeletionTimeout(_timeout) {
    matchDeletionTimeout = _timeout;
}


// --- Fonctions de statistiques ---
function updateUserStatsDisplay(stats) {
    const playerStatsDisplay = document.getElementById("player-stats");
    if (playerStatsDisplay && stats) {
        playerStatsDisplay.innerHTML = `
            <p>Victoires: ${stats.wins || 0}</p>
            <p>Défaites: ${stats.losses || 0}</p>
            <p>Égalités: ${stats.draws || 0}</p>
        `;
    }
}

export async function updateUserStats(result) {
    // L'UID sera maintenant le pseudo si on utilise notre système personnalisé
    if (!currentUser || !currentUser.pseudo) {
        console.error("Impossible de mettre à jour les statistiques : utilisateur non connecté.");
        return;
    }

    const userStatsRef = ref(db, `users/${currentUser.pseudo}/stats`);
    await runTransaction(userStatsRef, (currentStats) => {
        if (currentStats === null) {
            currentStats = { wins: 0, losses: 0, draws: 0 };
        }
        if (result === 'win') {
            currentStats.wins = (currentStats.wins || 0) + 1;
        } else if (result === 'loss') {
            currentStats.losses = (currentStats.losses || 0) + 1;
        } else if (result === 'draw') {
            currentStats.draws = (currentStats.draws || 0) + 1;
        }
        return currentStats;
    }).then(() => {
        console.log(`Statistiques mises à jour : ${result}`);
        get(userStatsRef).then(snapshot => {
            if (snapshot.exists()) {
                updateUserStatsDisplay(snapshot.val());
            }
        });
    }).catch(error => {
        console.error("Erreur lors de la mise à jour des stats :", error);
    });
}


// --- Fonctions du menu principal ---

// Fonction pour revenir au menu principal
export async function backToMenu(fromMatchEnd = false) {
    console.log("Retour au menu demandé.");

    // Arrêter tous les écouteurs Firebase liés au match
    if (currentMatchId) {
        const matchRef = ref(db, `matches/${currentMatchId}`);
        off(matchRef); // Désinscrit tous les listeners pour ce chemin
        console.log(`Écouteurs Firebase pour le match ${currentMatchId} désactivés.`);
    }

    // Annuler l'opération onDisconnect si elle existe
    if (onDisconnectRef) {
        try {
            await onDisconnectRef.cancel();
            console.log("Opération onDisconnect annulée.");
        } catch (error) {
            console.warn("Erreur lors de l'annulation de onDisconnect :", error);
        } finally {
            onDisconnectRef = null;
        }
    }

    // Effacer le timeout de suppression du match
    if (matchDeletionTimeout) {
        clearTimeout(matchDeletionTimeout);
        setMatchDeletionTimeout(null);
        console.log("Timeout de suppression du match annulé.");
    }

    // Arrêter le timer de tour
    if (timerInterval) {
        clearInterval(timerInterval);
        setTimerInterval(null);
        console.log("Timer de tour arrêté.");
    }

    // Réinitialiser les variables de match globales
    currentMatchId = null;
    youKey = null;
    opponentKey = null;
    gameMode = null;
    setHasPlayedThisTurn(false); // Réinitialiser le drapeau pour le prochain match
    console.log(`DEBUG main.js: hasPlayedThisTurn réinitialisé à ${hasPlayedThisTurn} lors du retour au menu.`); // NOUVEAU LOG

    // Réinitialiser l'interface utilisateur du match
    clearHistory();
    updateHealthBar("you-health-bar", 100);
    document.getElementById("player1-pv").textContent = "100 PV"; // Utilise player1-pv
    updateHealthBar("opponent-health-bar", 100);
    document.getElementById("player2-pv").textContent = "100 PV"; // Utilise player2-pv
    updateTimerUI(timerMax); // Réinitialise l'affichage du timer
    document.getElementById("current-match").textContent = "Aucun";
    document.getElementById("player2-pseudo").textContent = "Adversaire"; // Utilise player2-pseudo
    document.getElementById("player1-pseudo").textContent = "Vous"; // Utilise player1-pseudo
    showMessage("action-msg", "");
    showMessage("match-msg", ""); // Effacer le message de fin de match
    enableActionButtons(); // S'assurer que les boutons sont activés pour un nouveau match

    // Cacher l'écran de jeu et montrer le menu principal
    // CORRECTION : Utiliser 'game-screen' comme dans index.html
    document.getElementById("game-screen").style.display = "none";
    document.getElementById("main-menu").style.display = "block";

    if (fromMatchEnd) {
        showMessage("main-menu-msg", "Le match est terminé. Bienvenue au menu principal.");
    } else {
        showMessage("main-menu-msg", "Vous avez quitté le match. Bienvenue au menu principal.");
    }
}


// --- Fonctions de gestion de l'état de connexion de l'utilisateur (appelées par auth.js) ---
function handleUserLogin(userPseudo, userData) {
    currentUser = { pseudo: userPseudo, ...userData }; // Stocke le pseudo et les données (dont le code)
    console.log("Utilisateur connecté :", currentUser.pseudo);

    const userInfoSpan = document.getElementById("user-info");
    const loginBtn = document.getElementById("login-btn");
    const logoutBtn = document.getElementById("logout-btn");
    const authSection = document.getElementById("auth");
    const mainMenuSection = document.getElementById("main-menu");
    const pseudoDisplay = document.getElementById("pseudo-display");
    const playerStatsDisplay = document.getElementById("player-stats");


    if (userInfoSpan) userInfoSpan.textContent = `Connecté en tant que : ${currentUser.pseudo}`;
    // Les boutons signup et login sont gérés dans auth.js, mais on peut les masquer ici
    // si auth.js ne le fait pas déjà via l'affichage/masquage des sections.
    if (loginBtn) loginBtn.style.display = "none";
    // Le bouton signup-btn n'a pas besoin d'être géré ici car on masque la section auth

    if (logoutBtn) logoutBtn.style.display = "block";
    if (authSection) authSection.style.display = "none";
    if (mainMenuSection) mainMenuSection.style.display = "block";
    if (pseudoDisplay) pseudoDisplay.textContent = `Pseudo: ${currentUser.pseudo}`;
    updateUserStatsDisplay(currentUser.stats); // Afficher les stats

    showMessage("auth-msg", ""); // Nettoyer le message d'authentification
}

function handleUserLogout() {
    currentUser = null;
    console.log("Aucun utilisateur connecté.");

    const userInfoSpan = document.getElementById("user-info");
    const loginBtn = document.getElementById("login-btn");
    const logoutBtn = document.getElementById("logout-btn");
    const authSection = document.getElementById("auth");
    const mainMenuSection = document.getElementById("main-menu");
    const pseudoDisplay = document.getElementById("pseudo-display");
    const playerStatsDisplay = document.getElementById("player-stats");

    if (userInfoSpan) userInfoSpan.textContent = "Non connecté";
    if (loginBtn) loginBtn.style.display = "block";
    if (logoutBtn) logoutBtn.style.display = "none";
    if (authSection) authSection.style.display = "block";
    if (mainMenuSection) mainMenuSection.style.display = "none";
    if (pseudoDisplay) pseudoDisplay.textContent = "";
    if (playerStatsDisplay) playerStatsDisplay.innerHTML = "";

    showMessage("auth-msg", "Déconnecté avec succès.");
}


// --- Exécution du code après le chargement complet du DOM ---
document.addEventListener("DOMContentLoaded", () => {
    console.log("DEBUG: DOMContentLoaded fired! HTML elements should be available now."); // LOG DE DEBUG

    // Initialiser les écouteurs d'authentification en passant les fonctions de gestion d'UI
    setupAuthListeners(handleUserLogin, handleUserLogout);

    // --- Fonctions du menu principal (inchangées) ---
    const playIaBtn = document.getElementById("play-ia-btn");
    if (playIaBtn) {
        playIaBtn.addEventListener("click", async () => {
            console.log("Clic sur 'Jouer contre l'IA'.");
            if (!currentUser) { // Vérifie notre currentUser personnalisé
                showMessage("main-menu-msg", "Veuillez vous connecter pour jouer.");
                return;
            }

            // Crée un ID unique pour le match
            const newMatchRef = ref(db, 'matches');
            const newRef = push(newMatchRef); // Utilise push pour générer un ID unique
            const matchId = newRef.key; // Récupère la clé (ID) du nouveau nœud

            if (!matchId) {
                showMessage("main-menu-msg", "Erreur lors de la création du match.");
                return;
            }

            const initialMatchData = {
                createdAt: serverTimestamp(),
                mode: 'PvAI',
                status: 'playing',
                turn: 'p1', // P1 commence toujours
                turnStartTime: serverTimestamp(),
                lastTurnProcessedAt: serverTimestamp(),
                players: {
                    p1: {
                        uid: currentUser.pseudo, // L'UID sera le pseudo pour ce système
                        pseudo: currentUser.pseudo,
                        pv: 100,
                        action: null,
                        lastAction: null,
                        healCooldown: 0,
                        status: 'connected'
                    },
                    p2: {
                        uid: 'AI',
                        pseudo: 'IA',
                        pv: 100,
                        action: null,
                        lastAction: null,
                        healCooldown: 0,
                        status: 'connected'
                    }
                },
                history: [`${currentUser.pseudo} entre dans l'arène contre l'IA !`]
            };

            try {
                await set(ref(db, `matches/${matchId}`), initialMatchData);
                console.log(`Match IA créé avec ID: ${matchId}`);

                // CORRECTION : Affiche l'écran de jeu et masque le menu principal
                document.getElementById('main-menu').style.display = 'none';
                document.getElementById('game-screen').style.display = 'block'; // Utilise 'block' car ton CSS utilise 'display:none;'

                startMatchMonitoring(matchId, 'p1', 'PvAI');
            } catch (error) {
                console.error("Erreur lors de la création du match IA :", error);
                showMessage("main-menu-msg", "Erreur lors de la création du match IA.");
            }
        });
    }

    // Le reste de tes écouteurs d'événements pour les autres boutons (play-player-btn, etc.)
    // devrait être ici, en s'assurant qu'ils ont une logique similaire pour afficher/masquer les sections.

    const playPlayerBtn = document.getElementById("play-player-btn");
    if (playPlayerBtn) {
        playPlayerBtn.addEventListener("click", () => {
            showMessage("main-menu-msg", "Fonctionnalité 'Jouer contre un autre joueur' à implémenter.");
            // Logique pour le matchmaking ou rejoindre un match PvP
            // N'oubliez pas de gérer l'affichage de 'matchmaking-status'
            // et ensuite 'game-screen' une fois le match trouvé/créé.
        });
    }

    const howToPlayBtn = document.getElementById("how-to-play-btn");
    if (howToPlayBtn) {
        howToPlayBtn.addEventListener("click", () => {
            showMessage("main-menu-msg", "Instructions de jeu à afficher ici.");
        });
    }

    const logoutBtn = document.getElementById("logout-btn");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", async () => {
            // La déconnexion est gérée par auth.js et appellera handleUserLogout
            // Tu n'as pas besoin d'appeler handleUserLogout ici directement
            // car auth.js s'en charge après la déconnexion Firebase.
            showMessage("auth-msg", "Déconnexion...");
        });
    }

    // Initialisation de l'affichage en fonction de l'état de connexion au démarrage
    // Ceci est géré par setupAuthListeners qui appellera handleUserLogin/handleUserLogout
    // après avoir vérifié la session utilisateur.
});
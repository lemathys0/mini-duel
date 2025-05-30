// main.js

console.log("main.js chargé."); // DEBUG : Confirme le chargement de main.js

// Importez 'app' et 'db' directement depuis firebaseConfig.js
import { app, db } from "./firebaseConfig.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js";
import { ref, set, get, update, remove, onValue, off, serverTimestamp, runTransaction, push } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js";
import { startMatchMonitoring } from "./game.js"; // Importe la fonction de démarrage du monitoring du match
import { showMessage, updateHealthBar, updateTimerUI, clearHistory, disableActionButtons, enableActionButtons } from "./utils.js"; // Importe les fonctions utilitaires

// Initialiser Auth (app est déjà importé de firebaseConfig.js)
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// Variables globales pour le match en cours
export let currentUser = null;
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
    currentUser = user;
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
    if (!currentUser || !currentUser.uid) {
        console.error("Impossible de mettre à jour les statistiques : utilisateur non connecté.");
        return;
    }

    const userStatsRef = ref(db, `users/${currentUser.uid}/stats`);
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
    document.getElementById("you-pv-display").textContent = "100 PV";
    updateHealthBar("opponent-health-bar", 100);
    document.getElementById("opponent-pv-display").textContent = "100 PV";
    updateTimerUI(timerMax); // Réinitialise l'affichage du timer
    document.getElementById("current-match").textContent = "Aucun";
    document.getElementById("opponent-name").textContent = "Adversaire";
    document.getElementById("you-name").textContent = "Vous";
    showMessage("action-msg", "");
    showMessage("match-msg", ""); // Effacer le message de fin de match
    enableActionButtons(); // S'assurer que les boutons sont activés pour un nouveau match

    // Cacher l'écran de jeu et montrer le menu principal
    document.getElementById("game").style.display = "none";
    document.getElementById("main-menu").style.display = "block";

    if (fromMatchEnd) {
        showMessage("main-menu-msg", "Le match est terminé. Bienvenue au menu principal.");
    } else {
        showMessage("main-menu-msg", "Vous avez quitté le match. Bienvenue au menu principal.");
    }
}


// --- Exécution du code après le chargement complet du DOM ---
document.addEventListener("DOMContentLoaded", () => {
    console.log("DEBUG: DOMContentLoaded fired! HTML elements should be available now."); // <--- LOG DE DEBUG

    // Tout le code qui interagit avec les éléments HTML doit être ici
    const authSection = document.getElementById("auth");
    const mainMenuSection = document.getElementById("main-menu");
    const userInfoSpan = document.getElementById("user-info");
    const loginBtn = document.getElementById("login-btn");
    const logoutBtn = document.getElementById("logout-btn");
    const usernameInput = document.getElementById("username-input");
    const pseudoDisplay = document.getElementById("pseudo-display");
    const playerStatsDisplay = document.getElementById("player-stats");

    // --- Fonctions d'authentification (déplacées ici) ---
    onAuthStateChanged(auth, (user) => {
        if (user) {
            currentUser = user;
            console.log("Utilisateur connecté :", user.displayName || user.email);
            if (userInfoSpan) userInfoSpan.textContent = `Connecté en tant que : ${user.displayName || user.email}`;
            if (loginBtn) loginBtn.style.display = "none";
            if (logoutBtn) logoutBtn.style.display = "block";
            if (authSection) authSection.style.display = "none";
            if (mainMenuSection) mainMenuSection.style.display = "block";

            // Charger le pseudo personnalisé ou utiliser le displayName
            const userRef = ref(db, `users/${user.uid}`);
            get(userRef).then(snapshot => {
                if (snapshot.exists()) {
                    const userData = snapshot.val();
                    currentUser.pseudo = userData.pseudo || user.displayName; // Attribue le pseudo à l'objet currentUser
                    if (pseudoDisplay) pseudoDisplay.textContent = `Pseudo: ${currentUser.pseudo}`;
                    updateUserStatsDisplay(userData.stats);
                } else {
                    // Si l'utilisateur n'a pas de données, créer une entrée avec le displayName comme pseudo
                    set(userRef, {
                        pseudo: user.displayName,
                        stats: { wins: 0, losses: 0, draws: 0 }
                    }).then(() => {
                        currentUser.pseudo = user.displayName;
                        if (pseudoDisplay) pseudoDisplay.textContent = `Pseudo: ${currentUser.pseudo}`;
                        updateUserStatsDisplay({ wins: 0, losses: 0, draws: 0 });
                    }).catch(error => console.error("Erreur création profil utilisateur:", error));
                }
            }).catch(error => console.error("Erreur lecture profil utilisateur:", error));
        } else {
            currentUser = null;
            console.log("Aucun utilisateur connecté.");
            if (userInfoSpan) userInfoSpan.textContent = "Non connecté";
            if (loginBtn) loginBtn.style.display = "block";
            if (logoutBtn) logoutBtn.style.display = "none";
            if (authSection) authSection.style.display = "block";
            if (mainMenuSection) mainMenuSection.style.display = "none";
            if (pseudoDisplay) pseudoDisplay.textContent = "";
            if (playerStatsDisplay) playerStatsDisplay.innerHTML = "";
        }
    });

    if (loginBtn) {
        loginBtn.addEventListener("click", () => {
            const provider = new GoogleAuthProvider();
            signInWithPopup(auth, provider)
                .catch((error) => {
                    console.error("Erreur de connexion:", error);
                    showMessage("auth-msg", "Erreur de connexion.");
                });
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener("click", () => {
            signOut(auth).then(() => {
                showMessage("auth-msg", "Déconnecté avec succès.");
            }).catch((error) => {
                console.error("Erreur de déconnexion:", error);
                showMessage("auth-msg", "Erreur de déconnexion.");
            });
        });
    }

    const saveUsernameBtn = document.getElementById("save-username-btn");
    if (saveUsernameBtn) {
        saveUsernameBtn.addEventListener("click", async () => {
            if (currentUser) {
                const newPseudo = usernameInput ? usernameInput.value.trim() : '';
                if (newPseudo) {
                    const userRef = ref(db, `users/${currentUser.uid}`);
                    try {
                        await update(userRef, { pseudo: newPseudo });
                        currentUser.pseudo = newPseudo;
                        if (pseudoDisplay) pseudoDisplay.textContent = `Pseudo: ${newPseudo}`;
                        showMessage("auth-msg", "Pseudo mis à jour !");
                    } catch (error) {
                        console.error("Erreur lors de la mise à jour du pseudo :", error);
                        showMessage("auth-msg", "Erreur lors de la mise à jour du pseudo.");
                    }
                } else {
                    showMessage("auth-msg", "Le pseudo ne peut pas être vide.");
                }
            } else {
                showMessage("auth-msg", "Vous devez être connecté pour changer de pseudo.");
            }
        });
    }

    // --- Fonctions du menu principal (déplacées ici) ---
    const playIaBtn = document.getElementById("play-ia-btn");
    if (playIaBtn) {
        playIaBtn.addEventListener("click", async () => {
            console.log("Clic sur 'Jouer contre l'IA'.");
            if (!currentUser) {
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
                        uid: currentUser.uid,
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
                startMatchMonitoring(matchId, currentUser, 'p1', 'PvAI'); // Démarre la surveillance
                showMessage("main-menu-msg", "Match contre l'IA lancé !");
            } catch (error) {
                console.error("Erreur lors de la création du match IA :", error);
                showMessage("main-menu-msg", "Échec de la création du match IA.");
            }
        });
    }

    const playPlayerBtn = document.getElementById("play-player-btn");
    if (playPlayerBtn) {
        playPlayerBtn.addEventListener("click", async () => {
            showMessage("main-menu-msg", "Fonctionnalité 'Jouer contre un joueur' en développement.");
        });
    }

    const howToPlayBtn = document.getElementById("how-to-play-btn");
    if (howToPlayBtn) {
        howToPlayBtn.addEventListener("click", () => {
            alert("Comment jouer : Attaque pour infliger des dégâts, Défend pour réduire les dégâts entrants, Soigne pour restaurer des PV (avec cooldown). Le premier à 0 PV perd !");
        });
    }

    // Initialisation de l'affichage du timer au chargement initial
    updateTimerUI(timerMax);

}); // Fin de DOMContentLoaded
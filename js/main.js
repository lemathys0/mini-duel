// main.js - Mise à jour de la fonction `createMatch` et ajout de la gestion PvP

import { app } from "./firebaseConfig.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js";
import { db } from "./firebaseConfig.js";
import { ref, push, set, onValue, update, remove, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js";
import { startMatchMonitoring } from "./game.js"; // Assurez-vous que game.js est bien importé
import { showMessage, updateHealthBar, updateTimerUI, clearHistory, disableActionButtons } from "./utils.js"; // Assurez-vous que utils.js est bien importé

const auth = getAuth(app);

// Variables globales pour le match
export let currentUser = null;
export let currentMatchId = null;
export let youKey = null; // 'p1' or 'p2'
export let opponentKey = null; // 'p1' or 'p2'
export let gameMode = null; // 'PvAI' or 'PvP'

// Variables de contrôle du timer et de déconnexion
export const timerMax = 30; // 30 secondes par tour
export let timerInterval = null;
export function setTimerInterval(interval) { timerInterval = interval; }

export let onDisconnectRef = null;
export function setOnDisconnectRef(ref) { onDisconnectRef = ref; }

export let matchDeletionTimeout = null;
export function setMatchDeletionTimeout(timeout) { matchDeletionTimeout = timeout; }

export let hasPlayedThisTurn = false;
export function setHasPlayedThisTurn(bool) { hasPlayedThisTurn = bool; }


// --- NOUVELLE FONCTION POUR GÉRER LA SÉLECTION DU MODE DE JEU ---
function setupGameModeSelection() {
    document.getElementById("start-ai-game-btn").addEventListener("click", () => {
        if (currentUser) {
            createMatch('PvAI');
        } else {
            showMessage("auth-msg", "Veuillez vous connecter pour démarrer un match IA.");
        }
    });

    document.getElementById("start-pvp-game-btn").addEventListener("click", () => {
        if (currentUser) {
            findOrCreatePvPMatch();
        } else {
            showMessage("auth-msg", "Veuillez vous connecter pour démarrer un match PvP.");
        }
    });
}
// --- FIN NOUVELLE FONCTION ---


// Fonction d'authentification anonyme
async function authenticateAnonymously() {
    try {
        const userCredential = await signInAnonymously(auth);
        currentUser = userCredential.user;
        console.log("Authenticated anonymously:", currentUser.uid);
        // Récupérer le pseudo ou en générer un
        const userRef = ref(db, `users/${currentUser.uid}`);
        onValue(userRef, (snapshot) => {
            const userData = snapshot.val();
            if (userData && userData.pseudo) {
                currentUser.pseudo = userData.pseudo;
            } else {
                currentUser.pseudo = `Joueur_${Math.floor(Math.random() * 10000)}`;
                set(userRef, { pseudo: currentUser.pseudo, wins: 0, losses: 0, draws: 0 }); // Initialise les stats aussi
            }
            document.getElementById("pseudo-display").textContent = `Connecté en tant que : ${currentUser.pseudo}`;
            document.getElementById("auth-msg").textContent = "Connecté. Choisissez un mode de jeu.";
            document.getElementById("main-menu").style.display = "block";
            document.getElementById("auth-section").style.display = "none";
        }, {
            onlyOnce: true
        });

        // Setup le bouton de déconnexion
        document.getElementById("logout-btn").addEventListener("click", async () => {
            if (currentUser) {
                try {
                    await signOut(auth);
                    currentUser = null;
                    document.getElementById("pseudo-display").textContent = "Non connecté";
                    document.getElementById("auth-msg").textContent = "Déconnecté.";
                    document.getElementById("main-menu").style.display = "none";
                    document.getElementById("auth-section").style.display = "block";
                } catch (error) {
                    console.error("Error signing out:", error);
                    showMessage("auth-msg", "Erreur lors de la déconnexion.");
                }
            }
        });
    } catch (error) {
        console.error("Authentication error:", error);
        showMessage("auth-msg", "Échec de l'authentification. Veuillez réessayer.");
    }
}

// Vérifie l'état de l'authentification au chargement de la page
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        // Comme précédemment, récupérer le pseudo
        const userRef = ref(db, `users/${currentUser.uid}`);
        onValue(userRef, (snapshot) => {
            const userData = snapshot.val();
            if (userData && userData.pseudo) {
                currentUser.pseudo = userData.pseudo;
            } else {
                currentUser.pseudo = `Joueur_${Math.floor(Math.random() * 10000)}`;
                set(userRef, { pseudo: currentUser.pseudo, wins: 0, losses: 0, draws: 0 });
            }
            document.getElementById("pseudo-display").textContent = `Connecté en tant que : ${currentUser.pseudo}`;
            document.getElementById("auth-msg").textContent = "Connecté. Choisissez un mode de jeu.";
            document.getElementById("main-menu").style.display = "block";
            document.getElementById("auth-section").style.display = "none";
            setupGameModeSelection(); // Appelle la fonction de sélection du mode de jeu
        }, {
            onlyOnce: true
        });

        // Setup le bouton de déconnexion
        document.getElementById("logout-btn").addEventListener("click", async () => {
            if (currentUser) {
                try {
                    await signOut(auth);
                    currentUser = null;
                    document.getElementById("pseudo-display").textContent = "Non connecté";
                    document.getElementById("auth-msg").textContent = "Déconnecté.";
                    document.getElementById("main-menu").style.display = "none";
                    document.getElementById("auth-section").style.display = "block";
                } catch (error) {
                    console.error("Error signing out:", error);
                    showMessage("auth-msg", "Erreur lors de la déconnexion.");
                }
            }
        });

    } else {
        currentUser = null;
        document.getElementById("pseudo-display").textContent = "Non connecté";
        document.getElementById("auth-msg").textContent = "Veuillez vous connecter.";
        document.getElementById("main-menu").style.display = "none";
        document.getElementById("auth-section").style.display = "block";
        document.getElementById("connect-btn").addEventListener("click", authenticateAnonymously);
    }
});


// Fonction pour créer un match (PvAI ou PvP)
async function createMatch(mode) {
    const pseudo = currentUser.pseudo;
    const newMatchRef = push(ref(db, 'matches'));
    const newMatchId = newMatchRef.key;

    const initialData = {
        createdAt: serverTimestamp(),
        status: mode === 'PvP' ? 'waiting' : 'playing', // PvP: waiting; PvAI: playing
        turn: 'p1', // P1 commence toujours
        mode: mode, // <-- AJOUT IMPORTANT : le mode du match
        players: {
            p1: {
                pseudo: pseudo,
                pv: 100,
                status: 'connected',
                lastSeen: serverTimestamp(),
                action: null,
                lastAction: null,
                healCooldown: 0,
            }
        },
        history: [`Match ${mode === 'PvP' ? 'PvP' : 'IA'} créé par ${pseudo}. ${mode === 'PvP' ? 'En attente d\'un adversaire...' : 'Le duel contre l\'IA commence !'}`],
        lastTurnProcessedAt: serverTimestamp()
    };

    if (mode === 'PvAI') {
        initialData.players.p2 = {
            pseudo: 'IA',
            pv: 100,
            status: 'connected', // L'IA est toujours 'connectée'
            lastSeen: serverTimestamp(),
            action: null,
            lastAction: null,
            healCooldown: 0,
        };
    }

    try {
        await set(newMatchRef, initialData);
        if (mode === 'PvP') {
            showMessage("match-msg", `Match PvP créé. ID: ${newMatchId}. En attente d'un adversaire...`);
            // Mettre à jour l'UI pour la recherche/attente
            document.getElementById("menu").style.display = "none";
            document.getElementById("matchmaking-status").style.display = "block";
            document.getElementById("matchmaking-status").textContent = `Recherche un adversaire pour le match ${newMatchId}...`;
            // Lancer la surveillance du match pour le joueur créateur
            startMatchMonitoring(newMatchId, currentUser, 'p1', mode);
        } else {
            // Mode PvAI, on passe directement au jeu
            startMatchMonitoring(newMatchId, currentUser, 'p1', mode);
        }
    } catch (error) {
        console.error("Error creating match:", error);
        showMessage("match-msg", "Erreur lors de la création du match.");
    }
}

// --- NOUVELLE FONCTION POUR RECHERCHER OU CRÉER UN MATCH PVP ---
async function findOrCreatePvPMatch() {
    showMessage("match-msg", "Recherche de matchs PvP disponibles...");
    const matchesRef = ref(db, 'matches');
    let foundMatch = false;

    // Écoute des matchs disponibles pour qu'un joueur puisse les rejoindre
    // onValue continuera d'écouter, ce qui est nécessaire pour PvP
    onValue(matchesRef, async (snapshot) => {
        const matchesData = snapshot.val();
        if (foundMatch) return; // Si un match a déjà été trouvé et rejoint, ne pas en chercher d'autres

        for (const matchId in matchesData) {
            const match = matchesData[matchId];
            // Vérifier si le match est en attente, en mode PvP et n'a qu'un seul joueur (p1)
            if (match.status === 'waiting' && match.mode === 'PvP' && match.players && match.players.p1 && !match.players.p2) {
                // S'assurer que le joueur actuel n'est pas déjà p1 de ce match (cas de rechargement)
                if (match.players.p1.pseudo !== currentUser.pseudo) {
                    foundMatch = true;
                    try {
                        const updates = {};
                        updates[`matches/${matchId}/players/p2`] = {
                            pseudo: currentUser.pseudo,
                            pv: 100,
                            status: 'connected',
                            lastSeen: serverTimestamp(),
                            action: null,
                            lastAction: null,
                            healCooldown: 0,
                        };
                        updates[`matches/${matchId}/status`] = 'playing';
                        updates[`matches/${matchId}/history`] = [...(match.history || []), `${currentUser.pseudo} a rejoint le match ! Le duel commence !`];

                        await update(ref(db), updates);
                        showMessage("match-msg", `Vous avez rejoint le match ${matchId} !`);
                        document.getElementById("matchmaking-status").style.display = "none";
                        startMatchMonitoring(matchId, currentUser, 'p2', 'PvP');
                        return; // Quitter la boucle et l'écoute une fois le match trouvé/rejoint
                    } catch (error) {
                        console.error("Error joining match:", error);
                        showMessage("match-msg", "Erreur lors de la tentative de rejoindre un match.");
                        foundMatch = false; // Réinitialiser pour réessayer
                    }
                }
            }
        }

        // Si aucun match n'a été trouvé après avoir parcouru tous les matchs (et qu'on n'est pas déjà en train de créer un match ou d'en attendre un)
        // Note: La condition `!foundMatch` est importante pour éviter de créer un match si on vient d'en rejoindre un.
        // Il faudra peut-être une variable de contrôle plus robuste ici pour la gestion des "onValue"
        if (!foundMatch && !currentMatchId) { // currentMatchId indique qu'on est déjà dans un match ou en train de le créer/rejoindre
             // Si aucun match n'est trouvé, créer un nouveau match
            showMessage("match-msg", "Aucun match disponible. Création d'un nouveau match PvP...");
            createMatch('PvP'); // Crée un nouveau match PvP en attente
            foundMatch = true; // Pour éviter une boucle de création de match dans onValue
        }
    }, (error) => {
        console.error("Error listening for matches:", error);
        showMessage("match-msg", "Erreur lors de la recherche de matchs.");
    });
}
// --- FIN NOUVELLE FONCTION ---

// Fonction de retour au menu
export function backToMenu(fromGame = false) {
    if (fromGame) {
        document.getElementById("game").style.display = "none";
        document.getElementById("main-menu").style.display = "block";
        document.getElementById("matchmaking-status").style.display = "none"; // Cacher le statut si on revient de partie
        showMessage("match-msg", " "); // Effacer le message de match

        // Réinitialiser les variables globales du match
        currentMatchId = null;
        youKey = null;
        opponentKey = null;
        gameMode = null;

        // Annuler les écouteurs Firebase et les timers
        if (currentMatchUnsubscribe) { currentMatchUnsubscribe(); currentMatchUnsubscribe = null; }
        if (timerInterval) { clearInterval(timerInterval); setTimerInterval(null); }
        if (onDisconnectRef) { onDisconnectRef.cancel().catch(err => console.error("Error cancelling old onDisconnect:", err)); setOnDisconnectRef(null); }
        if (matchDeletionTimeout) { clearTimeout(matchDeletionTimeout); setMatchDeletionTimeout(null); }
        setHasPlayedThisTurn(false);
    } else {
        document.getElementById("main-menu").style.display = "block";
        document.getElementById("auth-section").style.display = "none";
        document.getElementById("matchmaking-status").style.display = "none";
        showMessage("match-msg", " ");
    }
}

// Mise à jour des statistiques de l'utilisateur
export async function updateUserStats(result) {
    if (!currentUser || !currentUser.uid) return;

    const userStatsRef = ref(db, `users/${currentUser.uid}`);
    const snapshot = await get(userStatsRef);
    const currentStats = snapshot.val() || { wins: 0, losses: 0, draws: 0 };

    let updates = { ...currentStats };

    if (result === 'win') {
        updates.wins = (updates.wins || 0) + 1;
    } else if (result === 'loss') {
        updates.losses = (updates.losses || 0) + 1;
    } else if (result === 'draw') {
        updates.draws = (updates.draws || 0) + 1;
    }

    try {
        await update(userStatsRef, updates);
        console.log("User stats updated:", updates);
    } catch (error) {
        console.error("Error updating user stats:", error);
    }
}

// Initialisation au chargement de la page
// (Cette partie est gérée par onAuthStateChanged maintenant)
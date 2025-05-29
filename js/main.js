import { app } from "./firebaseConfig.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js";
import { db } from "./firebaseConfig.js";
import { ref, push, set, onValue, update, remove, serverTimestamp, get } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js";
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

// Permet à game.js de mettre à jour les variables globales du match
export function setMatchVariables(id, user, playerKey, mode) {
    currentMatchId = id;
    currentUser = user; 
    youKey = playerKey;
    opponentKey = (playerKey === 'p1') ? 'p2' : 'p1';
    gameMode = mode;
    console.log(`Match variables set: ID=${currentMatchId}, YouKey=${youKey}, OpponentKey=${opponentKey}, Mode=${gameMode}`);
}


// --- GESTION DES MODES DE JEU ET AUTHENTIFICATION ---

// Fonction pour configurer les écouteurs de sélection de mode de jeu
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

    document.getElementById("cancel-matchmaking-btn").addEventListener("click", () => {
        backToMenu(true); // Retour au menu principal
        showMessage("match-msg", "Recherche de match annulée.");
    });
}


// Fonction d'authentification anonyme
async function authenticateAnonymously() {
    try {
        const userCredential = await signInAnonymously(auth);
        currentUser = userCredential.user;
        console.log("Authenticated anonymously:", currentUser.uid);
        
        // Récupérer le pseudo ou en générer un
        const userRef = ref(db, `users/${currentUser.uid}`);
        const snapshot = await get(userRef); // Utiliser get() pour lire une seule fois
        const userData = snapshot.val();

        if (userData && userData.pseudo) {
            currentUser.pseudo = userData.pseudo;
        } else {
            currentUser.pseudo = `Joueur_${Math.floor(Math.random() * 10000)}`;
            // Initialise les stats aussi si c'est un nouvel utilisateur
            await set(userRef, { pseudo: currentUser.pseudo, wins: 0, losses: 0, draws: 0 }); 
        }
        document.getElementById("pseudo-display").textContent = `Connecté en tant que : ${currentUser.pseudo}`;
        document.getElementById("player-name").textContent = currentUser.pseudo; // Met à jour le nom dans le titre du menu
        document.getElementById("auth-msg").textContent = "Connecté. Choisissez un mode de jeu.";
        document.getElementById("main-menu").style.display = "block";
        document.getElementById("auth").style.display = "none";
        setupGameModeSelection(); // Appelle la fonction de sélection du mode de jeu
        setupLogoutButton(); // Configure le bouton de déconnexion
    } catch (error) {
        console.error("Authentication error:", error);
        showMessage("auth-msg", "Échec de l'authentification. Veuillez réessayer.");
    }
}

// Configure le bouton de déconnexion
function setupLogoutButton() {
    document.getElementById("logout-btn").addEventListener("click", async () => {
        if (currentUser) {
            try {
                await signOut(auth);
                currentUser = null;
                document.getElementById("pseudo-display").textContent = "Non connecté";
                document.getElementById("player-name").textContent = ""; // Réinitialise le nom
                document.getElementById("auth-msg").textContent = "Déconnecté.";
                document.getElementById("main-menu").style.display = "none";
                document.getElementById("auth").style.display = "block";
                // Nettoie les écouteurs de mode de jeu pour éviter des problèmes après déconnexion
                document.getElementById("start-ai-game-btn").removeEventListener("click", null); 
                document.getElementById("start-pvp-game-btn").removeEventListener("click", null);
                document.getElementById("cancel-matchmaking-btn").removeEventListener("click", null);
            } catch (error) {
                console.error("Error signing out:", error);
                showMessage("auth-msg", "Erreur lors de la déconnexion.");
            }
        }
    });
}


// Vérifie l'état de l'authentification au chargement de la page
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        const userRef = ref(db, `users/${currentUser.uid}`);
        const snapshot = await get(userRef);
        const userData = snapshot.val();

        if (userData && userData.pseudo) {
            currentUser.pseudo = userData.pseudo;
        } else {
            currentUser.pseudo = `Joueur_${Math.floor(Math.random() * 10000)}`;
            await set(userRef, { pseudo: currentUser.pseudo, wins: 0, losses: 0, draws: 0 });
        }
        document.getElementById("pseudo-display").textContent = `Connecté en tant que : ${currentUser.pseudo}`;
        document.getElementById("player-name").textContent = currentUser.pseudo;
        document.getElementById("auth-msg").textContent = "Connecté. Choisissez un mode de jeu.";
        document.getElementById("main-menu").style.display = "block";
        document.getElementById("auth").style.display = "none";
        setupGameModeSelection();
        setupLogoutButton();
    } else {
        currentUser = null;
        document.getElementById("pseudo-display").textContent = "Non connecté";
        document.getElementById("player-name").textContent = "";
        document.getElementById("auth-msg").textContent = "Veuillez vous connecter.";
        document.getElementById("main-menu").style.display = "none";
        document.getElementById("auth").style.display = "block";
        document.getElementById("login-btn").addEventListener("click", authenticateAnonymously); // Connecte anonymement si pas d'auth
        // Optionnel: Si vous avez un bouton d'inscription pour l'auth par pseudo/code, vous le configurez ici.
        // Pour l'instant, on n'utilise que l'authentification anonyme pour simplifier.
    }
});


// --- LOGIQUE DE CRÉATION/RECHERCHE DE MATCH ---

// Fonction pour créer un match (PvAI ou PvP)
async function createMatch(mode) {
    if (!currentUser || !currentUser.pseudo) {
        showMessage("match-msg", "Erreur: Pseudo non défini. Veuillez vous reconnecter.");
        return;
    }

    const pseudo = currentUser.pseudo;
    const newMatchRef = push(ref(db, 'matches'));
    const newMatchId = newMatchRef.key;

    const initialData = {
        createdAt: serverTimestamp(),
        status: mode === 'PvP' ? 'waiting' : 'playing', // PvP: waiting; PvAI: playing
        turn: 'p1', // P1 commence toujours
        mode: mode, // AJOUT IMPORTANT : le mode du match ('PvAI' ou 'PvP')
        players: {
            p1: {
                pseudo: pseudo,
                pv: 100,
                status: 'connected', // 'connected', 'forfeited'
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
            lastSeen: serverTimestamp(), // L'IA n'a pas de 'lastSeen' réel mais on le met pour la cohérence
            action: null,
            lastAction: null,
            healCooldown: 0,
        };
    }

    try {
        await set(newMatchRef, initialData);
        if (mode === 'PvP') {
            showMessage("match-msg", `Match PvP créé. ID: ${newMatchId}. En attente d'un adversaire...`);
            document.getElementById("main-menu").style.display = "none";
            document.getElementById("matchmaking-status").style.display = "block";
            document.getElementById("matchmaking-message").textContent = `Recherche un adversaire pour le match ${newMatchId}...`;
            
            // Lancer la surveillance du match pour le joueur créateur (p1)
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

let pvpMatchFinderUnsubscribe = null; // Variable pour stocker la fonction d'unsubscribe

// Fonction pour rechercher ou créer un match PvP
async function findOrCreatePvPMatch() {
    showMessage("match-msg", "Recherche de matchs PvP disponibles...");
    document.getElementById("main-menu").style.display = "none";
    document.getElementById("matchmaking-status").style.display = "block";
    document.getElementById("matchmaking-message").textContent = "Recherche un adversaire...";

    const matchesRef = ref(db, 'matches');
    let foundAndJoinedMatch = false; // Flag pour s'assurer qu'on ne rejoint qu'un seul match

    // Si un listener existait, annulez-le pour éviter les écoutes multiples
    if (pvpMatchFinderUnsubscribe) {
        pvpMatchFinderUnsubscribe();
        pvpMatchFinderUnsubscribe = null;
    }

    pvpMatchFinderUnsubscribe = onValue(matchesRef, async (snapshot) => {
        const matchesData = snapshot.val();
        
        // Si un match a déjà été trouvé et rejoint par ce client, on ne fait rien
        if (foundAndJoinedMatch) {
            return;
        }

        let matchFound = false;
        for (const matchId in matchesData) {
            const match = matchesData[matchId];
            // Vérifier si le match est en attente, en mode PvP, et n'a qu'un seul joueur (p1)
            if (match.status === 'waiting' && match.mode === 'PvP' && match.players && match.players.p1 && !match.players.p2) {
                // S'assurer que le joueur actuel n'est pas déjà p1 de ce match (cas de rechargement/multi-onglets du même joueur)
                if (match.players.p1.pseudo !== currentUser.pseudo) {
                    foundAndJoinedMatch = true; // Définir le flag pour éviter de rejoindre d'autres matchs
                    matchFound = true; // Indique qu'un match a été trouvé
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
                        
                        // Annuler le listener de recherche de match après avoir rejoint
                        if (pvpMatchFinderUnsubscribe) {
                            pvpMatchFinderUnsubscribe();
                            pvpMatchFinderUnsubscribe = null;
                        }
                        return; // Quitter la boucle et la fonction onValue
                    } catch (error) {
                        console.error("Error joining match:", error);
                        showMessage("match-msg", "Erreur lors de la tentative de rejoindre un match.");
                        foundAndJoinedMatch = false; // Réinitialiser le flag si l'opération échoue
                        matchFound = false; // Réinitialiser si l'opération échoue
                    }
                }
            }
        }

        // Si aucun match n'a été trouvé après avoir parcouru tous les matchs
        // ET si on n'est pas déjà en train de créer/rejoindre un match
        if (!matchFound && !foundAndJoinedMatch && !currentMatchId) { 
             showMessage("match-msg", "Aucun match disponible. Création d'un nouveau match PvP...");
             document.getElementById("matchmaking-message").textContent = "Aucun match disponible. Création d'un nouveau match...";
             createMatch('PvP'); // Crée un nouveau match PvP en attente
             foundAndJoinedMatch = true; // Pour éviter une boucle de création de match dans onValue
             
             // Annuler le listener de recherche de match après avoir créé le match
             if (pvpMatchFinderUnsubscribe) {
                 pvpMatchFinderUnsubscribe();
                 pvpMatchFinderUnsubscribe = null;
             }
        }
    }, (error) => {
        console.error("Error listening for matches:", error);
        showMessage("match-msg", "Erreur lors de la recherche de matchs.");
    });
}


// --- GESTION DE LA FIN DE MATCH ET DU RETOUR AU MENU ---

// Fonction de retour au menu
export function backToMenu(fromGame = false) {
    // Si on revient du jeu ou de la recherche de match
    if (fromGame) {
        document.getElementById("game").style.display = "none";
        document.getElementById("main-menu").style.display = "block";
        document.getElementById("matchmaking-status").style.display = "none"; 
        showMessage("match-msg", ""); // Effacer le message de match
        showMessage("action-msg", ""); // Effacer le message d'action
        document.getElementById("matchmaking-message").textContent = ""; // Effacer message matchmaking

        // Réinitialiser les variables globales du match
        currentMatchId = null;
        youKey = null;
        opponentKey = null;
        gameMode = null;

        // Annuler les écouteurs Firebase et les timers
        // currentMatchUnsubscribe est géré dans game.js
        if (timerInterval) { clearInterval(timerInterval); setTimerInterval(null); }
        if (onDisconnectRef) { onDisconnectRef.cancel().catch(err => console.error("Error cancelling old onDisconnect:", err)); setOnDisconnectRef(null); }
        if (matchDeletionTimeout) { clearTimeout(matchDeletionTimeout); setMatchDeletionTimeout(null); }
        setHasPlayedThisTurn(false);

        // Annuler le listener de recherche de match si on revient au menu principal
        if (pvpMatchFinderUnsubscribe) {
            pvpMatchFinderUnsubscribe();
            pvpMatchFinderUnsubscribe = null;
        }

    } else { // Si on revient d'une autre section (ex: auth)
        document.getElementById("main-menu").style.display = "block";
        document.getElementById("auth").style.display = "none";
        document.getElementById("matchmaking-status").style.display = "none";
        showMessage("match-msg", "");
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
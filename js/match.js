import { db } from "./firebaseConfig.js";
import { ref, set, get, update, remove, onValue, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js";
import { showMessage } from "./utils.js";
import { startGame, backToMenu } from "./main.js"; // Importez les fonctions de main

let unsubscribeMatchCreationListener = null;

export function setupMatchListeners(currentUser) {
    document.getElementById("create-match-btn").onclick = async () => {
        const matchId = document.getElementById("match-id").value.trim();
        if (!matchId) {
            showMessage("match-msg", "Veuillez indiquer un code pour le match.");
            return;
        }

        const matchRef = ref(db, `matches/${matchId}`);
        try {
            const snapshot = await get(matchRef);
            if (snapshot.exists()) {
                showMessage("match-msg", "Ce code de match est déjà utilisé.");
            } else {
                const initialMatchData = {
                    players: {
                        p1: { pseudo: currentUser.pseudo, pv: 100, status: 'connected', lastSeen: serverTimestamp(), action: null },
                        p2: null
                    },
                    turn: "p1",
                    history: [`Match ${matchId} créé par ${currentUser.pseudo}. En attente d'un adversaire...`],
                    status: "waiting",
                    createdAt: serverTimestamp(),
                    lastTurnProcessedAt: serverTimestamp()
                };
                await set(matchRef, initialMatchData);
                showMessage("match-msg", "Match créé. En attente de l'adversaire...", true);
                startGame(matchId, currentUser, 'p1', 'PvP');

                if (unsubscribeMatchCreationListener) unsubscribeMatchCreationListener();
                unsubscribeMatchCreationListener = onValue(matchRef, (matchSnapshot) => {
                    const matchData = matchSnapshot.val();
                    if (!matchData) {
                        if (unsubscribeMatchCreationListener) unsubscribeMatchCreationListener();
                        unsubscribeMatchCreationListener = null;
                        return;
                    }
                    if (matchData.status === 'waiting' && !matchData.players.p2 && matchData.createdAt) {
                        const timeElapsed = Date.now() - matchData.createdAt;
                        if (timeElapsed > 60000) {
                            console.log(`Match ${matchId} non rejoint après 1 minute, suppression.`);
                            remove(matchRef)
                                .then(() => {
                                    showMessage("match-msg", "Match expiré et supprimé (aucun adversaire).");
                                    backToMenu(true);
                                })
                                .catch(err => console.error("Error removing expired match:", err));
                            if (unsubscribeMatchCreationListener) unsubscribeMatchCreationListener();
                            unsubscribeMatchCreationListener = null;
                        }
                    } else if (matchData.players.p2 && matchData.status === 'playing') {
                        if (unsubscribeMatchCreationListener) unsubscribeMatchCreationListener();
                        unsubscribeMatchCreationListener = null;
                    }
                });
            }
        } catch (error) {
            console.error("Error creating match:", error);
            showMessage("match-msg", "Erreur lors de la création du match.");
        }
    };

    document.getElementById("join-match-btn").onclick = async () => {
        const matchId = document.getElementById("match-id").value.trim();
        if (!matchId) {
            showMessage("match-msg", "Veuillez indiquer un code de match.");
            return;
        }

        const matchRef = ref(db, `matches/${matchId}`);
        try {
            const snapshot = await get(matchRef);
            if (!snapshot.exists()) {
                showMessage("match-msg", "Ce match n'existe pas.");
                return;
            }

            const matchData = snapshot.val();
            if (matchData.players.p1 && matchData.players.p1.pseudo === currentUser.pseudo) {
                showMessage("match-msg", "Vous êtes déjà le créateur de ce match. Attendez un joueur.");
                startGame(matchId, currentUser, 'p1', 'PvP');
                return;
            }
            if (matchData.players.p2) {
                showMessage("match-msg", "Ce match est déjà complet.");
                return;
            }
            if (matchData.status !== 'waiting') {
                showMessage("match-msg", "Ce match n'est plus en attente de joueurs.");
                return;
            }

            const updates = {};
            updates[`players/p2`] = { pseudo: currentUser.pseudo, pv: 100, status: 'connected', lastSeen: serverTimestamp(), action: null };
            updates[`status`] = 'playing';
            updates[`history`] = [...(matchData.history || []), `${currentUser.pseudo} a rejoint le match ! Le duel commence.`];
            updates[`lastTurnProcessedAt`] = serverTimestamp();

            await update(matchRef, updates);
            showMessage("match-msg", "Vous avez rejoint le match !", true);
            startGame(matchId, currentUser, 'p2', 'PvP');
        } catch (error) {
            console.error("Error joining match:", error);
            showMessage("match-msg", "Erreur pour rejoindre le match.");
        }
    };

    document.getElementById("play-ai-btn").onclick = async () => {
        const aiMatchId = "AI_" + currentUser.pseudo + "_" + Date.now().toString().slice(-6);

        const matchRef = ref(db, `matches/${aiMatchId}`);
        const initialMatchData = {
            players: {
                p1: { pseudo: currentUser.pseudo, pv: 100, status: 'connected', lastSeen: serverTimestamp(), action: null },
                p2: { pseudo: "IA", pv: 100, status: 'connected', lastSeen: serverTimestamp(), action: null }
            },
            turn: "p1",
            history: [`Match IA ${aiMatchId} créé par ${currentUser.pseudo}. Le duel contre l'IA commence !`],
            status: "playing",
            createdAt: serverTimestamp(),
            lastTurnProcessedAt: serverTimestamp()
        };

        try {
            await set(matchRef, initialMatchData);
            showMessage("match-msg", "Match contre l'IA créé. Bonne chance !", true);
            startGame(aiMatchId, currentUser, 'p1', 'PvAI');
        } catch (error) {
            console.error("Error creating AI match:", error);
            showMessage("match-msg", "Erreur lors de la création du match IA.");
        }
    };
} 

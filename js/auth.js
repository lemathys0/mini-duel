// js/auth.js

import { db } from "./firebaseConfig.js";
import { ref, set, get, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js";
import { showMessage } from "./utils.js";

// Cette fonction sera appelée par main.js pour gérer la connexion/déconnexion
// Elle prendra en paramètre les fonctions de main.js pour mettre à jour l'UI
export function setupAuthListeners(handleUserLogin, handleUserLogout) {
    const pseudoInput = document.getElementById("pseudo-input");
    const codeInput = document.getElementById("code-input");
    const signupBtn = document.getElementById("signup-btn");
    const loginBtn = document.getElementById("login-btn");
    const logoutBtn = document.getElementById("logout-btn");

    if (signupBtn) {
        signupBtn.addEventListener("click", async () => {
            const pseudo = pseudoInput ? pseudoInput.value.trim() : '';
            const code = codeInput ? codeInput.value.trim() : '';

            if (pseudo.length < 2) {
                showMessage("auth-msg", "Pseudo trop court (min 2 caractères).");
                return;
            }
            if (!/^\d{4}$/.test(code)) {
                showMessage("auth-msg", "Code doit être composé de 4 chiffres.");
                return;
            }

            const userRef = ref(db, `users/${pseudo}`);
            try {
                const snapshot = await get(userRef);
                if (snapshot.exists()) {
                    showMessage("auth-msg", "Ce pseudo est déjà pris.");
                } else {
                    const initialStats = { wins: 0, losses: 0, draws: 0 };
                    await set(userRef, { code, stats: initialStats, createdAt: serverTimestamp() });
                    showMessage("auth-msg", "Inscription réussie ! Vous pouvez maintenant vous connecter.", true);
                    // Pas de connexion automatique après inscription
                }
            } catch (error) {
                console.error("Signup error:", error);
                showMessage("auth-msg", "Erreur lors de l'inscription.");
            }
        });
    }

    if (loginBtn) {
        loginBtn.addEventListener("click", async () => {
            const pseudo = pseudoInput ? pseudoInput.value.trim() : '';
            const code = codeInput ? codeInput.value.trim() : '';

            if (!pseudo || !code) {
                showMessage("auth-msg", "Pseudo et code requis.");
                return;
            }

            const userRef = ref(db, `users/${pseudo}`);
            try {
                const snapshot = await get(userRef);
                if (!snapshot.exists()) {
                    showMessage("auth-msg", "Pseudo inconnu.");
                } else {
                    const data = snapshot.val();
                    if (data.code === code) {
                        showMessage("auth-msg", "Connexion réussie !", true);
                        handleUserLogin(pseudo, data); // Appelle la fonction de main.js
                    } else {
                        showMessage("auth-msg", "Code incorrect.");
                    }
                }
            } catch (error) {
                console.error("Login error:", error);
                showMessage("auth-msg", "Erreur de base de données.");
            }
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener("click", () => {
            handleUserLogout(); // Appelle la fonction de main.js
        });
    }
}
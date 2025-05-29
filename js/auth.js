import { db } from "./firebaseConfig.js";
import { ref, set, get, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js";
import { showMessage } from "./utils.js";
import { afterLogin } from "./main.js"; // Importez la fonction de main pour gérer le changement d'écran

export function setupAuthListeners() {
    document.getElementById("signup-btn").onclick = async () => {
        const pseudo = document.getElementById("pseudo").value.trim();
        const code = document.getElementById("code").value.trim();

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
                await set(userRef, { code, wins: 0, losses: 0, createdAt: serverTimestamp() });
                showMessage("auth-msg", "Inscription réussie !", true);
                afterLogin({ pseudo, code });
            }
        } catch (error) {
            console.error("Signup error:", error);
            showMessage("auth-msg", "Erreur lors de l'inscription.");
        }
    };

    document.getElementById("login-btn").onclick = async () => {
        const pseudo = document.getElementById("pseudo").value.trim();
        const code = document.getElementById("code").value.trim();

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
                    afterLogin({ pseudo, code });
                } else {
                    showMessage("auth-msg", "Code incorrect.");
                }
            }
        } catch (error) {
            console.error("Login error:", error);
            showMessage("auth-msg", "Erreur de base de données.");
        }
    };
} 

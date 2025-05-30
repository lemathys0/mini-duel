// js/auth.js

// 1. Importe les instances 'auth' et 'db' et les fonctions DB depuis ton fichier de configuration Firebase
import { auth, db, ref, set, get } from './firebaseConfig.js';

// 2. Importe les fonctions spécifiques d'authentification directement depuis la bibliothèque Firebase Auth
import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js"; // L'URL doit correspondre à ta version de Firebase

// Assurez-vous que ces chemins sont corrects pour vos autres fichiers
import { showMessage } from './utils.js';
import { handleUserLogin, handleUserLogout } from './main.js';

console.log("auth.js chargé.");

export function setupAuthListeners() {
    const pseudoInput = document.getElementById('pseudo-input');
    const codeInput = document.getElementById('code-input');
    const signupBtn = document.getElementById('signup-btn');
    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn');

    if (signupBtn) {
        signupBtn.addEventListener('click', async () => {
            const pseudo = pseudoInput.value.trim();
            const code = codeInput.value.trim();

            if (!pseudo || !code) {
                showMessage('auth-msg', 'Veuillez remplir tous les champs.', false);
                return;
            }
            if (code.length !== 4 || isNaN(code)) {
                showMessage('auth-msg', 'Le code doit être un nombre à 4 chiffres.', false);
                return;
            }

            try {
                // Utiliser une adresse email fictive pour l'authentification Firebase Auth
                const email = `${pseudo}@miniduel.com`;
                const userCredential = await createUserWithEmailAndPassword(auth, email, code);
                const user = userCredential.user;

                // Stocker le pseudo dans la base de données sous l'UID Firebase Auth
                await set(ref(db, `users/${user.uid}/pseudo`), pseudo);
                await set(ref(db, `users/${user.uid}/stats`), { wins: 0, losses: 0, draws: 0 }); // Initialiser les stats

                showMessage('auth-msg', 'Inscription réussie !', true);
            } catch (error) {
                console.error("Erreur d'inscription:", error);
                if (error.code === 'auth/email-already-in-use') {
                    showMessage('auth-msg', 'Ce pseudo est déjà utilisé. Veuillez vous connecter ou choisir un autre pseudo.', false);
                } else {
                    showMessage('auth-msg', `Erreur d'inscription: ${error.message}`, false);
                }
            }
        });
    }

    if (loginBtn) {
        loginBtn.addEventListener('click', async () => {
            const pseudo = pseudoInput.value.trim();
            const code = codeInput.value.trim();

            if (!pseudo || !code) {
                showMessage('auth-msg', 'Veuillez remplir tous les champs.', false);
                return;
            }

            try {
                const email = `${pseudo}@miniduel.com`;
                await signInWithEmailAndPassword(auth, email, code);
                showMessage('auth-msg', 'Connexion réussie !', true);
            } catch (error) {
                console.error("Erreur de connexion:", error);
                if (error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found') {
                    showMessage('auth-msg', 'Pseudo ou code incorrect.', false);
                } else {
                    showMessage('auth-msg', `Erreur de connexion: ${error.message}`, false);
                }
            }
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            try {
                await signOut(auth);
                showMessage('auth-msg', 'Déconnexion réussie.', true);
            } catch (error) {
                console.error("Erreur de déconnexion:", error);
                showMessage('auth-msg', `Erreur de déconnexion: ${error.message}`, false);
            }
        });
    }

    // Écouteur d'état d'authentification
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            // Récupérer le pseudo de l'utilisateur via son UID
            const pseudoSnapshot = await get(ref(db, `users/${user.uid}/pseudo`));
            const pseudo = pseudoSnapshot.val();
            if (pseudo) {
                // Passage des données de l'utilisateur à main.js
                handleUserLogin(user.uid, pseudo);
            } else {
                console.warn("Pseudo non trouvé pour l'utilisateur connecté :", user.uid);
                await signOut(auth); // Déconnecte si le pseudo n'est pas trouvé
                handleUserLogout();
            }
        } else {
            handleUserLogout();
        }
    });
}
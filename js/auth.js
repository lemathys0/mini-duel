// js/auth.js

// 1. Importe les instances 'auth' et 'db' et les fonctions DB depuis ton fichier de configuration Firebase
import { auth, db, ref, set, get, query, orderByChild } from './firebaseConfig.js';

// 2. Importe les fonctions spécifiques d'authentification directement depuis la bibliothèque Firebase Auth
import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    GoogleAuthProvider,       // Ajout pour Google Auth
    signInWithPopup,          // Ajout pour Google Auth
    PhoneAuthProvider,        // Ajout pour Phone Auth
    signInWithPhoneNumber,    // Ajout pour Phone Auth
    RecaptchaVerifier         // Ajout pour Phone Auth (reCAPTCHA)
} from "https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js"; // L'URL doit correspondre à ta version de Firebase

// Assurez-vous que ces chemins sont corrects pour vos autres fichiers
import { showMessage } from './utils.js';
import { handleUserLogin, handleUserLogout } from './main.js';

console.log("auth.js chargé.");

// Variable pour stocker le confirmationResult pour l'authentification par téléphone
let confirmationResult = null;

export function setupAuthListeners() {
    // Éléments pour Email/Mot de passe
    const pseudoInput = document.getElementById('pseudo-input');
    const emailInput = document.getElementById('email-input');
    const passwordInput = document.getElementById('password-input');
    const signupEmailBtn = document.getElementById('signup-email-btn');
    const loginEmailBtn = document.getElementById('login-email-btn');
    const authMsgEmail = document.getElementById('auth-msg-email'); // Message spécifique pour email/mdp

    // Éléments pour Google
    const loginGoogleBtn = document.getElementById('login-google-btn');
    const authMsgGoogle = document.getElementById('auth-msg-google'); // Message spécifique pour Google

    // Éléments pour Téléphone
    const phoneInput = document.getElementById('phone-input');
    const sendOtpBtn = document.getElementById('send-otp-btn');
    const otpInput = document.getElementById('otp-input');
    const verifyOtpBtn = document.getElementById('verify-otp-btn');
    const recaptchaContainer = document.getElementById('recaptcha-container');
    const authMsgPhone = document.getElementById('auth-msg-phone'); // Message spécifique pour téléphone

    // Boutons de déconnexion (un dans chaque section possible)
    const logoutBtn = document.getElementById('logout-btn'); // Bouton dans la section 'auth'
    const logoutBtnMenu = document.getElementById('logout-btn-menu'); // Bouton dans le 'main-menu'

    // --- Authentification Email/Mot de passe ---
    if (signupEmailBtn) {
        signupEmailBtn.addEventListener('click', async () => {
            const pseudo = pseudoInput.value.trim();
            const email = emailInput.value.trim();
            const password = passwordInput.value.trim();

            if (!pseudo || !email || !password) {
                showMessage(authMsgEmail, 'Veuillez remplir tous les champs.', false);
                return;
            }
            if (password.length < 6) {
                showMessage(authMsgEmail, 'Le mot de passe doit contenir au moins 6 caractères.', false);
                return;
            }

            try {
                // Vérifier si le pseudo est déjà pris
                const pseudoQuery = query(ref(db, 'users'), orderByChild('pseudo'), equalTo(pseudo));
                const pseudoSnapshot = await get(pseudoQuery);
                if (pseudoSnapshot.exists()) {
                    showMessage(authMsgEmail, 'Ce pseudo est déjà utilisé. Veuillez en choisir un autre.', false);
                    return;
                }

                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;

                // Stocker le pseudo et initialiser les stats
                await set(ref(db, `users/${user.uid}/pseudo`), pseudo);
                await set(ref(db, `users/${user.uid}/stats`), { wins: 0, losses: 0, draws: 0 });

                showMessage(authMsgEmail, 'Inscription réussie !', true);
            } catch (error) {
                console.error("Erreur d'inscription (Email/Mdp):", error);
                if (error.code === 'auth/email-already-in-use') {
                    showMessage(authMsgEmail, 'Cette adresse e-mail est déjà utilisée.', false);
                } else if (error.code === 'auth/invalid-email') {
                    showMessage(authMsgEmail, 'Adresse e-mail invalide.', false);
                } else if (error.code === 'auth/weak-password') {
                    showMessage(authMsgEmail, 'Mot de passe trop faible (min. 6 caractères).', false);
                } else {
                    showMessage(authMsgEmail, `Erreur d'inscription: ${error.message}`, false);
                }
            }
        });
    }

    if (loginEmailBtn) {
        loginEmailBtn.addEventListener('click', async () => {
            const email = emailInput.value.trim();
            const password = passwordInput.value.trim();

            if (!email || !password) {
                showMessage(authMsgEmail, 'Veuillez remplir tous les champs.', false);
                return;
            }

            try {
                await signInWithEmailAndPassword(auth, email, password);
                showMessage(authMsgEmail, 'Connexion réussie !', true);
                // onAuthStateChanged gérera l'appel à handleUserLogin
            } catch (error) {
                console.error("Erreur de connexion (Email/Mdp):", error);
                if (error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found') {
                    showMessage(authMsgEmail, 'Email ou mot de passe incorrect.', false);
                } else {
                    showMessage(authMsgEmail, `Erreur de connexion: ${error.message}`, false);
                }
            }
        });
    }

    // --- Authentification Google ---
    if (loginGoogleBtn) {
        loginGoogleBtn.addEventListener('click', async () => {
            try {
                const provider = new GoogleAuthProvider();
                await signInWithPopup(auth, provider);
                showMessage(authMsgGoogle, 'Connexion réussie avec Google !', true);
                // onAuthStateChanged gérera la logique de connexion et de pseudo
            } catch (error) {
                console.error("Erreur de connexion Google:", error);
                if (error.code === 'auth/popup-closed-by-user') {
                    showMessage(authMsgGoogle, 'Connexion Google annulée.', false);
                } else {
                    showMessage(authMsgGoogle, `Erreur de connexion Google: ${error.message}`, false);
                }
            }
        });
    }

    // --- Authentification Téléphone ---
    if (sendOtpBtn) {
        // Initialise reCAPTCHA une seule fois
        window.recaptchaVerifier = new RecaptchaVerifier(auth, recaptchaContainer, {
            'size': 'invisible', // Ou 'normal' pour un widget visible
            'callback': (response) => {
                // reCAPTCHA résolu, vous pouvez maintenant envoyer le code
                // Cette callback est déclenchée automatiquement par l'appel à signInWithPhoneNumber
            },
            'expired-callback': () => {
                showMessage(authMsgPhone, 'Le reCAPTCHA a expiré, veuillez réessayer.', false);
                // Réinitialiser le reCAPTCHA si nécessaire
                if (window.recaptchaVerifier && window.recaptchaVerifier.clear) {
                    window.recaptchaVerifier.clear();
                }
            }
        });
        window.recaptchaVerifier.render(); // Pour s'assurer qu'il est prêt

        sendOtpBtn.addEventListener('click', async () => {
            const phoneNumber = phoneInput.value.trim();

            if (!phoneNumber) {
                showMessage(authMsgPhone, 'Veuillez entrer un numéro de téléphone.', false);
                return;
            }

            // Vérification simple du format (peut être améliorée)
            if (!/^\+\d{1,3}\d{6,14}$/.test(phoneNumber)) { // Exemple: +33612345678
                showMessage(authMsgPhone, 'Format de numéro invalide. Ex: +33612345678', false);
                return;
            }

            try {
                showMessage(authMsgPhone, 'Envoi du code...', true);
                // Utilise le reCAPTCHA verifier que nous avons initialisé
                confirmationResult = await signInWithPhoneNumber(auth, phoneNumber, window.recaptchaVerifier);
                showMessage(authMsgPhone, 'Code envoyé ! Veuillez vérifier vos SMS.', true);
                // Optionnel: masquer le bouton "Envoyer" et afficher le champ OTP
                sendOtpBtn.style.display = 'none';
                otpInput.style.display = 'block';
                verifyOtpBtn.style.display = 'block';
            } catch (error) {
                console.error("Erreur d'envoi du code SMS:", error);
                if (error.code === 'auth/too-many-requests') {
                    showMessage(authMsgPhone, 'Trop de tentatives, veuillez réessayer plus tard.', false);
                } else if (error.code === 'auth/invalid-phone-number') {
                    showMessage(authMsgPhone, 'Numéro de téléphone invalide.', false);
                } else {
                    showMessage(authMsgPhone, `Erreur: ${error.message}`, false);
                }
                // Réinitialiser le reCAPTCHA en cas d'erreur
                if (window.recaptchaVerifier && window.recaptchaVerifier.clear) {
                    window.recaptchaVerifier.clear();
                }
            }
        });
    }

    if (verifyOtpBtn) {
        verifyOtpBtn.addEventListener('click', async () => {
            const otpCode = otpInput.value.trim();

            if (!otpCode) {
                showMessage(authMsgPhone, 'Veuillez entrer le code de vérification.', false);
                return;
            }

            if (confirmationResult) {
                try {
                    await confirmationResult.confirm(otpCode);
                    showMessage(authMsgPhone, 'Connexion réussie par téléphone !', true);
                    // onAuthStateChanged gérera la logique de connexion et de pseudo
                } catch (error) {
                    console.error("Erreur de vérification du code:", error);
                    if (error.code === 'auth/invalid-verification-code') {
                        showMessage(authMsgPhone, 'Code de vérification invalide.', false);
                    } else {
                        showMessage(authMsgPhone, `Erreur de vérification: ${error.message}`, false);
                    }
                }
            } else {
                showMessage(authMsgPhone, 'Veuillez d\'abord envoyer un code de vérification.', false);
            }
        });
    }

    // --- Déconnexion ---
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            try {
                await signOut(auth);
                showMessage(document.getElementById('auth-msg-email'), 'Déconnexion réussie.', true); // Utilisez un message générique ici
            } catch (error) {
                console.error("Erreur de déconnexion:", error);
                showMessage(document.getElementById('auth-msg-email'), `Erreur de déconnexion: ${error.message}`, false);
            }
        });
    }

    if (logoutBtnMenu) { // Le bouton de déconnexion dans le menu principal
        logoutBtnMenu.addEventListener('click', async () => {
            try {
                await signOut(auth);
                showMessage(document.getElementById('auth-msg-email'), 'Déconnexion réussie.', true); // Utilisez un message générique ici
            } catch (error) {
                console.error("Erreur de déconnexion:", error);
                showMessage(document.getElementById('auth-msg-email'), `Erreur de déconnexion: ${error.message}`, false);
            }
        });
    }

    // --- Écouteur d'état d'authentification (commun à toutes les méthodes) ---
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            // Un utilisateur est connecté
            let pseudo = null;
            let currentUserId = user.uid;

            // Tente de récupérer le pseudo depuis la DB
            const pseudoSnapshot = await get(ref(db, `users/${currentUserId}/pseudo`));
            pseudo = pseudoSnapshot.val();

            // Si le pseudo n'existe pas encore (nouvel utilisateur via Google/Phone ou corruption)
            if (!pseudo) {
                const enteredPseudo = prompt("Bienvenue ! Veuillez entrer votre pseudo de jeu unique (utilisé pour les classements) :");
                if (enteredPseudo) {
                    const pseudoTrimmed = enteredPseudo.trim();
                    if (pseudoTrimmed.length > 0) {
                        // Vérifier l'unicité du pseudo
                        const existingPseudoQuery = query(ref(db, 'users'), orderByChild('pseudo'), equalTo(pseudoTrimmed));
                        const existingPseudoSnapshot = await get(existingPseudoQuery);

                        if (existingPseudoSnapshot.exists()) {
                            alert("Ce pseudo est déjà pris. Veuillez en choisir un autre.");
                            await signOut(auth); // Déconnexion pour forcer à recommencer ou choisir une autre méthode
                            handleUserLogout();
                            return;
                        }

                        // Si pseudo est unique, le stocker et initialiser les stats
                        await set(ref(db, `users/${currentUserId}/pseudo`), pseudoTrimmed);
                        await set(ref(db, `users/${currentUserId}/stats`), { wins: 0, losses: 0, draws: 0 });
                        pseudo = pseudoTrimmed; // Mettre à jour la variable pseudo
                        showMessage(authMsgEmail, `Bienvenue ${pseudo} !`, true); // Affiche un message de bienvenue
                    } else {
                        alert("Le pseudo ne peut pas être vide.");
                        await signOut(auth); // Déconnexion
                        handleUserLogout();
                        return;
                    }
                } else {
                    // Si l'utilisateur annule le prompt
                    alert("Un pseudo est nécessaire pour jouer. Déconnexion.");
                    await signOut(auth);
                    handleUserLogout();
                    return;
                }
            }

            if (pseudo) {
                handleUserLogin(currentUserId, pseudo);
            } else {
                // Si pour une raison quelconque le pseudo n'est toujours pas là, déconnecter
                console.warn("Pseudo non trouvé après vérification. Déconnexion.");
                await signOut(auth);
                handleUserLogout();
            }

            // Gérer la visibilité du bouton de déconnexion
            logoutBtn.style.display = 'block';

        } else {
            // Aucun utilisateur connecté
            handleUserLogout();
            // Gérer la visibilité du bouton de déconnexion
            logoutBtn.style.display = 'none';
        }
    });
}
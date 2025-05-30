// js/auth.js

// 1. Importe les instances 'auth' et 'db' ET toutes les fonctions de la DB depuis ton fichier de configuration Firebase
import {
    auth,
    db,
    ref,
    set,
    get,
    query,
    orderByChild,
    equalTo
} from './firebaseConfig.js';

// 2. Importe les fonctions spécifiques d'authentification directement depuis la bibliothèque Firebase Auth
import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    GoogleAuthProvider,
    signInWithPopup,
    PhoneAuthProvider,
    signInWithPhoneNumber,
    RecaptchaVerifier
} from "https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js"; // L'URL doit correspondre à ta version de Firebase

// Assurez-vous que ces chemins sont corrects pour vos autres fichiers
import { showMessage } from './utils.js'; // showMessage prend un ID de string
// Import de handleUserLogin et handleUserLogout depuis main.js
import { handleUserLogin, handleUserLogout } from './main.js';

console.log("auth.js chargé.");

// Variables pour stocker le confirmationResult pour l'authentification par téléphone
let confirmationResult = null;
let recaptchaVerifierInstance = null; // Variable pour garder l'instance reCAPTCHA
let recaptchaInitialized = false; // Drapeau pour s'assurer que reCAPTCHA n'est initialisé qu'une fois
let recaptchaInitTimeout = null; // Pour gérer la temporisation de l'initialisation

// --- ID des éléments de message pour showMessage (CONSTANTES) ---
// Utiliser des constantes rend le code plus lisible et moins sujet aux erreurs de frappe
const AUTH_MSG_EMAIL_ID = 'auth-msg-email';
const AUTH_MSG_GOOGLE_ID = 'auth-msg-google';
const AUTH_MSG_PHONE_ID = 'auth-msg-phone';
// L'ID du message global est défini dans main.js et importé, mais le mettre ici pour référence
const GLOBAL_AUTH_MESSAGE_ID = 'global-auth-message';

export function setupAuthListeners() {
    // Références aux éléments du DOM
    const pseudoInput = document.getElementById('pseudo-input');
    const emailInput = document.getElementById('email-input');
    const passwordInput = document.getElementById('password-input');
    const signupEmailBtn = document.getElementById('signup-email-btn');
    const loginEmailBtn = document.getElementById('login-email-btn');

    const loginGoogleBtn = document.getElementById('login-google-btn');

    const phoneInput = document.getElementById('phone-input');
    const sendOtpBtn = document.getElementById('send-otp-btn');
    const otpInput = document.getElementById('otp-input');
    const verifyOtpBtn = document.getElementById('verify-otp-btn');
    const recaptchaContainer = document.getElementById('recaptcha-container');

    // Les boutons de déconnexion sont gérés dans main.js maintenant, mais les laissons ici pour l'écouteur d'état d'auth
    const logoutBtn = document.getElementById('logout-btn');
    // const logoutBtnMenu = document.getElementById('logout-btn-menu'); // Si ce bouton existe toujours


    // --- Fonction d'initialisation de reCAPTCHA (AVEC TEMPORISATION ET ROBUSTESSE) ---
    const initializeRecaptcha = () => {
        // Nettoie tout timeout précédent pour éviter les appels multiples ou en boucle
        if (recaptchaInitTimeout) {
            clearTimeout(recaptchaInitTimeout);
            recaptchaInitTimeout = null;
        }

        if (recaptchaInitialized) {
            console.log("reCAPTCHA already initialized. Skipping.");
            return;
        }

        // VÉRIFIE LA DISPONIBILITÉ DE 'auth' ET 'recaptchaContainer'
        if (!auth) {
            console.warn("Firebase Auth instance is not available yet for reCAPTCHA initialization. Retrying in 500ms.");
            recaptchaInitTimeout = setTimeout(initializeRecaptcha, 500);
            return;
        }
        if (!recaptchaContainer) {
            console.warn("reCAPTCHA container (#recaptcha-container) not found in DOM. Retrying in 500ms.");
            recaptchaInitTimeout = setTimeout(initializeRecaptcha, 500);
            return;
        }

        try {
            // **LA MODIFICATION EST ICI : on vérifie si auth.settings existe avant de l'utiliser**
            if (auth.settings && auth.settings.appVerificationDisabledForTesting) {
                console.log("DEBUG: reCAPTCHA is disabled for testing. Marking as initialized.");
                showMessage(AUTH_MSG_PHONE_ID, "Vérification reCAPTCHA désactivée pour le test local. (Comportement normal)", true);
                recaptchaInitialized = true; // On initialise pour le test
                return; // Sort de la fonction, pas besoin de créer RecaptchaVerifier
            }

            console.log("Attempting to initialize reCAPTCHA...");
            recaptchaVerifierInstance = new RecaptchaVerifier(auth, recaptchaContainer, {
                'size': 'invisible',
                'callback': (response) => {
                    console.log("reCAPTCHA solved!");
                },
                'expired-callback': () => {
                    showMessage(AUTH_MSG_PHONE_ID, 'Le reCAPTCHA a expiré, veuillez réessayer.', false);
                    if (recaptchaVerifierInstance && recaptchaVerifierInstance.clear) {
                        recaptchaVerifierInstance.clear();
                    }
                }
            });
            recaptchaVerifierInstance.render().then(() => {
                window.recaptchaVerifier = recaptchaVerifierInstance; // Pour un accès global si nécessaire
                recaptchaInitialized = true; // SEULEMENT ICI si le rendu a réussi !
                console.log("reCAPTCHA initialisé avec succès.");
            }).catch(err => {
                console.error("Erreur lors du rendu reCAPTCHA:", err);
                showMessage(AUTH_MSG_PHONE_ID, "Impossible de charger le reCAPTCHA. Veuillez rafraîchir la page.", false);
            });

        } catch (error) {
            // Ce bloc catch devrait être atteint uniquement pour d'autres erreurs inattendues,
            // car l'erreur appVerificationDisabledForTesting est maintenant gérée plus tôt.
            console.error("Erreur d'initialisation reCAPTCHA (dans try-catch principal):", error);
            showMessage(AUTH_MSG_PHONE_ID, `Erreur critique d'initialisation reCAPTCHA: ${error.message}`, false);
        }
    };


    // --- Authentification Email/Mot de passe ---
    if (signupEmailBtn) {
        signupEmailBtn.addEventListener('click', async () => {
            const pseudo = pseudoInput.value.trim();
            const email = emailInput.value.trim();
            const password = passwordInput.value.trim();

            if (!pseudo || !email || !password) { showMessage(AUTH_MSG_EMAIL_ID, 'Veuillez remplir tous les champs.', false); return; }
            if (password.length < 6) { showMessage(AUTH_MSG_EMAIL_ID, 'Le mot de passe doit contenir au moins 6 caractères.', false); return; }

            try {
                // Cette requête nécessite l'index "pseudo" dans les règles de la Realtime Database
                const pseudoQuery = query(ref(db, 'users'), orderByChild('pseudo'), equalTo(pseudo));
                const pseudoSnapshot = await get(pseudoQuery);
                if (pseudoSnapshot.exists()) { showMessage(AUTH_MSG_EMAIL_ID, 'Ce pseudo est déjà utilisé. Veuillez en choisir un autre.', false); return; }

                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;

                await set(ref(db, `users/${user.uid}/pseudo`), pseudo);
                await set(ref(db, `users/${user.uid}/stats`), { wins: 0, losses: 0, draws: 0 });

                showMessage(AUTH_MSG_EMAIL_ID, 'Inscription réussie !', true);
            } catch (error) {
                console.error("Erreur d'inscription (Email/Mdp):", error);
                if (error.code === 'auth/email-already-in-use') { showMessage(AUTH_MSG_EMAIL_ID, 'Cette adresse e-mail est déjà utilisée.', false); }
                else if (error.code === 'auth/invalid-email') { showMessage(AUTH_MSG_EMAIL_ID, 'Adresse e-mail invalide.', false); }
                else if (error.code === 'auth/weak-password') { showMessage(AUTH_MSG_EMAIL_ID, 'Mot de passe trop faible (min. 6 caractères).', false); }
                // Ajout d'une condition pour l'erreur d'index manquant
                else if (error.message && error.message.includes("Index not defined")) {
                    showMessage(AUTH_MSG_EMAIL_ID, "Erreur de base de données: Index 'pseudo' manquant. Vérifiez vos règles Firebase (Realtime Database -> Rules).", false);
                }
                else { showMessage(AUTH_MSG_EMAIL_ID, `Erreur d'inscription: ${error.message}`, false); }
            }
        });
    }

    if (loginEmailBtn) {
        loginEmailBtn.addEventListener('click', async () => {
            const email = emailInput.value.trim();
            const password = passwordInput.value.trim();

            if (!email || !password) { showMessage(AUTH_MSG_EMAIL_ID, 'Veuillez remplir tous les champs.', false); return; }

            try {
                await signInWithEmailAndPassword(auth, email, password);
                showMessage(AUTH_MSG_EMAIL_ID, 'Connexion réussie !', true);
            } catch (error) {
                console.error("Erreur de connexion (Email/Mdp):", error);
                if (error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found') { showMessage(AUTH_MSG_EMAIL_ID, 'Email ou mot de passe incorrect.', false); }
                else { showMessage(AUTH_MSG_EMAIL_ID, `Erreur de connexion: ${error.message}`, false); }
            }
        });
    }

    // --- Authentification Google ---
    if (loginGoogleBtn) {
        loginGoogleBtn.addEventListener('click', async () => {
            try {
                const provider = new GoogleAuthProvider();
                await signInWithPopup(auth, provider);
                showMessage(AUTH_MSG_GOOGLE_ID, 'Connexion réussie avec Google !', true);
            } catch (error) {
                console.error("Erreur de connexion Google:", error);
                if (error.code === 'auth/popup-closed-by-user') { showMessage(AUTH_MSG_GOOGLE_ID, 'Connexion Google annulée.', false); }
                // Ajout d'une condition pour l'erreur de domaine non autorisé
                else if (error.code === 'auth/unauthorized-domain') {
                    showMessage(AUTH_MSG_GOOGLE_ID, "Erreur: Domaine non autorisé. Ajoutez 'subtle-donut-ebec90.netlify.app' dans Firebase Console (Authentication -> Settings -> Authorized domains).", false);
                }
                else { showMessage(AUTH_MSG_GOOGLE_ID, `Erreur de connexion Google: ${error.message}`, false); }
            }
        });
    }

    // --- Authentification Téléphone ---
    if (sendOtpBtn && recaptchaContainer) {
        // Appelle initializeRecaptcha une fois que le bouton et le conteneur sont disponibles
        // L'auto-retry dans initializeRecaptcha gérera le timing.
        initializeRecaptcha();

        sendOtpBtn.addEventListener('click', async () => {
            const phoneNumber = phoneInput.value.trim();

            if (!phoneNumber) { showMessage(AUTH_MSG_PHONE_ID, 'Veuillez entrer un numéro de téléphone.', false); return; }
            if (!/^\+\d{1,3}\d{6,14}$/.test(phoneNumber)) { showMessage(AUTH_MSG_PHONE_ID, 'Format de numéro invalide. Ex: +33612345678', false); return; }

            // Vérifie si reCAPTCHA est bien initialisé OU si le mode de test est activé
            if (!recaptchaVerifierInstance && (!auth.settings || !auth.settings.appVerificationDisabledForTesting)) {
                 showMessage(AUTH_MSG_PHONE_ID, 'Le système de vérification (reCAPTCHA) n\'est pas prêt. Veuillez réessayer.', false);
                 return;
            }

            try {
                showMessage(AUTH_MSG_PHONE_ID, 'Envoi du code...', true);
                confirmationResult = await signInWithPhoneNumber(auth, phoneNumber, recaptchaVerifierInstance);
                showMessage(AUTH_MSG_PHONE_ID, 'Code envoyé ! Veuillez vérifier vos SMS.', true);
                sendOtpBtn.style.display = 'none';
                otpInput.style.display = 'block';
                verifyOtpBtn.style.display = 'block';
            } catch (error) {
                console.error("Erreur d'envoi du code SMS:", error);
                if (error.code === 'auth/too-many-requests') { showMessage(AUTH_MSG_PHONE_ID, 'Trop de tentatives, veuillez réessayer plus tard.', false); }
                else if (error.code === 'auth/invalid-phone-number') { showMessage(AUTH_MSG_PHONE_ID, 'Numéro de téléphone invalide.', false); }
                else { showMessage(AUTH_MSG_PHONE_ID, `Erreur: ${error.message}`, false); }
                if (recaptchaVerifierInstance && recaptchaVerifierInstance.clear) { recaptchaVerifierInstance.clear(); }
            }
        });
    }

    if (verifyOtpBtn) {
        verifyOtpBtn.addEventListener('click', async () => {
            const otpCode = otpInput.value.trim();

            if (!otpCode) { showMessage(AUTH_MSG_PHONE_ID, 'Veuillez entrer le code de vérification.', false); return; }

            if (confirmationResult) {
                try {
                    await confirmationResult.confirm(otpCode);
                    showMessage(AUTH_MSG_PHONE_ID, 'Connexion réussie par téléphone !', true);
                } catch (error) {
                    console.error("Erreur de vérification du code:", error);
                    if (error.code === 'auth/invalid-verification-code') { showMessage(AUTH_MSG_PHONE_ID, 'Code de vérification invalide.', false); }
                    else { showMessage(AUTH_MSG_PHONE_ID, `Erreur de vérification: ${error.message}`, false); }
                }
            } else {
                showMessage(AUTH_MSG_PHONE_ID, 'Veuillez d\'abord envoyer un code de vérification.', false);
            }
        });
    }

    // --- Déconnexion (gérée ici mais le bouton est écouté dans main.js) ---
    // Les boutons de déconnexion sont maintenant écoutés dans main.js et appellent signOut(auth) directement.
    // Cette partie est maintenue pour la clarté mais l'écouteur de bouton n'est plus ici.
    /*
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            try {
                await signOut(auth);
            } catch (error) {
                console.error("Erreur de déconnexion:", error);
                showMessage(GLOBAL_AUTH_MESSAGE_ID, `Erreur de déconnexion: ${error.message}`, false);
            }
        });
    }
    */

    // --- Écouteur d'état d'authentification (commun à toutes les méthodes) ---
    onAuthStateChanged(auth, async (user) => {
        // Appelle initializeRecaptcha ici aussi pour s'assurer qu'il est initialisé dès que
        // l'instance 'auth' est prête, même si l'utilisateur ne tente pas une connexion téléphone
        // tout de suite. Le drapeau `recaptchaInitialized` empêchera les doublons.
        initializeRecaptcha();

        if (user) {
            let pseudo = null;
            let currentUserId = user.uid;

            const pseudoSnapshot = await get(ref(db, `users/${currentUserId}/pseudo`));
            pseudo = pseudoSnapshot.val();

            if (!pseudo) {
                const enteredPseudo = prompt("Bienvenue ! Veuillez entrer votre pseudo de jeu unique (utilisé pour les classements) :");
                if (enteredPseudo) {
                    const pseudoTrimmed = enteredPseudo.trim();
                    if (pseudoTrimmed.length > 0) {
                        const existingPseudoQuery = query(ref(db, 'users'), orderByChild('pseudo'), equalTo(pseudoTrimmed));
                        const existingPseudoSnapshot = await get(existingPseudoQuery);

                        if (existingPseudoSnapshot.exists()) {
                            alert("Ce pseudo est déjà pris. Veuillez en choisir un autre.");
                            await signOut(auth); // Déconnecte l'utilisateur si le pseudo est pris
                            handleUserLogout(); // Appelle la fonction de main.js pour réinitialiser l'UI
                            return;
                        }

                        await set(ref(db, `users/${currentUserId}/pseudo`), pseudoTrimmed);
                        await set(ref(db, `users/${currentUserId}/stats`), { wins: 0, losses: 0, draws: 0 });
                        pseudo = pseudoTrimmed;
                        // Le message de bienvenue sera géré par handleUserLogin dans main.js
                    } else {
                        alert("Le pseudo ne peut pas être vide.");
                        await signOut(auth);
                        handleUserLogout();
                        return;
                    }
                } else {
                    alert("Un pseudo est nécessaire pour jouer. Déconnexion.");
                    await signOut(auth);
                    handleUserLogout();
                    return;
                }
            }
            // Appelle handleUserLogin de main.js avec les infos de l'utilisateur
            handleUserLogin(currentUserId, pseudo);

        } else {
            // Appelle handleUserLogout de main.js quand l'utilisateur est déconnecté
            handleUserLogout();
        }
    });

    // Appel initial pour lancer l'initialisation de reCAPTCHA dès que setupAuthListeners est exécuté.
    // La fonction initializeRecaptcha elle-même gérera si auth n'est pas encore prêt.
    initializeRecaptcha();
}
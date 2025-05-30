// js/auth.js

// Importe les instances 'auth' et 'db' depuis ton fichier de configuration Firebase
import { auth, db, ref, set, get, query, orderByChild, equalTo } from './firebaseConfig.js';

// Importe les fonctions spécifiques d'authentification directement depuis la bibliothèque Firebase Auth
import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged, // onAuthStateChanged est importé ici mais sera utilisé dans main.js
    GoogleAuthProvider,
    signInWithPopup,
    signInWithPhoneNumber,
    RecaptchaVerifier
} from "https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js"; // L'URL doit correspondre à ta version de Firebase

// Importe les fonctions utilitaires nécessaires
import { afficherMessage, afficherEcranAuth } from './utils.js';

console.log("auth.js chargé.");

// *******************************************************************
// CETTE LIGNE NE DOIT ABSOLUMENT PAS EXISTER ICI. C'EST L'ERREUR.
// L'instance 'auth' est importée de firebaseConfig.js.
// export const auth = getAuth(app); // <-- SUPPRIMEZ CETTE LIGNE SI ELLE EST PRÉSENTE !
// *******************************************************************

// Variables pour stocker le confirmationResult pour l'authentification par téléphone
let confirmationResult = null;
let recaptchaVerifierInstance = null;
let recaptchaInitialized = false;
let recaptchaInitTimeout = null;

// --- ID des éléments de message pour afficherMessage (CONSTANTES) ---
const AUTH_MSG_EMAIL_ID = 'auth-msg-email';
const AUTH_MSG_GOOGLE_ID = 'auth-msg-google';
const AUTH_MSG_PHONE_ID = 'auth-msg-phone';

/**
 * Fonction d'initialisation de reCAPTCHA.
 * Gère la temporisation et la robustesse de l'initialisation.
 */
const initializeRecaptcha = () => {
    if (recaptchaInitTimeout) {
        clearTimeout(recaptchaInitTimeout);
        recaptchaInitTimeout = null;
    }

    if (recaptchaInitialized) {
        console.log("reCAPTCHA déjà initialisé.");
        return;
    }

    const recaptchaContainer = document.getElementById('recaptcha-container');
    if (!auth || !auth.app || !recaptchaContainer) {
        console.warn("Conditions non remplies pour reCAPTCHA. Nouvelle tentative dans 100ms.");
        recaptchaInitTimeout = setTimeout(initializeRecaptcha, 100);
        return;
    }

    // Comportement de reCAPTCHA en local (désactivé pour les tests)
    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
        console.log("DEBUG: reCAPTCHA est désactivé pour le test local.");
        afficherMessage(AUTH_MSG_PHONE_ID, "Vérification reCAPTCHA désactivée pour le test local.", true);
        recaptchaInitialized = true;
        return;
    }

    try {
        console.log("Tentative d'initialisation reCAPTCHA...");
        recaptchaVerifierInstance = new RecaptchaVerifier(auth, recaptchaContainer, {
            'size': 'invisible',
            'callback': (response) => { console.log("reCAPTCHA résolu !"); },
            'expired-callback': () => {
                afficherMessage(AUTH_MSG_PHONE_ID, 'Le reCAPTCHA a expiré, veuillez réessayer.', false);
                if (recaptchaVerifierInstance && recaptchaVerifierInstance.clear) { recaptchaVerifierInstance.clear(); }
            }
        });
        recaptchaVerifierInstance.render().then(() => {
            window.recaptchaVerifier = recaptchaVerifierInstance;
            recaptchaInitialized = true;
            console.log("reCAPTCHA initialisé avec succès.");
        }).catch(err => {
            console.error("Erreur lors du rendu reCAPTCHA:", err);
            afficherMessage(AUTH_MSG_PHONE_ID, "Impossible de charger le reCAPTCHA.", false);
        });

    } catch (error) {
        console.error("Erreur d'initialisation reCAPTCHA (dans try-catch):", error);
        afficherMessage(AUTH_MSG_PHONE_ID, `Erreur critique d'initialisation reCAPTCHA: ${error.message}`, false);
    }
};

/**
 * Configure tous les écouteurs d'événements pour l'authentification.
 * Cette fonction est appelée depuis main.js.
 */
export function setupAuthListeners() {
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

    // Initialisation de reCAPTCHA si les éléments sont présents
    if (sendOtpBtn && recaptchaContainer) {
        initializeRecaptcha();
    }

    // --- Authentification Email/Mot de passe ---
    if (signupEmailBtn) {
        signupEmailBtn.addEventListener('click', async () => {
            const pseudo = pseudoInput.value.trim();
            const email = emailInput.value.trim();
            const password = passwordInput.value.trim();

            if (!pseudo || !email || !password) { afficherMessage(AUTH_MSG_EMAIL_ID, 'Veuillez remplir tous les champs.', false); return; }
            if (password.length < 6) { afficherMessage(AUTH_MSG_EMAIL_ID, 'Le mot de passe doit contenir au moins 6 caractères.', false); return; }

            try {
                const pseudoQuery = query(ref(db, 'users'), orderByChild('pseudo'), equalTo(pseudo));
                const pseudoSnapshot = await get(pseudoQuery);
                if (pseudoSnapshot.exists()) { afficherMessage(AUTH_MSG_EMAIL_ID, 'Ce pseudo est déjà utilisé. Veuillez en choisir un autre.', false); return; }

                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                await set(ref(db, `users/${userCredential.user.uid}/pseudo`), pseudo);
                await set(ref(db, `users/${userCredential.user.uid}/stats`), { wins: 0, losses: 0, draws: 0 });

                afficherMessage(AUTH_MSG_EMAIL_ID, 'Inscription réussie !', true);
            } catch (error) {
                console.error("Erreur d'inscription (Email/Mdp):", error);
                if (error.code === 'auth/email-already-in-use') { afficherMessage(AUTH_MSG_EMAIL_ID, 'Cette adresse e-mail est déjà utilisée.', false); }
                else if (error.code === 'auth/invalid-email') { afficherMessage(AUTH_MSG_EMAIL_ID, 'Adresse e-mail invalide.', false); }
                else if (error.code === 'auth/weak-password') { afficherMessage(AUTH_MSG_EMAIL_ID, 'Mot de passe trop faible (min. 6 caractères).', false); }
                else { afficherMessage(AUTH_MSG_EMAIL_ID, `Erreur d'inscription: ${error.message}`, false); }
            }
        });
    }

    if (loginEmailBtn) {
        loginEmailBtn.addEventListener('click', async () => {
            const email = emailInput.value.trim();
            const password = passwordInput.value.trim();

            if (!email || !password) { afficherMessage(AUTH_MSG_EMAIL_ID, 'Veuillez remplir tous les champs.', false); return; }

            try {
                await signInWithEmailAndPassword(auth, email, password);
                afficherMessage(AUTH_MSG_EMAIL_ID, 'Connexion réussie !', true);
            } catch (error) {
                console.error("Erreur de connexion (Email/Mdp):", error);
                if (error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found') { afficherMessage(AUTH_MSG_EMAIL_ID, 'Email ou mot de passe incorrect.', false); }
                else { afficherMessage(AUTH_MSG_EMAIL_ID, `Erreur de connexion: ${error.message}`, false); }
            }
        });
    }

    // --- Authentification Google ---
    if (loginGoogleBtn) {
        loginGoogleBtn.addEventListener('click', async () => {
            try {
                const provider = new GoogleAuthProvider();
                await signInWithPopup(auth, provider);
                afficherMessage(AUTH_MSG_GOOGLE_ID, 'Connexion réussie avec Google !', true);
            } catch (error) {
                console.error("Erreur de connexion Google:", error);
                if (error.code === 'auth/popup-closed-by-user') { afficherMessage(AUTH_MSG_GOOGLE_ID, 'Connexion Google annulée.', false); }
                else if (error.code === 'auth/unauthorized-domain') {
                    afficherMessage(AUTH_MSG_GOOGLE_ID, "Erreur: Domaine non autorisé. Ajoutez 'subtle-donut-ebec90.netlify.app' dans Firebase Console (Authentication -> Settings -> Authorized domains).", false);
                }
                else { afficherMessage(AUTH_MSG_GOOGLE_ID, `Erreur de connexion Google: ${error.message}`, false); }
            }
        });
    }

    // --- Authentification Téléphone ---
    if (sendOtpBtn) {
        sendOtpBtn.addEventListener('click', async () => {
            const phoneNumber = phoneInput.value.trim();
            if (!phoneNumber) { afficherMessage(AUTH_MSG_PHONE_ID, 'Veuillez entrer un numéro de téléphone.', false); return; }
            if (!/^\+\d{1,3}\d{6,14}$/.test(phoneNumber)) { afficherMessage(AUTH_MSG_PHONE_ID, 'Format de numéro invalide. Ex: +33612345678', false); return; }

            if (!recaptchaInitialized || !recaptchaVerifierInstance) {
                afficherMessage(AUTH_MSG_PHONE_ID, 'Le système de vérification (reCAPTCHA) n\'est pas prêt.', false);
                initializeRecaptcha();
                return;
            }

            try {
                afficherMessage(AUTH_MSG_PHONE_ID, 'Envoi du code...', true);
                confirmationResult = await signInWithPhoneNumber(auth, phoneNumber, recaptchaVerifierInstance);
                afficherMessage(AUTH_MSG_PHONE_ID, 'Code envoyé ! Veuillez vérifier vos SMS.', true);
                sendOtpBtn.style.display = 'none';
                otpInput.style.display = 'block';
                verifyOtpBtn.style.display = 'block';
            } catch (error) {
                console.error("Erreur d'envoi du code SMS:", error);
                if (recaptchaVerifierInstance && recaptchaVerifierInstance.clear) { recaptchaVerifierInstance.clear(); }
                afficherMessage(AUTH_MSG_PHONE_ID, `Erreur: ${error.message}`, false);
            }
        });
    }

    if (verifyOtpBtn) {
        verifyOtpBtn.addEventListener('click', async () => {
            const otpCode = otpInput.value.trim();
            if (!otpCode) { afficherMessage(AUTH_MSG_PHONE_ID, 'Veuillez entrer le code de vérification.', false); return; }

            if (confirmationResult) {
                try {
                    await confirmationResult.confirm(otpCode);
                    afficherMessage(AUTH_MSG_PHONE_ID, 'Connexion réussie par téléphone !', true);
                } catch (error) {
                    console.error("Erreur de vérification du code:", error);
                    afficherMessage(AUTH_MSG_PHONE_ID, `Erreur de vérification: ${error.message}`, false);
                }
            } else {
                afficherMessage(AUTH_MSG_PHONE_ID, 'Veuillez d\'abord envoyer un code de vérification.', false);
            }
        });
    }

    // L'écouteur onAuthStateChanged est dans main.js, car c'est lui qui gère la redirection de l'UI.
    // auth.js se contente de gérer la logique d'authentification elle-même.
}
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
    PhoneAuthProvider, // Note: PhoneAuthProvider n'est généralement pas exporté ou utilisé directement comme une classe,
                       // mais signInWithPhoneNumber le gère en interne. Gardez-le si votre version l'exige.
    signInWithPhoneNumber,
    RecaptchaVerifier
} from "https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js"; // L'URL doit correspondre à ta version de Firebase

// Assurez-vous que ces chemins sont corrects pour vos autres fichiers
import { showMessage, showAuthScreen } from './utils.js'; // showMessage prend un ID de string, showAuthScreen pour réafficher l'écran d'authentification
// Import de handleUserLogin et handleUserLogout depuis main.js
import { handleUserLogin, handleUserLogout } from './main.js';

console.log("auth.js chargé.");

export const auth = getAuth(app);

// Variables pour stocker le confirmationResult pour l'authentification par téléphone
let confirmationResult = null;
let recaptchaVerifierInstance = null; // Variable pour garder l'instance reCAPTCHA
let recaptchaInitialized = false; // Drapeau pour s'assurer que reCAPTCHA n'est initialisé qu'une fois
let recaptchaInitTimeout = null; // Pour gérer la temporisation de l'initialisation

// --- ID des éléments de message pour showMessage (CONSTANTES) ---
const AUTH_MSG_EMAIL_ID = 'auth-msg-email';
const AUTH_MSG_GOOGLE_ID = 'auth-msg-google';
const AUTH_MSG_PHONE_ID = 'auth-msg-phone';
// L'ID du message global est défini dans main.js et importé, mais le mettre ici pour référence
const GLOBAL_AUTH_MESSAGE_ID = 'global-auth-message'; // Utile si vous avez besoin d'envoyer des messages d'auth généraux

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

    // --- Fonction d'initialisation de reCAPTCHA (AVEC TEMPORISATION ET ROBUSTESSE) ---
    const initializeRecaptcha = () => {
        // Nettoie tout timeout précédent pour éviter les appels multiples ou en boucle
        if (recaptchaInitTimeout) {
            clearTimeout(recaptchaInitTimeout);
            recaptchaInitTimeout = null;
        }

        if (recaptchaInitialized) {
            console.log("reCAPTCHA déjà initialisé. Pas besoin de le refaire.");
            return;
        }

        // VÉRIFIE LA DISPONIBILITÉ DE 'auth' ET 'recaptchaContainer'
        // Attendez que l'instance `auth` soit complètement prête.
        // `auth.app` est une bonne vérification pour s'assurer que `auth` est lié à une app Firebase.
        if (!auth || !auth.app) {
            console.warn("Firebase Auth instance n'est pas encore entièrement disponible pour l'initialisation reCAPTCHA. Nouvelle tentative dans 100ms.");
            recaptchaInitTimeout = setTimeout(initializeRecaptcha, 100);
            return;
        }
        if (!recaptchaContainer) {
            console.warn("reCAPTCHA container (#recaptcha-container) non trouvé dans le DOM. Nouvelle tentative dans 100ms.");
            recaptchaInitTimeout = setTimeout(initializeRecaptcha, 100);
            return;
        }

        // Si la vérification est désactivée pour les tests (géré dans firebaseConfig.js maintenant)
        if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
            // Pas besoin de vérifier auth.settings.appVerificationDisabledForTesting ici car c'est configuré
            // globalement dans firebaseConfig.js et affecte le comportement de signInWithPhoneNumber.
            console.log("DEBUG: reCAPTCHA est désactivé pour le test. Marqué comme initialisé.");
            showMessage(AUTH_MSG_PHONE_ID, "Vérification reCAPTCHA désactivée pour le test local. (Comportement normal)", true);
            recaptchaInitialized = true;
            return;
        }

        try {
            console.log("Tentative d'initialisation reCAPTCHA...");
            recaptchaVerifierInstance = new RecaptchaVerifier(auth, recaptchaContainer, {
                'size': 'invisible',
                'callback': (response) => {
                    console.log("reCAPTCHA résolu !");
                },
                'expired-callback': () => {
                    showMessage(AUTH_MSG_PHONE_ID, 'Le reCAPTCHA a expiré, veuillez réessayer.', false);
                    if (recaptchaVerifierInstance && recaptchaVerifierInstance.clear) {
                        recaptchaVerifierInstance.clear();
                    }
                }
            });
            recaptchaVerifierInstance.render().then(() => {
                window.recaptchaVerifier = recaptchaVerifierInstance; // Ceci rend l'instance accessible globalement si nécessaire
                recaptchaInitialized = true;
                console.log("reCAPTCHA initialisé avec succès.");
            }).catch(err => {
                console.error("Erreur lors du rendu reCAPTCHA:", err);
                showMessage(AUTH_MSG_PHONE_ID, "Impossible de charger le reCAPTCHA. Veuillez rafraîchir la page.", false);
            });

        } catch (error) {
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
                // Vérifier l'unicité du pseudo avant de créer l'utilisateur
                const pseudoQuery = query(ref(db, 'users'), orderByChild('pseudo'), equalTo(pseudo));
                const pseudoSnapshot = await get(pseudoQuery);
                if (pseudoSnapshot.exists()) { showMessage(AUTH_MSG_EMAIL_ID, 'Ce pseudo est déjà utilisé. Veuillez en choisir un autre.', false); return; }

                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;

                // Enregistre le pseudo et initialise les stats pour le nouvel utilisateur
                await set(ref(db, `users/${user.uid}/pseudo`), pseudo);
                await set(ref(db, `users/${user.uid}/stats`), { wins: 0, losses: 0, draws: 0 });

                showMessage(AUTH_MSG_EMAIL_ID, 'Inscription réussie !', true);
                // handleUserLogin sera appelé par onAuthStateChanged
            } catch (error) {
                console.error("Erreur d'inscription (Email/Mdp):", error);
                if (error.code === 'auth/email-already-in-use') { showMessage(AUTH_MSG_EMAIL_ID, 'Cette adresse e-mail est déjà utilisée.', false); }
                else if (error.code === 'auth/invalid-email') { showMessage(AUTH_MSG_EMAIL_ID, 'Adresse e-mail invalide.', false); }
                else if (error.code === 'auth/weak-password') { showMessage(AUTH_MSG_EMAIL_ID, 'Mot de passe trop faible (min. 6 caractères).', false); }
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
                // handleUserLogin sera appelé par onAuthStateChanged
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
                // handleUserLogin sera appelé par onAuthStateChanged
            } catch (error) {
                console.error("Erreur de connexion Google:", error);
                if (error.code === 'auth/popup-closed-by-user') { showMessage(AUTH_MSG_GOOGLE_ID, 'Connexion Google annulée.', false); }
                else if (error.code === 'auth/unauthorized-domain') {
                    showMessage(AUTH_MSG_GOOGLE_ID, "Erreur: Domaine non autorisé. Ajoutez 'subtle-donut-ebec90.netlify.app' dans Firebase Console (Authentication -> Settings -> Authorized domains).", false);
                }
                else { showMessage(AUTH_MSG_GOOGLE_ID, `Erreur de connexion Google: ${error.message}`, false); }
            }
        });
    }

    // --- Authentification Téléphone ---
    // Appel initial à initializeRecaptcha lorsque le bouton d'envoi OTP est disponible
    if (sendOtpBtn && recaptchaContainer) {
        initializeRecaptcha(); // Initialise reCAPTCHA quand ces éléments sont présents
    }

    if (sendOtpBtn) {
        sendOtpBtn.addEventListener('click', async () => {
            const phoneNumber = phoneInput.value.trim();

            if (!phoneNumber) { showMessage(AUTH_MSG_PHONE_ID, 'Veuillez entrer un numéro de téléphone.', false); return; }
            if (!/^\+\d{1,3}\d{6,14}$/.test(phoneNumber)) { showMessage(AUTH_MSG_PHONE_ID, 'Format de numéro invalide. Ex: +33612345678', false); return; }

            // Vérifie que reCAPTCHA est prêt avant d'envoyer le code
            if (!recaptchaInitialized || !recaptchaVerifierInstance) {
                showMessage(AUTH_MSG_PHONE_ID, 'Le système de vérification (reCAPTCHA) n\'est pas prêt. Veuillez réessayer.', false);
                initializeRecaptcha(); // Tente de réinitialiser/s'assurer qu'il est prêt
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
                // Clear reCAPTCHA sur erreur pour permettre une nouvelle tentative
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
                    // handleUserLogin sera appelé par onAuthStateChanged
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

    // --- Écouteur d'état d'authentification (commun à toutes les méthodes) ---
    onAuthStateChanged(auth, async (user) => {
        // Supprimez l'appel à initializeRecaptcha() ici.
        // Il est appelé de manière ciblée plus haut ou via utils.js.

        if (user) {
            let pseudo = null;
            const currentUserId = user.uid;

            // Tente de récupérer le pseudo existant
            const pseudoSnapshot = await get(ref(db, `users/${currentUserId}/pseudo`));
            pseudo = pseudoSnapshot.val();

            // Si pas de pseudo, demande à l'utilisateur (boucle pour s'assurer d'un pseudo valide)
            if (!pseudo) {
                let enteredPseudo = null;
                let pseudoIsInvalid = true;

                while(pseudoIsInvalid) {
                    enteredPseudo = prompt("Bienvenue ! Veuillez entrer votre pseudo de jeu unique (utilisé pour les classements) :");

                    if (!enteredPseudo) {
                        alert("Un pseudo est nécessaire pour jouer. Déconnexion.");
                        await signOut(auth);
                        handleUserLogout(); // Utilise handleUserLogout de main.js
                        return; // Sort de la fonction
                    }

                    const pseudoTrimmed = enteredPseudo.trim();

                    if (pseudoTrimmed.length > 0) {
                        const existingPseudoQuery = query(ref(db, 'users'), orderByChild('pseudo'), equalTo(pseudoTrimmed));
                        const existingPseudoSnapshot = await get(existingPseudoQuery);

                        if (existingPseudoSnapshot.exists()) {
                            alert("Ce pseudo est déjà pris. Veuillez en choisir un autre.");
                        } else {
                            // Enregistre le pseudo et initialise les stats
                            await set(ref(db, `users/${currentUserId}/pseudo`), pseudoTrimmed);
                            await set(ref(db, `users/${currentUserId}/stats`), { wins: 0, losses: 0, draws: 0 });
                            pseudo = pseudoTrimmed;
                            pseudoIsInvalid = false; // Pseudo défini et valide, sort de la boucle
                        }
                    } else {
                        alert("Le pseudo ne peut pas être vide.");
                    }
                }
            }
            // Appelle handleUserLogin de main.js avec les infos de l'utilisateur
            // Cela assurera la redirection vers le menu principal.
            handleUserLogin(currentUserId, pseudo);

        } else {
            // Appelle handleUserLogout de main.js quand l'utilisateur est déconnecté
            handleUserLogout(); // Utilise handleUserLogout de main.js
            showAuthScreen(); // S'assure que l'écran d'authentification est affiché après la déconnexion
        }
    });

    // Supprimez l'appel à initializeRecaptcha() ici.
    // Il est maintenant appelé de manière ciblée plus haut.
}
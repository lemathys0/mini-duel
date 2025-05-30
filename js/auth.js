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
import { handleUserLogin, handleUserLogout } from './main.js';

console.log("auth.js chargé.");

// Variable pour stocker le confirmationResult pour l'authentification par téléphone
let confirmationResult = null;
let recaptchaVerifierInstance = null; // Variable pour garder l'instance reCAPTCHA
let recaptchaInitialized = false; // Drapeau pour s'assurer que reCAPTCHA n'est initialisé qu'une fois

export function setupAuthListeners() {
    // Éléments pour Email/Mot de passe (on récupère les références DOM ici)
    const pseudoInput = document.getElementById('pseudo-input');
    const emailInput = document.getElementById('email-input');
    const passwordInput = document.getElementById('password-input');
    const signupEmailBtn = document.getElementById('signup-email-btn');
    const loginEmailBtn = document.getElementById('login-email-btn');
    // On va passer l'ID de l'élément à showMessage, pas l'élément lui-même
    const authMsgEmailId = 'auth-msg-email';

    // Éléments pour Google
    const loginGoogleBtn = document.getElementById('login-google-btn');
    const authMsgGoogleId = 'auth-msg-google';

    // Éléments pour Téléphone
    const phoneInput = document.getElementById('phone-input');
    const sendOtpBtn = document.getElementById('send-otp-btn');
    const otpInput = document.getElementById('otp-input');
    const verifyOtpBtn = document.getElementById('verify-otp-btn');
    const recaptchaContainer = document.getElementById('recaptcha-container'); // Cet élément est passé tel quel à RecaptchaVerifier
    const authMsgPhoneId = 'auth-msg-phone';

    // Boutons de déconnexion
    const logoutBtn = document.getElementById('logout-btn');
    const logoutBtnMenu = document.getElementById('logout-btn-menu');


    // --- Fonction d'initialisation de reCAPTCHA (appelée une seule fois et au bon moment) ---
    const initializeRecaptcha = () => {
        // S'assure que auth est défini, que reCAPTCHA n'a pas déjà été initialisé, et que le conteneur existe
        if (!auth || recaptchaInitialized || !recaptchaContainer) {
            if (!auth) console.warn("Firebase Auth instance is not available yet for reCAPTCHA initialization.");
            if (recaptchaInitialized) console.warn("reCAPTCHA already initialized. Skipping.");
            if (!recaptchaContainer) console.warn("reCAPTCHA container (#recaptcha-container) not found in DOM. Skipping initialization.");
            return;
        }

        try {
            recaptchaVerifierInstance = new RecaptchaVerifier(auth, recaptchaContainer, {
                'size': 'invisible',
                'callback': (response) => {
                    console.log("reCAPTCHA résolu !");
                },
                'expired-callback': () => {
                    showMessage(authMsgPhoneId, 'Le reCAPTCHA a expiré, veuillez réessayer.', false);
                    if (recaptchaVerifierInstance && recaptchaVerifierInstance.clear) {
                        recaptchaVerifierInstance.clear();
                    }
                }
            });
            recaptchaVerifierInstance.render().catch(err => {
                console.error("Erreur lors du rendu reCAPTCHA:", err);
                showMessage(authMsgPhoneId, "Impossible de charger le reCAPTCHA. Veuillez rafraîchir la page.", false);
            });
            window.recaptchaVerifier = recaptchaVerifierInstance; // Pour un accès global si nécessaire
            recaptchaInitialized = true; // Met le drapeau à true
            console.log("reCAPTCHA initialisé avec succès.");
        } catch (error) {
            console.error("Erreur d'initialisation reCAPTCHA (dans try-catch):", error);
            if (error instanceof TypeError && error.message.includes("appVerificationDisabledForTesting")) {
                showMessage(authMsgPhoneId, "Erreur d'initialisation reCAPTCHA: Firebase Auth n'est pas encore prêt. (Si vous êtes en local, c'est normal, la vérification est désactivée.)", false);
            } else {
                showMessage(authMsgPhoneId, `Erreur d'initialisation reCAPTCHA: ${error.message}`, false);
            }
        }
    };


    // --- Authentification Email/Mot de passe ---
    if (signupEmailBtn) {
        signupEmailBtn.addEventListener('click', async () => {
            const pseudo = pseudoInput.value.trim();
            const email = emailInput.value.trim();
            const password = passwordInput.value.trim();

            if (!pseudo || !email || !password) {
                showMessage(authMsgEmailId, 'Veuillez remplir tous les champs.', false);
                return;
            }
            if (password.length < 6) {
                showMessage(authMsgEmailId, 'Le mot de passe doit contenir au moins 6 caractères.', false);
                return;
            }

            try {
                const pseudoQuery = query(ref(db, 'users'), orderByChild('pseudo'), equalTo(pseudo));
                const pseudoSnapshot = await get(pseudoQuery);
                if (pseudoSnapshot.exists()) {
                    showMessage(authMsgEmailId, 'Ce pseudo est déjà utilisé. Veuillez en choisir un autre.', false);
                    return;
                }

                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;

                await set(ref(db, `users/${user.uid}/pseudo`), pseudo);
                await set(ref(db, `users/${user.uid}/stats`), { wins: 0, losses: 0, draws: 0 });

                showMessage(authMsgEmailId, 'Inscription réussie !', true);
            } catch (error) {
                console.error("Erreur d'inscription (Email/Mdp):", error);
                if (error.code === 'auth/email-already-in-use') { showMessage(authMsgEmailId, 'Cette adresse e-mail est déjà utilisée.', false); }
                else if (error.code === 'auth/invalid-email') { showMessage(authMsgEmailId, 'Adresse e-mail invalide.', false); }
                else if (error.code === 'auth/weak-password') { showMessage(authMsgEmailId, 'Mot de passe trop faible (min. 6 caractères).', false); }
                else { showMessage(authMsgEmailId, `Erreur d'inscription: ${error.message}`, false); }
            }
        });
    }

    if (loginEmailBtn) {
        loginEmailBtn.addEventListener('click', async () => {
            const email = emailInput.value.trim();
            const password = passwordInput.value.trim();

            if (!email || !password) {
                showMessage(authMsgEmailId, 'Veuillez remplir tous les champs.', false);
                return;
            }

            try {
                await signInWithEmailAndPassword(auth, email, password);
                showMessage(authMsgEmailId, 'Connexion réussie !', true);
            } catch (error) {
                console.error("Erreur de connexion (Email/Mdp):", error);
                if (error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found') { showMessage(authMsgEmailId, 'Email ou mot de passe incorrect.', false); }
                else { showMessage(authMsgEmailId, `Erreur de connexion: ${error.message}`, false); }
            }
        });
    }

    // --- Authentification Google ---
    if (loginGoogleBtn) {
        loginGoogleBtn.addEventListener('click', async () => {
            try {
                const provider = new GoogleAuthProvider();
                await signInWithPopup(auth, provider);
                showMessage(authMsgGoogleId, 'Connexion réussie avec Google !', true);
            } catch (error) {
                console.error("Erreur de connexion Google:", error);
                if (error.code === 'auth/popup-closed-by-user') { showMessage(authMsgGoogleId, 'Connexion Google annulée.', false); }
                else { showMessage(authMsgGoogleId, `Erreur de connexion Google: ${error.message}`, false); }
            }
        });
    }

    // --- Authentification Téléphone ---
    if (sendOtpBtn && recaptchaContainer) { // Assure-toi que les deux éléments existent
        // Appelle initializeRecaptcha ici une fois que les éléments DOM sont disponibles
        initializeRecaptcha();

        sendOtpBtn.addEventListener('click', async () => {
            const phoneNumber = phoneInput.value.trim();

            if (!phoneNumber) { showMessage(authMsgPhoneId, 'Veuillez entrer un numéro de téléphone.', false); return; }
            if (!/^\+\d{1,3}\d{6,14}$/.test(phoneNumber)) { showMessage(authMsgPhoneId, 'Format de numéro invalide. Ex: +33612345678', false); return; }

            // Vérifier si reCAPTCHA est bien initialisé avant d'envoyer le code
            if (!recaptchaVerifierInstance) {
                 showMessage(authMsgPhoneId, 'Le système de vérification (reCAPTCHA) n\'est pas prêt. Veuillez réessayer.', false);
                 return;
            }

            try {
                showMessage(authMsgPhoneId, 'Envoi du code...', true);
                confirmationResult = await signInWithPhoneNumber(auth, phoneNumber, recaptchaVerifierInstance);
                showMessage(authMsgPhoneId, 'Code envoyé ! Veuillez vérifier vos SMS.', true);
                sendOtpBtn.style.display = 'none';
                otpInput.style.display = 'block';
                verifyOtpBtn.style.display = 'block';
            } catch (error) {
                console.error("Erreur d'envoi du code SMS:", error);
                if (error.code === 'auth/too-many-requests') { showMessage(authMsgPhoneId, 'Trop de tentatives, veuillez réessayer plus tard.', false); }
                else if (error.code === 'auth/invalid-phone-number') { showMessage(authMsgPhoneId, 'Numéro de téléphone invalide.', false); }
                else { showMessage(authMsgPhoneId, `Erreur: ${error.message}`, false); }
                if (recaptchaVerifierInstance && recaptchaVerifierInstance.clear) { recaptchaVerifierInstance.clear(); }
            }
        });
    }

    if (verifyOtpBtn) {
        verifyOtpBtn.addEventListener('click', async () => {
            const otpCode = otpInput.value.trim();

            if (!otpCode) { showMessage(authMsgPhoneId, 'Veuillez entrer le code de vérification.', false); return; }

            if (confirmationResult) {
                try {
                    await confirmationResult.confirm(otpCode);
                    showMessage(authMsgPhoneId, 'Connexion réussie par téléphone !', true);
                } catch (error) {
                    console.error("Erreur de vérification du code:", error);
                    if (error.code === 'auth/invalid-verification-code') { showMessage(authMsgPhoneId, 'Code de vérification invalide.', false); }
                    else { showMessage(authMsgPhoneId, `Erreur de vérification: ${error.message}`, false); }
                }
            } else {
                showMessage(authMsgPhoneId, 'Veuillez d\'abord envoyer un code de vérification.', false);
            }
        });
    }

    // --- Déconnexion ---
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            try {
                await signOut(auth);
                // Utilise l'ID de l'élément pour le message de déconnexion
                showMessage(authMsgEmailId, 'Déconnexion réussie.', true);
            } catch (error) {
                console.error("Erreur de déconnexion:", error);
                showMessage(authMsgEmailId, `Erreur de déconnexion: ${error.message}`, false);
            }
        });
    }

    if (logoutBtnMenu) { // Le bouton de déconnexion dans le menu principal
        logoutBtnMenu.addEventListener('click', async () => {
            try {
                await signOut(auth);
                showMessage(authMsgEmailId, 'Déconnexion réussie.', true);
            } catch (error) {
                console.error("Erreur de déconnexion:", error);
                showMessage(authMsgEmailId, `Erreur de déconnexion: ${error.message}`, false);
            }
        });
    }

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
                            await signOut(auth);
                            handleUserLogout();
                            return;
                        }

                        await set(ref(db, `users/${currentUserId}/pseudo`), pseudoTrimmed);
                        await set(ref(db, `users/${currentUserId}/stats`), { wins: 0, losses: 0, draws: 0 });
                        pseudo = pseudoTrimmed;
                        showMessage(authMsgEmailId, `Bienvenue ${pseudo} !`, true);
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

            if (pseudo) {
                handleUserLogin(currentUserId, pseudo);
            } else {
                console.warn("Pseudo non trouvé après vérification. Déconnexion.");
                await signOut(auth);
                handleUserLogout();
            }

            if (logoutBtn) logoutBtn.style.display = 'block';

        } else {
            handleUserLogout();
            if (logoutBtn) logoutBtn.style.display = 'none';
        }
    });
}
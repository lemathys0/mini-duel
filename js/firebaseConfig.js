// js/firebaseConfig.js

// Importe initializeApp pour initialiser l'application Firebase
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";
// Importe getAuth pour l'authentification Firebase
import { getAuth } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js";
// Importe getDatabase pour la base de données Realtime
import { getDatabase } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js";


// Définir la configuration de ton projet Firebase
const firebaseConfig = {
    apiKey: "AIzaSyA-e19z8T3c1K46YmJY8s9EAbO9BRes7fA",
    authDomain: "mini-duel-de-cartes.firebaseapp.com",
    databaseURL: "https://mini-duel-de-cartes-default-rtdb.firebaseio.com",
    projectId: "mini-duel-de-cartes",
    storageBucket: "mini-duel-de-cartes.firebasestorage.app",
    messagingSenderId: "1084207708579",
    appId: "1:1084207708579:web:f1312b68b7eb08f9d44216",
    measurementId: "G-7YW3J41XZF"
};

// Initialiser l'application Firebase
export const app = initializeApp(firebaseConfig);

// Obtenir l'instance de la base de données et l'exporter
export const db = getDatabase(app);

// Obtenir l'instance de l'authentification et l'exporter
export const auth = getAuth(app);

// *** PAS BESOIN D'EXPORTER LES FONCTIONS DE LA DB ICI ***
// Elles seront importées directement dans les fichiers qui en ont besoin.

// Optionnel: Pour le test local de la vérification téléphonique, à REMPLACER en production
if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    // Si auth n'est pas encore défini (très rare à ce point), il faudrait une vérification plus robuste.
    // Mais ici, auth est exporté directement après getAuth(app), donc il devrait être défini.
    auth.settings.appVerificationDisabledForTesting = true;
    console.warn("Firebase Auth: Phone verification disabled for testing on localhost.");
}
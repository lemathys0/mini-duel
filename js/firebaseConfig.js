// firebaseConfig.js

// Importe initializeApp pour initialiser l'application Firebase
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";

// Importe TOUTES les fonctions nécessaires de Firebase Realtime Database
import {
    getDatabase,
    ref,
    set,
    get,
    update,
    remove,
    onValue,
    off,
    serverTimestamp,
    runTransaction,
    push,
    onDisconnect // <-- C'est celle qui manquait pour la dernière erreur !
} from "https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js";


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

// Obtenir l'instance de la base de données
export const db = getDatabase(app);

// EXPORTE TOUTES LES FONCTIONS DE LA BASE DE DONNÉES POUR LES AUTRES MODULES
export {
    ref,
    set,
    get,
    update,
    remove,
    onValue,
    off,
    serverTimestamp,
    runTransaction,
    push,
    onDisconnect
};
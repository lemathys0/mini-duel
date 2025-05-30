// js/firebaseConfig.js
// Importe les fonctions nécessaires depuis les URLs CDN de Firebase
import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js';
import { getAuth, onAuthStateChanged  } from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js';
import { getDatabase, ref, set, get, query, orderByChild, equalTo, push, remove, onValue, serverTimestamp, off, update } from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js';

console.log("firebaseConfig.js chargé.");

// Votre configuration Firebase (vos clés sont conservées)
const firebaseConfig = {
    apiKey: "AIzaSyA-e19z8T3c1K46YmJY8s9EAbO9BRes7fA",
    authDomain: "mini-duel-de-cartes.firebaseapp.com",
    databaseURL: "https://mini-duel-de-cartes-default-rtdb.firebaseio.com",
    projectId: "mini-card-duel",
    storageBucket: "mini-duel-de-cartes.firebasestorage.app",
    messagingSenderId: "1084207708579",
    appId: "1:1084207708579:web:f1312b68b7eb08f9d44216",
    measurementId: "G-7YW3J41XZF"
};

// Initialisation de l'application Firebase
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app); // C'EST ICI QUE 'auth' EST DÉCLARÉ ET EXPORTÉ UNE FOIS POUR TOUTES
export const db = getDatabase(app); // C'EST ICI QUE 'db' EST DÉCLARÉ ET EXPORTÉ


// Export des fonctions de Realtime Database pour un accès facile
export { ref, set, get, query, orderByChild, equalTo, push, remove, onValue, serverTimestamp, off, update, onAuthStateChanged };
// firebaseConfig.js
// Pas besoin d'importer initializeApp ou getDatabase ici si vous ne les exportez pas directement.
// Mais pour la clarté et si d'autres modules en avaient besoin, on peut les garder.
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js";

// Définir la configuration
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

// Si vous avez besoin d'exporter la config elle-même pour une raison, faites-le nommément
// export const firebaseConfigData = firebaseConfig; // Renommez-la pour éviter la confusion
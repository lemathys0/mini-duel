// firebaseConfig.js
// Assurez-vous d'utiliser les URLs CDN complètes pour les imports si vous n'utilisez PAS un bundler (Webpack, Parcel, etc.)
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js"; // <-- TRÈS IMPORTANT : Importe getDatabase

const firebaseConfig = {
  apiKey: "AIzaSyA-e19z8T3c1K46YmJY8s9EAbO9BRes7fA",
  authDomain: "mini-duel-de-cartes.firebaseapp.com",
  databaseURL: "https://mini-duel-de-cartes-default-rtdb.firebaseio.com", // C'est l'URL par défaut de votre Realtime Database
  projectId: "mini-duel-de-cartes",
  storageBucket: "mini-duel-de-cartes.firebasestorage.app",
  messagingSenderId: "1084207708579",
  appId: "1:1084207708579:web:f1312b68b7eb08f9d44216",
  measurementId: "G-7YW3J41XZF" // Optionnel, si vous utilisez Analytics. Peut être retiré si non utilisé.
};

// Initialise l'application Firebase
export const app = initializeApp(firebaseConfig);

// Initialise et exporte l'instance de la Realtime Database
export const db = getDatabase(app); // <-- EXPORTE 'db' POUR QU'IL SOIT ACCESSIBLE DANS D'AUTRES FICHIERS
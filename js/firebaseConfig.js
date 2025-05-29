import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js";

const firebaseConfig = {
    apiKey: "YOUR_FIREBASE_API_KEY",
    authDomain: "mini-duel-de-cartes.firebaseapp.com",
    databaseURL: "https://mini-duel-de-cartes-default-rtdb.firebaseio.com",
    projectId: "mini-duel-de-cartes",
    storageBucket: "mini-duel-de-cartes.appspot.com",
    messagingSenderId: "1084207708579",
    appId: "1:1084207708579:web:f1312b68b7eb08f9d44216",
    measurementId: "G-7YW3J41XZF"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

export { app, db }; 

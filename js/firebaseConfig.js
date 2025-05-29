// firebaseConfig.js
import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database"; // <-- IMPORTANT: Import getDatabase for Realtime Database

const firebaseConfig = {
  apiKey: "AIzaSyA-e19z8T3c1K46YmJY8s9EAbO9BRes7fA",
  authDomain: "mini-duel-de-cartes.firebaseapp.com",
  databaseURL: "https://mini-duel-de-cartes-default-rtdb.firebaseio.com", // This URL is correct for your project ID
  projectId: "mini-duel-de-cartes",
  storageBucket: "mini-duel-de-cartes.firebasestorage.app",
  messagingSenderId: "1084207708579",
  appId: "1:1084207708579:web:f1312b68b7eb08f9d44216",
  measurementId: "G-7YW3J41XZF" // Keep this if you want Analytics
};

// Initialize Firebase App
export const app = initializeApp(firebaseConfig);

// Initialize Realtime Database
export const db = getDatabase(app); // <-- IMPORTANT: Initialize and export 'db'
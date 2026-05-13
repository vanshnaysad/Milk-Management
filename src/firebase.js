import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDBeJaN4eA6VVYXbw1sFr4MQmKSqohzORs",
  authDomain: "milk-counting-53446.firebaseapp.com",
  databaseURL: "https://milk-counting-53446-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "milk-counting-53446",
  storageBucket: "milk-counting-53446.firebasestorage.app",
  messagingSenderId: "904720186036",
  appId: "1:904720186036:web:26faef21b9dcae6d0db5e1",
  measurementId: "G-97Z1ZLBFM4"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

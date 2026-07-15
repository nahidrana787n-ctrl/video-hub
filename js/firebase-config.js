/* =========================================================
   আপনার Firebase + imgbb কনফিগারেশন
   ========================================================= */

const firebaseConfig = {
  apiKey: "AIzaSyB-G1Z67-b4wrjrOnbA2wpbL7EXw9ZoAt4",
  authDomain: "video-box-4b43f.firebaseapp.com",
  projectId: "video-box-4b43f",
  storageBucket: "video-box-4b43f.firebasestorage.app",
  messagingSenderId: "849350927715",
  appId: "1:849350927715:web:c9e24115cf6c84ae225f56",
  measurementId: "G-PRD2HVMH26"
};

// imgbb API key (ফটো ও প্রোফাইল পিকচার আপলোডের জন্য ব্যবহৃত হয়)
const IMGBB_API_KEY = "0e29028c8fe4a430a9467f33a0bf818a";

// যে ইমেইল দিয়ে লগইন করলে অ্যাডমিন প্যানেল অ্যাক্সেস পাবেন সেটি এখানে বসান
const ADMIN_EMAILS = ["nahidrana787n@gmail.com"];

/* ========================================================= */

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

function isAdminEmail(email){
  return !!email && ADMIN_EMAILS.map(e=>e.toLowerCase()).includes(email.toLowerCase());
}

import { initializeApp, getApps } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, type User } from 'firebase/auth';

function auth() {
  const config = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  };
  if (!config.apiKey || !config.authDomain || !config.projectId) throw new Error('Firebase authentication is not configured');
  return getAuth(getApps()[0] || initializeApp(config));
}

export async function submitCredentials(email: string, password: string, mode: 'in' | 'up') {
  const instance = auth();
  await (mode === 'up' ? createUserWithEmailAndPassword(instance, email, password) : signInWithEmailAndPassword(instance, email, password));
}

export function watchUser(callback: (user: User | null) => void) { return onAuthStateChanged(auth(), callback); }
export function signOutUser() { return signOut(auth()); }
export async function getUserToken() { return auth().currentUser?.getIdToken() || ''; }

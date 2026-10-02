import { initializeApp } from '../vendor/firebase-app.js';
import {
    getAuth,
    signInAnonymously,
    signInWithEmailAndPassword,
    onAuthStateChanged
} from '../vendor/firebase-auth.js';
import {
    getFirestore,
    enableNetwork,
    disableNetwork,
    connectFirestoreEmulator
} from '../vendor/firebase-firestore.js';

import { firebaseConfig, SETUP_DONE } from './firebase-config.js';

let app = null;
let auth = null;
let db = null;

export const configReady = SETUP_DONE;

export function getDb() {
    return db;
}

export async function initFirebase() {
    if (!SETUP_DONE) {
        throw new SetupRequiredError();
    }

    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);

    if (!auth.currentUser) {
        await signInAnonymously(auth);
    }
    await waitForAuth(auth, 15000);

    return auth.currentUser;
}

function waitForAuth(authRef, timeoutMs) {
    return new Promise((resolve, reject) => {
        let unsub = null;
        let settled = false;
        const done = (err) => {
            if (settled) return;
            settled = true;
            if (unsub) {
                try {
                    unsub();
                } catch (e) {
                    void e;
                }
            }
            if (err) reject(err);
            else resolve();
        };
        unsub = onAuthStateChanged(
            authRef,
            (user) => {
                if (user) done();
            },
            (err) => done(err)
        );
        if (authRef.currentUser) done();
        setTimeout(() => done(new Error('Sign-in timed out')), timeoutMs);
    });
}

export class SetupRequiredError extends Error {
    constructor() {
        super('Firebase config has not been filled in');
        this.name = 'SetupRequiredError';
    }
}

export async function signInAdmin(email, password) {
    if (!app) {
        app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);
    }
    return signInWithEmailAndPassword(auth, email, password);
}

export function isSignedInAdmin() {
    const u = auth && auth.currentUser;
    return !!(u && u.email);
}

export function adminEmail() {
    const u = auth && auth.currentUser;
    return (u && u.email) || '';
}

export function describeAuthError(err) {
    const code = (err && err.code) || '';
    if (code === 'auth/operation-not-allowed' || code === 'auth/admin-restricted-operation') {
        return 'Anonymous sign-in is switched OFF. In the Firebase console: Authentication -> Sign-in method -> Anonymous -> Enable, then Publish.';
    }
    if (code === 'auth/api-key-not-valid' || code === 'auth/invalid-api-key') {
        return 'The API key in js/firebase-config.js is not valid. Copy it again from Firebase console -> Project settings -> Your apps -> Web app -> SDK setup and configuration.';
    }
    if (code === 'auth/unauthorized-domain' || code === 'auth/operation-not-supported-in-this-environment') {
        return 'This domain is not authorised. In Firebase console -> Authentication -> Settings -> Authorised domains -> Add domain.';
    }
    if (code === 'permission-denied' || code === 'firestore/permission-denied') {
        return 'Firestore security rules rejected the write. Publish the firestore.rules file from this project (see README step 5).';
    }
    if (code === 'unavailable' || code === 'firestore/unavailable') {
        return 'Cannot reach Firestore. Check the school Wi-Fi / internet connection.';
    }
    return (err && err.message) || 'Unknown connection error';
}

export function isOfflineError(err) {
    if (!err) return false;
    const code = err.code || '';
    return (
        code === 'unavailable' ||
        code === 'firestore/unavailable' ||
        code === 'deadline-exceeded' ||
        err.name === 'FirebaseError' && /network|offline|unavailable/i.test(String(err.message))
    );
}

export async function forceReconnect() {
    if (!db) return;
    try {
        await disableNetwork(db);
    } catch (e) {
        void e;
    }
    await new Promise((r) => setTimeout(r, 400));
    await enableNetwork(db);
}

export { connectFirestoreEmulator };

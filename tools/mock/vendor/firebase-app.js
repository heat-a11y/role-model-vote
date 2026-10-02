export function initializeApp(config) {
    return { __app: true, config };
}
export function getAuth() {
    return { __auth: true, currentUser: { uid: 'test-uid', email: 'admin@example.com' } };
}
export function getFirestore() {
    return { __db: true };
}
export function signInAnonymously() {
    return Promise.resolve({ uid: 'anon' });
}
export function signInWithEmailAndPassword() {
    return Promise.resolve({ uid: 'admin' });
}
export function onAuthStateChanged(_auth, cb) {
    cb({ uid: 'test-uid', email: 'admin@example.com' });
    return () => {};
}

export function getAuth() {
    return { __auth: true, currentUser: { uid: 'anon' } };
}
export function signInAnonymously() {
    return Promise.resolve({ uid: 'anon' });
}
export function signInWithEmailAndPassword() {
    return Promise.resolve({ uid: 'admin', email: 'admin@example.com' });
}
export function onAuthStateChanged(_auth, cb) {
    cb({ uid: 'anon' });
    return () => {};
}

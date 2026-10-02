export const firebaseConfig = {
    apiKey: 'REPLACE_WITH_YOUR_API_KEY',
    authDomain: 'REPLACE_WITH_YOUR_PROJECT.firebaseapp.com',
    projectId: 'REPLACE_WITH_YOUR_PROJECT',
    storageBucket: 'REPLACE_WITH_YOUR_PROJECT.appspot.com',
    messagingSenderId: 'REPLACE_WITH_MESSAGING_SENDER_ID',
    appId: 'REPLACE_WITH_YOUR_APP_ID'
};

export const SETUP_DONE = !Object.values(firebaseConfig).some(
    (v) => typeof v === 'string' && (v.startsWith('REPLACE_WITH') || v.trim() === '')
);

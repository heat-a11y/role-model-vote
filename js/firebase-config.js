export const firebaseConfig = {
    apiKey: 'AIzaSyD00CNLJYkLwMbzcC0uuAO6nynY1lBHhk0',
    authDomain: 'school-voting-cad02.firebaseapp.com',
    projectId: 'school-voting-cad02',
    storageBucket: 'school-voting-cad02.firebasestorage.app',
    messagingSenderId: '87968069378',
    appId: '1:87968069378:web:25ab24e7fac140e87d741b'
};

export const SETUP_DONE = !Object.values(firebaseConfig).some(
    (v) => typeof v === 'string' && (v.startsWith('REPLACE_WITH') || v.trim() === '')
);
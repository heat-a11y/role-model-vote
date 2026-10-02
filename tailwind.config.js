/** @type {import('tailwindcss').Config} */
module.exports = {
    content: ['./*.html', './js/*.js'],
    theme: {
        extend: {
            fontFamily: {
                sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif']
            },
            keyframes: {
                'fade-in': {
                    from: { opacity: '0', transform: 'translateY(6px)' },
                    to: { opacity: '1', transform: 'translateY(0)' }
                },
                'pop-in': {
                    '0%': { opacity: '0', transform: 'scale(0.85)' },
                    '70%': { transform: 'scale(1.04)' },
                    '100%': { opacity: '1', transform: 'scale(1)' }
                },
                'bar-grow': {
                    from: { transform: 'scaleX(0)' },
                    to: { transform: 'scaleX(1)' }
                }
            },
            animation: {
                'fade-in': 'fade-in 0.25s ease-out both',
                'pop-in': 'pop-in 0.3s ease-out both'
            }
        }
    },
    plugins: []
};

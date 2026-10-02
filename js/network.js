export function describeNetworkError(err) {
    if (isOfflineError(err)) {
        return 'Cannot reach the voting server. Check that the master laptop is running and all devices are on the same Wi-Fi.';
    }
    return (err && err.message) || 'Unknown local server error';
}

export function isOfflineError(err) {
    return !!err && (
        err.code === 'unavailable' ||
        err.code === 'deadline-exceeded' ||
        err.name === 'TypeError' ||
        /network|offline|unavailable/i.test(String(err.message))
    );
}

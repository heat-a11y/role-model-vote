import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = path.join(root, path.normalize(rel).replace(/^([/\\])+/, ''));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});

function lanAddresses() {
    const out = [];
    for (const list of Object.values(os.networkInterfaces())) {
        for (const ni of list || []) {
            if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
        }
    }
    return out;
}

const port = Number(process.env.PORT || 8080);
server.listen(port, '0.0.0.0', () => {
    console.log('\nRole Model Vote is being served.\n');
    console.log('  On this laptop:');
    console.log('    http://localhost:' + port + '/\n');
    for (const ip of lanAddresses()) {
        console.log('  On other laptops on the same Wi-Fi:');
        console.log('    http://' + ip + ':' + port + '/kiosk.html?class=3A');
        console.log('    http://' + ip + ':' + port + '/dashboard.html\n');
    }
    console.log('  Press Ctrl+C to stop.\n');
});
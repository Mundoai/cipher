#!/usr/bin/env node

/**
 * Docker reverse proxy for single-port Cipher UI deployment.
 *
 * Routes traffic from the single exposed Docker port:
 * - /ws (including WebSocket upgrades) → API server (API_PORT)
 * - /health → API server (API_PORT)
 * - /api/* → API server (API_PORT)
 * - Everything else → Next.js standalone (UI_PORT)
 */

const http = require('http');
const net = require('net');

const PROXY_PORT = parseInt(process.env.PORT || '3000', 10);
const API_PORT = parseInt(process.env.API_PORT || '3001', 10);
const UI_PORT = parseInt(process.env.UI_PORT || '3002', 10);
const HOST = process.env.HOST || '0.0.0.0';

const ALLOWED_ORIGINS = [
	'https://cipher.mywebsites.dev',
	'http://localhost:3000',
	'http://localhost:3002',
];

function isAllowedOrigin(origin) {
	return origin && ALLOWED_ORIGINS.includes(origin);
}

function isApiRoute(url) {
	return (
		url === '/health' ||
		url.startsWith('/health?') ||
		url.startsWith('/api/') ||
		url === '/api' ||
		url.startsWith('/ws') ||
		url.startsWith('/.well-known/')
	);
}

function proxyRequest(req, res, targetPort) {
	// Rewrite Origin/Referer for API requests to bypass CORS
	// The API server allows http://localhost:3000 and http://localhost:3001
	const headers = { ...req.headers };
	if (targetPort === API_PORT) {
		const internalOrigin = `http://localhost:${API_PORT}`;
		if (headers.origin) {
			headers.origin = internalOrigin;
		}
		if (headers.referer) {
			headers.referer = headers.referer.replace(/https?:\/\/[^/]+/, internalOrigin);
		}
		// Remove host header mismatch
		headers.host = `localhost:${API_PORT}`;
	}

	const options = {
		hostname: '127.0.0.1',
		port: targetPort,
		path: req.url,
		method: req.method,
		headers,
	};

	const proxyReq = http.request(options, (proxyRes) => {
		// For API responses, set CORS headers only for allowed origins
		if (targetPort === API_PORT) {
			const responseHeaders = { ...proxyRes.headers };
			const requestOrigin = req.headers.origin;
			if (isAllowedOrigin(requestOrigin)) {
				responseHeaders['access-control-allow-origin'] = requestOrigin;
				responseHeaders['access-control-allow-credentials'] = 'true';
				responseHeaders['access-control-allow-methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
				responseHeaders['access-control-allow-headers'] = 'Content-Type, Authorization';
			} else {
				// Remove any CORS headers set by the upstream server
				delete responseHeaders['access-control-allow-origin'];
				delete responseHeaders['access-control-allow-credentials'];
			}
			res.writeHead(proxyRes.statusCode, responseHeaders);
		} else {
			res.writeHead(proxyRes.statusCode, proxyRes.headers);
		}
		proxyRes.pipe(res, { end: true });
	});

	proxyReq.on('error', (err) => {
		console.error(`Proxy error to port ${targetPort}: ${err.message}`);
		if (!res.headersSent) {
			res.writeHead(502, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'Bad Gateway', message: `Backend on port ${targetPort} unavailable` }));
		}
	});

	req.pipe(proxyReq, { end: true });
}

function proxyWebSocket(req, socket, head, targetPort) {
	const proxySocket = net.connect(targetPort, '127.0.0.1', () => {
		// Reconstruct the HTTP upgrade request
		const headers = Object.entries(req.headers)
			.map(([key, value]) => `${key}: ${value}`)
			.join('\r\n');

		proxySocket.write(
			`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n` +
			`${headers}\r\n\r\n`
		);

		if (head && head.length > 0) {
			proxySocket.write(head);
		}

		// Pipe data between client and backend
		proxySocket.pipe(socket);
		socket.pipe(proxySocket);
	});

	proxySocket.on('error', (err) => {
		console.error(`WebSocket proxy error to port ${targetPort}: ${err.message}`);
		socket.end();
	});

	socket.on('error', (err) => {
		console.error(`Client socket error: ${err.message}`);
		proxySocket.end();
	});
}

const server = http.createServer((req, res) => {
	const targetPort = isApiRoute(req.url) ? API_PORT : UI_PORT;
	proxyRequest(req, res, targetPort);
});

server.on('upgrade', (req, socket, head) => {
	// Route WebSocket upgrades
	const targetPort = req.url.startsWith('/ws') ? API_PORT : UI_PORT;
	proxyWebSocket(req, socket, head, targetPort);
});

server.listen(PROXY_PORT, HOST, () => {
	console.log(`[proxy] Reverse proxy listening on ${HOST}:${PROXY_PORT}`);
	console.log(`[proxy] API routes → 127.0.0.1:${API_PORT}`);
	console.log(`[proxy] UI routes  → 127.0.0.1:${UI_PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
	console.log('[proxy] Shutting down...');
	server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
	console.log('[proxy] Shutting down...');
	server.close(() => process.exit(0));
});

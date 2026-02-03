import { Request, Response, NextFunction } from 'express';
import { errorResponse, ERROR_CODES } from '../utils/response.js';
import { ApiKeyStore, ApiKeyRecord } from '../services/api-key-store.js';
import { logger } from '@core/logger/index.js';

// Extend Express Request to include apiKey
declare global {
	namespace Express {
		interface Request {
			apiKey?: ApiKeyRecord;
		}
	}
}

/**
 * Creates middleware that validates API key from Authorization header.
 * Keys are expected as: Authorization: Bearer sk-...
 */
export function createApiKeyAuth(store: ApiKeyStore) {
	return (req: Request, res: Response, next: NextFunction): void => {
		const authHeader = req.headers['authorization'];

		if (!authHeader) {
			errorResponse(
				res,
				ERROR_CODES.UNAUTHORIZED,
				'Missing Authorization header. Provide: Authorization: Bearer <api-key>',
				401,
				undefined,
				req.requestId
			);
			return;
		}

		const parts = authHeader.split(' ');
		if (parts.length !== 2 || parts[0] !== 'Bearer') {
			errorResponse(
				res,
				ERROR_CODES.UNAUTHORIZED,
				'Invalid Authorization format. Expected: Bearer <api-key>',
				401,
				undefined,
				req.requestId
			);
			return;
		}

		const key = parts[1];
		if (!key || !key.startsWith('sk-')) {
			errorResponse(
				res,
				ERROR_CODES.UNAUTHORIZED,
				'Invalid API key format',
				401,
				undefined,
				req.requestId
			);
			return;
		}

		const record = store.validate(key);
		if (!record) {
			logger.warn('[Auth] Invalid or expired API key attempt', {
				prefix: key.substring(0, 10) + '...',
				ip: req.ip,
			});
			errorResponse(
				res,
				ERROR_CODES.UNAUTHORIZED,
				'Invalid or expired API key',
				401,
				undefined,
				req.requestId
			);
			return;
		}

		// Attach key record to request for downstream use
		req.apiKey = record;
		next();
	};
}

/**
 * Creates admin authentication middleware.
 * Accepts either:
 * 1. CIPHER_ADMIN_KEY environment variable as Bearer token
 * 2. A valid API key with "admin:*" permission
 */
export function createAdminAuth(store: ApiKeyStore) {
	return (req: Request, res: Response, next: NextFunction): void => {
		const authHeader = req.headers['authorization'];
		const adminKey = process.env.CIPHER_ADMIN_KEY;

		if (!authHeader) {
			errorResponse(
				res,
				ERROR_CODES.UNAUTHORIZED,
				'Admin authentication required',
				401,
				undefined,
				req.requestId
			);
			return;
		}

		const parts = authHeader.split(' ');
		if (parts.length !== 2 || parts[0] !== 'Bearer') {
			errorResponse(
				res,
				ERROR_CODES.UNAUTHORIZED,
				'Invalid Authorization format',
				401,
				undefined,
				req.requestId
			);
			return;
		}

		const token = parts[1];

		// Check admin key from environment
		if (adminKey && token === adminKey) {
			next();
			return;
		}

		// Check if it's a valid API key with admin permissions
		if (token.startsWith('sk-')) {
			const record = store.validate(token);
			if (record && (record.permissions.includes('*') || record.permissions.includes('admin:*'))) {
				req.apiKey = record;
				next();
				return;
			}
		}

		logger.warn('[Auth] Unauthorized admin access attempt', { ip: req.ip });
		errorResponse(
			res,
			ERROR_CODES.UNAUTHORIZED,
			'Invalid admin credentials',
			403,
			undefined,
			req.requestId
		);
	};
}

/**
 * Optional API key auth - allows requests through but attaches key if present
 */
export function createOptionalApiKeyAuth(store: ApiKeyStore) {
	return (req: Request, _res: Response, next: NextFunction): void => {
		const authHeader = req.headers['authorization'];

		if (authHeader) {
			const parts = authHeader.split(' ');
			if (parts.length === 2 && parts[0] === 'Bearer' && parts[1].startsWith('sk-')) {
				const record = store.validate(parts[1]);
				if (record) {
					req.apiKey = record;
				}
			}
		}

		next();
	};
}

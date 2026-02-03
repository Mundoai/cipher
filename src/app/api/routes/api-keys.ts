import { Router, Request, Response } from 'express';
import { successResponse, errorResponse, ERROR_CODES } from '../utils/response.js';
import { ApiKeyStore } from '../services/api-key-store.js';
import { logger } from '@core/logger/index.js';

export function createApiKeyRoutes(store: ApiKeyStore): Router {
	const router = Router();

	/**
	 * POST /api/admin/keys
	 * Create a new API key
	 */
	router.post('/', async (req: Request, res: Response) => {
		try {
			const { name, permissions, expiresAt } = req.body;

			if (!name || typeof name !== 'string' || name.trim().length === 0) {
				return errorResponse(
					res,
					ERROR_CODES.VALIDATION_ERROR,
					'Name is required and must be a non-empty string',
					400,
					undefined,
					req.requestId
				);
			}

			if (name.length > 100) {
				return errorResponse(
					res,
					ERROR_CODES.VALIDATION_ERROR,
					'Name must be 100 characters or less',
					400,
					undefined,
					req.requestId
				);
			}

			// Validate permissions if provided
			if (permissions && !Array.isArray(permissions)) {
				return errorResponse(
					res,
					ERROR_CODES.VALIDATION_ERROR,
					'Permissions must be an array of strings',
					400,
					undefined,
					req.requestId
				);
			}

			// Validate expiresAt if provided
			if (expiresAt !== undefined && expiresAt !== null) {
				const expiry = Number(expiresAt);
				if (isNaN(expiry) || expiry <= Date.now()) {
					return errorResponse(
						res,
						ERROR_CODES.VALIDATION_ERROR,
						'expiresAt must be a future Unix timestamp in milliseconds',
						400,
						undefined,
						req.requestId
					);
				}
			}

			const result = store.create({
				name: name.trim(),
				permissions: permissions || ['*'],
				expiresAt: expiresAt || null,
			});

			logger.info(`[API Keys] Created key "${name}" with id ${result.record.id}`);

			// Return the full key ONLY on creation
			return successResponse(
				res,
				{
					key: result.key,
					id: result.record.id,
					name: result.record.name,
					prefix: result.record.prefix,
					permissions: result.record.permissions,
					createdAt: result.record.createdAt,
					expiresAt: result.record.expiresAt,
				},
				201,
				req.requestId
			);
		} catch (error) {
			logger.error('[API Keys] Error creating key', { error });
			return errorResponse(
				res,
				ERROR_CODES.INTERNAL_ERROR,
				'Failed to create API key',
				500,
				undefined,
				req.requestId
			);
		}
	});

	/**
	 * GET /api/admin/keys
	 * List all API keys (without actual key values)
	 */
	router.get('/', async (req: Request, res: Response) => {
		try {
			const includeRevoked = req.query.includeRevoked === 'true';
			const keys = store.list(includeRevoked);

			// Strip keyHash from response
			const sanitized = keys.map(k => ({
				id: k.id,
				name: k.name,
				prefix: k.prefix,
				permissions: k.permissions,
				createdAt: k.createdAt,
				lastUsedAt: k.lastUsedAt,
				expiresAt: k.expiresAt,
				revoked: k.revoked,
			}));

			return successResponse(res, sanitized, 200, req.requestId);
		} catch (error) {
			logger.error('[API Keys] Error listing keys', { error });
			return errorResponse(
				res,
				ERROR_CODES.INTERNAL_ERROR,
				'Failed to list API keys',
				500,
				undefined,
				req.requestId
			);
		}
	});

	/**
	 * GET /api/admin/keys/:keyId
	 * Get details of a specific API key
	 */
	router.get('/:keyId', async (req: Request, res: Response) => {
		try {
			const { keyId } = req.params;
			const record = store.getById(keyId);

			if (!record) {
				return errorResponse(
					res,
					ERROR_CODES.NOT_FOUND,
					'API key not found',
					404,
					undefined,
					req.requestId
				);
			}

			return successResponse(
				res,
				{
					id: record.id,
					name: record.name,
					prefix: record.prefix,
					permissions: record.permissions,
					createdAt: record.createdAt,
					lastUsedAt: record.lastUsedAt,
					expiresAt: record.expiresAt,
					revoked: record.revoked,
				},
				200,
				req.requestId
			);
		} catch (error) {
			logger.error('[API Keys] Error getting key', { error });
			return errorResponse(
				res,
				ERROR_CODES.INTERNAL_ERROR,
				'Failed to get API key',
				500,
				undefined,
				req.requestId
			);
		}
	});

	/**
	 * PUT /api/admin/keys/:keyId
	 * Update an API key's name
	 */
	router.put('/:keyId', async (req: Request, res: Response) => {
		try {
			const { keyId } = req.params;
			const { name } = req.body;

			if (!name || typeof name !== 'string' || name.trim().length === 0) {
				return errorResponse(
					res,
					ERROR_CODES.VALIDATION_ERROR,
					'Name is required',
					400,
					undefined,
					req.requestId
				);
			}

			const existing = store.getById(keyId);
			if (!existing) {
				return errorResponse(
					res,
					ERROR_CODES.NOT_FOUND,
					'API key not found',
					404,
					undefined,
					req.requestId
				);
			}

			store.updateName(keyId, name.trim());

			return successResponse(
				res,
				{ id: keyId, name: name.trim(), updated: true },
				200,
				req.requestId
			);
		} catch (error) {
			logger.error('[API Keys] Error updating key', { error });
			return errorResponse(
				res,
				ERROR_CODES.INTERNAL_ERROR,
				'Failed to update API key',
				500,
				undefined,
				req.requestId
			);
		}
	});

	/**
	 * DELETE /api/admin/keys/:keyId
	 * Revoke an API key (soft delete)
	 */
	router.delete('/:keyId', async (req: Request, res: Response) => {
		try {
			const { keyId } = req.params;
			const permanent = req.query.permanent === 'true';

			const existing = store.getById(keyId);
			if (!existing) {
				return errorResponse(
					res,
					ERROR_CODES.NOT_FOUND,
					'API key not found',
					404,
					undefined,
					req.requestId
				);
			}

			if (permanent) {
				store.delete(keyId);
				logger.info(`[API Keys] Permanently deleted key ${keyId}`);
			} else {
				store.revoke(keyId);
				logger.info(`[API Keys] Revoked key ${keyId}`);
			}

			return successResponse(
				res,
				{ id: keyId, action: permanent ? 'deleted' : 'revoked' },
				200,
				req.requestId
			);
		} catch (error) {
			logger.error('[API Keys] Error revoking key', { error });
			return errorResponse(
				res,
				ERROR_CODES.INTERNAL_ERROR,
				'Failed to revoke API key',
				500,
				undefined,
				req.requestId
			);
		}
	});

	return router;
}

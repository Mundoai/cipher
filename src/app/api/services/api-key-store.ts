import { randomBytes, createHash, randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import { logger } from '@core/logger/index.js';

export interface ApiKeyRecord {
	id: string;
	name: string;
	prefix: string; // First 10 chars for display (e.g., "sk-abc1234...")
	keyHash: string; // SHA-256 hash of the full key
	permissions: string[]; // e.g., ["*"] or ["message:write", "session:read"]
	createdAt: number;
	lastUsedAt: number | null;
	expiresAt: number | null;
	revoked: boolean;
}

export interface CreateApiKeyInput {
	name: string;
	permissions?: string[];
	expiresAt?: number | null;
}

export interface CreateApiKeyResult {
	key: string; // Full key - only shown once at creation
	record: ApiKeyRecord;
}

/**
 * API Key store using SQLite via better-sqlite3.
 * Creates its own database file for API key storage.
 */
export class ApiKeyStore {
	private db: any; // better-sqlite3 Database instance
	private statements: Record<string, any> = {};

	constructor(db?: any) {
		if (db) {
			this.db = db;
		} else {
			// Create standalone database
			this.db = ApiKeyStore.createDatabase();
		}
		this.initialize();
	}

	/**
	 * Create a standalone SQLite database for API keys
	 */
	static createDatabase(): any {
		// Use data directory relative to working directory
		const dataDir = path.resolve(process.cwd(), 'data');
		if (!fs.existsSync(dataDir)) {
			fs.mkdirSync(dataDir, { recursive: true });
		}

		const dbPath = path.join(dataDir, 'api-keys.db');
		// Dynamic require for better-sqlite3 (CommonJS module)
		const Database = require('better-sqlite3');
		const db = new Database(dbPath);

		// Enable WAL mode for better concurrent access
		db.pragma('journal_mode = WAL');
		db.pragma('busy_timeout = 5000');

		logger.info(`[ApiKeyStore] Database initialized at ${dbPath}`);
		return db;
	}

	private initialize(): void {
		// Create api_keys table
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS api_keys (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				prefix TEXT NOT NULL,
				key_hash TEXT NOT NULL UNIQUE,
				permissions TEXT NOT NULL DEFAULT '["*"]',
				created_at INTEGER NOT NULL,
				last_used_at INTEGER,
				expires_at INTEGER,
				revoked INTEGER NOT NULL DEFAULT 0
			)
		`);

		this.db.exec('CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash)');
		this.db.exec('CREATE INDEX IF NOT EXISTS idx_api_keys_revoked ON api_keys(revoked)');

		// Prepare statements
		this.statements = {
			insert: this.db.prepare(`
				INSERT INTO api_keys (id, name, prefix, key_hash, permissions, created_at, last_used_at, expires_at, revoked)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			`),
			findByHash: this.db.prepare(`
				SELECT * FROM api_keys WHERE key_hash = ? AND revoked = 0
			`),
			findById: this.db.prepare(`
				SELECT * FROM api_keys WHERE id = ?
			`),
			listAll: this.db.prepare(`
				SELECT * FROM api_keys ORDER BY created_at DESC
			`),
			listActive: this.db.prepare(`
				SELECT * FROM api_keys WHERE revoked = 0 ORDER BY created_at DESC
			`),
			revoke: this.db.prepare(`
				UPDATE api_keys SET revoked = 1 WHERE id = ?
			`),
			updateLastUsed: this.db.prepare(`
				UPDATE api_keys SET last_used_at = ? WHERE id = ?
			`),
			updateName: this.db.prepare(`
				UPDATE api_keys SET name = ? WHERE id = ?
			`),
			deleteKey: this.db.prepare(`
				DELETE FROM api_keys WHERE id = ?
			`),
			count: this.db.prepare(`
				SELECT COUNT(*) as count FROM api_keys WHERE revoked = 0
			`),
		};

		logger.debug('[ApiKeyStore] Initialized API key store');
	}

	/**
	 * Generate a new API key with format: sk-{32 random hex chars}
	 */
	private generateKey(): string {
		const random = randomBytes(32).toString('hex');
		return `sk-${random}`;
	}

	/**
	 * Hash a key using SHA-256
	 */
	private hashKey(key: string): string {
		return createHash('sha256').update(key).digest('hex');
	}

	/**
	 * Convert a database row to an ApiKeyRecord
	 */
	private rowToRecord(row: any): ApiKeyRecord {
		return {
			id: row.id,
			name: row.name,
			prefix: row.prefix,
			keyHash: row.key_hash,
			permissions: JSON.parse(row.permissions),
			createdAt: row.created_at,
			lastUsedAt: row.last_used_at,
			expiresAt: row.expires_at,
			revoked: Boolean(row.revoked),
		};
	}

	/**
	 * Create a new API key
	 */
	create(input: CreateApiKeyInput): CreateApiKeyResult {
		const key = this.generateKey();
		const keyHash = this.hashKey(key);
		const prefix = key.substring(0, 10) + '...';
		const id = randomUUID();
		const now = Date.now();

		this.statements.insert.run(
			id,
			input.name,
			prefix,
			keyHash,
			JSON.stringify(input.permissions || ['*']),
			now,
			null,
			input.expiresAt || null,
			0
		);

		const record: ApiKeyRecord = {
			id,
			name: input.name,
			prefix,
			keyHash,
			permissions: input.permissions || ['*'],
			createdAt: now,
			lastUsedAt: null,
			expiresAt: input.expiresAt || null,
			revoked: false,
		};

		logger.info(`[ApiKeyStore] Created API key "${input.name}" (${prefix})`);

		return { key, record };
	}

	/**
	 * Validate an API key and return the record if valid
	 */
	validate(key: string): ApiKeyRecord | null {
		const keyHash = this.hashKey(key);
		const row = this.statements.findByHash.get(keyHash);

		if (!row) return null;

		const record = this.rowToRecord(row);

		// Check expiration
		if (record.expiresAt && Date.now() > record.expiresAt) {
			return null;
		}

		// Update last used timestamp
		try {
			this.statements.updateLastUsed.run(Date.now(), record.id);
		} catch {
			// Non-critical, don't fail validation
		}

		return record;
	}

	/**
	 * Get a key by ID
	 */
	getById(id: string): ApiKeyRecord | null {
		const row = this.statements.findById.get(id);
		return row ? this.rowToRecord(row) : null;
	}

	/**
	 * List all API keys (does not include the actual key value)
	 */
	list(includeRevoked: boolean = false): ApiKeyRecord[] {
		const rows = includeRevoked
			? this.statements.listAll.all()
			: this.statements.listActive.all();
		return rows.map((row: any) => this.rowToRecord(row));
	}

	/**
	 * Revoke an API key
	 */
	revoke(id: string): boolean {
		const result = this.statements.revoke.run(id);
		if (result.changes > 0) {
			logger.info(`[ApiKeyStore] Revoked API key ${id}`);
			return true;
		}
		return false;
	}

	/**
	 * Delete an API key permanently
	 */
	delete(id: string): boolean {
		const result = this.statements.deleteKey.run(id);
		if (result.changes > 0) {
			logger.info(`[ApiKeyStore] Deleted API key ${id}`);
			return true;
		}
		return false;
	}

	/**
	 * Update a key's name
	 */
	updateName(id: string, name: string): boolean {
		const result = this.statements.updateName.run(name, id);
		return result.changes > 0;
	}

	/**
	 * Get count of active (non-revoked) keys
	 */
	getActiveCount(): number {
		const row = this.statements.count.get();
		return row?.count || 0;
	}
}

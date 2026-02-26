// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { logger } from '../../platform/logging';
import { IKernelAccessService } from './types';

/**
 * Service to verify user access to specific kernel categories
 */
@injectable()
export class KernelAccessService implements IKernelAccessService {
    private readonly baseUrl = 'http://inhouse-notebook-api.prd.meesho.int:8085/api/v1/kernels';
    private accessCache = new Map<string, { hasAccess: boolean; timestamp: number }>();
    private accessibleKernelsCache = new Map<string, { kernels: string[]; timestamp: number }>();
    private readonly cacheDuration = 5 * 60 * 1000; // 5 minutes cache

    /**
     * Verify if the user has access to a specific kernel category
     * @param category Kernel category (e.g., 'dp-adhoc', 'rca-warehouse')
     * @param userEmail User's email address
     * @returns Promise<boolean> indicating if user has access
     */
    public async verifyAccess(category: string, userEmail: string): Promise<boolean> {
        if (!userEmail || !category) {
            logger.warn('KernelAccessService: Missing email or category');
            return false;
        }

        // Check cache first
        const cacheKey = `${category}:${userEmail}`;
        const cached = this.accessCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.cacheDuration) {
            logger.debug(`KernelAccessService: Using cached access result for ${cacheKey}: ${cached.hasAccess}`);
            return cached.hasAccess;
        }

        try {
            const url = `${this.baseUrl}/${category}/access/verify?email=${encodeURIComponent(userEmail)}`;
            logger.debug(`KernelAccessService: Verifying access for ${userEmail} to ${category}`);

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    accept: 'application/json',
                    Cookie: `user_email=${userEmail}`
                }
            });

            if (!response.ok) {
                logger.warn(
                    `KernelAccessService: Access verification failed with status ${response.status} for ${cacheKey}`
                );
                this.accessCache.set(cacheKey, { hasAccess: false, timestamp: Date.now() });
                return false;
            }

            const hasAccess = await response.json();
            const accessGranted = hasAccess === true || hasAccess === 'true';

            // Cache the result
            this.accessCache.set(cacheKey, { hasAccess: accessGranted, timestamp: Date.now() });

            logger.debug(`KernelAccessService: Access ${accessGranted ? 'granted' : 'denied'} for ${cacheKey}`);
            return accessGranted;
        } catch (error) {
            logger.error(`KernelAccessService: Error verifying access for ${cacheKey}`, error);
            // On error, deny access by default
            return false;
        }
    }

    /**
     * Fetch all accessible kernel categories for a user
     * @param userEmail User's email address
     * @returns Promise<string[]> list of accessible categories
     */
    public async getAccessibleKernels(userEmail: string): Promise<string[]> {
        if (!userEmail) {
            return [];
        }

        // Check cache
        const cached = this.accessibleKernelsCache.get(userEmail);
        if (cached && Date.now() - cached.timestamp < this.cacheDuration) {
            logger.debug(`KernelAccessService: Using cached accessible kernels for ${userEmail}`);
            return cached.kernels;
        }

        try {
            const url = `${this.baseUrl}?email=${encodeURIComponent(userEmail)}`;
            logger.debug(`KernelAccessService: Fetching all accessible kernels for ${userEmail}`);

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    accept: 'application/json',
                    Cookie: `user_email=${userEmail}`
                }
            });

            if (!response.ok) {
                logger.warn(`KernelAccessService: Failed to fetch accessible kernels for ${userEmail}`);
                return [];
            }

            const kernels = await response.json();
            const result = Array.isArray(kernels) ? kernels.map((k: any) => String(k)) : [];

            // Cache result
            this.accessibleKernelsCache.set(userEmail, { kernels: result, timestamp: Date.now() });
            logger.debug(`KernelAccessService: Found ${result.length} accessible kernels for ${userEmail}`);
            return result;
        } catch (error) {
            logger.error(`KernelAccessService: Error fetching accessible kernels for ${userEmail}`, error);
            return [];
        }
    }

    /**
     * Clear the access cache for a specific user or all users
     * @param userEmail Optional user email to clear cache for specific user
     */
    public clearCache(userEmail?: string): void {
        if (userEmail) {
            // Clear cache for specific user
            const keysToDelete: string[] = [];
            this.accessCache.forEach((_, key) => {
                if (key.endsWith(`:${userEmail}`)) {
                    keysToDelete.push(key);
                }
            });
            keysToDelete.forEach((key) => this.accessCache.delete(key));
            logger.debug(`KernelAccessService: Cleared cache for user ${userEmail}`);
        } else {
            // Clear all cache
            this.accessCache.clear();
            logger.debug('KernelAccessService: Cleared all access cache');
        }
    }

    /**
     * Get user email from environment or configuration
     * This should be implemented based on how your organization manages user identity
     */
    public getUserEmail(): string | undefined {
        // 1. Try to get from ~/.inhouse-notebook/fsutil/data.json
        try {
            const dataPath = path.join(os.homedir(), '.inhouse-notebook', 'fsutil', 'data.json');
            if (fs.existsSync(dataPath)) {
                logger.debug(`KernelAccessService: Found data.json at ${dataPath}. Reading...`);
                const content = fs.readFileSync(dataPath, 'utf8');
                const data = JSON.parse(content);
                if (data.email) {
                    logger.debug(`KernelAccessService: Successfully found email in data.json: ${data.email}`);
                    return data.email;
                } else {
                    logger.warn('KernelAccessService: data.json exists but "email" key is missing or empty.');
                }
            } else {
                logger.info(`KernelAccessService: data.json not found at ${dataPath}`);
            }
        } catch (err) {
            logger.error('KernelAccessService: Error reading or parsing email from data.json', err);
        }

        // 2. Try to get from environment variable
        logger.debug('KernelAccessService: Checking environment variables for USER_EMAIL or MEESHO_USER_EMAIL.');
        const email = process.env.USER_EMAIL || process.env.MEESHO_USER_EMAIL;

        if (!email) {
            logger.warn(
                'KernelAccessService: User email could not be retrieved from data.json or environment variables.'
            );
        } else {
            logger.debug(`KernelAccessService: Found email in environment: ${email}`);
        }

        return email;
    }

    /**
     * Extract kernel category from kernel name.
     * Simply returns the kernel name as-is — the API at
     * /api/v1/kernels/{name}/access/verify is the single source of truth
     * for whether this kernel requires access control.
     * No hardcoded patterns needed.
     */
    public extractKernelCategory(kernelName: string): string | undefined {
        if (!kernelName) {
            return undefined;
        }
        return kernelName;
    }
}

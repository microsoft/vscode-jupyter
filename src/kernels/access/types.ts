// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export const IKernelAccessService = Symbol('IKernelAccessService');

export interface IKernelAccessService {
    /**
     * Verify if the user has access to a specific kernel category
     */
    verifyAccess(category: string, userEmail: string): Promise<boolean>;

    /**
     * Clear the access cache
     */
    clearCache(userEmail?: string): void;

    /**
     * Get the current user's email
     */
    getUserEmail(): string | undefined;

    /**
     * Get all accessible kernels for a user
     */
    getAccessibleKernels(userEmail: string): Promise<string[]>;

    /**
     * Extract kernel category from kernel name
     */
    extractKernelCategory(kernelName: string): string | undefined;
}

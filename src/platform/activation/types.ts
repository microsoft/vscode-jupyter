// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export const IExtensionActivationManager = Symbol('IExtensionActivationManager');
/**
 * Responsible for activation of extension.
 */
export interface IExtensionActivationManager {
    /**
     * Method invoked when extension activates (invoked once).
     */
    activate(): void;
}

export const IExtensionSyncActivationService = Symbol('IExtensionSyncActivationService');
/**
 * Classes implementing this interface will have their `activate` methods
 * invoked during the activation of the extension.
 * This is a great hook for extension activation code, i.e. you don't need to modify
 * the `extension.ts` file to invoke some code when extension gets activated.
 */
export interface IExtensionSyncActivationService {
    activate(): void;
}

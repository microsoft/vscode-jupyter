// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { IDisposable } from '../common/types';

export const IExtensionActivationManager = Symbol('IExtensionActivationManager');
/**
 * Responsible for activation of extension.
 *
 * @export
 * @interface IExtensionActivationManager
 * @extends {IDisposable}
 */
export interface IExtensionActivationManager extends IDisposable {
    /**
     * Method invoked when extension activates (invoked once).
     */
    activateSync(): void;
    /**
     * Method invoked when extension activates (invoked once).
     *
     * @returns {Promise<void>}
     * @memberof IExtensionActivationManager
     */
    activate(): Promise<void>;
}

export const IExtensionSingleActivationService = Symbol('IExtensionSingleActivationService');
/**
 * Classes implementing this interface will have their `activate` methods
 * invoked during the activation of the extension.
 * This is a great hook for extension activation code, i.e. you don't need to modify
 * the `extension.ts` file to invoke some code when extension gets activated.
 * @export
 * @interface IExtensionSingleActivationService
 */
export interface IExtensionSingleActivationService {
    activate(): Promise<void>;
}

export const IExtensionSyncActivationService = Symbol('IExtensionSyncActivationService');
/**
 * Classes implementing this interface will have their `activate` methods
 * invoked during the activation of the extension.
 * This is a great hook for extension activation code, i.e. you don't need to modify
 * the `extension.ts` file to invoke some code when extension gets activated.
 * Unlike `IExtensionSingleActivationService`, this is synchronous, & guaranteed to run before any other code.
 */
export interface IExtensionSyncActivationService {
    activate(): void;
}

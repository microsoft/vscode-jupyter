// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Container, interfaces } from 'inversify';
import { IDisposable } from '../common/types';

/* eslint-disable @typescript-eslint/prefer-function-type */
// eslint-disable-next-line @typescript-eslint/naming-convention
export interface Newable<T> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new (...args: any[]): T;
}
/* eslint-enable @typescript-eslint/prefer-function-type */

// eslint-disable-next-line @typescript-eslint/naming-convention
export interface Abstract<T> {
    prototype: T;
}

/* eslint-disable @typescript-eslint/prefer-function-type */
export type ClassType<T> = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new (...args: any[]): T;
};
/* eslint-enable @typescript-eslint/prefer-function-type */

export const IServiceManager = Symbol('IServiceManager');

export interface IServiceManager extends IDisposable {
    add<T>(
        serviceIdentifier: interfaces.ServiceIdentifier<T>,
        constructor: ClassType<T>,
        name?: string | number | symbol | undefined,
        bindings?: symbol[]
    ): void;
    addSingleton<T>(
        serviceIdentifier: interfaces.ServiceIdentifier<T>,
        constructor: ClassType<T>,
        name?: string | number | symbol,
        bindings?: symbol[]
    ): void;
    addSingletonInstance<T>(
        serviceIdentifier: interfaces.ServiceIdentifier<T>,
        instance: T,
        name?: string | number | symbol
    ): void;
    addFactory<T>(
        factoryIdentifier: interfaces.ServiceIdentifier<interfaces.Factory<T>>,
        factoryMethod: interfaces.FactoryCreator<T>
    ): void;
    addBinding<T1, T2>(from: interfaces.ServiceIdentifier<T1>, to: interfaces.ServiceIdentifier<T2>): void;
    get<T>(serviceIdentifier: interfaces.ServiceIdentifier<T>, name?: string | number | symbol): T;
    tryGet<T>(serviceIdentifier: interfaces.ServiceIdentifier<T>, name?: string | number | symbol): T | undefined;
    getAll<T>(serviceIdentifier: interfaces.ServiceIdentifier<T>, name?: string | number | symbol): T[];
    rebind<T>(
        serviceIdentifier: interfaces.ServiceIdentifier<T>,
        constructor: ClassType<T>,
        name?: string | number | symbol
    ): void;
    rebindSingleton<T>(
        serviceIdentifier: interfaces.ServiceIdentifier<T>,
        constructor: ClassType<T>,
        name?: string | number | symbol
    ): void;
    rebindInstance<T>(
        serviceIdentifier: interfaces.ServiceIdentifier<T>,
        instance: T,
        name?: string | number | symbol
    ): void;
    getContainer(): Container; // For testing
}

export const IServiceContainer = Symbol('IServiceContainer');
export interface IServiceContainer {
    get<T>(serviceIdentifier: interfaces.ServiceIdentifier<T>, name?: string | number | symbol): T;
    getAll<T>(serviceIdentifier: interfaces.ServiceIdentifier<T>, name?: string | number | symbol): T[];
    tryGet<T>(serviceIdentifier: interfaces.ServiceIdentifier<T>, name?: string | number | symbol): T | undefined;
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Event, Uri } from 'vscode';
import { ClassType } from '../../ioc/types';
import { Resource } from '../types';

export type EnvironmentVariables = Object & Record<string, string | undefined>;

export const IEnvironmentVariablesService = Symbol('IEnvironmentVariablesService');

export interface IEnvironmentVariablesService {
    parseFile(filePath?: string, baseVars?: EnvironmentVariables): Promise<EnvironmentVariables | undefined>;
    /**
     * The variables in `source` trumps variables already in `target`.
     * If we have an env variable `ABC` defined in both, then the variable defined in `source` wins.
     * If we do not have a variable defined in `source`, then variable in `target` wins.
     * Some variables such as PYTHONPATH and PATH are not altered in `target`.
     * Use `appendPythonPath` & `appendPath` to update the `PYTHONPATH` & `PATH` variables in the `target` with those from `source`.
     */
    mergeVariables(source: EnvironmentVariables, target: EnvironmentVariables): void;
    appendPythonPath(vars: EnvironmentVariables, ...pythonPaths: string[]): void;
    appendPath(vars: EnvironmentVariables, ...paths: string[]): void;
    prependPath(vars: EnvironmentVariables, ...paths: string[]): void;
    /**
     * Special case where it will merge the paths from the two EnvironmentVariables together.
     * If source['path'] is available, it wins, otherwise target['path'] does
     */
    mergePaths(source: EnvironmentVariables, target: EnvironmentVariables): void;
}

/**
 * An interface for a JavaScript object that
 * acts as a dictionary. The keys are strings.
 */
export interface IStringDictionary<V> {
    [name: string]: V;
}

export interface ISystemVariables {
    resolve(value: string): string;
    resolve(value: string[]): string[];
    resolve(value: IStringDictionary<string>): IStringDictionary<string>;
    resolve(value: IStringDictionary<string[]>): IStringDictionary<string[]>;
    resolve(value: IStringDictionary<IStringDictionary<string>>): IStringDictionary<IStringDictionary<string>>;
    resolveAny<T>(value: T): T;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
}

export type ISystemVariablesConstructor = ClassType<ISystemVariables>;

export const ICustomEnvironmentVariablesProvider = Symbol('ICustomEnvironmentVariablesProvider');

export interface ICustomEnvironmentVariablesProvider {
    /**
     * Triggered when the .env file changes.
     */
    onDidEnvironmentVariablesChange: Event<Uri | undefined>;
    /**
     * Gets merged result of process.env and env variables defined in the .env file.
     */
    getEnvironmentVariables(
        resource: Resource,
        purpose: 'RunPythonCode' | 'RunNonPythonCode'
    ): Promise<EnvironmentVariables>;
    /**
     * Gets the env variables defined in the .env file.
     */
    getCustomEnvironmentVariables(
        resource: Resource,
        purpose: 'RunPythonCode' | 'RunNonPythonCode'
    ): Promise<EnvironmentVariables | undefined>;
}

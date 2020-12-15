// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Event, Uri } from 'vscode';

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
    // tslint:disable-next-line:no-any
    [key: string]: any;
}

export const IEnvironmentVariablesProvider = Symbol('IEnvironmentVariablesProvider');

export interface IEnvironmentVariablesProvider {
    onDidEnvironmentVariablesChange: Event<Uri | undefined>;
    getEnvironmentVariables(resource?: Uri): Promise<EnvironmentVariables>;
    getCustomEnvironmentVariables(resource?: Uri): Promise<EnvironmentVariables | undefined>;
}

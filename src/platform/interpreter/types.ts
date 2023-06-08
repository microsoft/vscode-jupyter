// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Uri } from 'vscode';
import { IDisposable, InterpreterUri, Resource } from '../../platform/common/types';
import { PythonEnvironment } from '../pythonEnvironments/info';

export const IReservedPythonNamedProvider = Symbol('IReservedPythonNamedProvider');
export interface IReservedPythonNamedProvider extends IDisposable {
    getUriOverridingReservedPythonNames(cwd: Uri): Promise<{ uri: Uri; type: 'file' | '__init__' }[]>;
    isReserved(uri: Uri): Promise<boolean>;
    /**
     * Keeps track of a Uri as a file that should be ignored from all warnings related to reserved names.
     */
    addToIgnoreList(uri: Uri): Promise<void>;
}

export const IInterpreterPackages = Symbol('IInterpreterPackages');
export interface IInterpreterPackages {
    listPackages(resource?: Resource): Promise<string[]>;
    getPackageVersions(interpreter: PythonEnvironment): Promise<Map<string, string>>;
    getPackageVersion(interpreter: PythonEnvironment, packageName: string): Promise<string | undefined>;
    trackPackages(interpreterUri: InterpreterUri, ignoreCache?: boolean): void;
}

export const IWorkspaceInterpreterTracker = Symbol('IWorkspaceInterpreterTracker');
export interface IWorkspaceInterpreterTracker {
    activate(): void;
    isActiveWorkspaceInterpreter(resource: Resource, interpreter?: PythonEnvironment): boolean;
}

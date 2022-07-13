// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Uri } from 'vscode';
import { IDisposable } from '../../platform/common/types';

export const IReservedPythonNamedProvider = Symbol('IReservedPythonNamedProvider');
export interface IReservedPythonNamedProvider extends IDisposable {
    getFilesOverridingReservedPythonNames(cwd: Uri): Promise<Uri[]>;
    isReserved(uri: Uri): Promise<boolean>;
    /**
     * Keeps track of a Uri as a file that should be ignored from all warnings related to reserved names.
     */
    addToIgnoreList(uri: Uri): Promise<void>;
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { EventEmitter, Uri } from 'vscode';
import { DisposableBase } from '../platform/common/utils/lifecycle';
import type { INotebookPythonEnvironmentService } from './types';
import type { Environment } from '@vscode/python-extension';

@injectable()
export class NotebookPythonEnvironmentService extends DisposableBase implements INotebookPythonEnvironmentService {
    private readonly _onDidChangeEnvironment = this._register(new EventEmitter<Uri>());
    public readonly onDidChangeEnvironment = this._onDidChangeEnvironment.event;

    public getPythonEnvironment(_: Uri): Environment | undefined {
        return undefined;
    }
}

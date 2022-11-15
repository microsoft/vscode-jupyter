// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import { DebugConfiguration, DebugSession, NotebookDocument } from 'vscode';

export class Debugger {
    constructor(
        public readonly document: NotebookDocument,
        public readonly config: DebugConfiguration,
        public readonly session: DebugSession
    ) {}
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import { debug, NotebookDocument, DebugSession, DebugSessionOptions, DebugConfiguration } from 'vscode';
import { noop } from '../../platform/common/utils/misc';

/**
 * Wraps debug start in a promise
 */
export class Debugger {
    private resolveFunc?: (value: DebugSession) => void;
    private rejectFunc?: (reason?: Error) => void;

    readonly session: Promise<DebugSession>;

    constructor(
        public readonly document: NotebookDocument,
        public readonly config: DebugConfiguration,
        options?: DebugSessionOptions
    ) {
        this.session = new Promise<DebugSession>((resolve, reject) => {
            this.resolveFunc = resolve;
            this.rejectFunc = reject;

            debug.startDebugging(undefined, config, options).then(undefined, reject);
        });
    }

    resolve(session: DebugSession) {
        if (this.resolveFunc) {
            this.resolveFunc(session);
        }
    }

    reject(reason: Error) {
        if (this.rejectFunc) {
            this.rejectFunc(reason);
        }
    }

    async stop() {
        void debug.stopDebugging(await this.session).then(noop, noop);
    }
}

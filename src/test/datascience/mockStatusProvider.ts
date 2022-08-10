// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Disposable } from 'vscode';
import { IStatusProvider } from '../../platform/progress/types';
import { noop } from '../core';
export class MockStatusProvider implements IStatusProvider {
    public set(_message: string, _timeout?: number, _cancel?: () => void): Disposable {
        return {
            dispose: noop
        };
    }

    public waitWithStatus<T>(
        promise: () => Promise<T>,
        _message: string,
        _timeout?: number,
        _canceled?: () => void
    ): Promise<T> {
        return promise();
    }
}

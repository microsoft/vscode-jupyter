// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { traceError } from '../logging';
import { PromiseFunction } from '../common/utils/async';
import { IProgressReporter, Progress, ReportableAction } from './types';

const _reporters = new Set<IProgressReporter>();

export function registerReporter(reporter: IProgressReporter) {
    _reporters.add(reporter);
}

export function disposeRegisteredReporters() {
    _reporters.clear();
}

function report(progress: Progress) {
    try {
        _reporters.forEach((item) => item.report(progress));
    } catch (ex) {
        traceError('Failed to report progress', ex);
    }
}

/**
 * Reports a user reportable action.
 * Action may be logged or displayed to the user depending on the registered listeners.
 *
 * @export
 * @param {ReportableAction} action
 * @returns
 */
export function reportAction(action: ReportableAction) {
    return function (_target: Object, _propertyName: string, descriptor: TypedPropertyDescriptor<PromiseFunction>) {
        const originalMethod = descriptor.value!;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any,
        descriptor.value = async function (...args: any[]) {
            report({ action, phase: 'started' });
            // eslint-disable-next-line no-invalid-this
            return originalMethod.apply(this, args).finally(() => {
                report({ action, phase: 'completed' });
            });
        };
    };
}

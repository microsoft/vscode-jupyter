// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { isTestExecution } from '../constants';

// This decorator can be added to any method to make sure that it only runs under test execution
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function testOnlyMethod(_target: Object, propertyKey: string, descriptor: TypedPropertyDescriptor<any>) {
    if (!isTestExecution()) {
        throw new Error(`Function: ${propertyKey} can only be called from test code`);
    }

    return descriptor;
}

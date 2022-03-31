// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { createWriteStream } from 'fs-extra';
import { registerLogger } from '../platform/logging';
import { FileLogger } from '../platform/logging/fileLogger.node';

// IMPORTANT: This file should only be importing from the '../platform/logging' directory, as we
// delete everything in '../platform' except for '../platform/logging' before running smoke tests.

const isCI = process.env.TF_BUILD !== undefined || process.env.GITHUB_ACTIONS === 'true';

export function initializeLogger() {
    if (isCI && process.env.VSC_JUPYTER_LOG_FILE) {
        const fileLogger = new FileLogger(createWriteStream(process.env.VSC_JUPYTER_LOG_FILE));
        registerLogger(fileLogger);
    }
}

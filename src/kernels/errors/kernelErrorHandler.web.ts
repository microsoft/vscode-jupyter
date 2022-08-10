// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { Resource } from '../../platform/common/types';
import { DataScienceErrorHandler } from './kernelErrorHandler';

/**
 * Web version of common error handler. It skips some things.
 */
@injectable()
export class DataScienceErrorHandlerWeb extends DataScienceErrorHandler {
    protected override async addErrorMessageIfPythonArePossiblyOverridingPythonModules(
        _messages: string[],
        _resource: Resource
    ) {
        //
    }
    protected override async getFilesInWorkingDirectoryThatCouldPotentiallyOverridePythonModules(_resource: Resource) {
        return [];
    }
}

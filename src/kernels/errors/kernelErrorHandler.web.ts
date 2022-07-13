// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { injectable } from 'inversify';
import { Uri } from 'vscode';
import { Resource } from '../../platform/common/types';
import { DataScienceErrorHandler } from './kernelErrorHandler';

@injectable()
export class DataScienceErrorHandlerWeb extends DataScienceErrorHandler {
    protected override async addErrorMessageIfPythonArePossiblyOverridingPythonModules(
        _messages: string[],
        _resource: Resource
    ) {
        //
    }
    protected override async getFilesInWorkingDirectoryThatCouldPotentiallyOverridePythonModules(
        _resource: Resource
    ): Promise<Uri[]> {
        return [];
    }
}

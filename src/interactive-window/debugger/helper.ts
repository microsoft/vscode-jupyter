// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import { ISourceMapRequest } from '../../notebooks/debugger/debuggingTypes';
import { getFilePath } from '../../platform/common/platform/fs-paths';
import { IFileGeneratedCodes } from '../editor-integration/types';

export function buildSourceMap(fileHash: IFileGeneratedCodes): ISourceMapRequest {
    const sourceMapRequest: ISourceMapRequest = { source: { path: getFilePath(fileHash.uri) }, pydevdSourceMaps: [] };
    sourceMapRequest.pydevdSourceMaps = fileHash.generatedCodes.map((generatedCode) => {
        return {
            line: generatedCode.debuggerStartLine,
            endLine: generatedCode.endLine,
            runtimeSource: {
                path: generatedCode.runtimeFile
            },
            runtimeLine: generatedCode.runtimeLine
        };
    });

    return sourceMapRequest;
}

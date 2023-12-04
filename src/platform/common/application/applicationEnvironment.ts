// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import { IApplicationEnvironment } from './types';
import { inject, injectable } from 'inversify';
import { IExtensionContext } from '../types';

/**
 * Wrapper around the vscode.env object and some other properties related to the VS code instance.
 */
@injectable()
export class ApplicationEnvironment implements IApplicationEnvironment {
    public get extensionVersion(): string {
        // eslint-disable-next-line
        return this.extensionContext.extension.packageJSON.version;
    }
    constructor(@inject(IExtensionContext) private readonly extensionContext: vscode.ExtensionContext) {}
}

export function getVSCodeChannel() {
    return vscode.env.appName.indexOf('Insider') > 0 || vscode.env.appName.indexOf('Code - OSS Dev') >= 0
        ? 'insiders'
        : 'stable';
}

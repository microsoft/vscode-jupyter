// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import { Channel, IApplicationEnvironment } from './types';

/**
 * Wrapper around the vscode.env object and some other properties related to the VS code instance.
 */
export abstract class BaseApplicationEnvironment implements IApplicationEnvironment {
    public abstract get userSettingsFile(): vscode.Uri | undefined;
    public abstract get userCustomKeybindingsFile(): vscode.Uri | undefined;
    public get appName(): string {
        return vscode.env.appName;
    }
    public get vscodeVersion(): string {
        return vscode.version;
    }
    public get appRoot(): string {
        return vscode.env.appRoot;
    }
    public get language(): string {
        return vscode.env.language;
    }
    public get sessionId(): string {
        return vscode.env.sessionId;
    }
    public get machineId(): string {
        return vscode.env.machineId;
    }
    public get uiKind(): vscode.UIKind {
        return vscode.env.uiKind;
    }
    public get extensionName(): string {
        // eslint-disable-next-line
        return this.packageJson.displayName;
    }
    public get extensionVersion(): string {
        // eslint-disable-next-line
        return this.packageJson.version;
    }
    /**
     * At the time of writing this API, the vscode.env.shell isn't officially released in stable version of VS Code.
     * Using this in stable version seems to throw errors in VSC with messages being displayed to the user about use of
     * unstable API.
     * Solution - log and suppress the errors.
     * @readonly
     * @type {(string)}
     * @memberof ApplicationEnvironment
     */
    public get shell(): string {
        return vscode.env.shell;
    }
    public get packageJson() {
        return this.extensionContext.extension.packageJSON;
    }
    public get channel(): Channel {
        return this.appName.indexOf('Insider') > 0 || this.appName.indexOf('Code - OSS Dev') >= 0
            ? 'insiders'
            : 'stable';
    }
    public get uriScheme(): string {
        return vscode.env.uriScheme;
    }
    constructor(protected readonly extensionContext: vscode.ExtensionContext) {}
}

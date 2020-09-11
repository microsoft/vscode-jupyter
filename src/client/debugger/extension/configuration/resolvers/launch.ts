// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { CancellationToken, Uri, WorkspaceFolder } from 'vscode';
import { IDocumentManager, IWorkspaceService } from '../../../../common/application/types';
import { IPlatformService } from '../../../../common/platform/types';
import { IConfigurationService } from '../../../../common/types';
import { DebuggerTypeName } from '../../../constants';
import { DebugOptions, LaunchRequestArguments } from '../../../types';
import { BaseConfigurationResolver } from './base';
import { IDebugEnvironmentVariablesService } from './helper';

@injectable()
export class LaunchConfigurationResolver extends BaseConfigurationResolver<LaunchRequestArguments> {
    constructor(
        @inject(IWorkspaceService) workspaceService: IWorkspaceService,
        @inject(IDocumentManager) documentManager: IDocumentManager,
        @inject(IPlatformService) platformService: IPlatformService,
        @inject(IConfigurationService) configurationService: IConfigurationService,
        @inject(IDebugEnvironmentVariablesService) private readonly debugEnvHelper: IDebugEnvironmentVariablesService
    ) {
        super(workspaceService, documentManager, platformService, configurationService);
    }
    public async resolveDebugConfiguration(
        folder: WorkspaceFolder | undefined,
        debugConfiguration: LaunchRequestArguments,
        _token?: CancellationToken
    ): Promise<LaunchRequestArguments | undefined> {
        const workspaceFolder = this.getWorkspaceFolder(folder);

        const config = debugConfiguration as LaunchRequestArguments;
        const numberOfSettings = Object.keys(config);

        if ((config.noDebug === true && numberOfSettings.length === 1) || numberOfSettings.length === 0) {
            const defaultProgram = this.getProgram();

            config.name = 'Launch';
            config.type = DebuggerTypeName;
            config.request = 'launch';
            config.program = defaultProgram ? defaultProgram : '';
            config.env = {};
        }

        await this.provideLaunchDefaults(workspaceFolder, config);

        const dbgConfig = debugConfiguration;
        if (Array.isArray(dbgConfig.debugOptions)) {
            dbgConfig.debugOptions = dbgConfig.debugOptions!.filter(
                (item, pos) => dbgConfig.debugOptions!.indexOf(item) === pos
            );
        }
        return debugConfiguration;
    }
    // tslint:disable-next-line:cyclomatic-complexity
    protected async provideLaunchDefaults(
        workspaceFolder: Uri | undefined,
        debugConfiguration: LaunchRequestArguments
    ): Promise<void> {
        this.resolveAndUpdatePaths(workspaceFolder, debugConfiguration);
        if (typeof debugConfiguration.cwd !== 'string' && workspaceFolder) {
            debugConfiguration.cwd = workspaceFolder.fsPath;
        }
        if (typeof debugConfiguration.envFile !== 'string' && workspaceFolder) {
            const settings = this.configurationService.getSettings(workspaceFolder);
            debugConfiguration.envFile = settings.envFile;
        }
        // Extract environment variables from .env file in the vscode context and
        // set the "env" debug configuration argument. This expansion should be
        // done here before handing of the environment settings to the debug adapter
        debugConfiguration.env = await this.debugEnvHelper.getEnvironmentVariables(debugConfiguration);
        if (typeof debugConfiguration.stopOnEntry !== 'boolean') {
            debugConfiguration.stopOnEntry = false;
        }
        debugConfiguration.showReturnValue = debugConfiguration.showReturnValue !== false;
        if (!debugConfiguration.console) {
            debugConfiguration.console = 'integratedTerminal';
        }
        // If using a terminal, then never open internal console.
        if (debugConfiguration.console !== 'internalConsole' && !debugConfiguration.internalConsoleOptions) {
            debugConfiguration.internalConsoleOptions = 'neverOpen';
        }
        if (!Array.isArray(debugConfiguration.debugOptions)) {
            debugConfiguration.debugOptions = [];
        }
        if (debugConfiguration.justMyCode === undefined) {
            // Populate justMyCode using debugStdLib
            debugConfiguration.justMyCode = !debugConfiguration.debugStdLib;
        }
        // Pass workspace folder so we can get this when we get debug events firing.
        debugConfiguration.workspaceFolder = workspaceFolder ? workspaceFolder.fsPath : undefined;
        const debugOptions = debugConfiguration.debugOptions!;
        if (!debugConfiguration.justMyCode) {
            this.debugOption(debugOptions, DebugOptions.DebugStdLib);
        }
        if (debugConfiguration.stopOnEntry) {
            this.debugOption(debugOptions, DebugOptions.StopOnEntry);
        }
        if (debugConfiguration.showReturnValue) {
            this.debugOption(debugOptions, DebugOptions.ShowReturnValue);
        }
        if (debugConfiguration.django) {
            this.debugOption(debugOptions, DebugOptions.Django);
        }
        if (debugConfiguration.jinja) {
            this.debugOption(debugOptions, DebugOptions.Jinja);
        }
        if (debugConfiguration.redirectOutput === undefined && debugConfiguration.console === 'internalConsole') {
            debugConfiguration.redirectOutput = true;
        }
        if (debugConfiguration.redirectOutput) {
            this.debugOption(debugOptions, DebugOptions.RedirectOutput);
        }
        if (debugConfiguration.sudo) {
            this.debugOption(debugOptions, DebugOptions.Sudo);
        }
        if (debugConfiguration.subProcess === true) {
            this.debugOption(debugOptions, DebugOptions.SubProcess);
        }
        if (this.platformService.isWindows) {
            this.debugOption(debugOptions, DebugOptions.FixFilePathCase);
        }
        const isFlask = this.isDebuggingFlask(debugConfiguration);
        if (
            (debugConfiguration.pyramid || isFlask) &&
            debugOptions.indexOf(DebugOptions.Jinja) === -1 &&
            debugConfiguration.jinja !== false
        ) {
            this.debugOption(debugOptions, DebugOptions.Jinja);
        }
        // Unlike with attach, we do not set a default path mapping.
        // (See: https://github.com/microsoft/vscode-python/issues/3568)
        if (debugConfiguration.pathMappings) {
            let pathMappings = debugConfiguration.pathMappings;
            if (pathMappings.length > 0) {
                pathMappings = this.fixUpPathMappings(
                    pathMappings || [],
                    workspaceFolder ? workspaceFolder.fsPath : ''
                );
            }
            debugConfiguration.pathMappings = pathMappings.length > 0 ? pathMappings : undefined;
        }
        this.sendTelemetry(debugConfiguration.request as 'launch' | 'test', debugConfiguration);
    }
}

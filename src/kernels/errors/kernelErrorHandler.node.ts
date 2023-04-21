// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, optional } from 'inversify';
import { Uri } from 'vscode';
import { IApplicationShell, ICommandManager, IWorkspaceService } from '../../platform/common/application/types';
import {
    IBrowserService,
    IConfigurationService,
    IExtensions,
    IsWebExtension,
    Resource
} from '../../platform/common/types';
import { DataScience, Common } from '../../platform/common/utils/localize';
import { IKernelDependencyService } from '../types';
import {
    IJupyterInterpreterDependencyManager,
    IJupyterServerUriStorage,
    IJupyterUriProviderRegistration
} from '../jupyter/types';
import * as path from '../../platform/vscode-path/resources';
import { IReservedPythonNamedProvider } from '../../platform/interpreter/types';
import { JupyterKernelStartFailureOverrideReservedName } from '../../platform/interpreter/constants';
import { DataScienceErrorHandler } from './kernelErrorHandler';
import { getDisplayPath } from '../../platform/common/platform/fs-paths';
import { IFileSystem } from '../../platform/common/platform/types';
import { IInterpreterService } from '../../platform/interpreter/contracts';

/**
 * Common code for handling errors. This one is node specific.
 */
@injectable()
export class DataScienceErrorHandlerNode extends DataScienceErrorHandler {
    constructor(
        @inject(IApplicationShell) applicationShell: IApplicationShell,
        @inject(IJupyterInterpreterDependencyManager)
        @optional()
        dependencyManager: IJupyterInterpreterDependencyManager | undefined,
        @inject(IBrowserService) browser: IBrowserService,
        @inject(IConfigurationService) configuration: IConfigurationService,
        @inject(IKernelDependencyService)
        @optional()
        kernelDependency: IKernelDependencyService | undefined,
        @inject(IWorkspaceService) workspaceService: IWorkspaceService,
        @inject(IJupyterServerUriStorage) serverUriStorage: IJupyterServerUriStorage,
        @inject(ICommandManager) commandManager: ICommandManager,
        @inject(IsWebExtension) isWebExtension: boolean,
        @inject(IExtensions) extensions: IExtensions,
        @inject(IJupyterUriProviderRegistration) jupyterUriProviderRegistration: IJupyterUriProviderRegistration,
        @inject(IReservedPythonNamedProvider) private readonly reservedPythonNames: IReservedPythonNamedProvider,
        @inject(IFileSystem) fs: IFileSystem,
        @inject(IInterpreterService) interpreterService: IInterpreterService
    ) {
        super(
            applicationShell,
            dependencyManager,
            browser,
            configuration,
            kernelDependency,
            workspaceService,
            serverUriStorage,
            jupyterUriProviderRegistration,
            commandManager,
            isWebExtension,
            extensions,
            fs,
            interpreterService
        );
    }
    protected override async addErrorMessageIfPythonArePossiblyOverridingPythonModules(
        messages: string[],
        resource: Resource
    ) {
        // Looks like some other module is missing.
        // Sometimes when you create files like xml.py, then kernel startup fails due to xml.dom module not being found.
        const problematicFiles = await this.getFilesInWorkingDirectoryThatCouldPotentiallyOverridePythonModules(
            resource
        );
        if (problematicFiles.length > 0) {
            const cwd = resource ? path.dirname(resource) : undefined;
            const fileLinks = problematicFiles.map((item) => {
                if (item.type === 'file') {
                    const displayPath = resource ? getDisplayPath(item.uri, [], cwd) : path.basename(item.uri);
                    return `<a href='${item.uri.toString()}?line=1'>${displayPath}</a>`;
                } else {
                    const displayPath = resource
                        ? getDisplayPath(item.uri, [], cwd)
                        : `${path.basename(path.dirname(item.uri))}/__init__.py`;
                    return `<a href='${item.uri.toString()}?line=1'>${displayPath}</a>`;
                }
            });
            let files = '';
            if (fileLinks.length === 1) {
                files = fileLinks[0];
            } else {
                files = `${fileLinks.slice(0, -1).join(', ')} ${Common.and} ${fileLinks.slice(-1)}`;
            }
            messages.push(DataScience.filesPossiblyOverridingPythonModulesMayHavePreventedKernelFromStarting(files));
            messages.push(DataScience.listOfFilesWithLinksThatMightNeedToBeRenamed(files));
            messages.push(Common.clickHereForMoreInfoWithHtml(JupyterKernelStartFailureOverrideReservedName));
        }
    }
    protected override async getFilesInWorkingDirectoryThatCouldPotentiallyOverridePythonModules(
        resource: Resource
    ): Promise<{ uri: Uri; type: 'file' | '__init__' }[]> {
        return resource ? this.reservedPythonNames.getUriOverridingReservedPythonNames(path.dirname(resource)) : [];
    }
}

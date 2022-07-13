// Copyright (c) Microsoft Corporation. All rights reserved.
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
import { IJupyterInterpreterDependencyManager, IJupyterServerUriStorage } from '../jupyter/types';
import { IFileSystemNode } from '../../platform/common/platform/types.node';
import * as path from '../../platform/vscode-path/resources';
import { IReservedPythonNamedProvider } from '../../platform/interpreter/types';
import { JupyterKernelStartFailureOverrideReservedName } from '../../platform/interpreter/constants';
import { DataScienceErrorHandler } from './kernelErrorHandler';

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
        @inject(IFileSystemNode) private readonly fs: IFileSystemNode,
        @inject(IReservedPythonNamedProvider) private readonly reservedPythonNames: IReservedPythonNamedProvider
    ) {
        super(
            applicationShell,
            dependencyManager,
            browser,
            configuration,
            kernelDependency,
            workspaceService,
            serverUriStorage,
            commandManager,
            isWebExtension,
            extensions
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
            const fileLinks = problematicFiles.map(
                (file) => `<a href='${file.toString()}?line=1'>${path.basename(file)}</a>`
            );
            let files = '';
            if (fileLinks.length === 1) {
                files = fileLinks[0];
            } else {
                files = `${fileLinks.slice(0, -1).join(', ')} ${Common.and()} ${fileLinks.slice(-1)}`;
            }
            messages.push(
                DataScience.filesPossiblyOverridingPythonModulesMayHavePreventedKernelFromStarting().format(files)
            );
            messages.push(DataScience.listOfFilesWithLinksThatMightNeedToBeRenamed().format(files));
            messages.push(Common.clickHereForMoreInfoWithHtml().format(JupyterKernelStartFailureOverrideReservedName));
        }
    }
    protected override async getFilesInWorkingDirectoryThatCouldPotentiallyOverridePythonModules(
        resource: Resource
    ): Promise<Uri[]> {
        if (!resource) {
            return [];
        }
        // eslint-disable-next-line local-rules/dont-use-fspath
        const files = await this.fs.searchLocal('*.py', path.dirname(resource).fsPath, true);
        const problematicFiles: Uri[] = [];
        await Promise.all(
            files.map(async (file) => {
                const uri = Uri.file(file);
                if (await this.reservedPythonNames.isReserved(uri)) {
                    // eslint-disable-next-line local-rules/dont-use-fspath
                    problematicFiles.push(Uri.joinPath(path.dirname(resource), uri.fsPath));
                }
            })
        );
        return problematicFiles;
    }
}

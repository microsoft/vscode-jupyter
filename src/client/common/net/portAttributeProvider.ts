// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { workspace } from 'vscode';
import { CancellationToken, PortAttributes, PortAttributesProvider, PortAutoForwardAction } from 'vscode';
import { IExtensionSyncActivationService } from '../../activation/types';
import { NotebookStarter } from '../../datascience/jupyter/notebookStarter';
import { KernelLauncher } from '../../datascience/kernel-launcher/kernelLauncher';
import { traceError } from '../logger';
import { IDisposableRegistry } from '../types';

@injectable()
export class PortAttributesProviders implements PortAttributesProvider, IExtensionSyncActivationService {
    constructor(@inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry) {}
    activate(): void {
        try {
            this.disposables.push(workspace.registerPortAttributesProvider({}, this));
        } catch (ex) {
            // In case proposed API changes.
            traceError('Failure in registering port attributes', ex);
        }
    }
    providePortAttributes(
        port: number,
        _pid: number | undefined,
        _commandLine: string | undefined,
        _token: CancellationToken
    ): PortAttributes | undefined {
        try {
            if (KernelLauncher.usedPorts.includes(port) || NotebookStarter.usedPorts.includes(port)) {
                return {
                    autoForwardAction: PortAutoForwardAction.Ignore,
                    port
                };
            }
        } catch (ex) {
            // In case proposed API changes.
            traceError('Failure in returning port attributes', ex);
        }
    }
}

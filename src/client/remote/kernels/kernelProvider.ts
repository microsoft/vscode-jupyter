// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Kernel, Session } from '@jupyterlab/services';
import { inject, injectable } from 'inversify';
// tslint:disable-next-line: no-require-imports
import { CancellationToken, Uri } from 'vscode';
import { NotebookDocument } from '../../../../types/vscode-proposed';
import { IVSCodeNotebook } from '../../common/application/types';
import { traceError } from '../../common/logger';
import { translateMonacoToKernelLanguage } from '../../datascience/common';
import { Telemetry } from '../../datascience/constants';
import { IKernelProvider } from '../../datascience/jupyter/kernels/types';
import { getNotebookMetadata } from '../../datascience/notebook/helpers/helpers';
import { VSCodeNotebookKernelMetadata } from '../../datascience/notebook/kernelProvider';
import { captureTelemetry } from '../../telemetry';
import { IJupyterServerAuthServiceProvider, IJupyterServerConnectionInfo } from '../ui/types';
import { getActiveSessions, getKernelSpecs } from './helpers';
// tslint:disable-next-line: no-var-requires no-require-imports
const vscodeNotebookEnums = require('vscode') as typeof import('vscode-proposed');

@injectable()
export class RemoteKernelPickerProvider {
    constructor(
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(IVSCodeNotebook) private readonly notebook: IVSCodeNotebook,
        @inject(IJupyterServerAuthServiceProvider)
        private readonly authServiceProvider: IJupyterServerAuthServiceProvider
    ) {}

    @captureTelemetry(Telemetry.KernelProviderPerf)
    public async provideKernels(
        document: NotebookDocument,
        token: CancellationToken
    ): Promise<VSCodeNotebookKernelMetadata[]> {
        const connections = await this.authServiceProvider.getRemoteConnections();
        // tslint:disable-next-line: no-suspicious-comment
        // TODO: If we're using a local notebook & want to run against a remote kernel,
        // then return all kernels from all connections.
        if (document.uri.scheme === 'file') {
            return [];
        }
        const connection = connections.find(
            (item) => item.fileScheme.toLowerCase() === document.uri.scheme.toLowerCase()
        );
        if (!connection) {
            traceError(`No connections available to retrieve kernels for remote notebook ${document.uri.toString()}.`);
            return [];
        }
        const kernelSpecsPromise = getKernelSpecs(connection);
        const [preferredKernel, kernels] = await Promise.all([
            this.getPreferredKernel(document, token, connection, kernelSpecsPromise),
            this.getKernelSpecs(kernelSpecsPromise)
        ]);
        if (token.isCancellationRequested) {
            return [];
        }

        // If we have a preferred kernel, ensure its not included in the list of kernelspecs.
        const filteredKernelSpecs = preferredKernel
            ? kernels.filter((item) => item.id !== preferredKernel.id)
            : kernels;

        return [...(preferredKernel ? [preferredKernel] : []), ...filteredKernelSpecs];
    }
    private async getPreferredKernel(
        document: NotebookDocument,
        _token: CancellationToken,
        connectionInfo: IJupyterServerConnectionInfo,
        kernelSpecsPromise: Promise<{ default?: string; specs: Kernel.ISpecModel[] }>
    ): Promise<undefined | VSCodeNotebookKernelMetadata> {
        if (connectionInfo.fileScheme.toLowerCase() !== document.uri.scheme.toLowerCase()) {
            return;
        }

        // If this document is associated with a kernel that is already running, then use that kernel.
        const [sessions, kernelSpecsList] = await Promise.all([getActiveSessions(connectionInfo), kernelSpecsPromise]);
        if (sessions.length > 0) {
            const relatedSession = sessions.find(
                (item) => Uri.file(item.path).with({ scheme: connectionInfo.fileScheme }).fsPath === document.uri.fsPath
            );
            if (relatedSession) {
                return this.getLiveKernel(relatedSession, kernelSpecsList.specs);
            }
        }
        const metadata = getNotebookMetadata(document);
        const languages = document.cells
            .filter((item) => item.cellKind === vscodeNotebookEnums.CellKind.Code)
            .map((item) => item.language);
        let preferredKernelSpec: Kernel.ISpecModel | undefined;
        if (metadata?.kernelspec && !preferredKernelSpec) {
            preferredKernelSpec = kernelSpecsList.specs.find((item) => item.name === metadata.kernelspec?.name);
        }
        if (metadata?.language_info && !preferredKernelSpec) {
            preferredKernelSpec = kernelSpecsList.specs.find((item) => item.language === metadata?.language_info?.name);
        }
        if (languages.length && !preferredKernelSpec) {
            preferredKernelSpec = kernelSpecsList.specs.find(
                (item) => item.language === translateMonacoToKernelLanguage(languages[0])
            );
        }
        if (!preferredKernelSpec) {
            preferredKernelSpec = kernelSpecsList.specs.find((item) => item.name === kernelSpecsList.default);
        }
        if (preferredKernelSpec) {
            return this.getKernelSpec(preferredKernelSpec, true);
        }
    }
    private getLiveKernel(session: Session.IModel, kernelSpecs: Kernel.ISpecModel[]) {
        const spec = kernelSpecs.find((item) => item.name.toLowerCase() === session.kernel.name.toLowerCase());
        if (!spec) {
            traceError(`We have a live session, but unable to find the kernelspec for ${session.kernel.name}`);
            return;
        }

        // const model = await Kernel.findById(relatedSession.id, server.info);
        return new VSCodeNotebookKernelMetadata(
            spec.display_name,
            `Remote Kernel for ${spec.language}`,
            `Live kernel associated with ${session.path}`,
            {
                kernelModel: {
                    ...spec,
                    ...session.kernel,
                    session: session,
                    lastActivityTime: new Date(),
                    numberOfConnections: 0
                    // tslint:disable-next-line: no-any
                } as any,
                kind: 'connectToLiveKernel'
            },
            true,
            this.kernelProvider,
            this.notebook
        );
    }
    private getKernelSpec(kernelSpec: Kernel.ISpecModel, isPreferred = false) {
        return new VSCodeNotebookKernelMetadata(
            kernelSpec.display_name,
            `Remote Kernel for ${kernelSpec.language}`,
            kernelSpec.argv.length ? kernelSpec.argv[0] : kernelSpec.language,
            {
                kernelSpec: {
                    ...kernelSpec,
                    ...({
                        path: kernelSpec.argv.length ? kernelSpec.argv[0] : ''
                        // tslint:disable-next-line: no-any
                    } as any)
                },
                kind: 'startUsingKernelSpec'
            },
            isPreferred,
            this.kernelProvider,
            this.notebook
        );
    }
    private async getKernelSpecs(
        kernelSpecsPromise: Promise<{ default?: string; specs: Kernel.ISpecModel[] }>
    ): Promise<VSCodeNotebookKernelMetadata[]> {
        const result = await kernelSpecsPromise;
        return result.specs.map((kernelSpec) => this.getKernelSpec(kernelSpec));
    }
}

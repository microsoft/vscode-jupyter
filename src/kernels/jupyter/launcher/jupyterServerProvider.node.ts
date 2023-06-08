// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, optional } from 'inversify';
import { traceVerbose } from '../../../platform/logging';
import { DataScience } from '../../../platform/common/utils/localize';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { JupyterInstallError } from '../../../platform/errors/jupyterInstallError';
import { GetServerOptions, IJupyterConnection } from '../../types';
import { IJupyterServerHelper, IJupyterServerProvider } from '../types';
import { NotSupportedInWebError } from '../../../platform/errors/notSupportedInWebError';
import { getFilePath } from '../../../platform/common/platform/fs-paths';
import { Cancellation, isCancellationError } from '../../../platform/common/cancellation';

@injectable()
export class JupyterServerProvider implements IJupyterServerProvider {
    private serverPromise?: Promise<IJupyterConnection>;
    constructor(
        @inject(IJupyterServerHelper)
        @optional()
        private readonly jupyterServerHelper: IJupyterServerHelper | undefined,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService
    ) {}
    public async getOrStartServer(options: GetServerOptions): Promise<IJupyterConnection> {
        if (!this.serverPromise) {
            const promise = (this.serverPromise = this.startServerImpl(options));
            promise.catch(() => {
                if (promise === this.serverPromise) {
                    this.serverPromise = undefined;
                }
            });
        }
        return this.serverPromise;
    }

    private async startServerImpl(options: GetServerOptions): Promise<IJupyterConnection> {
        const jupyterServerHelper = this.jupyterServerHelper;
        if (!jupyterServerHelper) {
            throw new NotSupportedInWebError();
        }

        // Check to see if we support ipykernel or not
        try {
            traceVerbose(`Checking for server usability.`);

            const usable = await this.checkUsable();
            if (!usable) {
                traceVerbose('Server not usable (should ask for install now)');
                // Indicate failing.
                throw new JupyterInstallError(
                    DataScience.jupyterNotSupported(await jupyterServerHelper.getJupyterServerError())
                );
            }
            // Then actually start the server
            traceVerbose(`Starting notebook server.`);
            const result = await jupyterServerHelper.startServer(options.resource, options.token);
            Cancellation.throwIfCanceled(options.token);
            return result;
        } catch (e) {
            // If user cancelled, then do nothing.
            if (options.token?.isCancellationRequested && isCancellationError(e)) {
                throw e;
            }

            // Also tell jupyter execution to reset its search. Otherwise we've just cached
            // the failure there
            await jupyterServerHelper.refreshCommands();

            throw e;
        }
    }

    private async checkUsable(): Promise<boolean> {
        try {
            if (this.jupyterServerHelper) {
                const usableInterpreter = await this.jupyterServerHelper.getUsableJupyterPython();
                return usableInterpreter ? true : false;
            } else {
                return true;
            }
        } catch (e) {
            const activeInterpreter = await this.interpreterService.getActiveInterpreter(undefined);
            // Can't find a usable interpreter, show the error.
            if (activeInterpreter) {
                const displayName = activeInterpreter.displayName
                    ? activeInterpreter.displayName
                    : getFilePath(activeInterpreter.uri);
                throw new Error(DataScience.jupyterNotSupportedBecauseOfEnvironment(displayName, e.toString()));
            } else {
                throw new JupyterInstallError(
                    DataScience.jupyterNotSupported(
                        this.jupyterServerHelper ? await this.jupyterServerHelper.getJupyterServerError() : 'Error'
                    )
                );
            }
        }
    }
}

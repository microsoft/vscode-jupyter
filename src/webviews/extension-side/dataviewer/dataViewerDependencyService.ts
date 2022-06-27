// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { SemVer } from 'semver';
import { ProductNames } from '../../../kernels/installer/productNames';
import { Product } from '../../../kernels/installer/types';
import { IApplicationShell } from '../../../platform/common/application/types';
import { traceWarning } from '../../../platform/logging';
import { IsCodeSpace } from '../../../platform/common/types';
import { parseSemVer } from '../../../platform/common/utils';
import { DataScience, Common } from '../../../platform/common/utils/localize';
import { EnvironmentType } from '../../../platform/pythonEnvironments/info';
import { sendTelemetryEvent, Telemetry } from '../../../telemetry';
import {
    IDataViewerDependencyService,
    IDataViewerDependencyServiceOptions,
    IdataViewerDependencyServiceOptionsWithDebuggerSession,
    IDataViewerDependencyServiceOptionsWithKernel
} from './types';
import { executeSilently } from '../../../kernels/helpers';

export const minimumSupportedPandaVersion = '0.20.0';
export const printPandasVersion = [
    'import pandas as _VSCODE_pandas;print(_VSCODE_pandas.__version__);del _VSCODE_pandas'
];
export const returnPandasVersion = ['import pandas as _VSCODE_pandas', '_VSCODE_pandas.__version'];
// def getPandasVersion():
//    import pandas as pd
//    return pd.__version
//
// getPandasVersion()
// getVersion = lambda: "ZZZZZZ"
// `;
export const deleteCustomPandas = 'del getPandasVersion';

function isVersionOfPandaSupported(version: SemVer) {
    return version.compare(minimumSupportedPandaVersion) > 0;
}

/**
 * Responsible for managing dependencies of a Data Viewer.
 */
@injectable()
export class DataViewerDependencyService implements IDataViewerDependencyService {
    constructor(
        @inject(IApplicationShell) private readonly applicationShell: IApplicationShell,
        @inject(IsCodeSpace) private isCodeSpace: boolean
    ) {}

    private packaging(options: IDataViewerDependencyServiceOptions): 'conda' | 'pip' | '%conda' | '%pip' {
        const kernel = (options as IDataViewerDependencyServiceOptionsWithKernel).kernel;
        if (!kernel) return 'pip';

        const envType = kernel.kernelConnectionMetadata.interpreter?.envType;
        const isConda = envType === EnvironmentType.Conda;
        return isConda ? '%conda' : '%pip';
    }

    public async checkAndInstallMissingDependencies(options: IDataViewerDependencyServiceOptions): Promise<void> {
        const kernel = (options as IDataViewerDependencyServiceOptionsWithKernel).kernel;
        const { debugSession, frameId } = options as IdataViewerDependencyServiceOptionsWithDebuggerSession;

        // Providing feedback as soon as possible.
        if (!kernel && !debugSession) {
            sendTelemetryEvent(Telemetry.InsufficientParameters);
            throw new Error(DataScience.insufficientParameters());
        } else if (kernel && !kernel.session) {
            sendTelemetryEvent(Telemetry.NoActiveKernelSession);
            throw new Error(DataScience.noActiveKernelSession());
        } else if (debugSession && !frameId) {
            sendTelemetryEvent(Telemetry.NoDebuggerSessionAndFrameId);
            throw new Error(DataScience.noActiveKernelSession());
        }

        const pandasVersion = await this.getVersionOfPandas(options);

        if (pandasVersion) {
            if (isVersionOfPandaSupported(pandasVersion)) {
                return;
            }
            sendTelemetryEvent(Telemetry.PandasTooOld);
            // Warn user that we cannot start because pandas is too old.
            const versionStr = `${pandasVersion.major}.${pandasVersion.minor}.${pandasVersion.build}`;
            throw new Error(DataScience.pandasTooOldForViewingFormat().format(versionStr));
        }

        sendTelemetryEvent(Telemetry.PandasNotInstalled);
        await this.installMissingDependencies(options);
    }

    private async getVersionOfPandas(options: IDataViewerDependencyServiceOptions): Promise<SemVer | undefined> {
        const kernel = (options as IDataViewerDependencyServiceOptionsWithKernel).kernel;
        const command = kernel ? printPandasVersion : returnPandasVersion;

        try {
            const outputs = await this.executeSilently(command, options);
            return outputs.map((text) => (text ? parseSemVer(text.toString()) : undefined)).find((item) => item);
        } catch (e) {
            traceWarning(DataScience.failedToGetVersionOfPandas(), e.message);
            return;
        }
    }

    private async installMissingDependencies(options: IDataViewerDependencyServiceOptions): Promise<void> {
        sendTelemetryEvent(Telemetry.PythonModuleInstall, undefined, {
            action: 'displayed',
            moduleName: ProductNames.get(Product.pandas)!
        });

        const selection = this.isCodeSpace
            ? Common.install()
            : await this.applicationShell.showErrorMessage(
                  DataScience.pandasRequiredForViewing(),
                  { modal: true },
                  Common.install()
              );

        // From https://ipython.readthedocs.io/en/stable/interactive/magics.html#magic-pip (%conda is here as well).
        const command = [`${this.packaging(options)} install pandas`];

        if (selection === Common.install()) {
            try {
                await this.executeSilently(command, options);
                sendTelemetryEvent(Telemetry.UserInstalledPandas);
            } catch (e) {
                sendTelemetryEvent(Telemetry.FailedToInstallPandas);
                throw new Error(DataScience.failedToInstallPandas());
            }
        } else {
            sendTelemetryEvent(Telemetry.UserDidNotInstallPandas);
            throw new Error(DataScience.pandasRequiredForViewing());
        }
    }

    private async executeSilently(
        commands: string[],
        options: IDataViewerDependencyServiceOptions
    ): Promise<(string | undefined)[]> {
        const kernel = (options as IDataViewerDependencyServiceOptionsWithKernel).kernel;
        const { debugSession, frameId } = options as IdataViewerDependencyServiceOptionsWithDebuggerSession;

        let results: (string | undefined)[] = [];

        for (const command of commands) {
            console.log({
                command,
                frameId
            });

            if (kernel) {
                if (!kernel.session) {
                    sendTelemetryEvent(Telemetry.NoActiveKernelSession);
                    throw new Error(DataScience.noActiveKernelSession());
                }
                const outputs = await executeSilently(kernel.session, command);
                const error = outputs.find((item) => item.output_type === 'error');
                if (error) {
                    traceWarning(DataScience.failedToGetVersionOfPandas(), error.message);
                }
                results = results.concat(outputs.map((item) => item.text?.toString()));
            } else {
                const response = await debugSession.customRequest('evaluate', {
                    expression: command,
                    context: 'repl',
                    format: { rawString: true },
                    frameId
                });
                results.push(response.response);
            }
        }
        results.push(
            (
                await debugSession.customRequest('evaluate', {
                    expression: 'getVersion = lambda: "ZZZZZZ"',
                    context: 'repl',
                    format: { rawString: true },
                    frameId
                })
            ).response
        );
        results.push(
            (
                await debugSession.customRequest('evaluate', {
                    expression: 'getVersion = lambda: "ZZZZZZ"',
                    context: 'repl',
                    format: { rawString: true },
                    frameId
                })
            ).response
        );
        results.push(
            (
                await debugSession.customRequest('evaluate', {
                    expression: 'print("hola")',
                    format: { rawString: true },
                    frameId
                })
            ).response
        );
        results.push(
            (
                await debugSession.customRequest('evaluate', {
                    expression: '"hola"',
                    format: { rawString: true },
                    frameId
                })
            ).response
        );
        results.push(
            (
                await debugSession.customRequest('evaluate', {
                    expression: 'print("hola")',
                    frameId
                })
            ).response
        );
        results.push(
            (
                await debugSession.customRequest('evaluate', {
                    expression: '"hola"',
                    frameId
                })
            ).response
        );
        results.push(
            (
                await debugSession.customRequest('evaluate', {
                    expression: 'print("hola")',
                    context: 'repl',
                    format: { rawString: true }
                })
            ).response
        );
        results.push(
            (
                await debugSession.customRequest('evaluate', {
                    expression: '"hola"',
                    context: 'repl',
                    format: { rawString: true }
                })
            ).response
        );
        results.push(
            (
                await debugSession.customRequest('evaluate', {
                    expression: 'print("hola")',
                    format: { rawString: true }
                })
            ).response
        );
        results.push(
            (
                await debugSession.customRequest('evaluate', {
                    expression: '"hola"',
                    format: { rawString: true }
                })
            ).response
        );
        results.push(
            (
                await debugSession.customRequest('evaluate', {
                    expression: 'print("hola")'
                })
            ).response
        );
        results.push(
            (
                await debugSession.customRequest('evaluate', {
                    expression: '"hola"'
                })
            ).response
        );
        results.push(
            (
                await debugSession.customRequest('evaluate', {
                    expression: 'getVersion = lambda: "ZZZZZZ"',
                    context: 'repl',
                    format: { rawString: true },
                    frameId
                })
            ).response
        );
        results.push(
            (
                await debugSession.customRequest('evaluate', {
                    expression: 'getVersion = lambda: "ZZZZZZ"',
                    context: 'repl',
                    frameId
                })
            ).response
        );
        results.push(
            (
                await debugSession.customRequest('evaluate', {
                    expression: 'getVersion = lambda: "ZZZZZZ"',
                    format: { rawString: true },
                    frameId
                })
            ).response
        );
        results.push(
            (
                await debugSession.customRequest('evaluate', {
                    expression: 'getVersion = lambda: "ZZZZZZ"',
                    frameId
                })
            ).response
        );
        results.push(
            (
                await debugSession.customRequest('evaluate', {
                    expression: 'getVersion = lambda: "ZZZZZZ"'
                })
            ).response
        );
        results.push(
            (
                await debugSession.customRequest('evaluate', {
                    expression: 'getVersion()',
                    context: 'repl',
                    format: { rawString: true },
                    frameId
                })
            ).response
        );
        results.push(
            (
                await debugSession.customRequest('evaluate', {
                    expression: 'getVersion()',
                    context: 'repl',
                    frameId
                })
            ).response
        );
        results.push(
            (
                await debugSession.customRequest('evaluate', {
                    expression: 'getVersion()',
                    format: { rawString: true },
                    frameId
                })
            ).response
        );
        results.push(
            (
                await debugSession.customRequest('evaluate', {
                    expression: 'getVersion()',
                    frameId
                })
            ).response
        );
        results.push(
            (
                await debugSession.customRequest('evaluate', {
                    expression: 'getVersion()'
                })
            ).response
        );
        console.log({ results });
        return results;
    }
}

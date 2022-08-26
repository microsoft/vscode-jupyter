// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, named } from 'inversify';
import { Memento } from 'vscode';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { Telemetry } from '../../platform/common/constants';
import { IProcessServiceFactory } from '../../platform/common/process/types.node';
import { GLOBAL_MEMENTO, IMemento } from '../../platform/common/types';
import { swallowExceptions } from '../../platform/common/utils/decorators';
import { noop } from '../../platform/common/utils/misc';
import { sendTelemetryEvent } from '../../telemetry';

const JupyterDetectionTelemetrySentMementoKey = 'JupyterDetectionTelemetrySentMementoKey';

/**
 * Sends telemetry about whether or not jupyter is installed anywhere.
 */
@injectable()
export class JupyterDetectionTelemetry implements IExtensionSyncActivationService {
    constructor(
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalMemento: Memento,
        @inject(IProcessServiceFactory) private readonly processFactory: IProcessServiceFactory
    ) {}
    public activate(): void {
        this.initialize().catch(noop);
    }
    @swallowExceptions()
    private async initialize(): Promise<void> {
        // If we've sent this telemetry once before then no need to check again.
        // E.g. if the user were to use our extension, then they might subsequently
        // install jupyter and configure things as part of using VS Code.
        // This telemetry is useful for first time users, users without support for raw kernels, etc.
        if (this.globalMemento.get<boolean>(JupyterDetectionTelemetrySentMementoKey, false)) {
            return;
        }
        this.globalMemento.update(JupyterDetectionTelemetrySentMementoKey, true).then(noop, noop);
        this.detectJupyter('notebook', process.env).catch(noop);
        this.detectJupyter('lab', process.env).catch(noop);
    }
    private async detectJupyter(frontEnd: 'notebook' | 'lab', env: NodeJS.ProcessEnv): Promise<void> {
        try {
            const processService = await this.processFactory.create(undefined);
            const output = await processService.exec('jupyter', [frontEnd, '--version'], {
                env,
                throwOnStdErr: false,
                mergeStdOutErr: true
            });
            const versionLines = output.stdout
                .splitLines({ trim: true, removeEmptyEntries: true })
                .filter((line) => !isNaN(parseInt(line.substring(0, 1), 10)));
            const versionMatch = /^\s*(\d+)\.(\d+)\.(.+)\s*$/.exec(versionLines.length ? versionLines[0] : '');
            if (versionMatch && versionMatch.length > 2) {
                const major = parseInt(versionMatch[1], 10);
                const minor = parseInt(versionMatch[2], 10);
                const frontEndVersion = parseFloat(`${major}.${minor}`);
                sendTelemetryEvent(
                    Telemetry.JupyterInstalled,
                    { frontEndVersion },
                    {
                        frontEnd,
                        detection: 'process'
                    }
                );
            } else {
                sendTelemetryEvent(Telemetry.JupyterInstalled, undefined, {
                    failed: true,
                    reason: 'notInstalled',
                    frontEnd
                });
            }
        } catch (ex) {
            sendTelemetryEvent(Telemetry.JupyterInstalled, undefined, {
                failed: true,
                reason: 'notInstalled',
                frontEnd
            });
        }
    }
}

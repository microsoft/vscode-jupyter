import { IDisposable } from '@fluentui/react';
import TelemetryReporter from '@vscode/extension-telemetry';
import { extensions } from 'vscode';
import { JVSC_EXTENSION_ID, AppinsightsKey, Telemetry } from '../../platform/common/constants';
import { StopWatch } from '../../platform/common/utils/stopWatch';
import { IS_CI_SERVER } from '../ciConstants.node';
import { sleep } from '../core';

export class PerformanceTracker implements IDisposable {
    stopWatch = new StopWatch();
    durations: Record<string, number> = {};
    checkpointCount = 0;
    telemetryReporter: TelemetryReporter | undefined;
    telemetryEnabled = true || IS_CI_SERVER && !process.env.VSC_JUPYTER_WARMUP;

    constructor(private testName: string) {
        if (this.telemetryEnabled) {
            this.createTelemetryReporter();
        }
    }

    public startTime() {
        this.stopWatch.reset();
    }

    public markTime(label: string) {
        this.durations[`${this.checkpointCount++}_${label}`] = this.stopWatch.elapsedTime;
    }

    public finishAndReport(result: string) {
        this.durations.totalTime = this.stopWatch.elapsedTime;
        console.log(`test ${result} with times: ${JSON.stringify(this.durations)}`);
        this.telemetryReporter?.sendDangerousTelemetryEvent(
            Telemetry.RunTest,
            {
                testName: this.testName,
                testResult: result
            },
            this.durations
        );
    }

    public async dispose() {
        if (this.telemetryReporter) {
            await this.telemetryReporter.dispose();
            await sleep(3000);
        }
    }

    private createTelemetryReporter() {
        const extensionId = JVSC_EXTENSION_ID;
        const extension = extensions.getExtension(JVSC_EXTENSION_ID);

        const extensionVersion = extension?.packageJSON?.version ?? 'unknown';

        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const reporter = require('@vscode/extension-telemetry').default as typeof TelemetryReporter;
        this.telemetryReporter = new reporter(extensionId, extensionVersion, AppinsightsKey, true);
    }
}

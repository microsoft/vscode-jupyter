import { Context } from 'mocha';
import { JVSC_EXTENSION_ID, Telemetry } from '../platform/common/constants';
import { IS_CI_SERVER } from './ciConstants.node';
import { extensions } from 'vscode';
import { sleep } from './core';
import { CiTelemetryReporter } from './utils/ciTelemetry/ciTelemetryReporter.node';

let telemetryReporter: CiTelemetryReporter | undefined;

export const rootHooks = {
    beforeAll: async function () {
        if (!IS_CI_SERVER) {
            return;
        }

        const extensionVersion = extensions.getExtension(JVSC_EXTENSION_ID)?.packageJSON.version;
        telemetryReporter = new CiTelemetryReporter(JVSC_EXTENSION_ID, extensionVersion);
        await telemetryReporter.initialize();
    },
    afterEach(this: Context) {
        if (!IS_CI_SERVER) {
            return;
        }

        let result = this.currentTest?.isFailed() ? 'failed' : this.currentTest?.isPassed() ? 'passed' : 'skipped';
        if (this.currentTest?.title) {
            const duration = this.currentTest?.duration;
            const measures = typeof duration === 'number' ? { duration: duration } : duration ? duration : undefined;
            telemetryReporter?.sendTelemetryEvent(
                Telemetry.RunTest,
                {
                    testName: this.currentTest?.title,
                    testResult: result
                },
                measures
            );
        }
    },
    afterAll: async function () {
        if (!IS_CI_SERVER) {
            return;
        }

        await telemetryReporter?.flush();
        // allow some time for the telemetry to flush
        await sleep(2000);
    }
};

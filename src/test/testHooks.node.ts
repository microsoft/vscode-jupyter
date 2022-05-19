import { Context } from 'mocha';
import { AppinsightsKey, JVSC_EXTENSION_ID, Telemetry } from '../platform/common/constants';
import TelemetryReporter from '@vscode/extension-telemetry/lib/telemetryReporter';
import { IS_CI_SERVER } from './ciConstants.node';
import { extensions } from 'vscode';
import { sleep } from '../platform/common/utils/async';

let telemetryReporter: TelemetryReporter;

export const rootHooks: Mocha.RootHookObject = {
    beforeAll() {
        if (!IS_CI_SERVER) {
            return;
        }

        const extensionId = JVSC_EXTENSION_ID;
        const extension = extensions.getExtension(extensionId)!;
        const extensionVersion = extension.packageJSON.version;

        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const reporter = require('@vscode/extension-telemetry').default as typeof TelemetryReporter;
        telemetryReporter = new reporter(extensionId, extensionVersion, AppinsightsKey, true);
    },
    afterEach(this: Context) {
        if (!IS_CI_SERVER || (process.env.GIT_BRANCH && process.env.GIT_BRANCH !== 'main')) {
            return;
        }

        let result = this.currentTest?.isFailed() ? 'failed' : this.currentTest?.isPassed() ? 'passed' : 'skipped';

        const measures = this.currentTest?.duration ? { duration: this.currentTest.duration } : undefined;

        let dimensions: Record<string, string> = {
            testName: this.currentTest!.title,
            testResult: result
        };

        if (process.env.VSC_JUPYTER_WARMUP) {
            dimensions = { ...dimensions, perfWarmup: 'true' };
        }

        if (this.currentTest?.perfCheckpoints) {
            dimensions = { ...dimensions, timedCheckpoints: JSON.stringify(this.currentTest?.perfCheckpoints) };
        }

        if (process.env.GIT_SHA) {
            dimensions = { ...dimensions, commitHash: process.env.GIT_SHA };
        }

        telemetryReporter.sendDangerousTelemetryEvent(Telemetry.RunTest, dimensions, measures);
    },
    afterAll: async () => {
        if (!IS_CI_SERVER) {
            return;
        }

        await telemetryReporter.dispose();
        await sleep(2000);
    }
};

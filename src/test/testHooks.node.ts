// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Context } from 'mocha';
import { AppinsightsKey, JVSC_EXTENSION_ID, Telemetry } from '../platform/common/constants';
import TelemetryReporter from '@vscode/extension-telemetry/lib/telemetryReporter';
import { IS_CI_SERVER } from './ciConstants.node';
import { extensions } from 'vscode';
import { sleep } from '../platform/common/utils/async';
import { traceInfoIfCI } from '../platform/logging';

let telemetryReporter: TelemetryReporter;

export const rootHooks: Mocha.RootHookObject = {
    beforeAll() {
        traceInfoIfCI(`Environment Variable dump: ${JSON.stringify(process.env)}`);
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
        if (
            !IS_CI_SERVER ||
            !process.env.GITHUB_REF_NAME ||
            process.env.GITHUB_REF_NAME !== 'main' ||
            (process.env.VSC_JUPYTER_WARMUP && process.env.VSC_JUPYTER_WARMUP == 'true')
        ) {
            return;
        }

        let result = this.currentTest?.isFailed() ? 'failed' : this.currentTest?.isPassed() ? 'passed' : 'skipped';

        const measures = this.currentTest?.duration ? { duration: this.currentTest.duration } : undefined;

        let dimensions: Record<string, string> = {
            testName: this.currentTest!.title,
            testResult: result
        };

        if (this.currentTest?.perfCheckpoints) {
            dimensions = { ...dimensions, timedCheckpoints: JSON.stringify(this.currentTest?.perfCheckpoints) };
        }

        if (process.env.GITHUB_SHA) {
            dimensions = { ...dimensions, commitHash: process.env.GITHUB_SHA };
        }

        traceInfoIfCI(`Sending telemetry event ${Telemetry.RunTest} with dimensions ${JSON.stringify(dimensions)}`);
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

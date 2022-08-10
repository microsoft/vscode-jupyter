// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Telemetry } from '../../../platform/common/constants';
import { sendTelemetryEvent } from '../../../telemetry';
import { getTelemetrySafeLanguage } from '../../../platform/telemetry/helpers';
import { IJupyterKernelSpec } from '../../types';

const shellScripts = ['/bin/sh', '/bin/bash', '/bin/zsh'];
export function sendKernelSpecTelemetry(kernelSpec: IJupyterKernelSpec, kind: 'local' | 'remote') {
    const usesShell = (kernelSpec.argv || []).some((arg) => {
        arg = arg.toLowerCase();
        return shellScripts.some((shell) => arg.includes(shell));
    });
    sendTelemetryEvent(Telemetry.KernelSpecLanguage, undefined, {
        language: getTelemetrySafeLanguage(kernelSpec.language),
        kind,
        usesShell
    });
}

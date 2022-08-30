// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { analyzeKernelErrors } from './errorUtils';

const taggers = [tagWithChildProcessExited, tagWithKernelRestarterFailed];
export function getErrorTags(stdErrOrStackTrace: string | string[]) {
    const tags: string[] = [];

    // This parameter might be either a string or a string array
    let stdErrOrStackTraceLowered = Array.isArray(stdErrOrStackTrace)
        ? stdErrOrStackTrace[0].toLowerCase()
        : stdErrOrStackTrace.toLowerCase();
    taggers.forEach((tagger) => tagger(stdErrOrStackTraceLowered, tags));
    const error = analyzeKernelErrors([], stdErrOrStackTraceLowered, undefined);
    if (error?.telemetrySafeTags.length) {
        tags.push(...error.telemetrySafeTags);
    }
    return Array.from(new Set(tags)).join(',');
}

function tagWithChildProcessExited(stdErrOrStackTrace: string, tags: string[] = []) {
    // StackTrace = at ChildProcess.exithandler child_process.js:312:12\n\tat ChildProcess.emit events.js:315:20\n\tat maybeClose <REDACTED: user-file-path>:1021:16\n\tat Process.ChildProcess._handle.onexit <REDACTED: user-file-path>:286:5"
    // StackTrace = at ChildProcess.exithandler child_process.js:312:12\n\tat ChildProcess.emit events.js:315:20\n\tat ChildProcess.EventEmitter.emit domain.js:483:12\n\tat maybeClose <REDACTED: user-file-path>:1021:16\n\tat Socket <REDACTED: user-file-path>:443:11\n\tat Socket.emit events.js:315:20\n\tat Socket.EventEmitter.emit domain.js:483:12\n\tat Pipe net.js:674:12"
    if (stdErrOrStackTrace.includes('ChildProcess.exithandler'.toLowerCase())) {
        tags.push('childproc.exit');
    }
}
function tagWithKernelRestarterFailed(stdErrOrStackTrace: string, tags: string[] = []) {
    /*
    [I 14:48:13.999 NotebookApp] KernelRestarter: restarting kernel (1/5), new random ports
    [I 14:48:17.011 NotebookApp] KernelRestarter: restarting kernel (2/5), new random ports
    [I 14:48:20.023 NotebookApp] KernelRestarter: restarting kernel (3/5), new random ports
    [I 14:48:23.031 NotebookApp] KernelRestarter: restarting kernel (4/5), new random ports
    [W 14:48:26.040 NotebookApp] KernelRestarter: restart failed
    */
    if (stdErrOrStackTrace.includes('KernelRestarter: restart failed'.toLowerCase())) {
        tags.push('KernelRestarter.failed');
    }
}

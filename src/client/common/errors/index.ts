// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as stackTrace from 'stack-trace';
import { getTelemetrySafeHashedString } from '../../telemetry/helpers';
import { getLastFrameFromPythonTraceback } from './errorUtils';

export abstract class BaseError extends Error {
    public stdErr?: string;
    constructor(public readonly category: ErrorCategory, message: string) {
        super(message);
    }
}

export function getErrorCategory(error?: Error): ErrorCategory {
    if (!error) {
        return 'unknown';
    }
    return error instanceof BaseError ? error.category : 'unknown';
}
export type ErrorCategory =
    | 'cancelled'
    | 'timeout'
    | 'daemon'
    | 'zmq'
    | 'debugger'
    | 'kerneldied'
    | 'kerneldied'
    | 'kernelpromisetimeout'
    | 'jupytersession'
    | 'jupyterconnection'
    | 'jupyterinstall'
    | 'jupyterselfcert'
    | 'invalidkernel'
    | 'noipykernel'
    | 'fetcherror'
    | 'notinstalled'
    | 'unknown';

// If there are errors, then the are added to the telementry properties.
export type TelemetryErrorProperties = {
    failed: true;
    /**
     * Node stacktrace without PII.
     */
    stackTrace: string;
    /**
     * A reason that we generate (e.g. kerneldied, noipykernel, etc), more like a category of the error.
     */
    failureCategory?: string;
    /**
     * Further sub classification of the error. E.g. kernel died due to the fact that zmq is not installed properly.
     */
    failureSubCategory?: string;
    /**
     * Hash of the file name that contains the file in the last frame (from Python stack trace).
     */
    pythonErrorFile?: string;
    /**
     * Hash of the folder that contains the file in the last frame (from Python stack trace).
     */
    pythonErrorFolder?: string;
    /**
     * Hash of the module that contains the file in the last frame (from Python stack trace).
     */
    pythonErrorPackage?: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function populateTelemetryWithErrorInfo(props: Partial<TelemetryErrorProperties>, error: Error) {
    props.failed = true;
    // Don't blow away what we already have.
    props.failureCategory = props.failureCategory || getErrorCategory(error);
    props.stackTrace = serializeStackTrace(error);
    const stdErr = error instanceof BaseError ? error.stdErr : '';
    if (!stdErr) {
        return;
    }
    props.failureSubCategory = props.failureSubCategory || getReasonForKernelToDie(stdErr);
    const info = getLastFrameFromPythonTraceback(stdErr);
    if (!info) {
        return;
    }
    props.pythonErrorFile = props.pythonErrorFile || getTelemetrySafeHashedString(info.fileName);
    props.pythonErrorFolder = props.pythonErrorFolder || getTelemetrySafeHashedString(info.folderName);
    props.pythonErrorPackage = props.pythonErrorPackage || getTelemetrySafeHashedString(info.packageName);
}

function parseStack(ex: Error) {
    // Work around bug in stackTrace when ex has an array already
    if (ex.stack && Array.isArray(ex.stack)) {
        const concatenated = { ...ex, stack: ex.stack.join('\n') };
        return stackTrace.parse(concatenated);
    }
    return stackTrace.parse(ex);
}

function serializeStackTrace(ex: Error): string {
    // We aren't showing the error message (ex.message) since it might contain PII.
    let trace = '';
    for (const frame of parseStack(ex)) {
        const filename = frame.getFileName();
        if (filename) {
            const lineno = frame.getLineNumber();
            const colno = frame.getColumnNumber();
            trace += `\n\tat ${getCallsite(frame)} ${filename}:${lineno}:${colno}`;
        } else {
            trace += '\n\tat <anonymous>';
        }
    }
    // Ensure we always use `/` as path separators.
    // This way stack traces (with relative paths) coming from different OS will always look the same.
    return trace.trim().replace(/\\/g, '/');
}

function getCallsite(frame: stackTrace.StackFrame) {
    const parts: string[] = [];
    if (typeof frame.getTypeName() === 'string' && frame.getTypeName().length > 0) {
        parts.push(frame.getTypeName());
    }
    if (typeof frame.getMethodName() === 'string' && frame.getMethodName().length > 0) {
        parts.push(frame.getMethodName());
    }
    if (typeof frame.getFunctionName() === 'string' && frame.getFunctionName().length > 0) {
        if (parts.length !== 2 || parts.join('.') !== frame.getFunctionName()) {
            parts.push(frame.getFunctionName());
        }
    }
    return parts.join('.');
}

/**
 * Analyze the details of the error such as `stdErr` from the kernel process and
 * try to determine the cause.
 */
function getReasonForKernelToDie(stdErr: string) {
    stdErr = stdErr.toLowerCase();
    if (stdErr.includes("ImportError: No module named 'win32api'".toLowerCase())) {
        // force re-installing ipykernel worked.
        /*
          File "C:\Users\<user>\miniconda3\envs\env_zipline\lib\contextlib.py", line 59, in enter
            return next(self.gen)
            File "C:\Users\<user>\miniconda3\envs\env_zipline\lib\site-packages\jupyter_client\connect.py", line 100, in secure_write
            win32_restrict_file_to_user(fname)
            File "C:\Users\<user>\miniconda3\envs\env_zipline\lib\site-packages\jupyter_client\connect.py", line 53, in win32_restrict_file_to_user
            import win32api
            ImportError: No module named 'win32api'
        */
        return 'win32api';
    }
    if (
        stdErr.includes('ImportError: cannot import name'.toLowerCase()) &&
        stdErr.includes('from partially initialized module'.toLowerCase()) &&
        stdErr.includes('zmq.backend.cython'.toLowerCase())
    ) {
        // force re-installing ipykernel worked.
        /*
          File "C:\Users\<user>\AppData\Roaming\Python\Python38\site-packages\zmq\backend\cython\__init__.py", line 6, in <module>
    from . import (constants, error, message, context,
          ImportError: cannot import name 'constants' from partially initialized module 'zmq.backend.cython' (most likely due to a circular import) (C:\Users\<user>\AppData\Roaming\Python\Python38\site-packages\zmq\backend\cython\__init__.py)
        */
        return 'zmq';
    }
    if (
        stdErr.includes('zmq'.toLowerCase()) &&
        stdErr.includes('cython'.toLowerCase()) &&
        stdErr.includes('__init__.py'.toLowerCase())
    ) {
        // force re-installing ipykernel worked.
        /*
          File "C:\Users\<user>\AppData\Roaming\Python\Python38\site-packages\zmq\backend\cython\__init__.py", line 6, in <module>
    from . import (constants, error, message, context,
          ImportError: cannot import name 'constants' from partially initialized module 'zmq.backend.cython' (most likely due to a circular import) (C:\Users\<user>\AppData\Roaming\Python\Python38\site-packages\zmq\backend\cython\__init__.py)
        */
        return 'zmq';
    }
    if (stdErr.includes('ImportError: DLL load failed'.toLowerCase())) {
        // Possibly a conda issue on windows
        /*
        win32_restrict_file_to_user
        import win32api
        ImportError: DLL load failed: 找不到指定的程序。
        */
        return 'dll.load.failed';
    }
    if (stdErr.includes("AssertionError: Couldn't find Class NSProcessInfo".toLowerCase())) {
        // Conda environment with IPython 5.8.0 fails with this message.
        // Updating to latest version of ipython fixed it (conda update ipython).
        // Possible we might have to update other packages as well (when using `conda update ipython` plenty of other related pacakges got updated, such as zeromq, nbclient, jedi)
        /*
            Error: Kernel died with exit code 1. Traceback (most recent call last):
            File "/Users/donjayamanne/miniconda3/envs/env3/lib/python3.7/site-packages/appnope/_nope.py", line 90, in nope
                "Because Reasons"
            File "/Users/donjayamanne/miniconda3/envs/env3/lib/python3.7/site-packages/appnope/_nope.py", line 60, in beginActivityWithOptions
                NSProcessInfo = C('NSProcessInfo')
            File "/Users/donjayamanne/miniconda3/envs/env3/lib/python3.7/site-packages/appnope/_nope.py", line 38, in C
                assert ret is not None, "Couldn't find Class %s" % classname
            AssertionError: Couldn't find Class NSProcessInfo
        */
        return 'oldipython';
    }
    if (
        stdErr.includes('NotImplementedError'.toLowerCase()) &&
        stdErr.includes('asyncio'.toLowerCase()) &&
        stdErr.includes('events.py'.toLowerCase())
    ) {
        /*
        "C:\Users\<user>\AppData\Roaming\Python\Python38\site-packages\zmq\eventloop\zmqstream.py", line 127, in __init__
        Info 2020-08-10 12:14:11: Python Daemon (pid: 16976): write to stderr:     self._init_io_state()
        Info 2020-08-10 12:14:11: Python Daemon (pid: 16976): write to stderr:   File "C:\Users\<user>\AppData\Roaming\Python\Python38\site-packages\zmq\eventloop\zmqstream.py", line 546, in _init_io_state
        Info 2020-08-10 12:14:11: Python Daemon (pid: 16976): write to stderr:     self.io_loop.add_handler(self.socket, self._handle_events, self.io_loop.READ)
        Info 2020-08-10 12:14:11: Python Daemon (pid: 16976): write to stderr:   File "C:\Users\<user>\AppData\Roaming\Python\Python38\site-packages\tornado\platform\asyncio.py", line 99, in add_handler
        Info 2020-08-10 12:14:11: Python Daemon (pid: 16976): write to stderr:     self.asyncio_loop.add_reader(fd, self._handle_events, fd, IOLoop.READ)
        Info 2020-08-10 12:14:11: Python Daemon (pid: 16976): write to stderr:   File "C:\Users\<user>\AppData\Local\Programs\Python\Python38-32\lib\asyncio\events.py", line 501, in add_reader
        Info 2020-08-10 12:14:11: Python Daemon (pid: 16976): write to stderr:     raise NotImplementedError
        Info 2020-08-10 12:14:11: Python Daemon (pid: 16976): write to stderr: NotImplementedError
        */
        return 'oldipykernel';
    }
    return '';
}

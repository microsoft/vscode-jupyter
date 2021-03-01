// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const taggers = [
    tagWithWin32Error,
    tagWithZmqError,
    tagWithDllLoadError,
    tagWithOldIPyKernel,
    tagWithOldIPython,
    tagWithChildProcessExited
];
export function getErrorTags(stdErrOrStackTrace: string) {
    const tags: string[] = [];
    stdErrOrStackTrace = stdErrOrStackTrace.toLowerCase();
    taggers.forEach((tagger) => tagger(stdErrOrStackTrace, tags));

    return Array.from(new Set(tags)).join(',');
}

function tagWithWin32Error(stdErr: string, tags: string[] = []) {
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
        tags.push('win32api');
    }
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
        tags.push('win32api');
    }
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
function tagWithZmqError(stdErr: string, tags: string[] = []) {
    if (
        stdErr.includes('ImportError: cannot import name'.toLowerCase()) &&
        stdErr.includes('from partially initialized module'.toLowerCase()) &&
        stdErr.includes('zmq.backend.cython'.toLowerCase())
    ) {
        // force re-installing ipykernel worked.
        tags.push('zmq.backend.cython');
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
        tags.push('zmq.cython');
    }
    // ZMQ general errors
    if (stdErr.includes('zmq.error.ZMQError')) {
        tags.push('zmq.error');
    }
}
function tagWithDllLoadError(stdErr: string, tags: string[] = []) {
    if (stdErr.includes('ImportError: DLL load failed'.toLowerCase())) {
        // Possibly a conda issue on windows
        /*
        win32_restrict_file_to_user
        import win32api
        ImportError: DLL load failed: 找不到指定的程序。
        */
        tags.push('dll.load.failed');
    }
}
function tagWithOldIPython(stdErr: string, tags: string[] = []) {
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
        tags.push('oldipython');
    }
}
function tagWithOldIPyKernel(stdErr: string, tags: string[] = []) {
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
        tags.push('oldipykernel');
    }
}

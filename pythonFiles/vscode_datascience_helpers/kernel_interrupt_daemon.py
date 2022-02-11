# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.

import sys
import ctypes
import os

from vscode_datascience_helpers.daemon.daemon_python import (
    error_decorator,
    PythonDaemon as BasePythonDaemon,
    change_exec_context,
)
from vscode_datascience_helpers.jupyter_daemon import PythonDaemon as JupyterDaemon
import vscode_datascience_helpers.winapi as winapi


class PythonDaemon(JupyterDaemon):
    def __init__(self, rx, tx, ppid):
        super().__init__(rx, tx, ppid)
        self.log.info("DataScience Kernel Interrupt Daemon init: " + str(ppid))
        if sys.platform == "win32" and ppid != 0:
            self.initialize_interrupt(ppid)

    def close(self):
        """Ensure we kill the kernel when shutting down the daemon."""
        try:
            self.m_kill_kernel()
            """ We don't care about exceptions coming back from killing the kernel, so pass here """
        except:  # nosec
            pass
        super().close()

    @error_decorator
    def m_interrupt_kernel(self):
        """Interrupts the kernel by sending it a signal.
        Unlike ``signal_kernel``, this operation is well supported on all
        platforms.
        Borrowed from https://github.com/jupyter/jupyter_client/blob/master/jupyter_client/manager.py
        """
        self.log.info("Interrupt kernel in DS Kernel Interrupt Daemon")
        if self.interrupt_handle is not None:
            winapi.SetEvent(self.interrupt_handle)

    @error_decorator
    def m_kill_kernel(self):
        """Kills the kernel by sending it a signal.
        Unlike ``signal_kernel``, this operation is well supported on all
        platforms.
        Borrowed from https://github.com/jupyter/jupyter_client/blob/master/jupyter_client/manager.py
        """
        self.log.info("Kill kernel in DS Kernel Interrupt Daemon")
        if self.interrupt_handle is not None:
            winapi.CloseHandle(self.interrupt_handle)

    @error_decorator
    def m_get_handle(self):
        """Return the dupe interrupt handle for the parent process."""
        self.log.info("Get interrupt handle in Interrupt Daemon")
        if self.dupe_handle is not None:
            return self.dupe_handle.value

    def initialize_interrupt(self, ppid):
        """Create an interrupt event handle.
        The parent process should call this to create the
        interrupt event that is passed to the child process. It should store
        this handle and use it with ``send_interrupt`` to interrupt the child
        process.
        """
        # Create a security attributes struct that permits inheritance of the
        # handle by new processes.
        # FIXME: We can clean up this mess by requiring pywin32 for IPython.
        class SECURITY_ATTRIBUTES(ctypes.Structure):
            _fields_ = [
                ("nLength", ctypes.c_int),
                ("lpSecurityDescriptor", ctypes.c_void_p),
                ("bInheritHandle", ctypes.c_int),
            ]

        sa = SECURITY_ATTRIBUTES()
        sa_p = ctypes.pointer(sa)
        sa.nLength = ctypes.sizeof(SECURITY_ATTRIBUTES)
        sa.lpSecurityDescriptor = 0
        sa.bInheritHandle = 1

        # Create the event in the child process
        self.interrupt_handle = ctypes.windll.kernel32.CreateEventA(
            sa_p, False, False, 0
        )

        # Duplicate the handle for the parent process
        child_proc_handle = winapi.OpenProcess(
            winapi.PROCESS_ALL_ACCESS, False, os.getpid()
        )
        parent_proc_handle = winapi.OpenProcess(winapi.PROCESS_ALL_ACCESS, False, ppid)
        self.dupe_handle = winapi.DuplicateHandle(
            child_proc_handle,
            self.interrupt_handle,
            parent_proc_handle,
            0,
            True,
            winapi.DUPLICATE_SAME_ACCESS,
        )
        child_proc_handle.Close()
        parent_proc_handle.Close()

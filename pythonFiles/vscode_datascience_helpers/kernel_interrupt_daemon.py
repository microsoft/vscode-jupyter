# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.

import argparse
import sys
import ctypes
import os
import logging
import logging.config

import winapi


def add_arguments(parser):
    parser.description = "Interrupter"
    parser.add_argument("--ppid", help="Parent process id", type=int)


class PythonKernelInterrupter:
    def __init__(self, ppid):
        self.ppid = ppid
        self.interrupt_handles = {}

    def interrupt(self, handle):
        """Interrupts the kernel by sending it a signal.
        Borrowed from https://github.com/jupyter/jupyter_client/blob/master/jupyter_client/manager.py
        """
        if handle in self.interrupt_handles:
            winapi.SetEvent(self.interrupt_handles[handle])
        else:
            logging.warning(
                "Interrupt handle for kernel process interrupt handle %d not found",
                handle,
            )

    def close_interrupt_handle(self, handle):
        """Kills the kernel by sending it a signal.
        Borrowed from https://github.com/jupyter/jupyter_client/blob/master/jupyter_client/manager.py
        """
        if handle in self.interrupt_handles:
            logging.info(
                "Closing interrupt handle for kernel process interrupt handle %d",
                handle,
            )
            winapi.CloseHandle(self.interrupt_handles[handle])

    def initialize_interrupt(self):
        """Create an interrupt event handle.
        The parent process should call this to create the
        interrupt event that is passed to the child process. It should store
        this handle and use it with ``send_interrupt`` to interrupt the child
        process.

        Return the dupe interrupt handle for the parent process.
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
        interrupt_handle = ctypes.windll.kernel32.CreateEventA(sa_p, False, False, 0)

        # Duplicate the handle for the parent process
        child_proc_handle = winapi.OpenProcess(
            winapi.PROCESS_ALL_ACCESS, False, os.getpid()
        )

        parent_proc_handle = winapi.OpenProcess(
            winapi.PROCESS_ALL_ACCESS, False, self.ppid
        )
        dupe_handle = winapi.DuplicateHandle(
            child_proc_handle,
            interrupt_handle,
            parent_proc_handle,
            0,
            True,
            winapi.DUPLICATE_SAME_ACCESS,
        )
        child_proc_handle.Close()
        parent_proc_handle.Close()
        self.interrupt_handles[dupe_handle.value] = interrupt_handle

        return dupe_handle.value


def main():
    """Starts the daemon.
    Look for commands to create interrupt handles and then subsequently interrupt processes.
    """
    logging.basicConfig(
        format="%(asctime)s UTC - %(levelname)s - %(message)s", level=logging.DEBUG
    )
    parser = argparse.ArgumentParser()
    add_arguments(parser)
    args = parser.parse_args()
    print(args.ppid)
    if sys.platform == "win32" and args.ppid == 0:
        return

    interrupter = PythonKernelInterrupter(args.ppid)
    for line in sys.stdin:
        try:
            line = line.strip()
            if line.startswith("INITIALIZE_INTERRUPT:"):
                handle = interrupter.initialize_interrupt()
                print(f"INITIALIZE_INTERRUPT:{int(line.split(':')[1])}:{handle}")
            elif line.startswith("INTERRUPT:"):
                interrupter.interrupt(int(line.split(":")[2]))
                print(f"INTERRUPT:{int(line.split(':')[1])}")
            elif line.startswith("KILL_INTERRUPT:"):
                interrupter.close_interrupt_handle(int(line.split(":")[2]))
                print(f"KILL_INTERRUPT:{int(line.split(':')[1])}")
            else:
                logging.warning("Unknown command: %s", line)
        except:
            logging.exception(f"Error in line {line}")


if __name__ == "__main__":
    main()

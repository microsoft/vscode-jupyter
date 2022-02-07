# No changes to original code.
# Original source borrowed from https://github.com/jupyter/jupyter_client/blob/master/jupyter_client/win_interrupt.py.

"""Use a Windows event to interrupt a child process like SIGINT.

The child needs to explicitly listen for this - see
ipykernel.parentpoller.ParentPollerWindows for a Python implementation.
"""

import ctypes
import argparse
import winapi
import os


def create_interrupt_event(ppid):
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
    interrupt_handle = ctypes.windll.kernel32.CreateEventA(sa_p, False, False, 0)

    # Duplicate the handle for the parent process
    child_proc_handle = winapi.OpenProcess(
        winapi.PROCESS_ALL_ACCESS, False, os.getpid()
    )
    parent_proc_handle = winapi.OpenProcess(winapi.PROCESS_ALL_ACCESS, False, ppid)
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
    winapi.CloseHandle(interrupt_handle)
    return dupe_handle.value


def send_interrupt(interrupt_handle):
    """Sends an interrupt event using the specified handle."""
    winapi.SetEvent(interrupt_handle)


def close_handle(interrupt_handle):
    """Closes a handle"""
    ctypes.windll.kernel32.CloseHandle(interrupt_handle)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ppid", help="Parent process id")
    parser.add_argument("--signal", help="Handle to signal an event on")
    parser.add_argument("--close", help="Handle to close")
    args = parser.parse_args()
    if args.ppid:
        handle = create_interrupt_event(int(args.ppid))
        print(handle)
    elif args.signal:
        send_interrupt(int(args.signal))
    elif args.close:
        close_handle(int(args.close))
    else:
        parser.print_help()


if __name__ == "__main__":
    main()

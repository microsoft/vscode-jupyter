# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

import ipykernel
import jupyter_client
import zmq
from jupyter_client import KernelManager


root = os.environ["RAW_KERNEL_STARTUP_RUNTIME_ROOT"]
with tempfile.TemporaryDirectory(prefix="kernel-", dir=root) as runtime:
    manager = KernelManager(connection_file=str(Path(runtime) / "connection.json"))
    gate = os.environ.get("RAW_KERNEL_STARTUP_GATE") == "1"
    manager.kernel_spec.argv = (
        [sys.executable, str(Path(__file__).with_name("rawStartupGate.py"))]
        if gate
        else [sys.executable, "-m", "ipykernel_launcher"]
    ) + ["-f", "{connection_file}"]
    try:
        manager.start_kernel(
            cwd=runtime,
            env={
                **os.environ,
                "IPYTHONDIR": runtime,
                "JUPYTER_CONFIG_DIR": runtime,
                "JUPYTER_RUNTIME_DIR": runtime,
            },
            stdout=subprocess.DEVNULL,
            stderr=sys.stderr,
        )
        connection = manager.get_connection_info()
        connection["key"] = connection["key"].decode()
        print(json.dumps({
            "event": "started",
            "connection": connection,
            "runtime": runtime,
            "pid": manager.provisioner.pid,
            "versions": {
                "python": sys.version.split()[0],
                "ipykernel": ipykernel.__version__,
                "pyzmq": zmq.__version__,
                "jupyter_client": jupyter_client.__version__,
            },
        }), flush=True)
        for command in sys.stdin:
            if command.strip() == "stop":
                break
            raise ValueError("Unexpected owned kernel driver command")
    finally:
        if manager.has_kernel:
            manager.shutdown_kernel(now=True)
        manager.cleanup_resources()

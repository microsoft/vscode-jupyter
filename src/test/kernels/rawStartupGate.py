# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Stage the actual ipykernel sender without applying its readiness correction."""

import hashlib
import json
from pathlib import Path
import select
import time

import zmq
from ipykernel.kernelbase import Kernel
from ipykernel.subshell_manager import SubshellManager


original_sender = SubshellManager._send_on_shell_channel
original_dispatch = Kernel.dispatch_shell
replies = 0
runtime = Path.cwd()
state = {"executions": 0}


def save():
    temporary = runtime / "fixture-state.tmp"
    temporary.write_text(json.dumps(state), encoding="utf-8")
    temporary.replace(runtime / "fixture-state.json")


def header(message):
    frames = [frame.bytes if isinstance(frame, zmq.Frame) else frame for frame in message]
    return json.loads(frames[frames.index(b"<IDS|MSG>") + 2])


def send(self, message):
    global replies
    if header(message)["msg_type"] != "kernel_info_reply":
        return original_sender(self, message)
    replies += 1
    if replies != 2:
        return original_sender(self, message)

    def staged_send():
        (runtime / "sender-ready").write_text("ready", encoding="utf-8")
        marker = runtime / "startup-request-ready"
        deadline = time.monotonic() + 4
        while not marker.exists() or marker.stat().st_size != 16:
            if time.monotonic() >= deadline:
                state["error"] = "Original startup request did not reach the staging gate"
                save()
                raise RuntimeError(state["error"])
            time.sleep(0.001)
        fd = self._shell_socket.get(zmq.FD)
        before = bool(select.select([fd], [], [], 1)[0])
        original_sender(self, message)
        after = bool(select.select([fd], [], [], 0)[0])
        events = self._shell_socket.get(zmq.EVENTS)
        state.update(
            fd_before=before,
            fd_after=after,
            pollin=bool(events & zmq.POLLIN),
            request_hash=marker.read_text(encoding="utf-8"),
        )
        save()
        if not before or after or not state["pollin"]:
            raise RuntimeError("Real sender did not establish a missed-readiness condition")

    self._shell_channel_io_loop.call_later(0.02, staged_send)


async def dispatch(self, message, *args, **kwargs):
    info = header(message)
    request_hash = hashlib.sha256(info["msg_id"].encode()).hexdigest()[:16]
    if info["msg_type"] == "execute_request" and request_hash == state.get("request_hash"):
        state["executions"] += 1
        save()
    return await original_dispatch(self, message, *args, **kwargs)


SubshellManager._send_on_shell_channel = send
Kernel.dispatch_shell = dispatch
from ipykernel.kernelapp import main

main()

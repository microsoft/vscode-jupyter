# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Controlled native-FD fixture, using the installed, unmodified ipykernel sender."""

import asyncio
import json
import os
import secrets
import select
import sys
import threading
import time

import zmq
from ipykernel.subshell_manager import SubshellManager
from jupyter_client.session import Session
from tornado.ioloop import IOLoop
from zmq.eventloop.zmqstream import ZMQStream

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
threading.current_thread().name = "Shell channel"
context = zmq.Context()
session = Session(key=secrets.token_hex(32).encode())
loop = IOLoop(make_current=False)
connection = {"ip": "127.0.0.1", "transport": "tcp", "key": session.key.decode(),
              "signature_scheme": "hmac-sha256"}
sockets = {}
for name, kind in (("shell", zmq.ROUTER), ("control", zmq.ROUTER), ("stdin", zmq.ROUTER),
                   ("iopub", zmq.PUB), ("hb", zmq.REP)):
    socket = context.socket(kind)
    socket.linger = 0
    connection[name + "_port"] = socket.bind_to_random_port("tcp://127.0.0.1")
    sockets[name] = socket
shell = sockets["shell"]
sender = object.__new__(SubshellManager)
sender._shell_socket = shell
stopping = threading.Event()
execution_count = 0
retained = []
unrecoverable = "--unrecoverable" in sys.argv
omit_ready = "--omit-ready" in sys.argv
ignore_stop = "--ignore-stop" in sys.argv
expect_eof = "--expect-eof" in sys.argv


def emit(event, **values):
    print(json.dumps({"event": event, **values}), flush=True)


def status(parent, value):
    session.send(sockets["iopub"], "status", {"execution_state": value}, parent=parent)


def reply(parent, identities, kind, content):
    message = session.msg(kind, content, parent=parent)
    SubshellManager._send_on_shell_channel(sender, session.serialize(message, ident=identities))


def dispatch(identities, message):
    global execution_count
    status(message, "busy")
    if message["header"]["msg_type"] == "kernel_info_request":
        reply(message, identities, "kernel_info_reply", {
            "status": "ok", "protocol_version": "5.3", "implementation": "ipython",
            "implementation_version": "9.17.1", "language_info": {"name": "python", "version": "3.14.6"},
            "supported_features": ["kernel subshells"], "banner": "", "help_links": [],
        })
    elif message["header"]["msg_type"] == "execute_request":
        execution_count += 1
        reply(message, identities, "execute_reply", {
            "status": "ok", "execution_count": execution_count, "payload": [], "user_expressions": {},
        })
        emit("executed", count=execution_count)
    else:
        raise ValueError("Unexpected fixture request")
    status(message, "idle")


def on_message(frames):
    if unrecoverable:
        retained.append(frames)
        emit("request-retained")
        return
    identities, body = session.feed_identities(frames)
    dispatch(identities, session.deserialize(body))


stream = ZMQStream(shell, io_loop=loop)
stream.on_recv(on_message)


def read_commands():
    for command in sys.stdin:
        if command.strip() != "stop":
            raise ValueError("Unknown fixture command")
        if ignore_stop:
            emit("stop-ignored")
            continue
        stopping.set()
        loop.add_callback(loop.stop)
        return
    if expect_eof:
        emit("stdin-eof")
    stopping.set()
    loop.add_callback(loop.stop)


threading.Thread(target=read_commands, daemon=True).start()
if not omit_ready:
    emit("started", pid=os.getpid(), connection=connection)
try:
    while not stopping.is_set():
        if not shell.poll(100):
            continue
        identities, message = session.recv(shell)
        if message["header"]["msg_type"] != "execute_request":
            dispatch(identities, message)
            continue
        execution_count += 1
        status(message, "busy")
        shell.getsockopt(zmq.EVENTS)
        emit("queue-second")
        if not select.select([stream._fd], [], [], 2)[0]:
            raise RuntimeError("Controlled second request did not enter the native queue")
        time.sleep(0.01)
        reply(message, identities, "execute_reply", {
            "status": "ok", "execution_count": execution_count, "payload": [], "user_expressions": {},
        })
        readable = bool(select.select([stream._fd], [], [], 0)[0])
        events = shell.getsockopt(zmq.EVENTS)
        if readable or not events & zmq.POLLIN:
            raise RuntimeError("Actual missed readiness edge was not staged")
        status(message, "idle")
        emit("fault-staged", fd_readable=readable, queued_pollin=bool(events & zmq.POLLIN))
        loop.start()
        break
finally:
    stream.close(linger=0)
    for name, socket in sockets.items():
        if name != "shell":
            socket.close(linger=0)
    loop.close()
    context.term()

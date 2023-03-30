
# encoding: utf-8
"""IO capturing utilities."""

# Copyright (c) IPython Development Team.
# Distributed under the terms of the Modified BSD License.

from IPython.core import magic_arguments
from IPython.core.magic import (
    Magics,
    cell_magic,
    line_cell_magic,
    line_magic,
    magics_class,
    needs_local_scope,
    no_var_expand,
    on_off,
)
from IPython.core.displayhook import DisplayHook

import traceback
import warnings
import threading
import sys
import io
import os
from io import StringIO, TextIOBase
from typing import Any, Callable, Deque, Optional

#-----------------------------------------------------------------------------
# Classes and functions
#-----------------------------------------------------------------------------


class RichOutput(object):
    def __init__(self, data=None, metadata=None, transient=None, update=False):
        self.data = data or {}
        self.metadata = metadata or {}
        self.transient = transient or {}
        self.update = update

    def display(self):
        from IPython.display import publish_display_data
        publish_display_data(data=self.data, metadata=self.metadata,
                             transient=self.transient, update=self.update)

    def _repr_mime_(self, mime):
        if mime not in self.data:
            return
        data = self.data[mime]
        if mime in self.metadata:
            return data, self.metadata[mime]
        else:
            return data

    def _repr_mimebundle_(self, include=None, exclude=None):
        return self.data, self.metadata

    def _repr_html_(self):
        return self._repr_mime_("text/html")

    def _repr_latex_(self):
        return self._repr_mime_("text/latex")

    def _repr_json_(self):
        return self._repr_mime_("application/json")

    def _repr_javascript_(self):
        return self._repr_mime_("application/javascript")

    def _repr_png_(self):
        return self._repr_mime_("image/png")

    def _repr_jpeg_(self):
        return self._repr_mime_("image/jpeg")

    def _repr_svg_(self):
        return self._repr_mime_("image/svg+xml")


class CapturedIO(object):
    """Simple object for containing captured stdout/err and rich display StringIO objects

    Each instance `c` has three attributes:

    - ``c.stdout`` : standard output as a string
    - ``c.stderr`` : standard error as a string
    - ``c.outputs``: a list of rich display outputs

    Additionally, there's a ``c.show()`` method which will print all of the
    above in the same order, and can be invoked simply via ``c()``.
    """

    def __init__(self, stdout, stderr, outputs=None):
        self._stdout = stdout
        self._stderr = stderr
        if outputs is None:
            outputs = []
        self._outputs = outputs

    def __str__(self):
        return self.stdout

    @property
    def stdout(self):
        "Captured standard output"
        if not self._stdout:
            return ''
        return self._stdout.getvalue()

    @property
    def stderr(self):
        "Captured standard error"
        if not self._stderr:
            return ''
        return self._stderr.getvalue()

    @property
    def outputs(self):
        """A list of the captured rich display outputs, if any.

        If you have a CapturedIO object ``c``, these can be displayed in IPython
        using::

            from IPython.display import display
            for o in c.outputs:
                display(o)
        """
        return [ RichOutput(**kargs) for kargs in self._outputs ]

    def show(self):
        """write my output to sys.stdout/err as appropriate"""
        sys.stdout.write(self.stdout)
        sys.stderr.write(self.stderr)
        sys.stdout.flush()
        sys.stderr.flush()
        for kargs in self._outputs:
            RichOutput(**kargs).display()

    __call__ = show

class StreamLogger(object):
   def __init__(self, store, pass_through):
      self.pass_through = pass_through
      self.store = store

   def getvalue(self):
      return self.store.getvalue()

   def flush(self):
      self.pass_through.flush()

   def isatty(self):
      return self.pass_through.isatty()

   def fileno(self):
      return self.pass_through.fileno()

   def write(self, buf):
      self.store.write(buf)
      self.pass_through.write(buf)

   def writelines(self, lines):
      self.store.writelines(lines)
      self.pass_through.writelines(lines)


class OutStream(TextIOBase):
    """A file like object that publishes the stream to a 0MQ PUB socket.

    Output is handed off to an IO Thread
    """

    # timeout for flush to avoid infinite hang
    # in case of misbehavior
    flush_timeout = 10
    # The time interval between automatic flushes, in seconds.
    flush_interval = 0.2
    topic = None
    encoding = "UTF-8"
    _exc: Optional[Any] = None

    def fileno(self):
        """
        Things like subprocess will peak and write to the fileno() of stderr/stdout.
        """
        if getattr(self, "_original_stdstream_copy", None) is not None:
            return self._original_stdstream_copy
        else:
            msg = "fileno"
            raise io.UnsupportedOperation(msg)

    def _watch_pipe_fd(self):
        """
        We've redirected standards steams 0 and 1 into a pipe.

        We need to watch in a thread and redirect them to the right places.

        1) the ZMQ channels to show in notebook interfaces,
        2) the original stdout/err, to capture errors in terminals.

        We cannot schedule this on the ioloop thread, as this might be blocking.

        """

        try:
            bts = os.read(self._fid, 1000)
            while bts and self._should_watch:
                self.write(bts.decode())
                os.write(self._original_stdstream_copy, bts)
                bts = os.read(self._fid, 1000)
        except Exception:
            self._exc = sys.exc_info()

    def __init__(
        self,
        name,
        pipe=None,
        echo=None,
        *,
        watchfd=True,
        isatty=False,
    ):
        """
        Parameters
        ----------
        session : object
            the session object
        pub_thread : threading.Thread
            the publication thread
        name : str {'stderr', 'stdout'}
            the name of the standard stream to replace
        pipe : object
            the pip object
        echo : bool
            whether to echo output
        watchfd : bool (default, True)
            Watch the file descripttor corresponding to the replaced stream.
            This is useful if you know some underlying code will write directly
            the file descriptor by its number. It will spawn a watching thread,
            that will swap the give file descriptor for a pipe, read from the
            pipe, and insert this into the current Stream.
        isatty : bool (default, False)
            Indication of whether this stream has termimal capabilities (e.g. can handle colors)

        """
        if pipe is not None:
            warnings.warn(
                "pipe argument to OutStream is deprecated and ignored since ipykernel 4.2.3.",
                DeprecationWarning,
                stacklevel=2,
            )
        # This is necessary for compatibility with Python built-in streams
        self.name = name
        self.topic = b"stream." + name.encode()
        self.parent_header = {}
        self._master_pid = os.getpid()
        self._flush_pending = False
        self._subprocess_flush_pending = False
        self._buffer_lock = threading.RLock()
        self._buffer = StringIO()
        self.echo = None
        self._isatty = bool(isatty)
        self._should_watch = False

        if (
            watchfd
            and (sys.platform.startswith("linux") or sys.platform.startswith("darwin"))
            and ("PYTEST_CURRENT_TEST" not in os.environ)
        ):
            # Pytest set its own capture. Dont redirect from within pytest.

            self._should_watch = True
            self._setup_stream_redirects(name)

        if echo:
            if hasattr(echo, "read") and hasattr(echo, "write"):
                self.echo = echo
            else:
                msg = "echo argument must be a file like object"
                raise ValueError(msg)

    def isatty(self):
        """Return a bool indicating whether this is an 'interactive' stream.

        Returns:
            Boolean
        """
        return self._isatty

    def _setup_stream_redirects(self, name):
        pr, pw = os.pipe()
        fno = getattr(sys, name).fileno()
        self._original_stdstream_copy = os.dup(fno)
        os.dup2(pw, fno)

        self._fid = pr

        self._exc = None
        self.watch_fd_thread = threading.Thread(target=self._watch_pipe_fd)
        self.watch_fd_thread.daemon = True
        self.watch_fd_thread.start()

    def _is_master_process(self):
        return os.getpid() == self._master_pid

    def set_parent(self, parent):
        """Set the parent header."""
        pass

    def close(self):
        """Close the stream."""
        if self._should_watch:
            self._should_watch = False
            self.watch_fd_thread.join()
        if self._exc:
            etype, value, tb = self._exc
            traceback.print_exception(etype, value, tb)
        self.pub_thread = None

    @property
    def closed(self):
        return self.pub_thread is None

    def _schedule_flush(self):
        """schedule a flush in the IO thread

        call this on write, to indicate that flush should be called soon.
        """
        if self._flush_pending:
            return
        self._flush_pending = True

        # add_timeout has to be handed to the io thread via event pipe
        self._flush()
        # def _schedule_in_thread():
        #     self._io_loop.call_later(self.flush_interval, self._flush)

        # self.pub_thread.schedule(_schedule_in_thread)

    def flush(self):
        """trigger actual zmq send

        send will happen in the background thread
        """
        # if (
        #     self.pub_thread
        #     and self.pub_thread.thread is not None
        #     and self.pub_thread.thread.is_alive()
        #     and self.pub_thread.thread.ident != threading.current_thread().ident
        # ):
        #     # request flush on the background thread
        #     self.pub_thread.schedule(self._flush)
        #     # wait for flush to actually get through, if we can.
        #     evt = threading.Event()
        #     self.pub_thread.schedule(evt.set)
        #     # and give a timeout to avoid
        #     if not evt.wait(self.flush_timeout):
        #         # write directly to __stderr__ instead of warning because
        #         # if this is happening sys.stderr may be the problem.
        #         print("IOStream.flush timed out", file=sys.__stderr__)
        # else:
        #     self._flush()

        self._flush()

    def _flush(self):
        """This is where the actual send happens.

        _flush should generally be called in the IO thread,
        unless the thread has been destroyed (e.g. forked subprocess).
        """
        self._flush_pending = False
        self._subprocess_flush_pending = False

        if self.echo is not None:
            try:
                self.echo.flush()
            except OSError as e:
                if self.echo is not sys.__stderr__:
                    print(f"Flush failed: {e}", file=sys.__stderr__)

        # data = self._flush_buffer()
        # if data:
        #     # FIXME: this disables Session's fork-safe check,
        #     # since pub_thread is itself fork-safe.
        #     # There should be a better way to do this.
        #     self.session.pid = os.getpid()
        #     content = {"name": self.name, "text": data}
        #     self.session.send(
        #         self.pub_thread,
        #         "stream",
        #         content=content,
        #         parent=self.parent_header,
        #         ident=self.topic,
        #     )

    def write(self, string: str) -> Optional[int]:  # type:ignore[override]
        """Write to current stream after encoding if necessary

        Returns
        -------
        len : int
            number of items from input parameter written to stream.

        """

        if not isinstance(string, str):
            msg = f"write() argument must be str, not {type(string)}"
            raise TypeError(msg)

        if self.echo is not None:
            try:
                self.echo.write(string)
            except OSError as e:
                if self.echo is not sys.__stderr__:
                    print(f"Write failed: {e}", file=sys.__stderr__)

        if self.pub_thread is None:
            msg = "I/O operation on closed file"
            raise ValueError(msg)
        else:
            is_child = not self._is_master_process()
            # only touch the buffer in the IO thread to avoid races
            with self._buffer_lock:
                self._buffer.write(string)
            if is_child:
                # mp.Pool cannot be trusted to flush promptly (or ever),
                # and this helps.
                if self._subprocess_flush_pending:
                    return None
                self._subprocess_flush_pending = True
                # We can not rely on self._io_loop.call_later from a subprocess
                self.pub_thread.schedule(self._flush)
            else:
                self._schedule_flush()

        return len(string)

    def writelines(self, sequence):
        """Write lines to the stream."""
        if self.pub_thread is None:
            msg = "I/O operation on closed file"
            raise ValueError(msg)
        else:
            for string in sequence:
                self.write(string)

    def writable(self):
        """Test whether the stream is writable."""
        return True

    def getvalue(self):
        return self._flush_buffer()

    def _flush_buffer(self):
        """clear the current buffer and return the current buffer data."""
        buf = self._rotate_buffer()
        data = buf.getvalue()
        buf.close()
        return data

    def _rotate_buffer(self):
        """Returns the current buffer and replaces it with an empty buffer."""
        with self._buffer_lock:
            old_buffer = self._buffer
            self._buffer = StringIO()
        return old_buffer



class capture_output(object):
    """context manager for capturing stdout/err"""
    stdout = True
    stderr = True
    display = True

    def __init__(self, stdout=True, stderr=True, display=True):
        self.stdout = stdout
        self.stderr = stderr
        self.display = display
        self.shell = None

    def __enter__(self):
        from IPython.core.getipython import get_ipython
        from IPython.core.displaypub import CapturingDisplayPublisher
        from IPython.core.displayhook import CapturingDisplayHook

        self.sys_stdout = sys.stdout
        self.sys_stderr = sys.stderr

        if self.display:
            self.shell = get_ipython()
            if self.shell is None:
                self.save_display_pub = None
                self.display = False

        stdout = stderr = outputs = None
        if self.stdout:
            # stdout = sys.stdout = StringIO()
            # stdout = StreamLogger(StringIO(), sys.stdout)
            stdout = OutStream('stdout', watchfd=False)
            sys.stdout = stdout
        if self.stderr:
            # stderr = sys.stderr = StringIO()
            # stderr = StreamLogger(StringIO(), sys.stderr)
            stderr = OutStream('stderr', watchfd=False)
            sys.stderr = stderr
        if self.display:
            self.save_display_pub = self.shell.display_pub
            self.shell.display_pub = CapturingDisplayPublisher()
            outputs = self.shell.display_pub.outputs
            self.save_display_hook = sys.displayhook
            sys.displayhook = CapturingDisplayHook(shell=self.shell,
                                                   outputs=outputs)

        return CapturedIO(stdout, stderr, outputs)

    def __exit__(self, exc_type, exc_value, traceback):
        sys.stdout = self.sys_stdout
        sys.stderr = self.sys_stderr
        if self.display and self.shell:
            self.shell.display_pub = self.save_display_pub
            sys.displayhook = self.save_display_hook



@magics_class
class MyMagics(Magics):
    """Magics related to code execution, debugging, profiling, etc.
    """

    def __init__(self, shell):
        super(MyMagics, self).__init__(shell)
        # Default execution function used to actually run user code.
        self.default_runner = None

    @magic_arguments.magic_arguments()
    @magic_arguments.argument('output', type=str, default='', nargs='?',
        help="""The name of the variable in which to store output.
        This is a utils.io.CapturedIO object with stdout/err attributes
        for the text of the captured output.
        CapturedOutput also has a show() method for displaying the output,
        and __call__ as well, so you can use that to quickly display the
        output.
        If unspecified, captured output is discarded.
        """
    )
    @magic_arguments.argument('--no-stderr', action="store_true",
        help="""Don't capture stderr."""
    )
    @magic_arguments.argument('--no-stdout', action="store_true",
        help="""Don't capture stdout."""
    )
    @magic_arguments.argument('--no-display', action="store_true",
        help="""Don't capture IPython's rich display."""
    )
    @cell_magic
    def vsccapture(self, line, cell):
        """run the cell, capturing stdout, stderr, and IPython's rich display() calls."""
        args = magic_arguments.parse_argstring(self.vsccapture, line)
        out = not args.no_stdout
        err = not args.no_stderr
        disp = not args.no_display
        with capture_output(out, err, disp) as io:
            self.shell.run_cell(cell)
        if DisplayHook.semicolon_at_end_of_expression(cell):
            if args.output in self.shell.user_ns:
                del self.shell.user_ns[args.output]
        elif args.output:
            self.shell.user_ns[args.output] = io



# In order to actually use these magics, you must register them with a
# running IPython.

def load_ipython_extension(ipython):
    """
    Any module file that define a function named `load_ipython_extension`
    can be loaded via `%load_ext module.path` or be configured to be
    autoloaded by IPython at startup time.
    """
    # You can register the class itself without instantiating it.  IPython will
    # call the default constructor on it.
    ipython.register_magics(MyMagics)

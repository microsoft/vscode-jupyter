
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


import sys
from io import StringIO

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
            stdout = StreamLogger(StringIO(), sys.stdout)
            sys.stdout = stdout
        if self.stderr:
            # stderr = sys.stderr = StringIO()
            stderr = StreamLogger(StringIO(), sys.stderr)
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

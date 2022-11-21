# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.

import pytest
import sys
import textwrap

import normalizeSelection


class TestNormalizationScript(object):
    """Basic unit tests for the normalization script."""

    def test_basicNormalization(self):
        src = 'print("this is a test")'
        ret = normalizeSelection.normalize_lines(src)
        assert ret == 'print("this is a test")\n'

    def test_basicNormalization_syntaxerror(self):
        src = "if True:"
        ret = normalizeSelection.normalize_lines(src)
        assert ret == "if True:\n\n"

    def test_commentsGone(self):
        src = textwrap.dedent(
            """\
            # Some rando comment
            x = 3
            """
        )
        expectedResult = textwrap.dedent(
            """\
            x = 3
            """
        )
        ret = normalizeSelection.normalize_lines(src)
        assert ret == expectedResult

    def test_lineAfterMultiline(self):
        src = textwrap.dedent(
            """\
            def show_something():
                print("Something")
            """
        )
        expectedResult = textwrap.dedent(
            """\
            def show_something():
                print("Something")

            """
        )
        ret = normalizeSelection.normalize_lines(src)
        assert ret == expectedResult

    def test_dedent(self):
        src = """\
            def show_something():
                print("Something")
            """
        expectedResult = textwrap.dedent(
            """\
            def show_something():
                print("Something")

            """
        )
        ret = normalizeSelection.normalize_lines(src)
        assert ret == expectedResult

    def test_withHangingIndent(self):
        src = textwrap.dedent(
            """\
            x = 22
            y = 30
            z = -10
            result = x + y + z

            if result == 42:
                print("The answer to life, the universe, and everything")
            """
        )
        expectedResult = textwrap.dedent(
            """\
            x = 22
            y = 30
            z = -10
            result = x + y + z
            if result == 42:
                print("The answer to life, the universe, and everything")

            """
        )
        ret = normalizeSelection.normalize_lines(src)
        assert ret == expectedResult

    def test_clearOutExtraneousNewlines(self):
        src = textwrap.dedent(
            """\
            value_x = 22

            value_y = 30

            value_z = -10

            print(value_x + value_y + value_z)

            """
        )
        expectedResult = textwrap.dedent(
            """\
            value_x = 22
            value_y = 30
            value_z = -10
            print(value_x + value_y + value_z)
            """
        )
        ret = normalizeSelection.normalize_lines(src)
        assert ret == expectedResult

    def test_clearOutExtraLinesAndWhitespace(self):
        src = textwrap.dedent(
            """\
            if True:
                x = 22

                y = 30

                z = -10

            print(x + y + z)

            """
        )
        expectedResult = textwrap.dedent(
            """\
            if True:
                x = 22
                y = 30
                z = -10

            print(x + y + z)
            """
        )
        ret = normalizeSelection.normalize_lines(src)
        assert ret == expectedResult

    def test_semicolon(self):
        src = textwrap.dedent(
            """\
            a = 3; b = 4
            """
        )
        ret = normalizeSelection.normalize_lines(src)
        assert ret == src

    def test_syntaxerror(self):
        src = textwrap.dedent(
            """\
            for x in range(4):
                if x > 3:
            """
        )
        expectedResult = textwrap.dedent(
            """\
            for x in range(4):
                if x > 3:


            """
        )
        ret = normalizeSelection.normalize_lines(src)
        assert ret == expectedResult

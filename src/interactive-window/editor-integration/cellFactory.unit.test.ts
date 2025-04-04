// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { generateCells } from './cellFactory';
import { splitLines } from '../../platform/common/helpers';
import { removeLinesFromFrontAndBack, stripComments } from '../../platform/common/utils';

const splitCode = (s: string) => splitLines(s, { removeEmptyEntries: false, trim: false });
const splitMarkdown = (s: string) => splitLines(s, { removeEmptyEntries: false, trim: false });
/* eslint-disable  */
suite('CellFactory', () => {
    test('parsing cells', () => {
        let cells = generateCells(undefined, '#%%\na=1\na', true);
        assert.equal(cells.length, 1, 'Simple cell, not right number found');
        //assert.equal(cells[0].value, 'a=1\na', 'Simple cell, not right contents');
        cells = generateCells(undefined, 'a=1\na', true);
        assert.equal(cells.length, 1, 'cell without marker, not right number found');
        assert.equal(cells[0].value, 'a=1\na', 'Simple cell, not right contents');
        cells = generateCells(undefined, '#%% [markdown]\na=1\na', true);
        assert.equal(cells.length, 2, 'Split cell, not right number found');
        cells = generateCells(undefined, '#%% [markdown]\n# #a=1\n#a', true);
        assert.equal(cells.length, 1, 'Markdown split wrong');
        assert.equal(cells[0].languageId, 'markdown', 'Markdown cell not generated');
        cells = generateCells(undefined, "#%% [markdown]\n'''\n# a\nb\n'''", true);
        assert.equal(cells.length, 1, 'Markdown cell multline failed');
        assert.equal(cells[0].languageId, 'markdown', 'Markdown cell not generated');
        assert.equal(splitMarkdown(cells[0].value).length, 3, 'Lines for markdown not emitted');
        cells = generateCells(undefined, '#%% [markdown]\n"""\n# a\nb\n"""', true);
        assert.equal(cells.length, 1, 'Markdown cell multline failed');
        assert.equal(cells[0].languageId, 'markdown', 'Markdown cell not generated');
        assert.equal(splitMarkdown(cells[0].value).length, 3, 'Lines for markdown not emitted');
        cells = generateCells(undefined, '#%% \n"""\n# a\nb\n"""', true);
        assert.equal(cells.length, 1, 'Code cell multline failed');
        assert.equal(cells[0].languageId, 'python', 'Code cell not generated');
        assert.equal(splitCode(cells[0].value).length, 4, 'Lines for cell not emitted');
        cells = generateCells(undefined, '#%% [markdown] \n"""# a\nb\n"""', true);
        assert.equal(cells.length, 1, 'Markdown cell multline failed');
        assert.equal(cells[0].languageId, 'markdown', 'Markdown cell not generated');
        assert.equal(splitMarkdown(cells[0].value).length, 3, 'Lines for cell not emitted');

        // eslint-disable-next-line no-multi-str
        const multilineCode = `#%%
myvar = """ # Lorem Ipsum
Lorem ipsum dolor sit amet, consectetur adipiscing elit.
Nullam eget varius ligula, eget fermentum mauris.
Cras ultrices, enim sit amet iaculis ornare, nisl nibh aliquet elit, sed ultrices velit ipsum dignissim nisl.
Nunc quis orci ante. Vivamus vel blandit velit.
Sed mattis dui diam, et blandit augue mattis vestibulum.
Suspendisse ornare interdum velit. Suspendisse potenti.
Morbi molestie lacinia sapien nec porttitor. Nam at vestibulum nisi.
"""`;
        // eslint-disable-next-line no-multi-str
        const multilineTwo = `#%%
""" # Lorem Ipsum
Lorem ipsum dolor sit amet, consectetur adipiscing elit.
Nullam eget varius ligula, eget fermentum mauris.
Cras ultrices, enim sit amet iaculis ornare, nisl nibh aliquet elit, sed ultrices velit ipsum dignissim nisl.
Nunc quis orci ante. Vivamus vel blandit velit.
Sed mattis dui diam, et blandit augue mattis vestibulum.
Suspendisse ornare interdum velit. Suspendisse potenti.
Morbi molestie lacinia sapien nec porttitor. Nam at vestibulum nisi.
""" print('bob')`;

        cells = generateCells(undefined, multilineCode, true);
        assert.equal(cells.length, 1, 'code cell multline failed');
        assert.equal(cells[0].languageId, 'python', 'Code cell not generated');
        assert.equal(splitCode(cells[0].value).length, 9, 'Lines for cell not emitted');
        cells = generateCells(undefined, multilineTwo, true);
        assert.equal(cells.length, 1, 'code cell multline failed');
        assert.equal(cells[0].languageId, 'python', 'Code cell not generated');
        assert.equal(splitCode(cells[0].value).length, 9, 'Lines for cell not emitted');
        // eslint-disable-next-line no-multi-str
        const multilineMarkdown = `#%% [markdown]
# ## Block of Interest
#
# ### Take a look
#
#
#   1. Item 1
#
#     - Item 1-a
#       1. Item 1-a-1
#          - Item 1-a-1-a
#          - Item 1-a-1-b
#       2. Item 1-a-2
#          - Item 1-a-2-a
#          - Item 1-a-2-b
#       3. Item 1-a-3
#          - Item 1-a-3-a
#          - Item 1-a-3-b
#          - Item 1-a-3-c
#
#   2. Item 2`;
        cells = generateCells(undefined, multilineMarkdown, true);
        assert.equal(cells.length, 1, 'markdown cell multline failed');
        assert.equal(cells[0].languageId, 'markdown', 'markdown cell not generated');
        assert.equal(splitMarkdown(cells[0].value).length, 39, 'Lines for cell not emitted');
        assert.equal(splitMarkdown(cells[0].value)[34], '          - Item 1-a-3-c', 'Lines for markdown not emitted');

        // eslint-disable-next-line no-multi-str
        const multilineQuoteWithOtherDelimiter = `#%% [markdown]
'''
### Take a look
  2. Item 2
""" Not a comment delimiter
'''
`;
        cells = generateCells(undefined, multilineQuoteWithOtherDelimiter, true);
        assert.equal(cells.length, 1, 'markdown cell multline failed');
        assert.equal(cells[0].languageId, 'markdown', 'markdown cell not generated');
        assert.equal(splitCode(cells[0].value).length, 5, 'Lines for cell not emitted');
        assert.equal(splitCode(cells[0].value)[4], '""" Not a comment delimiter', 'Lines for markdown not emitted');

        // eslint-disable-next-line no-multi-str
        const multilineQuoteInFunc = `#%%
import requests
def download(url, filename):
    """ utility function to download a file """
    response = requests.get(url, stream=True)
    with open(filename, "wb") as handle:
        for data in response.iter_content():
            handle.write(data)
`;
        cells = generateCells(undefined, multilineQuoteInFunc, true);
        assert.equal(cells.length, 1, 'cell multline failed');
        assert.equal(cells[0].languageId, 'python', 'code cell not generated');
        assert.equal(splitCode(cells[0].value).length, 8, 'Lines for cell not emitted');
        assert.equal(
            splitCode(cells[0].value)[2],
            '    """ utility function to download a file """',
            'Lines for cell not emitted'
        );

        // eslint-disable-next-line no-multi-str
        const multilineMarkdownWithCell = `#%% [markdown]
# # Define a simple class
class Pizza(object):
    def __init__(self, size, toppings, price, rating):
        self.size = size
        self.toppings = toppings
        self.price = price
        self.rating = rating
        `;

        cells = generateCells(undefined, multilineMarkdownWithCell, true);
        assert.equal(cells.length, 2, 'cell split failed');
        assert.equal(cells[0].languageId, 'markdown', 'markdown cell not generated');
        assert.equal(splitCode(cells[0].value).length, 1, 'Lines for markdown not emitted');
        assert.equal(cells[1].languageId, 'python', 'code cell not generated');
        assert.equal(splitCode(cells[1].value).length, 7, 'Lines for code not emitted');
        assert.equal(splitCode(cells[1].value)[3], '        self.toppings = toppings', 'Lines for cell not emitted');

        // Non comments tests
        let nonComments = stripComments(multilineCode);
        assert.ok(nonComments.startsWith('myvar = """ # Lorem Ipsum'), 'Variable set to multiline string not working');
        nonComments = stripComments(multilineTwo);
        assert.equal(nonComments, '', 'Multline comment is not being stripped');
        nonComments = stripComments(multilineQuoteInFunc);
        assert.equal(splitCode(nonComments).length, 8, 'Splitting quote in func wrong number of lines');
    });

    test('Line removal', () => {
        const entry1 = `# %% CELL

first line`;
        const expected1 = `# %% CELL

first line`;
        const entry2 = `# %% CELL

first line

`;
        const expected2 = `# %% CELL

first line`;
        const entry3 = `# %% CELL

first line

second line

`;
        const expected3 = `# %% CELL

first line

second line`;

        const entry4 = `

if (foo):
    print('stuff')

print('some more')

`;
        const expected4 = `if (foo):
    print('stuff')

print('some more')`;
        const entry5 = `
def test(input: str = "test"):
    """
    test function
    """
    print("hallo")


test("dude")
`;
        const expected5 = `def test(input: str = "test"):
    """
    test function
    """
    print("hallo")


test("dude")`;
        let removed = removeLinesFromFrontAndBack(entry1);
        assert.equal(removed, expected1);
        removed = removeLinesFromFrontAndBack(entry2);
        assert.equal(removed, expected2);
        removed = removeLinesFromFrontAndBack(entry3);
        assert.equal(removed, expected3);
        removed = removeLinesFromFrontAndBack(entry4);
        assert.equal(removed, expected4);
        removed = removeLinesFromFrontAndBack(entry5);
        assert.equal(removed, expected5);
    });
});

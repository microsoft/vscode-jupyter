// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { expect } from 'chai';
import { format } from './helpers';
import { fileToCommandArgument, toCommandArgument, trimQuotes } from './helpers';

// Defines a Mocha test suite to group tests of similar kind together
suite('String Extensions', () => {
    test('Should return empty string for empty arg', () => {
        const argTotest = '';
        expect(toCommandArgument(argTotest)).to.be.equal('');
    });
    test('Should quote an empty space', () => {
        const argTotest = ' ';
        expect(toCommandArgument(argTotest)).to.be.equal('" "');
    });
    test('Should not quote command arguments without spaces', () => {
        const argTotest = 'one.two.three';
        expect(toCommandArgument(argTotest)).to.be.equal(argTotest);
    });
    test('Should quote command arguments with spaces', () => {
        const argTotest = 'one two three';
        expect(toCommandArgument(argTotest)).to.be.equal(`"${argTotest}"`);
    });
    test('Should return empty string for empty path', () => {
        const fileToTest = '';
        expect(fileToCommandArgument(fileToTest)).to.be.equal('');
    });
    test('Should not quote file argument without spaces', () => {
        const fileToTest = 'users/test/one';
        expect(fileToCommandArgument(fileToTest)).to.be.equal(fileToTest);
    });
    test('Should quote file argument with spaces', () => {
        const fileToTest = 'one two three';
        expect(fileToCommandArgument(fileToTest)).to.be.equal(`"${fileToTest}"`);
    });
    test('Should replace all back slashes with forward slashes (irrespective of OS)', () => {
        const fileToTest = 'c:\\users\\user\\conda\\scripts\\python.exe';
        expect(fileToCommandArgument(fileToTest)).to.be.equal(fileToTest.replace(/\\/g, '/'));
    });
    test('Should replace all back slashes with forward slashes (irrespective of OS) and quoted when file has spaces', () => {
        const fileToTest = 'c:\\users\\user namne\\conda path\\scripts\\python.exe';
        expect(fileToCommandArgument(fileToTest)).to.be.equal(`"${fileToTest.replace(/\\/g, '/')}"`);
    });
    test('Should replace all back slashes with forward slashes (irrespective of OS) and quoted when file has spaces', () => {
        const fileToTest = 'c:\\users\\user namne\\conda path\\scripts\\python.exe';
        expect(fileToCommandArgument(fileToTest)).to.be.equal(`"${fileToTest.replace(/\\/g, '/')}"`);
    });
    test('Should leave string unchanged', () => {
        expect(format('something {0}')).to.be.equal('something {0}');
    });
    test('String should be formatted to contain first argument', () => {
        const formatString = 'something {0}';
        const expectedString = 'something one';
        expect(format(formatString, 'one')).to.be.equal(expectedString);
    });
    test('String should be formatted to contain first argument even with too many args', () => {
        const formatString = 'something {0}';
        const expectedString = 'something one';
        expect(format(formatString, 'one', 'two')).to.be.equal(expectedString);
    });
    test('String should be formatted to contain second argument', () => {
        const formatString = 'something {1}';
        const expectedString = 'something two';
        expect(format(formatString, 'one', 'two')).to.be.equal(expectedString);
    });
    test('String should be formatted to contain second argument even with too many args', () => {
        const formatString = 'something {1}';
        const expectedString = 'something two';
        expect(format(formatString, 'one', 'two', 'three')).to.be.equal(expectedString);
    });
    test('String should be formatted with multiple args', () => {
        const formatString = 'something {1}, {0}';
        const expectedString = 'something two, one';
        expect(format(formatString, 'one', 'two', 'three')).to.be.equal(expectedString);
    });
    test('String should remove quotes', () => {
        /* eslint-disable no-multi-str */
        const quotedString = `'foo is "bar" is foo' is bar'`;
        const quotedString2 = `foo is "bar" is foo' is bar'`;
        const quotedString3 = `foo is "bar" is foo' is bar`;
        const quotedString4 = `"foo is "bar" is foo' is bar"`;
        const expectedString = `foo is "bar" is foo' is bar`;
        expect(trimQuotes(quotedString)).to.be.equal(expectedString);
        expect(trimQuotes(quotedString2)).to.be.equal(expectedString);
        expect(trimQuotes(quotedString3)).to.be.equal(expectedString);
        expect(trimQuotes(quotedString4)).to.be.equal(expectedString);
    });

    // Tests for Windows paths with special characters (issue #16932)
    test('Should quote Windows paths with spaces in username', () => {
        const pathToTest = 'C:\\Users\\John Smith\\AppData\\Local\\env\\python.exe';
        expect(toCommandArgument(pathToTest)).to.be.equal(`"${pathToTest}"`);
    });
    test('Should quote Windows paths with parentheses in username', () => {
        const pathToTest = 'C:\\Users\\John(Contractor)\\AppData\\Local\\env\\python.exe';
        expect(toCommandArgument(pathToTest)).to.be.equal(`"${pathToTest}"`);
    });
    test('Should quote Windows paths with both spaces and parentheses', () => {
        const pathToTest = 'C:\\Users\\John Smith (Contractor)\\AppData\\Local\\env\\python.exe';
        expect(toCommandArgument(pathToTest)).to.be.equal(`"${pathToTest}"`);
    });
    test('Should quote file paths with special characters and normalize slashes', () => {
        const pathToTest = 'C:\\Users\\John(Contractor)\\AppData\\Local\\env\\python.exe';
        const expectedPath = 'C:/Users/John(Contractor)/AppData/Local/env/python.exe';
        expect(fileToCommandArgument(pathToTest)).to.be.equal(`"${expectedPath}"`);
    });
    test('Should handle already quoted paths correctly', () => {
        const pathToTest = '"C:\\Users\\John(Contractor)\\AppData\\Local\\env\\python.exe"';
        // toCommandArgument should not double-quote if already quoted
        expect(toCommandArgument(pathToTest)).to.be.equal(pathToTest);
    });
    test('Should quote paths with other shell metacharacters', () => {
        const pathWithAmpersand = 'C:\\Users\\John&Jane\\python.exe';
        const pathWithPipe = 'C:\\Users\\John|Jane\\python.exe';
        const pathWithLessThan = 'C:\\Users\\John<Jane\\python.exe';
        const pathWithGreaterThan = 'C:\\Users\\John>Jane\\python.exe';
        const pathWithCaret = 'C:\\Users\\John^Jane\\python.exe';

        expect(toCommandArgument(pathWithAmpersand)).to.be.equal(`"${pathWithAmpersand}"`);
        expect(toCommandArgument(pathWithPipe)).to.be.equal(`"${pathWithPipe}"`);
        expect(toCommandArgument(pathWithLessThan)).to.be.equal(`"${pathWithLessThan}"`);
        expect(toCommandArgument(pathWithGreaterThan)).to.be.equal(`"${pathWithGreaterThan}"`);
        expect(toCommandArgument(pathWithCaret)).to.be.equal(`"${pathWithCaret}"`);
    });
    test('Should not quote paths without special characters', () => {
        const normalPath = 'C:\\Users\\JohnSmith\\AppData\\Local\\env\\python.exe';
        expect(toCommandArgument(normalPath)).to.be.equal(normalPath);
    });
});

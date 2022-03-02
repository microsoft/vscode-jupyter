// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/* eslint-disable  */
import * as os from 'os';
import { expect } from 'chai';
import * as path from 'path';
import * as TypeMoq from 'typemoq';
import { Executables, FileSystemPaths, FileSystemPathUtils } from './fs-paths';
import { getNamesAndValues } from '../../../test/utils/enum';
import { OSType } from '../utils/platform';
import { IS_WINDOWS } from './constants';

interface IUtilsDeps {
    // executables
    delimiter: string;
    envVar: string;
    // paths
    readonly sep: string;
    join(...filenames: string[]): string;
    dirname(filename: string): string;
    basename(filename: string, suffix?: string): string;
    normalize(filename: string): string;
    normCase(filename: string): string;
    // node "path"
    relative(relpath: string, rootpath: string): string;
}

suite('FileSystem - Path Utils', () => {
    let deps: TypeMoq.IMock<IUtilsDeps>;
    let utils: FileSystemPathUtils;
    setup(() => {
        deps = TypeMoq.Mock.ofType<IUtilsDeps>(undefined, TypeMoq.MockBehavior.Strict);
        utils = new FileSystemPathUtils(
            'my-home',
            // It's simpler to just use one mock for all 3 dependencies.
            deps.object,
            deps.object,
            deps.object
        );
    });
    function verifyAll() {
        deps.verifyAll();
    }

    suite('path-related', () => {
        const caseInsensitive = [OSType.Windows];

        suite('arePathsSame', () => {
            getNamesAndValues<OSType>(OSType).forEach((item) => {
                const osType = item.value;

                function setNormCase(filename: string, numCalls = 1): string {
                    let norm = filename;
                    if (osType === OSType.Windows) {
                        norm = path.normalize(filename).toUpperCase();
                    }
                    deps.setup((d) => d.normCase(filename))
                        .returns(() => norm)
                        .verifiable(TypeMoq.Times.exactly(numCalls));
                    return filename;
                }

                [
                    // no upper-case
                    'c:\\users\\peter smith\\my documents\\test.txt',
                    // some upper-case
                    'c:\\USERS\\Peter Smith\\my documents\\test.TXT'
                ].forEach((path1) => {
                    test(`True if paths are identical (type: ${item.name}) - ${path1}`, () => {
                        path1 = setNormCase(path1, 2);

                        const areSame = utils.arePathsSame(path1, path1);

                        expect(areSame).to.be.equal(true, 'file paths do not match');
                        verifyAll();
                    });
                });

                test(`False if paths are completely different (type: ${item.name})`, () => {
                    const path1 = setNormCase('c:\\users\\Peter Smith\\my documents\\test.txt');
                    const path2 = setNormCase('c:\\users\\Peter Smith\\my documents\\test.exe');

                    const areSame = utils.arePathsSame(path1, path2);

                    expect(areSame).to.be.equal(false, 'file paths do not match');
                    verifyAll();
                });

                if (caseInsensitive.includes(osType)) {
                    test(`True if paths only differ by case (type: ${item.name})`, () => {
                        const path1 = setNormCase('c:\\users\\Peter Smith\\my documents\\test.txt');
                        const path2 = setNormCase('c:\\USERS\\Peter Smith\\my documents\\test.TXT');

                        const areSame = utils.arePathsSame(path1, path2);

                        expect(areSame).to.be.equal(true, 'file paths match');
                        verifyAll();
                    });
                } else {
                    test(`False if paths only differ by case (type: ${item.name})`, () => {
                        const path1 = setNormCase('c:\\users\\Peter Smith\\my documents\\test.txt');
                        const path2 = setNormCase('c:\\USERS\\Peter Smith\\my documents\\test.TXT');

                        const areSame = utils.arePathsSame(path1, path2);

                        expect(areSame).to.be.equal(false, 'file paths do not match');
                        verifyAll();
                    });
                }

                // Missing tests:
                // * exercize normalization
            });
        });
    });
});

suite('FileSystem - Paths', () => {
    let paths: FileSystemPaths;
    setup(() => {
        paths = FileSystemPaths.withDefaults();
    });

    suite('separator', () => {
        test('matches node', () => {
            expect(paths.sep).to.be.equal(path.sep);
        });
    });

    suite('dirname', () => {
        test('with dirname', () => {
            const filename = path.join('spam', 'eggs', 'spam.py');
            const expected = path.join('spam', 'eggs');

            const basename = paths.dirname(filename);

            expect(basename).to.equal(expected);
        });

        test('without dirname', () => {
            const filename = 'spam.py';
            const expected = '.';

            const basename = paths.dirname(filename);

            expect(basename).to.equal(expected);
        });
    });

    suite('basename', () => {
        test('with dirname', () => {
            const filename = path.join('spam', 'eggs', 'spam.py');
            const expected = 'spam.py';

            const basename = paths.basename(filename);

            expect(basename).to.equal(expected);
        });

        test('without dirname', () => {
            const filename = 'spam.py';
            const expected = filename;

            const basename = paths.basename(filename);

            expect(basename).to.equal(expected);
        });
    });

    suite('normalize', () => {
        test('noop', () => {
            const filename = path.join('spam', 'eggs', 'spam.py');
            const expected = filename;

            const norm = paths.normalize(filename);

            expect(norm).to.equal(expected);
        });

        test('pathological', () => {
            const filename = path.join(path.sep, 'spam', '..', 'eggs', '.', 'spam.py');
            const expected = path.join(path.sep, 'eggs', 'spam.py');

            const norm = paths.normalize(filename);

            expect(norm).to.equal(expected);
        });

        test('relative to CWD', () => {
            const filename = path.join('..', 'spam', 'eggs', 'spam.py');
            const expected = filename;

            const norm = paths.normalize(filename);

            expect(norm).to.equal(expected);
        });

        test('parent of root fails', () => {
            const filename = path.join(path.sep, '..');
            const expected = filename;

            const norm = paths.normalize(filename);

            expect(norm).to.equal(expected);
        });
    });

    suite('join', () => {
        test('parts get joined by path.sep', () => {
            const expected = path.join('x', 'y', 'z', 'spam.py');

            const result = paths.join(
                'x',
                // Be explicit here to ensure our assumptions are correct
                // about the relationship between "sep" and "join()".
                path.sep === '\\' ? 'y\\z' : 'y/z',
                'spam.py'
            );

            expect(result).to.equal(expected);
        });
    });

    suite('normCase', () => {
        test('forward-slash', () => {
            const filename = 'X/Y/Z/SPAM.PY';
            const expected = IS_WINDOWS ? 'X\\Y\\Z\\SPAM.PY' : filename;

            const result = paths.normCase(filename);

            expect(result).to.equal(expected);
        });

        test('backslash is not changed', () => {
            const filename = 'X\\Y\\Z\\SPAM.PY';
            const expected = filename;

            const result = paths.normCase(filename);

            expect(result).to.equal(expected);
        });

        test('lower-case', () => {
            const filename = 'x\\y\\z\\spam.py';
            const expected = IS_WINDOWS ? 'X\\Y\\Z\\SPAM.PY' : filename;

            const result = paths.normCase(filename);

            expect(result).to.equal(expected);
        });

        test('upper-case stays upper-case', () => {
            const filename = 'X\\Y\\Z\\SPAM.PY';
            const expected = 'X\\Y\\Z\\SPAM.PY';

            const result = paths.normCase(filename);

            expect(result).to.equal(expected);
        });
    });
});

suite('FileSystem - Executables', () => {
    let execs: Executables;
    setup(() => {
        execs = Executables.withDefaults();
    });

    suite('delimiter', () => {
        test('matches node', () => {
            expect(execs.delimiter).to.be.equal(path.delimiter);
        });
    });

    suite('getPathVariableName', () => {
        const expected = IS_WINDOWS ? 'Path' : 'PATH';

        test('matches platform', () => {
            expect(execs.envVar).to.equal(expected);
        });
    });
});

suite('FileSystem - Path Utils', () => {
    let utils: FileSystemPathUtils;
    setup(() => {
        utils = FileSystemPathUtils.withDefaults();
    });

    suite('arePathsSame', () => {
        test('identical', () => {
            const filename = 'x/y/z/spam.py';

            const result = utils.arePathsSame(filename, filename);

            expect(result).to.equal(true);
        });

        test('not the same', () => {
            const file1 = 'x/y/z/spam.py';
            const file2 = 'a/b/c/spam.py';

            const result = utils.arePathsSame(file1, file2);

            expect(result).to.equal(false);
        });

        test('with different separators', () => {
            const file1 = 'x/y/z/spam.py';
            const file2 = 'x\\y\\z\\spam.py';
            const expected = IS_WINDOWS;

            const result = utils.arePathsSame(file1, file2);

            expect(result).to.equal(expected);
        });

        test('with different case', () => {
            const file1 = 'x/y/z/spam.py';
            const file2 = 'x/Y/z/Spam.py';
            const expected = IS_WINDOWS;

            const result = utils.arePathsSame(file1, file2);

            expect(result).to.equal(expected);
        });
    });

    suite('getDisplayName', () => {
        const relname = path.join('spam', 'eggs', 'spam.py');
        const cwd = path.resolve(path.sep, 'x', 'y', 'z');

        test('filename matches CWD', () => {
            const filename = path.join(cwd, relname);
            const expected = `.${path.sep}${relname}`;

            const display = utils.getDisplayName(filename, cwd);

            expect(display).to.equal(expected);
        });

        test('filename does not match CWD', () => {
            const filename = path.resolve(cwd, '..', relname);
            const expected = filename;

            const display = utils.getDisplayName(filename, cwd);

            expect(display).to.equal(expected);
        });

        test('filename matches home dir, not cwd', () => {
            const filename = path.join(os.homedir(), relname);
            const expected = path.join('~', relname);

            const display = utils.getDisplayName(filename, cwd);

            expect(display).to.equal(expected);
        });

        test('filename matches home dir', () => {
            const filename = path.join(os.homedir(), relname);
            const expected = path.join('~', relname);

            const display = utils.getDisplayName(filename);

            expect(display).to.equal(expected);
        });

        test('filename does not match home dir', () => {
            const filename = relname;
            const expected = filename;

            const display = utils.getDisplayName(filename);

            expect(display).to.equal(expected);
        });
    });
});

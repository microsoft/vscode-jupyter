// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const common = require('../common');
function replaceModule(prefixRegex, prefix, contents, moduleName, quotes) {
    const stringToSearch = `${prefixRegex}${quotes}${moduleName}${quotes}`;
    const stringToReplaceWith = `${prefix}${quotes}./node_modules/${moduleName}${quotes}`;
    return contents.replace(new RegExp(stringToSearch, 'gm'), stringToReplaceWith);
}
// tslint:disable:no-default-export no-invalid-this
function default_1(source) {
    common.nodeModulesToReplacePaths.forEach((moduleName) => {
        if (source.indexOf(moduleName) > 0) {
            source = replaceModule('import\\(', 'import(', source, moduleName, '"');
            source = replaceModule('import\\(', 'import(', source, moduleName, "'");
            source = replaceModule('require\\(', 'require(', source, moduleName, '"');
            source = replaceModule('require\\(', 'require(', source, moduleName, "'");
            source = replaceModule('from ', 'from ', source, moduleName, '"');
            source = replaceModule('from ', 'from ', source, moduleName, "'");
        }
    });
    return source;
}
exports.default = default_1;

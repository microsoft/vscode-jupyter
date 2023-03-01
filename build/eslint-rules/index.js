// Based this logic on this file here: https://github.com/import-js/eslint-plugin-import/blob/main/src/rules/no-nodejs-modules.js
// Also this is a useful reference for creating new rules (describes API of stuff like MemberReference)
// https://btmills.github.io/parserapi/
const importType = require('eslint-plugin-import/lib/core/importType');
const moduleVisitor = require('eslint-module-utils/moduleVisitor');
const path = require('path');
const testFolder = path.join('src', 'test');

function reportIfMissing(context, node, allowed, name) {
    const fileName = context.getFilename();
    if (
        allowed.indexOf(name) === -1 &&
        importType.default(name, context) === 'builtin' &&
        !fileName.endsWith('.node.ts') &&
        !fileName.endsWith('.unit.test.ts') &&
        !fileName.includes(testFolder)
    ) {
        context.report(node, `Do not import Node.js builtin module "${name}"`);
    }
    // Special case 'path'. Force everything to use the custom path
    if (importType.default(name, context) === 'builtin' && name === 'path') {
        context.report(node, `Do not import path builtin module. Use the custom vscode-path instead.`);
    }
}

module.exports = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Check for node.js builtins in non-node files',
            category: 'import'
        },
        schema: [
            {
                type: 'object',
                properties: {
                    allow: {
                        type: 'array',
                        uniqueItems: true,
                        items: {
                            type: 'string'
                        }
                    }
                },
                additionalProperties: false
            }
        ]
    },
    rules: {
        'node-imports': {
            create: function (context) {
                const options = context.options[0] || {};
                const allowed = options.allow || [];

                return moduleVisitor.default(
                    (source, node) => {
                        reportIfMissing(context, node, allowed, source.value);
                    },
                    { commonjs: true }
                );
            }
        },
        'dont-use-process': {
            create: function (context) {
                return {
                    MemberExpression(node) {
                        const objectName = node.object.name;
                        const propertyName = node.property.name;
                        const fileName = context.getFilename();

                        if (
                            !fileName.endsWith('.node.ts') &&
                            objectName === 'process' &&
                            !node.computed &&
                            propertyName &&
                            propertyName === 'env'
                        ) {
                            context.report(node, `process.env is not allowed in anything but .node files`);
                        }
                    }
                };
            }
        },
        'dont-use-fspath': {
            create: function (context) {
                return {
                    MemberExpression(node) {
                        const objectName = node.object.name;
                        const propertyName = node.property.name;
                        const fileName = context.getFilename();

                        if (
                            !fileName.endsWith('.node.ts') &&
                            !fileName.endsWith('.test.ts') &&
                            !node.computed &&
                            propertyName &&
                            propertyName === 'fsPath'
                        ) {
                            context.report(node, `fsPath is not allowed in anything but .node files`);
                        }
                    }
                };
            }
        },
        'dont-use-filename': {
            create: function (context) {
                return {
                    Identifier(node) {
                        const objectName = node.name;
                        const fileName = context.getFilename();

                        if (
                            !fileName.endsWith('.node.ts') &&
                            !fileName.endsWith('.test.ts') &&
                            !node.computed &&
                            objectName &&
                            (objectName === '__dirname' || objectName === '__filename')
                        ) {
                            context.report(node, `${objectName} is not allowed in anything but .node files`);
                        }
                    }
                };
            }
        }
    }
};

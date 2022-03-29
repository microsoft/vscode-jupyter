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
        !fileName.includes(testFolder)
    ) {
        context.report(node, `Do not import Node.js builtin module "${name}"`);
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
        }
    }
};

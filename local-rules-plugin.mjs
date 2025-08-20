// Local rules plugin for flat ESLint config
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import the legacy local rules module
const localRulesModule = await import(join(__dirname, 'build/eslint-rules/index.js'));

// Create a proper plugin object for flat config
export const localRulesPlugin = {
    meta: {
        name: 'local-rules',
        version: '1.0.0'
    },
    rules: {
        'node-imports': {
            meta: localRulesModule.default.meta,
            create: localRulesModule.default.rules['node-imports'].create
        },
        'dont-use-process': {
            meta: {
                type: 'problem',
                docs: {
                    description: 'Disallow process.env in non-node files',
                    category: 'Best Practices'
                }
            },
            create: localRulesModule.default.rules['dont-use-process'].create
        },
        'dont-use-fspath': {
            meta: {
                type: 'problem',
                docs: {
                    description: 'Disallow fsPath in non-node files',
                    category: 'Best Practices'
                }
            },
            create: localRulesModule.default.rules['dont-use-fspath'].create
        },
        'dont-use-filename': {
            meta: {
                type: 'problem',
                docs: {
                    description: 'Disallow __dirname and __filename in non-node files',
                    category: 'Best Practices'
                }
            },
            create: localRulesModule.default.rules['dont-use-filename'].create
        }
    }
};

export default localRulesPlugin;
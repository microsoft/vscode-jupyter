'use strict';
// var __importDefault =
//     (this && this.__importDefault) ||
//     function (mod) {
//         return mod && mod.__esModule ? mod : { default: mod };
//     };
// Object.defineProperty(exports, '__esModule', { value: true });
// exports.activate = exports.truncatedArrayOfString = void 0;
// require('./styles.css');
const activate = (context) => {
    // const latestContext = context;
    // if (context.postMessage && context.onDidReceiveMessage) {
    //     context.postMessage({
    //         type: 2
    //     });
    // }
    return {
        renderOutputItem: async (outputItem, element) => {
            const container = document.createElement('div');
            container.innerHTML =
                'The cell completed execution while this notebook was closed, <a href="#">click to refresh</> the outupts';
            element.appendChild(container);
            container.addEventListener('click', (e) => {
                // const a = e.target;
                // if (a && a.href && handleInnerClick(a, context)) {
                e.stopImmediatePropagation();
                e.preventDefault();
                // }
                context.postMessage({
                    type: 2
                });
            });
        }
    };
};
export { activate };
//# sourceMappingURL=index.js.map

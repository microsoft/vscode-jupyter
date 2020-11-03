const { KernelMessage, Kernel, KernelManager, ServerConnection, ContentsManager } = require('@jupyterlab/services');
const nodeFetch = require('node-fetch');
const serverSettings = ServerConnection.makeSettings({
    baseUrl: 'http://localhost:8888/',
    token: '77e1d5e04a833b9724013cc22b974ba1f19d742a834ee17e',
    init: { cache: 'no-store', credentials: 'same-origin' },
    Request: nodeFetch.Request,
    fetch: nodeFetch.default,
    Headers: nodeFetch.Headers
});
// Get a list of available kernels and connect to one.
// Kernel.getSpecs(settings).then((kernelModels) => {
//     // const kernel = Kernel.connectTo(kernelModels[0]);
//     // console.log(kernel.name);
//     // console.log(kernelModels);
// });
// settings.fetch(`${settings.baseUrl}api/status`).then(async (resp) => {
//     console.log(resp.status);
//     console.log(await resp.text());
// });
// // settings.fetch(`api/status`).then(async (resp) => {
// //     console.log(resp.status);
// //     console.log(await resp.text());
// // });
const kernelManager = new KernelManager({ serverSettings });
const contentManager = new ContentsManager({ serverSettings });
contentManager.get('').then((result) => {
    console.log(result);
});

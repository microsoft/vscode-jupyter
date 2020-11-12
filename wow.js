const { ContentsManager, ServerConnection } = require('@jupyterlab/services');

async function main() {
    const settings = ServerConnection.makeSettings({ baseUrl: 'http://localhost:9193/', token: '' });
    const contentManager = new ContentsManager({ serverSettings: settings });
    const model = await contentManager.newUntitled({ type: 'notebook', path: '/tmp', });
    console.log(model);
}
main()
    .then(() => console.log('done'))
    .catch((ex) => console.error(ex));

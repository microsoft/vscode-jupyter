async function sleep(n) {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            resolve();
        }, n);
    });
}

async function generateHash() {
    console.log('generating hash...');
    await sleep(100);
    return 'hash';
}

async function main() {
    const map = new Map();
    map.set(1, 'one');

    const hash = map.get(2) || (await generateHash());
    console.log('generated hash:', hash);
}
main();

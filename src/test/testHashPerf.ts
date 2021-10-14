import * as crypto from 'crypto';
import * as path from 'path';
import { getInterpreterHash } from '../client/pythonEnvironments/info/interpreter';

function doHash(p: string) {
    return getInterpreterHash({ path: p });
}

function trivial(p: string) {
    return p.length;
}

function randomFile() {
    return crypto.randomBytes(20).toString('hex');
}

function randomPath() {
    return path.join(randomFile(), randomFile(), randomFile(), randomFile());
}

function highPerfTime() {
    var hrTime = process.hrtime();
    return hrTime[0] * 1000000 + hrTime[1] / 1000;
}

const randomPaths = [];
for (let i = 0; i < 1000; i++) {
    randomPaths.push(randomPath());
}

// Do something trivial to compare doing nothing
let startTime = highPerfTime();
let lengths = [];
for (let i = 0; i < randomPaths.length; i++) {
    // Do something trivial
    lengths.push(trivial(randomPaths[i]));
}
let endTime = highPerfTime();
console.log(`Trivial loop time: ${endTime - startTime}`);
console.log(`Trivial average time: ${(endTime - startTime) / 1000}`);

startTime = highPerfTime();
lengths = [];
// Run through them all and print statistics
for (let i = 0; i < randomPaths.length; i++) {
    lengths.push(doHash(randomPaths[i]));
}
endTime = highPerfTime();

console.log(`Hash loop time: ${endTime - startTime}`);
console.log(`Hash average time: ${(endTime - startTime) / 1000}`);

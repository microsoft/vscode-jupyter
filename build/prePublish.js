// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

"use strict";

const path = require("path");
const { download } = require("./download");
const fs = require("fs");

const VERSION = "6.0.0-beta.16.5";

/**
 * Downloads the ZMQ binaries.
 */
async function downloadZMQ() {
  const destination = path.join(__dirname, "..", "prebuilds");
  if (fs.existsSync(path.dirname(destination))) {
    fs.rmSync(destination, { force: true, recursive: true });
  }
  fs.mkdirSync(destination);
  const downloadOptions = {
    version: VERSION,
    token: process.env["GITHUB_TOKEN"],
    destination,
    force: true,
  };
  await download(downloadOptions);
}

module.exports.downloadZMQ = downloadZMQ;

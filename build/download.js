// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// @ts-check
"use strict";

const path = require("path");
const fs = require("fs");
const util = require("util");

const fsCopyFile = util.promisify(fs.copyFile);
const fsMkdir = util.promisify(fs.mkdir);
const fsReadDir = util.promisify(fs.readdir);

/**
 * @param {string[]} assets
 * @param {{ 'win32'?: ('x64' | 'ia32' | 'arm64')[]; 'linux'?: ('arm' | 'x64' | 'arm64' | 'armhf')[]; 'darwin'?: ('x64' | 'arm64')[]; 'alpine'?: ('x64' | 'arm64')[] }} platformOptions If not provided, then downloads all binaries for all platforms and archs.
 * @return {string[]} List of assets to copy
 */
function getAssetsToCopy(assets, platformOptions) {
  return assets.filter((asset) => {
    if (!platformOptions) {
      return true;
    }
    if (Object.keys(platformOptions).length === 0) {
      return true;
    }

    if (platformOptions.alpine) {
      const archs = platformOptions.alpine;
      if (archs.length) {
        return (
          asset.includes("linux") &&
          archs.some((arch) => asset.includes(arch)) &&
          asset.includes("musl")
        );
      } else {
        return asset.includes("linux") && asset.includes("musl");
      }
    } else if (platformOptions.darwin) {
      const archs = platformOptions.darwin;
      if (archs.length) {
        return (
          asset.includes("darwin") && archs.some((arch) => asset.includes(arch))
        );
      } else {
        return asset.includes("darwin");
      }
    } else if (platformOptions.linux) {
      const archs = platformOptions.linux;
      if (archs.length) {
        return (
          asset.includes("linux") && archs.some((arch) => asset.includes(arch))
        );
      } else {
        return asset.includes("linux");
      }
    } else if (platformOptions.win32) {
      const archs = platformOptions.win32;
      if (archs.length) {
        return (
          asset.includes("win32") && archs.some((arch) => asset.includes(arch))
        );
      } else {
        return asset.includes("win32");
      }
    } else {
      return true;
    }
  });
}

/**
 * @param {{ destination: string; }} opts
 * @param {{ 'win32'?: ('x64' | 'ia32' | 'arm64')[]; 'linux'?: ('arm' | 'x64' | 'arm64' | 'armhf')[]; 'darwin'?: ('x64' | 'arm64')[]; 'alpine'?: ('x64' | 'arm64')[] }} platformOptions If not provided, then downloads all binaries for all platforms and archs.
 * @return {Promise<void>} File path to the downloaded asset
 */
module.exports.download = async (opts, platformOptions) => {
  if (!opts.destination) {
    return Promise.reject(new Error("Missing destination"));
  }
  if (platformOptions && Object.keys(platformOptions).length === 0) {
    return Promise.reject(new Error("Missing platformOptions[platform]"));
  }

  // If we have files in prebuilds folder, use them
  const prebuildRoot = path.join(__dirname, "..", "prebuilds");
  const prebuildFolders = await fsReadDir(prebuildRoot);
  if (prebuildFolders.length === 0) {
    throw new Error("no prebuilds folder in vscode-zeromq");
  }

  const prebuildFoldersToCopy = getAssetsToCopy(
    prebuildFolders,
    platformOptions
  );

  const foldersToCreate = new Set();
  prebuildFoldersToCopy.forEach((folder) => {
    foldersToCreate.add(path.join(opts.destination, folder));
  });
  console.log(
    "Creating destination folders for prebuilds: ",
    Array.from(foldersToCreate)
  );
  await Promise.all(
    Array.from(foldersToCreate).map((folder) =>
      fsMkdir(folder, { recursive: true })
    )
  );

  const filesToCopy = [];
  await Promise.all(
    prebuildFoldersToCopy.map(async (prebuildFolder) => {
      const files = await fsReadDir(path.join(prebuildRoot, prebuildFolder));
      filesToCopy.push(...files.map((file) => path.join(prebuildFolder, file)));
    })
  );
  // Copy the files across.
  await Promise.all(
    filesToCopy.map((file) => {
      console.info(
        `Copying file ${file} from ${prebuildRoot} to ${opts.destination}`
      );
      return fsCopyFile(
        path.join(prebuildRoot, file),
        path.join(opts.destination, file)
      );
    })
  );
};

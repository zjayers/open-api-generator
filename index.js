#!/usr/bin/env node
const path = require('path');
const makeDir = require('make-dir');
const moveFile = require('move-file');
const npmAddScript = require('npm-add-script')
const exec = require('await-exec')
const fs = require('fs');
const fsPromises = require('fs').promises;
const argv = require('yargs/yargs')(process.argv.slice(2)).argv;
const lineReader = require('line-reader');
const util = require('util');
const readLinesAsync = util.promisify(lineReader.eachLine);

(async () => {

    console.info("Starting OpenAPI Stub Generation...");

    // Check If a file was passed in via the '-f' flag
    if (!argv.f) {
        console.error("No file was passed in. Please pass in an OpenAPI file with the '-f' flag.")
        return;
    }

    const fileName = argv.f;

    // Check if file exists
    if (!fs.existsSync(fileName)) {
        console.error(`Invalid file was passed in. Could not find ${fileName}. Please pass in an OpenAPI file with the '-f' flag.`)
        return;
    }

    // Check Extensions
    const extension = path.extname(fileName);
    const openApiExtensions = new Set();
    openApiExtensions.add("yaml");
    openApiExtensions.add("yml");
    openApiExtensions.add("json");

    // Check if file is of the correct extension
    if (!openApiExtensions.has(extension.substring(1))) {
        console.error(`Filetype ${extension} is not a valid OpenAPI file type. Please pass in an OpenAPI file with the '-f' flag.`)
        return;
    }

    // Get Version Number
    console.info("Getting Version Number...");
    let versionNumber = "0";

    await readLinesAsync(fileName, (line) => {
        if (line.includes('version')) {
            versionNumber = 'v' + line.replace('version:', '').replaceAll('\'', "").replaceAll('.', '-').trim();
            console.info(`Version Number Found: ${versionNumber}`);
            return false; // stop reading
        }
    });

    if (versionNumber === "0") {
        console.error(`No version number found. Aborting!`)
        return;
    }

    const fileNameWithVersion = fileName.replace(extension, `-${versionNumber}${extension}`);
    const fileNameWithVersionNoExtension = fileNameWithVersion.replace(extension, '');

    // Check if file exists
    if (!fs.existsSync(fileName)) {
        console.error(`Invalid file was passed in. Could not find ${fileName}. Please pass in an OpenAPI file with the '-f' flag.`)
        return;
    }

    // Check the directory doesn't exists
    if (fs.existsSync(`./api-spec/${versionNumber}`)) {
        console.error(`Version ${versionNumber} already exists. Please update your OpenAPI file's version number and try again.`)
        return;
    }

    // Make Directories
    console.info("Making Directories...");
    await Promise.all([
        makeDir(`api-spec/${versionNumber}/open-api`),
        makeDir(`api-spec/${versionNumber}/swagger-stub`),
        makeDir(`api-spec/${versionNumber}/html-docs`)])

    await exec('npm init -y');

    console.info("Adding NPM Scripts...");
    npmAddScript({ key: "make:swagger", value: `make-dir swagger-stub` })
    npmAddScript({ key: "generate:swagger", value: `npm run delete:swagger && npm run make:swagger && openapi-generator-cli generate -i open-api/${fileNameWithVersion} -g nodejs-express-server -o swagger-stub --additional-properties=serverPort=9999` })
    npmAddScript({ key: "delete:swagger", value: `rimraf swagger-stub` })

    npmAddScript({ key: "make:docs", value: `make-dir html-docs` })
    npmAddScript({ key: "delete:docs", value: `rimraf html-docs` })
    npmAddScript({ key: "generate:docs", value: `npm run delete:docs && npm run make:docs && openapi-generator-cli generate -i open-api/${fileNameWithVersion} -g html2 -o html-docs` })

    npmAddScript({ key: "make:markdown", value: `make-dir markdown-docs` })
    npmAddScript({ key: "generate:markdown", value: `npm run delete:markdown && npm run make:markdown && widdershins open-api/${fileNameWithVersion} -o markdown-docs/${fileNameWithVersionNoExtension}_dirty.md --omitHeader --expandBody --language_tabs 'javascript:JavaScript' && npm run markdown:prepare` })
    npmAddScript({ key: "delete:markdown", value: `rimraf markdown-docs` })

    npmAddScript({ key: "markdown:tidy", value: `tidy-markdown < ./markdown-docs/${fileNameWithVersionNoExtension}_dirty.md > ./markdown-docs/${fileNameWithVersionNoExtension}.md` })
    npmAddScript({ key: "markdown:remove-comments", value: `replace-in-files --string=\"<!-- backwards compatibility -->\" "<!-- Generator: Widdershins v4.0.1 -->" --replacement='' ./markdown-docs/${fileNameWithVersionNoExtension}.md` })
    npmAddScript({ key: "markdown:remove-empty-links", value: `replace-in-files --string=\"[]()\" --replacement='' markdown-docs/${fileNameWithVersionNoExtension}.md` })
    npmAddScript({ key: "markdown:remove-aside", value: `replace-in-files --string=\"</aside>\" --replacement='**' markdown-docs/${fileNameWithVersionNoExtension}.md` })
    npmAddScript({ key: "markdown:replace-warnings", value: `replace-in-files --regex=\"<aside[^>]*>\" --replacement='**' markdown-docs/${fileNameWithVersionNoExtension}.md` })
    npmAddScript({ key: "markdown:remove-dirty", value: `rimraf markdown-docs/${fileNameWithVersionNoExtension}_dirty.md` })
    npmAddScript({ key: "markdown:prepare", value: `npm run markdown:tidy && npm run markdown:remove-comments && npm run markdown:remove-empty-links && npm run markdown:remove-aside && npm run markdown:replace-warnings && npm run markdown:remove-dirty` })

    npmAddScript({ key: "generate", value: 'npm run generate:swagger && npm run generate:docs && npm run generate:markdown' })
    npmAddScript({ key: "start:swagger", value: `cd swagger-stub && npm start` })
    npmAddScript({ key: "start:prism", value: `prism mock open-api/${fileNameWithVersion}` })
    npmAddScript({ key: "start:browser", value: 'wait-on http://localhost:9999/api-docs && start http://localhost:9999/api-docs\"' })
    npmAddScript({ key: "start", value: "concurrently -n swagger,prism,browser \"npm run start:swagger\" \"npm run start:prism\" \"npm run start:browser\"" })

    console.info("Moving / Copying Files...");
    await fsPromises.copyFile(fileName, `api-spec/${versionNumber}/open-api/${fileName}`);
    await fsPromises.rename(`api-spec/${versionNumber}/ozpen-api/${fileName}`, `api-spec/${versionNumber}/open-api/${fileNameWithVersion}`)
    await moveFile('package.json', `api-spec/${versionNumber}/package.json`);

    console.info("Installing NPM Modules. Please Wait...");
    await exec(`npm --prefix api-spec/${versionNumber} i @openapitools/openapi-generator-cli@2.2.8 @stoplight/prism-cli@4.2.3 concurrently@6.1.0 rimraf@3.0.2 make-dir-cli@3.0.0 wait-on@5.3.0 replace-in-files-cli@1.0.0 tidy-markdown@2.0.3 widdershins@4.0.1`);

    console.info("Generating Server Stub. Please Wait...");
    await exec(`npm --prefix api-spec/${versionNumber} run generate:swagger`);

    console.info("Generating HTML Documentation. Please Wait...");
    await exec(`npm --prefix api-spec/${versionNumber} run generate:docs`);

    console.info("Generating Markdown Documentation. Please Wait...");
    await exec(`npm --prefix api-spec/${versionNumber} run generate:markdown`);

    console.info("Cleaning Up...");
    await moveFile('openapitools.json', 'api-spec/openapitools.json');

    console.info(`Stub Generation Complete!\n Run 'npm --prefix api-spec/${versionNumber} start' to start the API mocking and Swagger documentation servers.\n`);

})();


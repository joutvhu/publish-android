import * as core from '@actions/core';
import { androidpublisher, androidpublisher_v3, auth } from '@googleapis/androidpublisher';
import { createReadStream, lstatSync, readdirSync, readFileSync } from 'fs';
import JSZip from 'jszip';
import path from 'path';
import { Readable } from 'stream';
import { PublishInputs } from './io-helper';

export async function uploadToPlayStore(inputs: PublishInputs): Promise<string[]> {
  core.debug('Executing uploadToPlayStore');

  const googleAuth = new auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/androidpublisher']
  });
  const androidPublisher: androidpublisher_v3.Androidpublisher = androidpublisher({
    version: 'v3',
    auth: googleAuth
  });

  // Check the 'track' for 'internalsharing', if so switch to a non-track api
  if (inputs.track === 'internalsharing') {
    core.debug('Track is Internal app sharing, switch to special upload api');
    const downloadUrls: string[] = [];
    for (const releaseFile of inputs.releaseFiles) {
      core.debug(`Uploading ${releaseFile}`);
      const downloadUrl = await uploadInternalSharingRelease(androidPublisher, inputs, releaseFile);
      downloadUrls.push(downloadUrl);
    }
    core.exportVariable('INTERNAL_SHARING_DOWNLOAD_URLS', downloadUrls);
    core.debug(`Finished uploading to the Play Store.`);
    return downloadUrls;
  } else {
    // Create a new Edit
    const appEditId = await getOrCreateEdit(androidPublisher, inputs);

    // Validate the given track
    await validateSelectedTrack(androidPublisher, appEditId, inputs);

    // Upload artifacts to Google Play, and store their version codes
    const versionCodes = await uploadReleaseFiles(androidPublisher, appEditId, inputs);

    // Add the uploaded artifacts to the Edit track
    core.info(`Adding ${versionCodes.length} artifacts to release on '${inputs.track}' track`);
    const track = await addReleasesToTrack(androidPublisher, appEditId, inputs, versionCodes);
    core.debug(`Track: ${track}`);

    // Commit the pending Edit
    core.info(`Committing the Edit`);
    const res = await androidPublisher.edits.commit({
      editId: appEditId,
      packageName: inputs.packageName,
      changesNotSentForReview: inputs.changesNotSentForReview
    });

    if (res.data.id == null) {
      throw new Error(`Error ${res.status}: ${res.statusText}`);
    }
    core.info(`Successfully committed ${res.data.id}`);
    core.debug(`Finished uploading to the Play Store.`);

    return versionCodes.map(version => `https://play.google.com/apps/test/${inputs.packageName}/${version}`);
  }
}

async function uploadInternalSharingRelease(
  androidPublisher: androidpublisher_v3.Androidpublisher,
  inputs: PublishInputs,
  releaseFile: string
): Promise<string> {
  let res: androidpublisher_v3.Schema$InternalAppSharingArtifact;
  if (releaseFile.endsWith('.apk')) {
    res = await internalSharingUploadApk(androidPublisher, inputs, releaseFile);
  } else if (releaseFile.endsWith('.aab')) {
    res = await internalSharingUploadBundle(androidPublisher, inputs, releaseFile);
  } else {
    throw new Error(`${releaseFile} is invalid (missing or invalid file extension).`);
  }

  if (!res.downloadUrl)
    throw Error('Uploaded file has no download URL.');

  core.exportVariable('INTERNAL_SHARING_DOWNLOAD_URL', res.downloadUrl);
  core.debug(`${releaseFile} uploaded to Internal Sharing, download it with ${res.downloadUrl}`);
  return res.downloadUrl;
}

async function uploadRelease(
  androidPublisher: androidpublisher_v3.Androidpublisher,
  appEditId: string,
  inputs: PublishInputs,
  releaseFile: string
): Promise<number> {
  let result: androidpublisher_v3.Schema$Apk | androidpublisher_v3.Schema$Bundle;
  if (releaseFile.endsWith('.apk')) {
    result = await uploadApk(androidPublisher, appEditId, inputs, releaseFile);
    if (!result.versionCode)
      throw Error('Failed to upload APK.');
  } else if (releaseFile.endsWith('.aab')) {
    result = await uploadBundle(androidPublisher, appEditId, inputs, releaseFile);
    if (!result.versionCode)
      throw Error('Failed to upload bundle.');
  } else {
    throw new Error(`${releaseFile} is invalid`);
  }

  await uploadMappingFile(androidPublisher, appEditId, result.versionCode, inputs);
  await uploadDebugSymbolsFile(androidPublisher, appEditId, result.versionCode, inputs);
  return result.versionCode;
}

async function validateSelectedTrack(
  androidPublisher: androidpublisher_v3.Androidpublisher,
  appEditId: string,
  inputs: PublishInputs
) {
  core.info(`Validating track '${inputs.track}'`);
  const res = await androidPublisher.edits.tracks.list({
    editId: appEditId,
    packageName: inputs.packageName
  });

  if (!isSuccessStatusCode(res.status))
    throw new Error(res.statusText);

  const allTracks = res.data.tracks;
  if (allTracks == null)
    throw new Error('No tracks found, unable to validate track.');

  // Check whether the track is valid
  const allTrackNames = allTracks.map(t => t.track);
  if (!allTrackNames.includes(inputs.track))
    throw new Error(`Track "${inputs.track}" could not be found. Available tracks are: ${allTrackNames.toString()}`);
}

async function addReleasesToTrack(
  androidPublisher: androidpublisher_v3.Androidpublisher,
  appEditId: string,
  inputs: PublishInputs,
  versionCodes: number[]
): Promise<androidpublisher_v3.Schema$Track> {
  let status: string | undefined = inputs.status;
  if (!status) {
    if (inputs.userFraction != undefined) {
      status = 'inProgress';
    } else {
      status = 'completed';
    }
  }

  core.debug(`Creating Track Release for Edit(${appEditId}) for Track(${inputs.track}) with a UserFraction(${inputs.userFraction}), Status(${status}), and VersionCodes(${versionCodes})`);
  const res = await androidPublisher.edits.tracks.update({
    editId: appEditId,
    packageName: inputs.packageName,
    track: inputs.track,
    requestBody: {
      track: inputs.track,
      releases: [
        {
          name: inputs.releaseName,
          userFraction: inputs.userFraction,
          status: status,
          inAppUpdatePriority: inputs.inAppUpdatePriority,
          releaseNotes: await readLocalizedReleaseNotes(inputs.whatsNewDirectory),
          versionCodes: versionCodes.filter(x => x != 0).map(x => x.toString())
        }
      ]
    }
  });

  return res.data;
}

async function uploadMappingFile(
  androidPublisher: androidpublisher_v3.Androidpublisher,
  appEditId: string,
  versionCode: number,
  inputs: PublishInputs
) {
  if (inputs.mappingFile != undefined && inputs.mappingFile.length > 0) {
    core.debug(`[${appEditId}, versionCode=${versionCode}, packageName=${inputs.packageName}]: Uploading Proguard mapping file @ ${inputs.mappingFile}`);
    await androidPublisher.edits.deobfuscationfiles.upload({
      packageName: inputs.packageName,
      editId: appEditId,
      apkVersionCode: versionCode,
      deobfuscationFileType: 'proguard',
      media: {
        mimeType: 'application/octet-stream',
        body: createReadStream(inputs.mappingFile)
      }
    });
  }
}

async function uploadDebugSymbolsFile(
  androidPublisher: androidpublisher_v3.Androidpublisher,
  appEditId: string,
  versionCode: number,
  inputs: PublishInputs
) {
  if (inputs.debugSymbols != undefined && inputs.debugSymbols.length > 0) {
    const fileStat = lstatSync(inputs.debugSymbols);

    let data: Buffer;
    if (fileStat.isDirectory())
      data = await createDebugSymbolZipFile(inputs.debugSymbols);
    else
      data = readFileSync(inputs.debugSymbols);

    core.debug(`[${appEditId}, versionCode=${versionCode}, packageName=${inputs.packageName}]: Uploading Debug Symbols file @ ${inputs.debugSymbols}`);
    await androidPublisher.edits.deobfuscationfiles.upload({
      packageName: inputs.packageName,
      editId: appEditId,
      apkVersionCode: versionCode,
      deobfuscationFileType: 'nativeCode',
      media: {
        mimeType: 'application/octet-stream',
        body: Readable.from(data)
      }
    });
  }
}

async function zipFileAddDirectory(root: JSZip | null, dirPath: string, rootPath: string, isRootRoot: boolean) {
  if (root == null) return root;

  const newRootPath = path.join(rootPath, dirPath);
  const fileStat = lstatSync(newRootPath);

  if (!fileStat.isDirectory()) {
    const data = readFileSync(newRootPath);
    root.file(dirPath, data);
    return root;
  }

  const dir = readdirSync(newRootPath);
  const zipFolder = isRootRoot ? root : root.folder(dirPath);
  for (const underPath of dir) {
    await zipFileAddDirectory(zipFolder, underPath, newRootPath, false);
  }

  return root;
}

async function createDebugSymbolZipFile(debugSymbolsPath: string) {
  const zipFile = new JSZip();
  await zipFileAddDirectory(zipFile, '.', debugSymbolsPath, true);

  return zipFile.generateAsync({type: 'nodebuffer'});
}

async function internalSharingUploadApk(
  androidPublisher: androidpublisher_v3.Androidpublisher,
  inputs: PublishInputs,
  apkReleaseFile: string
): Promise<androidpublisher_v3.Schema$InternalAppSharingArtifact> {
  core.debug(`[packageName=${inputs.packageName}]: Uploading Internal Sharing APK @ ${apkReleaseFile}`);

  const res = await androidPublisher.internalappsharingartifacts.uploadapk({
    packageName: inputs.packageName,
    media: {
      mimeType: 'application/vnd.android.package-archive',
      body: createReadStream(apkReleaseFile)
    }
  });

  return res.data;
}

async function internalSharingUploadBundle(
  androidPublisher: androidpublisher_v3.Androidpublisher,
  inputs: PublishInputs,
  bundleReleaseFile: string
): Promise<androidpublisher_v3.Schema$InternalAppSharingArtifact> {
  core.debug(`[packageName=${inputs.packageName}]: Uploading Internal Sharing Bundle @ ${bundleReleaseFile}`);

  const res = await androidPublisher.internalappsharingartifacts.uploadbundle({
    packageName: inputs.packageName,
    media: {
      mimeType: 'application/octet-stream',
      body: createReadStream(bundleReleaseFile)
    }
  });

  return res.data;
}

async function uploadApk(
  androidPublisher: androidpublisher_v3.Androidpublisher,
  appEditId: string,
  inputs: PublishInputs,
  apkReleaseFile: string
): Promise<androidpublisher_v3.Schema$Apk> {
  core.debug(`[${appEditId}, packageName=${inputs.packageName}]: Uploading APK @ ${apkReleaseFile}`);

  const res = await androidPublisher.edits.apks.upload({
    packageName: inputs.packageName,
    editId: appEditId,
    media: {
      mimeType: 'application/vnd.android.package-archive',
      body: createReadStream(apkReleaseFile)
    }
  });

  return res.data;
}

async function uploadBundle(
  androidPublisher: androidpublisher_v3.Androidpublisher,
  appEditId: string,
  inputs: PublishInputs,
  bundleReleaseFile: string
): Promise<androidpublisher_v3.Schema$Bundle> {
  core.debug(`[${appEditId}, packageName=${inputs.packageName}]: Uploading App Bundle @ ${bundleReleaseFile}`);
  const res = await androidPublisher.edits.bundles.upload({
    packageName: inputs.packageName,
    editId: appEditId,
    deviceTierConfigId: inputs.deviceTierConfigId,
    media: {
      mimeType: 'application/octet-stream',
      body: createReadStream(bundleReleaseFile)
    }
  });

  return res.data;
}

export async function readLocalizedReleaseNotes(whatsNewDir: string | undefined): Promise<androidpublisher_v3.Schema$LocalizedText[] | undefined> {
  core.debug(`Executing readLocalizedReleaseNotes`);
  if (whatsNewDir != undefined && whatsNewDir.length > 0) {
    const releaseNotes = readdirSync(whatsNewDir)
      .filter(value => /whatsnew-((.*-.*)|(.*))\b/.test(value));
    const pattern = /whatsnew-(?<local>(.*-.*)|(.*))/;

    const localizedReleaseNotes: androidpublisher_v3.Schema$LocalizedText[] = [];

    core.debug(`Found files: ${releaseNotes}`);
    releaseNotes.forEach(value => {
      const matches = value.match(pattern);
      core.debug(`Matches for ${value} = ${matches}`);
      if (matches != undefined && matches[1] != undefined) {
        const lang = matches[1];
        const filePath = path.join(whatsNewDir, value);
        const content = readFileSync(filePath, 'utf-8');
        core.debug(`Found localized 'whatsnew-*-*' for Lang(${lang})`);
        localizedReleaseNotes.push({language: lang, text: content});
      }
    });

    return localizedReleaseNotes;
  }
  return undefined;
}

async function getOrCreateEdit(
  androidPublisher: androidpublisher_v3.Androidpublisher,
  inputs: PublishInputs
): Promise<string> {
  // If we already have an ID, just return that
  if (inputs.existingEditId)
    return inputs.existingEditId;

  // Else attempt to create a new edit. This will throw if there is an issue
  core.info(`Creating a new Edit for this release`);
  const result = await androidPublisher.edits.insert({
    packageName: inputs.packageName
  });

  // If we didn't get status 200, i.e. success, propagate the error with valid text
  if (!isSuccessStatusCode(result.status))
    throw new Error(result.statusText);

  // If the result was successful but we have no ID, something went horribly wrong
  if (!result.data.id)
    throw new Error('New edit has no ID, cannot continue.');

  core.debug(`This new edit expires at ${result.data.expiryTimeSeconds}`);
  // Return the new edit ID
  return result.data.id;
}

function isSuccessStatusCode(statusCode?: number): boolean {
  if (!statusCode) return false;
  return statusCode >= 200 && statusCode < 300;
}

async function uploadReleaseFiles(
  androidPublisher: androidpublisher_v3.Androidpublisher,
  appEditId: string,
  inputs: PublishInputs
): Promise<number[]> {
  const versionCodes: number[] = [];
  // Upload all release files
  for (const releaseFile of inputs.releaseFiles) {
    core.info(`Uploading ${releaseFile}`);
    const versionCode = await uploadRelease(androidPublisher, appEditId, inputs, releaseFile);
    versionCodes.push(versionCode);
  }

  core.info(`Successfully uploaded ${versionCodes.length} artifacts`);

  return versionCodes;
}

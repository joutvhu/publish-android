import * as core from '@actions/core';
import {androidpublisher, androidpublisher_v3} from '@googleapis/androidpublisher';
import {createReadStream, readdirSync, readFileSync} from 'fs';
import path from 'path';
import {PublishInputs} from './io-helper';

const androidPublisher: androidpublisher_v3.Androidpublisher = androidpublisher('v3');

export async function uploadToPlayStore(inputs: PublishInputs): Promise<string[] | undefined> {
    core.exportVariable('GOOGLE_APPLICATION_CREDENTIALS', inputs.googleApplicationCredentials);
    // Check the 'track' for 'internalsharing', if so switch to a non-track api
    if (inputs.track === 'internalsharing') {
        core.debug('Track is Internal app sharing, switch to special upload api');
        let downloadUrls: string[] = [];
        for (const releaseFile of inputs.releaseFiles) {
            core.debug(`Uploading ${releaseFile}`);
            const downloadUrl = await uploadInternalSharingRelease(inputs, releaseFile);
            downloadUrls.push(downloadUrl as string);
        }
        core.exportVariable('INTERNAL_SHARING_DOWNLOAD_URLS', downloadUrls);
        core.debug(`Finished uploading to the Play Store.`);
        return downloadUrls;
    } else {
        // Create a new Edit
        core.info(`Creating a new Edit for this release`);
        const appEditId = inputs.existingEditId || (await androidPublisher.edits.insert({
            auth: inputs.authClient,
            packageName: inputs.packageName
        })).data.id;

        // Validate the given track
        core.info(`Validating track '${inputs.track}'`);
        await validateSelectedTrack(appEditId!, inputs);

        // Upload artifacts to Google Play, and store their version codes
        const versionCodes = new Array<number>();
        for (const releaseFile of inputs.releaseFiles) {
            core.info(`Uploading ${releaseFile}`);
            const versionCode = await uploadRelease(appEditId!, inputs, releaseFile);
            versionCodes.push(versionCode!);
        }
        core.info(`Successfully uploaded ${versionCodes.length} artifacts`);

        // Add the uploaded artifacts to the Edit track
        core.info(`Adding ${versionCodes.length} artifacts to release on '${inputs.track}' track`);
        const track = await addReleasesToTrack(appEditId!, inputs, versionCodes);
        core.debug(`Track: ${track}`);

        // Commit the pending Edit
        core.info(`Committing the Edit`);
        const res = await androidPublisher.edits.commit({
            auth: inputs.authClient,
            editId: appEditId!,
            packageName: inputs.packageName,
            changesNotSentForReview: inputs.changesNotSentForReview
        });

        if (res.data.id == null) {
            throw new Error(`Error ${res.status}: ${res.statusText}`);
        }
        core.info(`Successfully committed ${res.data.id}`);
        core.debug(`Finished uploading to the Play Store.`);
    }
}

async function uploadInternalSharingRelease(inputs: PublishInputs, releaseFile: string): Promise<string | undefined | null> {
    if (releaseFile.endsWith('.apk')) {
        const res = await internalSharingUploadApk(inputs, releaseFile);
        core.exportVariable('INTERNAL_SHARING_DOWNLOAD_URL', res.downloadUrl);

        core.debug(`${releaseFile} uploaded to Internal Sharing, download it with ${res.downloadUrl}`);
        return res.downloadUrl;
    } else if (releaseFile.endsWith('.aab')) {
        const res = await internalSharingUploadBundle(inputs, releaseFile);
        core.exportVariable('INTERNAL_SHARING_DOWNLOAD_URL', res.downloadUrl);

        core.debug(`${releaseFile} uploaded to Internal Sharing, download it with ${res.downloadUrl}`);
        return res.downloadUrl;
    } else {
        throw new Error(`${releaseFile} is invalid`);
    }
}

async function uploadRelease(appEditId: string, inputs: PublishInputs, releaseFile: string): Promise<number | undefined | null> {
    if (releaseFile.endsWith('.apk')) {
        const apk = await uploadApk(appEditId, inputs, releaseFile);
        await uploadMappingFile(appEditId, apk.versionCode!, inputs);
        return apk.versionCode;
    } else if (releaseFile.endsWith('.aab')) {
        const bundle = await uploadBundle(appEditId, inputs, releaseFile);
        await uploadMappingFile(appEditId, bundle.versionCode!, inputs);
        return bundle.versionCode;
    } else {
        throw new Error(`${releaseFile} is invalid`);
    }
}

async function validateSelectedTrack(appEditId: string, inputs: PublishInputs) {
    const res = await androidPublisher.edits.tracks.list({
        auth: inputs.authClient,
        editId: appEditId,
        packageName: inputs.packageName
    });
    const allTracks = res.data.tracks;
    if (allTracks == undefined || allTracks.find(value => value.track == inputs.track) == undefined) {
        throw new Error(`Track "${inputs.track}" could not be found`);
    }
}

async function addReleasesToTrack(appEditId: string, inputs: PublishInputs, versionCodes: number[]): Promise<androidpublisher_v3.Schema$Track> {
    let status: string | undefined = inputs.status;
    if (!status) {
        if (inputs.userFraction != undefined) {
            status = 'inProgress';
        } else {
            status = 'completed';
        }
    }

    core.debug(`Creating Track Release for Edit(${appEditId}) for Track(${inputs.track}) with a UserFraction(${inputs.userFraction}), Status(${status}), and VersionCodes(${versionCodes})`);
    const res = await androidPublisher.edits.tracks
        .update({
            auth: inputs.authClient,
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

async function uploadMappingFile(appEditId: string, versionCode: number, inputs: PublishInputs) {
    if (inputs.mappingFile != undefined && inputs.mappingFile.length > 0) {
        const mapping = readFileSync(inputs.mappingFile, 'utf-8');
        if (mapping != undefined) {
            core.debug(`[${appEditId}, versionCode=${versionCode}, packageName=${inputs.packageName}]: Uploading Proguard mapping file @ ${inputs.mappingFile}`);
            await androidPublisher.edits.deobfuscationfiles.upload({
                auth: inputs.authClient,
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
}

async function internalSharingUploadApk(inputs: PublishInputs, apkReleaseFile: string): Promise<androidpublisher_v3.Schema$InternalAppSharingArtifact> {
    core.debug(`[packageName=${inputs.packageName}]: Uploading Internal Sharing APK @ ${apkReleaseFile}`);

    const res = await androidPublisher.internalappsharingartifacts.uploadapk({
        auth: inputs.authClient,
        packageName: inputs.packageName,
        media: {
            mimeType: 'application/vnd.android.package-archive',
            body: createReadStream(apkReleaseFile)
        }
    });

    return res.data;
}

async function internalSharingUploadBundle(inputs: PublishInputs, bundleReleaseFile: string): Promise<androidpublisher_v3.Schema$InternalAppSharingArtifact> {
    core.debug(`[packageName=${inputs.packageName}]: Uploading Internal Sharing Bundle @ ${bundleReleaseFile}`);

    const res = await androidPublisher.internalappsharingartifacts.uploadbundle({
        auth: inputs.authClient,
        packageName: inputs.packageName,
        media: {
            mimeType: 'application/octet-stream',
            body: createReadStream(bundleReleaseFile)
        }
    });

    return res.data;
}

async function uploadApk(appEditId: string, inputs: PublishInputs, apkReleaseFile: string): Promise<androidpublisher_v3.Schema$Apk> {
    core.debug(`[${appEditId}, packageName=${inputs.packageName}]: Uploading APK @ ${apkReleaseFile}`);

    const res = await androidPublisher.edits.apks.upload({
        auth: inputs.authClient,
        packageName: inputs.packageName,
        editId: appEditId,
        media: {
            mimeType: 'application/vnd.android.package-archive',
            body: createReadStream(apkReleaseFile)
        }
    });

    return res.data;
}

async function uploadBundle(appEditId: string, inputs: PublishInputs, bundleReleaseFile: string): Promise<androidpublisher_v3.Schema$Bundle> {
    core.debug(`[${appEditId}, packageName=${inputs.packageName}]: Uploading App Bundle @ ${bundleReleaseFile}`);
    const res = await androidPublisher.edits.bundles.upload({
        auth: inputs.authClient,
        packageName: inputs.packageName,
        editId: appEditId,
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

        let localizedReleaseNotes: androidpublisher_v3.Schema$LocalizedText[] = [];

        core.debug(`Found files: ${releaseNotes}`);
        releaseNotes.forEach(value => {
            const matches = value.match(pattern);
            core.debug(`Matches for ${value} = ${matches}`);
            if (matches != undefined && matches.length == 4) {
                const lang = matches[1];
                const filePath = path.join(whatsNewDir, value);
                const content = readFileSync(filePath, 'utf-8');

                if (content != undefined) {
                    core.debug(`Found localized 'whatsnew-*-*' for Lang(${lang})`);
                    localizedReleaseNotes.push(
                        {
                            language: lang,
                            text: content
                        }
                    );
                }
            }
        });

        return localizedReleaseNotes;
    }
    return undefined;
}

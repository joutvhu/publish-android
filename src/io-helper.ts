import * as core from '@actions/core';
import {getInput, InputOptions} from '@actions/core';
import fg from 'fast-glob';
import {existsSync, writeFileSync} from 'fs';
import {Compute} from 'google-auth-library/build/src/auth/computeclient';
import {JSONClient} from 'google-auth-library/build/src/auth/googleauth';
import {Inputs, Outputs} from './constants';

export interface PublishInputs {
    authClient: Compute | JSONClient;
    googleApplicationCredentials: string;
    createdGoogleCredentialsFile: boolean;
    packageName: string;
    releaseFiles: string[];
    releaseName: string;
    track: string;
    inAppUpdatePriority: number;
    userFraction?: number;
    status?: string;
    whatsNewDirectory?: string;
    mappingFile?: string;
    changesNotSentForReview?: boolean;
    existingEditId?: string;
    debugSymbols?: string;
}

export function isBlank(value: any): boolean {
    return value === null || value === undefined || (value.length !== undefined && value.length === 0);
}

export function isNotBlank(value: any): boolean {
    return value !== null && value !== undefined && (value.length === undefined || value.length > 0);
}

export function getBooleanInput(name: string, options?: InputOptions, defaultValue?: boolean): boolean | undefined {
    const value = core.getInput(name, options);
    if (isNotBlank(value)) {
        return ['y', 'yes', 't', 'true', 'e', 'enable', 'enabled', 'on', 'ok', '1']
            .includes(value.trim().toLowerCase());
    }
    return options?.required ? defaultValue : undefined;
}

export function getIntegerInput(name: string, options?: InputOptions, defaultValue?: number): number | undefined {
    const value = core.getInput(name, options);
    if (isNotBlank(value)) {
        const result = parseInt(value, 10);
        if (!isNaN(result))
            return result;
    }
    return options?.required ? defaultValue : undefined;
}

export function getFloatInput(name: string, options?: InputOptions, defaultValue?: number): number | undefined {
    const value = core.getInput(name, options);
    if (isNotBlank(value)) {
        const result = parseFloat(value);
        if (!isNaN(result))
            return result;
    }
    return options?.required ? defaultValue : undefined;
}

export async function getInputs(): Promise<PublishInputs> {
    core.debug('Getting the inputs.');
    const result: PublishInputs | any = {};

    const serviceAccountJson = getInput(Inputs.ServiceAccountJson, {required: true});
    if (serviceAccountJson) {
        if (/^([ \n\t]*){.+}([ \n\t]*)$/s.test(serviceAccountJson)) {
            const serviceAccountFile = './.service-account.google.json';
            writeFileSync(serviceAccountFile, serviceAccountJson, {encoding: 'utf8'});
            core.debug(`Created file "${serviceAccountFile}"`);
            result.googleApplicationCredentials = serviceAccountFile;
            result.createdGoogleCredentialsFile = true;
        } else {
            result.googleApplicationCredentials = serviceAccountJson;
            result.createdGoogleCredentialsFile = false;
        }
    } else {
        console.log('No service account json key provided!');
        throw new Error('You must provide one of \'serviceAccountJson\' to use this action');
    }

    result.packageName = getInput(Inputs.PackageName, {required: true});

    const releaseFiles = getInput(Inputs.ReleaseFile, {required: true})
        .split(/\r?\n/)
        .map(name => name.trim())
        .filter(name => name.length > 0) || [];
    if (releaseFiles.length > 0) {
        core.debug(`Finding files ${releaseFiles.join(',')}`);
        const files = await fg(releaseFiles);
        if (!files.length) {
            throw new Error(`Unable to find any release file @ ${releaseFiles.join(',')}`);
        }
        result.releaseFiles = files;
    } else {
        throw new Error(`You must provide either 'releaseFile' in your configuration.`);
    }

    const releaseName = core.getInput(Inputs.ReleaseName, {required: false});
    if (isNotBlank(releaseName))
        result.releaseName = releaseName.trim();

    result.track = getInput(Inputs.Track, {required: true});

    const inAppUpdatePriority = getIntegerInput(Inputs.InAppUpdatePriority, {required: false});
    if (inAppUpdatePriority == null) {
        result.inAppUpdatePriority = undefined;
    } else if (inAppUpdatePriority < 0 || inAppUpdatePriority > 5) {
        throw new Error('inAppUpdatePriority must be between 0 and 5, inclusive-inclusive');
    } else {
        result.inAppUpdatePriority = inAppUpdatePriority;
    }

    const userFraction = getFloatInput(Inputs.UserFraction, {required: false});
    if (userFraction == null) {
        result.userFraction = undefined;
    } else if (userFraction < 0.0 || userFraction > 1.0) {
        throw new Error('A provided userFraction must be between 0.0 and 1.0, inclusive-inclusive');
    } else {
        result.userFraction = userFraction;
    }

    result.status = getInput(Inputs.Status, {required: false});
    switch (result.status) {
        case 'completed':
        case 'draft':
            if (userFraction != null)
                throw new Error(`Status '${result.status}' does not support 'userFraction'`);
            break;
        case 'halted':
        case 'inProgress':
            if (userFraction == null)
                throw new Error(`Status '${result.status}' requires a 'userFraction' to be set`);
            break;
        default:
            throw new Error(`Invalid status provided! Must be one of 'completed', 'inProgress', 'halted', 'draft'. Got ${result.status ?? 'undefined'}`);
    }

    const whatsNewDirectory = getInput(Inputs.WhatsNewDirectory, {required: false});
    if (whatsNewDirectory != null && whatsNewDirectory.length > 0 && !existsSync(whatsNewDirectory)) {
        throw new Error(`Unable to find 'whatsnew' directory @ ${whatsNewDirectory}`);
    } else {
        result.whatsNewDirectory = whatsNewDirectory;
    }

    const mappingFile = getInput(Inputs.MappingFile, {required: false});
    if (mappingFile != null && mappingFile.length > 0 && !existsSync(mappingFile)) {
        throw new Error(`Unable to find 'mappingFile' @ ${mappingFile}`);
    } else {
        result.mappingFile = mappingFile;
    }

    result.changesNotSentForReview = getBooleanInput(Inputs.ChangesNotSentForReview, {required: false}, false);
    result.existingEditId = getInput(Inputs.ExistingEditId, {required: false});

    result.debugSymbols = getInput(Inputs.DebugSymbols, {required: false});

    return result;
}

export function setOutputs(response: any) {
    if (response != null) {
        // Get the outputs for the created release from the response
        let message = '';
        for (const key in Outputs) {
            const field: string = (Outputs as any)[key];
            message += `\n  ${field}: ${JSON.stringify(response[field])}`;
            core.setOutput(field, response[field]);
        }

        core.debug('Outputs:' + message);
    } else {
        core.debug('No output.');
    }
}

import * as core from '@actions/core';
import {auth} from '@googleapis/androidpublisher';
import {unlinkSync} from 'fs';
import {Outputs} from './constants';
import {uploadToPlayStore} from './google-apis';
import {getInputs, PublishInputs, setOutputs} from './io-helper';

(async function run() {
    let inputs: PublishInputs | undefined;
    try {
        inputs = await getInputs();

        const googleAuth = new auth.GoogleAuth({
            scopes: ['https://www.googleapis.com/auth/androidpublisher']
        });
        inputs.authClient = await googleAuth.getClient();

        const urls = await uploadToPlayStore(inputs);

        setOutputs({
            [Outputs.InternalSharingDownloadUrls]: urls,
            [Outputs.InternalSharingDownloadUrl]: urls != null && urls.length > 0 ? urls[urls.length - 1] : undefined
        });
    } catch (err: any) {
        core.setFailed(err.message);
    } finally {
        if (inputs?.createdGoogleCredentialsFile) {
            core.debug('Cleaning up service account json file');
            unlinkSync('./.google-service-account.json');
        }
    }
})();
